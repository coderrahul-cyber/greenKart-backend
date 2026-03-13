// src/modules/user/user.routes.ts
import { Router } from "express";
import {
  register,
  login,
  refreshToken,
  logout,
  getMe,
  updateMe,
  addAddress,
  updateAddress,
  deleteAddress,
  changePassword,
} from "./user.controller";
import { authenticate } from "../../middleware/auth";
import {
  loginLimiter,
  registerLimiter,
  refreshTokenLimiter,
} from "../../middleware/rateLimiter";

const router = Router();

// ── Public — rate limited tightly ─────────────────────────────────────────────
router.post("/register", registerLimiter, register);
router.post("/login", loginLimiter, login);
router.post("/refresh-token", refreshTokenLimiter, refreshToken);

// ── Protected ─────────────────────────────────────────────────────────────────
router.post("/logout", authenticate, logout);
router.get("/me", authenticate, getMe);
router.patch("/me", authenticate, updateMe);
router.patch("/me/change-password", authenticate, changePassword);
router.post("/me/addresses", authenticate, addAddress);
router.patch("/me/addresses/:addressId", authenticate, updateAddress);
router.delete("/me/addresses/:addressId", authenticate, deleteAddress);

export { router as userRouter };
