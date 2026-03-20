// src/modules/user/user.controller.ts

import type { Request, Response } from "express";
import { User }         from "./user.model";
import { Cart }         from "../cart/cart.model";
import { ApiError }     from "../../utils/apiError";
import { asyncHandler } from "../../utils/asynchandler";
import { sendSuccess, sendCreated } from "../../utils/response";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../../utils/jwt";
import type { AuthRequest } from "../../middleware/auth";
import { geocodeAddress, haversineDistanceKm } from "../../utils/geocode";
import { env } from "../../config/env";

/* ─────────────────────────────────────────
   Cookie Config (centralized)
───────────────────────────────────────── */
const isProd = process.env.NODE_ENV === "production";

const cookieOptions = {
  httpOnly: true,
  secure:   isProd,
  sameSite: isProd ? 'none' as const : 'lax' as const,  // ✅ 'none' in prod
  path:     '/',
  // domain:   isProd ? '.greenkartt.shop' : undefined,
};

const accessCookieOptions  = { ...cookieOptions, maxAge: 15 * 60 * 1000 };           // 15 min
const refreshCookieOptions = { ...cookieOptions, maxAge: 30 * 24 * 60 * 60 * 1000 };

/* ─────────────────────────────────────────
   Register
───────────────────────────────────────── */
// src/modules/user/user.controller.ts (register only)

export const register = asyncHandler(async (req: Request, res: Response) => {
  const { name, phoneNumber, password, address } = req.body;

  if (!name || !phoneNumber || !password) {
    throw ApiError.badRequest("name, phoneNumber and password are required");
  }

  const existing = await User.findOne({ phoneNumber });
  if (existing) throw ApiError.conflict("Phone number is already registered");

  const addresses: any[] = [];

  /* ─────────────────────────────────────────
     ADDRESS HANDLING (FIXED + RELIABLE)
  ───────────────────────────────────────── */
  if (address) {
    const city = address.city?.toLowerCase().trim();
    const pincode = address.pincode?.toString().trim();

    let coords: { lat: number; lng: number } | null = null;
    let isFallback = false;

    try {
      if (address.line1 && address.city && address.pincode) {
        coords = await geocodeAddress(address.line1, address.city, address.pincode);
      }
    } catch {
      coords = null;
    }

    // ── Fallback logic ─────────────────────
    if (!coords) {
      if (city === "khatima" && pincode === "262308") {
        coords = {
          lat: env.store.lat,
          lng: env.store.lng,
        };
        isFallback = true;
      } else {
        throw ApiError.badRequest(
          "Service available only in Khatima (262308). Unable to verify your location."
        );
      }
    }

    // ── Distance check (only if NOT fallback)
    if (!isFallback) {
      const distanceKm = haversineDistanceKm(
        env.store.lat,
        env.store.lng,
        coords.lat,
        coords.lng
      );

      if (distanceKm > env.store.radiusKm) {
        throw ApiError.badRequest(
          `We serve within ${env.store.radiusKm}km. Your area is ${Math.round(distanceKm)}km away.`
        );
      }
    }

    // ── ALWAYS PUSH ADDRESS ────────────────
    const addressObj = {
      line1: address.line1 ?? "",
      line2: address.line2 ?? "",
      city: address.city ?? "",
      pincode: address.pincode ?? "",
      isDefault: true,
    };

    addresses.push(addressObj);
  }

  /* ─────────────────────────────────────────
     USER CREATION
  ───────────────────────────────────────── */
  const user = new User({
    name,
    phoneNumber,
    password,
    addresses,
    isPhoneVerified: false,
  });

  const cart = await Cart.create({ userId: user._id });
  user.cart = cart._id;

  /* ─────────────────────────────────────────
     TOKENS
  ───────────────────────────────────────── */
  const payload = { userId: user._id.toString(), role: "customer" };

  const accessToken = signAccessToken(payload);
  const refreshToken = signRefreshToken(payload);

  user.refreshToken = refreshToken;

  /* ─────────────────────────────────────────
     SAVE USER
  ───────────────────────────────────────── */
  await user.save();

  /* ─────────────────────────────────────────
     SET COOKIES
  ───────────────────────────────────────── */
  res.cookie("accessToken", accessToken, cookieOptions);
  res.cookie("refreshToken", refreshToken, cookieOptions);

  /* ─────────────────────────────────────────
     RESPONSE
  ───────────────────────────────────────── */
  sendCreated(res, { user }, "Registration successful");
});

/* ─────────────────────────────────────────
   Login
───────────────────────────────────────── */
export const login = asyncHandler(async (req: Request, res: Response) => {
  const { phoneNumber, password } = req.body;

  if (!phoneNumber || !password) {
    throw ApiError.badRequest("phoneNumber and password are required");
  }

  const user = await User.findOne({ phoneNumber }).select("+password");
  if (!user) throw ApiError.unauthorized("Invalid credentials");

  const isMatch = await user.comparePassword(password);
  if (!isMatch) throw ApiError.unauthorized("Invalid credentials");

  const payload = { userId: user._id.toString(), role: "customer" };
  const accessToken = signAccessToken(payload);
  const refreshToken = signRefreshToken(payload);

  user.refreshToken = refreshToken;
  await user.save({ validateBeforeSave: false });

  res.cookie("accessToken", accessToken, cookieOptions);
  res.cookie("refreshToken", refreshToken, cookieOptions);

  sendSuccess(res, { user }, "Login successful");
});

/* ─────────────────────────────────────────
   Refresh Token
───────────────────────────────────────── */
export const refreshToken = asyncHandler(async (req: Request, res: Response) => {
  const token = req.cookies?.refreshToken;

  if (!token) throw ApiError.unauthorized("No refresh token");

  const decoded = verifyRefreshToken(token);
  const user    = await User.findById(decoded.userId).select("+refreshToken");

  if (!user || user.refreshToken !== token) {
    // ✅ Clear stale cookies so the browser doesn't keep retrying with them
    res.clearCookie("accessToken",  { path: '/' });
    res.clearCookie("refreshToken", { path: '/' });
    throw ApiError.unauthorized("Invalid refresh token");
  }

  const payload         = { userId: user._id.toString(), role: "customer" };
  const newAccessToken  = signAccessToken(payload);
  const newRefreshToken = signRefreshToken(payload);

  user.refreshToken = newRefreshToken;
  await user.save({ validateBeforeSave: false });

  res.cookie("accessToken",  newAccessToken,  accessCookieOptions);
  res.cookie("refreshToken", newRefreshToken, refreshCookieOptions);

  sendSuccess(res, null, "Token refreshed");
});

/* ─────────────────────────────────────────
   Logout
───────────────────────────────────────── */
export const logout = asyncHandler(async (req: AuthRequest, res: Response) => {
  // Clear refresh token from DB so it can't be reused
  await User.findByIdAndUpdate(req.user?.userId, {
    $unset: { refreshToken: 1 },
  });

  res.clearCookie("accessToken",  { path: '/', ...(isProd && { secure: true, sameSite: 'none' }) });
  res.clearCookie("refreshToken", { path: '/', ...(isProd && { secure: true, sameSite: 'none' }) });

  sendSuccess(res, null, "Logged out");
});

/* ─────────────────────────────────────────
   Get Me
───────────────────────────────────────── */
export const getMe = asyncHandler(async (req: AuthRequest, res: Response) => {
  const user = await User.findById(req.user!.userId)
    .populate("cart")
    .populate({
      path: "orders",
      select: "orderId totalAmount status createdAt",
      options: { limit: 5, sort: { createdAt: -1 } },
    });

  if (!user) throw ApiError.notFound("User not found");

  sendSuccess(res, { user }, "Profile fetched");
});

/* ─────────────────────────────────────────
   Update Profile
───────────────────────────────────────── */
export const updateMe = asyncHandler(async (req: AuthRequest, res: Response) => {
  const updates: Record<string, unknown> = {};
  if (req.body.name !== undefined) updates.name = req.body.name;

  if (!Object.keys(updates).length) {
    throw ApiError.badRequest("No valid fields provided");
  }

  const user = await User.findByIdAndUpdate(
    req.user!.userId,
    { $set: updates },
    { returnDocument : "after", runValidators: true }
  );

  if (!user) throw ApiError.notFound("User not found");

  sendSuccess(res, { user }, "Profile updated");
});

/* ─────────────────────────────────────────
   Address CRUD (unchanged logic)
───────────────────────────────────────── */
export const addAddress = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { line1, line2, city, pincode, isDefault } = req.body;

  if (!line1 || !city || !pincode) {
    throw ApiError.badRequest("Required fields missing");
  }

  const user = await User.findById(req.user!.userId);
  if (!user) throw ApiError.notFound("User not found");

  if (isDefault) user.addresses.forEach(a => a.isDefault = false);

  user.addresses.push({ line1, line2, city, pincode, isDefault: !!isDefault });
  await user.save();

  sendSuccess(res, { addresses: user.addresses }, "Address added");
});

export const deleteAddress = asyncHandler(async (req: AuthRequest, res: Response) => {
  const user = await User.findById(req.user!.userId);
  if (!user) throw ApiError.notFound("User not found");

  user.addresses = user.addresses.filter(
    a => a._id?.toString() !== req.params.addressId
  );

  await user.save();
  sendSuccess(res, { addresses: user.addresses }, "Address removed");
});

export const updateAddress = asyncHandler(async (req: AuthRequest, res: Response) => {
  const user = await User.findById(req.user!.userId);
  if (!user) throw ApiError.notFound("User not found");

  const address = user.addresses.find(
    a => a._id?.toString() === req.params.addressId
  );
  if (!address) throw ApiError.notFound("Address not found");

  Object.assign(address, req.body);

  if (req.body.isDefault) {
    user.addresses.forEach(a => a.isDefault = false);
    address.isDefault = true;
  }

  await user.save();
  sendSuccess(res, { addresses: user.addresses }, "Address updated");
});

/* ─────────────────────────────────────────
   Change Password
───────────────────────────────────────── */
export const changePassword = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    throw ApiError.badRequest("Missing fields");
  }

  const user = await User.findById(req.user!.userId).select("+password");
  if (!user) throw ApiError.notFound("User not found");

  const isMatch = await user.comparePassword(currentPassword);
  if (!isMatch) throw ApiError.unauthorized("Incorrect password");

  user.password = newPassword;
  await user.save();

  sendSuccess(res, null, "Password changed");
});