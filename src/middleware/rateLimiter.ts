// src/middlewares/rateLimiter.ts
import rateLimit from "express-rate-limit";

const make = (windowMs: number, max: number, message: string) =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders:   false,
    message: { success: false, message },
    skipSuccessfulRequests: false,
  });

// ─── Auth routes ──────────────────────────────────────────────────────────────

// Login: 20 attempts per 15 minutes per IP
export const loginLimiter = make(
  15 * 60 * 1000,
  20,
  "Too many login attempts. Please wait 15 minutes before trying again."
);

// Register: 10 accounts per hour per IP
export const registerLimiter = make(
  60 * 60 * 1000,
  10,
  "Too many accounts created from this IP. Please try again after an hour."
);

// Refresh token: 60 per 15 min
export const refreshTokenLimiter = make(
  15 * 60 * 1000,
  60,
  "Too many token refresh requests. Please try again shortly."
);

// ─── Admin routes ─────────────────────────────────────────────────────────────

// Admin login only — all other admin routes have no rate limit
export const adminLoginLimiter = make(
  15 * 60 * 1000,
  20,
  "Too many admin login attempts. Please wait 15 minutes."
);

// ─── General API ──────────────────────────────────────────────────────────────

// Global baseline: 300 per minute
export const publicApiLimiter = make(
  60 * 1000,
  300,
  "Too many requests. Please slow down."
);

// Authenticated routes: 150 per minute
export const userApiLimiter = make(
  60 * 1000,
  150,
  "Too many requests. Please slow down."
);