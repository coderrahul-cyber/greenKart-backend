// src/modules/user/user.controller.ts
import type { Request, Response } from "express";
import { User } from "./user.model";
import { Cart } from "../cart/cart.model";
import { ApiError } from "../../utils/apiError";
import { asyncHandler } from "../../utils/asynchandler";
import { sendSuccess, sendCreated } from "../../utils/response";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../../utils/jwt";
import type { AuthRequest } from "../../middleware/auth";
import { geocodeAddress, haversineDistanceKm } from "../../utils/geocode";
import { env } from "../../config/env";

// ─── Register ─────────────────────────────────────────────────────────────────
// POST /api/v1/users/register
// Body: { name, email, password, phoneNumber, address?: { line1, line2?, city, pincode } }
export const register = asyncHandler(async (req: Request, res: Response) => {
  const { name, email, password, phoneNumber, address } = req.body;

  // ── Step 1: Duplicate check ───────────────────────────────────────────────
  const existing = await User.findOne({ $or: [{ email }, { phoneNumber }] });
  if (existing) {
    const field = existing.email === email.toLowerCase() ? "Email" : "Phone number";
    throw ApiError.conflict(`${field} is already registered`);
  }

  // ── Step 2: Delivery radius check ────────────────────────────────────────
  // If the frontend sends an address, verify it is within the service radius
  // before creating the account. We geocode the address via Nominatim (free,
  // no API key) and run the Haversine formula against the store coordinates
  // stored in .env (STORE_LAT, STORE_LNG, STORE_RADIUS_KM).
  const addresses = [];

  if (address?.line1 && address?.city && address?.pincode) {
    // Geocode: text address → { lat, lng }
    // Tries full address first, then city+pincode, then pincode-only as fallback
    const coords = await geocodeAddress(address.line1, address.city, address.pincode);

    if (!coords) {
      // All 3 fallback attempts failed — address is completely unrecognisable
      throw ApiError.badRequest(
        "We could not verify your pincode. " +
        "Please double-check your city and pincode and try again."
      );
    }

    // Log which precision level matched — useful for debugging local addresses
    console.log(
      `[geocode] matched at precision="${coords.precision}" ` +
      `for: "${address.line1}, ${address.city}, ${address.pincode}"`
    );

    // Calculate straight-line distance from store to user address
    const distanceKm = haversineDistanceKm(
      env.store.lat, env.store.lng,
      coords.lat,    coords.lng
    );

    if (distanceKm > env.store.radiusKm) {
      throw ApiError.badRequest(
        `Sorry, we do not deliver to your area yet. ` +
        `We currently serve within ${env.store.radiusKm}km of our store. ` +
        `Your pincode is approximately ${Math.round(distanceKm)}km away.`
      );
    }

    // Address is within range — store it as the default address
    addresses.push({
      line1:     address.line1,
      line2:     address.line2 ?? "",
      city:      address.city,
      pincode:   address.pincode,
      isDefault: true,
    });
  }

  // ── Step 3: Create user + cart ────────────────────────────────────────────
  const user = await User.create({ name, email, password, phoneNumber, addresses });

  const cart = await Cart.create({ userId: user._id });

  user.cart = cart._id;
  await user.save({ validateBeforeSave: false });

  const payload      = { userId: user._id.toString(), role: "customer" };
  const accessToken  = signAccessToken(payload);
  const refreshToken = signRefreshToken(payload);

  user.refreshToken = refreshToken;
  await user.save({ validateBeforeSave: false });

  sendCreated(res, { user, accessToken, refreshToken }, "Registration successful");
});

// ─── Login ────────────────────────────────────────────────────────────────────
// POST /api/v1/users/login
export const login = asyncHandler(async (req: Request, res: Response) => {
  const { email, password } = req.body;

  if (!email || !password) throw ApiError.badRequest("Email and password are required");

  // Explicitly select password (select: false by default)
  const user = await User.findOne({ email: email.toLowerCase() }).select("+password");
  if (!user) throw ApiError.unauthorized("Invalid email or password");

  if (!user.isActive) throw ApiError.forbidden("Your account has been deactivated");

  const isMatch = await user.comparePassword(password);
  if (!isMatch) throw ApiError.unauthorized("Invalid email or password");

  const payload = { userId: user._id.toString(), role: "customer" };
  const accessToken  = signAccessToken(payload);
  const refreshToken = signRefreshToken(payload);

  user.refreshToken = refreshToken;
  await user.save({ validateBeforeSave: false });

  // Return user without sensitive fields (handled by toJSON transform)
  sendSuccess(res, { user, accessToken, refreshToken }, "Login successful");
});

// ─── Refresh Token ────────────────────────────────────────────────────────────
// POST /api/v1/users/refresh-token
export const refreshToken = asyncHandler(async (req: Request, res: Response) => {
  const { refreshToken: token } = req.body;
  if (!token) throw ApiError.badRequest("Refresh token is required");

  const decoded = verifyRefreshToken(token);
  const user = await User.findById(decoded.userId).select("+refreshToken");

  if (!user || user.refreshToken !== token) {
    throw ApiError.unauthorized("Invalid or expired refresh token");
  }

  const payload = { userId: user._id.toString(), role: "customer" };
  const newAccessToken  = signAccessToken(payload);
  const newRefreshToken = signRefreshToken(payload);

  user.refreshToken = newRefreshToken;
  await user.save({ validateBeforeSave: false });

  sendSuccess(res, { accessToken: newAccessToken, refreshToken: newRefreshToken }, "Token refreshed");
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
    .populate({ path: "orders", select: "orderId totalAmount status createdAt", options: { limit: 5, sort: { createdAt: -1 } } });

  if (!user) throw ApiError.notFound("User not found");

  sendSuccess(res, { user }, "Profile fetched");
});

// ─── Update My Profile ────────────────────────────────────────────────────────
// PATCH /api/v1/users/me
export const updateMe = asyncHandler(async (req: AuthRequest, res: Response) => {
  // Only allow these fields — never let users change password or email here
  const allowed: string[] = ["name", "phoneNumber"];
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

  // If this address is set as default, unset all existing defaults first
  if (isDefault) {
    user.addresses.forEach((addr) => { addr.isDefault = false; });
  }

  user.addresses.push({ line1, line2, city, pincode, isDefault: !!isDefault });
  await user.save();

  sendSuccess(res, { addresses: user.addresses }, "Address added");
});

// ─── Delete Address ───────────────────────────────────────────────────────────
// DELETE /api/v1/users/me/addresses/:addressId
export const deleteAddress = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { addressId } = req.params;

  const user = await User.findById(req.user!.userId);
  if (!user) throw ApiError.notFound("User not found");

  const index = user.addresses.findIndex((a) => a._id?.toString() === addressId);
  if (index === -1) throw ApiError.notFound("Address not found");

  user.addresses.splice(index, 1);
  await user.save();

  sendSuccess(res, { addresses: user.addresses }, "Address removed");
});

// ─── Update Address ───────────────────────────────────────────────────────────
// PATCH /api/v1/users/me/addresses/:addressId
// Body: { line1?, line2?, city?, pincode?, isDefault? }
// All fields are optional — only the ones sent get updated (partial update).
// If isDefault:true is sent, all other addresses are unset as default first.
export const updateAddress = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { addressId } = req.params;
  const { line1, line2, city, pincode, isDefault } = req.body;

  // Reject if body is completely empty
  if (!line1 && !line2 && !city && !pincode && isDefault === undefined) {
    throw ApiError.badRequest("Provide at least one field to update");
  }

  const user = await User.findById(req.user!.userId);
  if (!user) throw ApiError.notFound("User not found");

  const address = user.addresses.find((a) => a._id?.toString() === addressId);
  if (!address) throw ApiError.notFound("Address not found");

  // Apply only the fields that were actually sent
  if (line1   !== undefined) address.line1   = line1;
  if (line2   !== undefined) address.line2   = line2;
  if (city    !== undefined) address.city    = city;
  if (pincode !== undefined) address.pincode = pincode;

  // If marking this as default, unset all others first
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

  user.password = newPassword; // pre-save hook hashes it automatically
  await user.save();

  sendSuccess(res, null, "Password changed successfully");
});