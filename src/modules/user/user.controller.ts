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

// ─── Register ─────────────────────────────────────────────────────────────────
// POST /api/v1/users/register
// Body: { name, phoneNumber, password, address? }
// Phone verification is handled entirely on the frontend (Firebase/any provider).
// By the time this endpoint is called, the phone is already verified.
// We just create the user and return tokens.
export const register = asyncHandler(async (req: Request, res: Response) => {
  const { name, phoneNumber, password, address } = req.body;

  if (!name || !phoneNumber || !password) {
    throw ApiError.badRequest("name, phoneNumber and password are required");
  }

  // ── Duplicate check ───────────────────────────────────────────────────────
  const existing = await User.findOne({ phoneNumber });
  if (existing) throw ApiError.conflict("Phone number is already registered");

  // ── Optional delivery radius check ────────────────────────────────────────
  const addresses = [];

  if (address?.line1 && address?.city && address?.pincode) {
    const coords = await geocodeAddress(address.line1, address.city, address.pincode);

    if (!coords) {
      throw ApiError.badRequest(
        "We could not verify your pincode. Please double-check your city and pincode."
      );
    }

    const distanceKm = haversineDistanceKm(
      env.store.lat, env.store.lng,
      coords.lat,    coords.lng
    );

    if (distanceKm > env.store.radiusKm) {
      throw ApiError.badRequest(
        `Sorry, we do not deliver to your area yet. ` +
        `We serve within ${env.store.radiusKm}km of our store. ` +
        `Your area is approximately ${Math.round(distanceKm)}km away.`
      );
    }

    addresses.push({
      line1:     address.line1,
      line2:     address.line2 ?? "",
      city:      address.city,
      pincode:   address.pincode,
      isDefault: true,
    });
  }

  // ── Create user + cart ─────────────────────────────────────────────────────
  const user = new User({
    name,
    phoneNumber,
    password,
    addresses,
    isPhoneVerified: false,   // frontend verified it before calling this
  });

  const cart  = await Cart.create({ userId: user._id });
  user.cart   = cart._id;

  const payload      = { userId: user._id.toString(), role: "customer" };
  const accessToken  = signAccessToken(payload);
  const refreshToken = signRefreshToken(payload);

  user.refreshToken = refreshToken;
  await user.save();

  sendCreated(res, {
    user,
    accessToken,
    refreshToken,
  }, "Registration successful. Welcome to GreenKart!");
});

// ─── Login ────────────────────────────────────────────────────────────────────
// POST /api/v1/users/login
// Body: { phoneNumber, password }
export const login = asyncHandler(async (req: Request, res: Response) => {
  const { phoneNumber, password } = req.body;

  if (!phoneNumber || !password) {
    throw ApiError.badRequest("phoneNumber and password are required");
  }

  const user = await User.findOne({ phoneNumber }).select("+password");
  if (!user) throw ApiError.unauthorized("Invalid phone number or password");
  if (!user.isActive) throw ApiError.forbidden("Your account has been deactivated");

  const isMatch = await user.comparePassword(password);
  if (!isMatch) throw ApiError.unauthorized("Invalid phone number or password");

  const payload      = { userId: user._id.toString(), role: "customer" };
  const accessToken  = signAccessToken(payload);
  const refreshToken = signRefreshToken(payload);

  user.refreshToken = refreshToken;
  await user.save({ validateBeforeSave: false });

  sendSuccess(res, {
    user,
    accessToken,
    refreshToken,
  }, "Login successful");
});

// ─── Refresh Token ────────────────────────────────────────────────────────────
// POST /api/v1/users/refresh-token
export const refreshToken = asyncHandler(async (req: Request, res: Response) => {
  const { refreshToken: token } = req.body;
  if (!token) throw ApiError.badRequest("Refresh token is required");

  const decoded = verifyRefreshToken(token);
  const user    = await User.findById(decoded.userId).select("+refreshToken");

  if (!user || user.refreshToken !== token) {
    throw ApiError.unauthorized("Invalid or expired refresh token");
  }

  const payload         = { userId: user._id.toString(), role: "customer" };
  const newAccessToken  = signAccessToken(payload);
  const newRefreshToken = signRefreshToken(payload);

  user.refreshToken = newRefreshToken;
  await user.save({ validateBeforeSave: false });

  sendSuccess(res, {
    accessToken:  newAccessToken,
    refreshToken: newRefreshToken,
  }, "Token refreshed");
});

// ─── Logout ───────────────────────────────────────────────────────────────────
// POST /api/v1/users/logout
export const logout = asyncHandler(async (req: AuthRequest, res: Response) => {
  await User.findByIdAndUpdate(req.user!.userId, { refreshToken: null });
  sendSuccess(res, null, "Logged out successfully");
});

// ─── Get My Profile ───────────────────────────────────────────────────────────
// GET /api/v1/users/me
export const getMe = asyncHandler(async (req: AuthRequest, res: Response) => {
  const user = await User.findById(req.user!.userId)
    .populate("cart")
    .populate({
      path:    "orders",
      select:  "orderId totalAmount status createdAt",
      options: { limit: 5, sort: { createdAt: -1 } },
    });

  if (!user) throw ApiError.notFound("User not found");
  sendSuccess(res, { user }, "Profile fetched");
});

// ─── Update My Profile ────────────────────────────────────────────────────────
// PATCH /api/v1/users/me
export const updateMe = asyncHandler(async (req: AuthRequest, res: Response) => {
  const allowed = ["name"] as const;
  const updates: Record<string, unknown> = {};

  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }

  if (Object.keys(updates).length === 0) {
    throw ApiError.badRequest("No valid fields provided to update");
  }

  const user = await User.findByIdAndUpdate(
    req.user!.userId,
    { $set: updates },
    { new: true, runValidators: true }
  );

  if (!user) throw ApiError.notFound("User not found");
  sendSuccess(res, { user }, "Profile updated");
});

// ─── Add Address ──────────────────────────────────────────────────────────────
// POST /api/v1/users/me/addresses
export const addAddress = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { line1, line2, city, pincode, isDefault } = req.body;

  if (!line1 || !city || !pincode) {
    throw ApiError.badRequest("line1, city and pincode are required");
  }

  const user = await User.findById(req.user!.userId);
  if (!user) throw ApiError.notFound("User not found");

  if (isDefault) user.addresses.forEach((a) => { a.isDefault = false; });

  user.addresses.push({ line1, line2, city, pincode, isDefault: !!isDefault });
  await user.save();

  sendSuccess(res, { addresses: user.addresses }, "Address added");
});

// ─── Delete Address ───────────────────────────────────────────────────────────
// DELETE /api/v1/users/me/addresses/:addressId
export const deleteAddress = asyncHandler(async (req: AuthRequest, res: Response) => {
  const user = await User.findById(req.user!.userId);
  if (!user) throw ApiError.notFound("User not found");

  const index = user.addresses.findIndex(
    (a) => a._id?.toString() === req.params.addressId
  );
  if (index === -1) throw ApiError.notFound("Address not found");

  user.addresses.splice(index, 1);
  await user.save();

  sendSuccess(res, { addresses: user.addresses }, "Address removed");
});

// ─── Update Address ───────────────────────────────────────────────────────────
// PATCH /api/v1/users/me/addresses/:addressId
export const updateAddress = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { line1, line2, city, pincode, isDefault } = req.body;

  if (!line1 && !line2 && !city && !pincode && isDefault === undefined) {
    throw ApiError.badRequest("Provide at least one field to update");
  }

  const user = await User.findById(req.user!.userId);
  if (!user) throw ApiError.notFound("User not found");

  const address = user.addresses.find(
    (a) => a._id?.toString() === req.params.addressId
  );
  if (!address) throw ApiError.notFound("Address not found");

  if (line1   !== undefined) address.line1   = line1;
  if (line2   !== undefined) address.line2   = line2;
  if (city    !== undefined) address.city    = city;
  if (pincode !== undefined) address.pincode = pincode;

  if (isDefault === true) {
    user.addresses.forEach((a) => { a.isDefault = false; });
    address.isDefault = true;
  }

  await user.save();
  sendSuccess(res, { addresses: user.addresses }, "Address updated");
});

// ─── Change Password ──────────────────────────────────────────────────────────
// PATCH /api/v1/users/me/change-password
export const changePassword = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    throw ApiError.badRequest("currentPassword and newPassword are required");
  }
  if (newPassword.length < 8) {
    throw ApiError.badRequest("New password must be at least 8 characters");
  }

  const user = await User.findById(req.user!.userId).select("+password");
  if (!user) throw ApiError.notFound("User not found");

  const isMatch = await user.comparePassword(currentPassword);
  if (!isMatch) throw ApiError.unauthorized("Current password is incorrect");

  user.password = newPassword;
  await user.save();

  sendSuccess(res, null, "Password changed successfully");
});


