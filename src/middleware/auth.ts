// src/middlewares/auth.ts

import type { Request, Response, NextFunction } from "express";
import { verifyAccessToken, type TokenPayload } from "../utils/jwt";
import { ApiError } from "../utils/apiError";
import { asyncHandler } from "../utils/asynchandler";

export interface AuthRequest extends Request {
  user?: TokenPayload;
}

export const authenticate = asyncHandler(
  async (req: AuthRequest, _res: Response, next: NextFunction) => {
    let token: string | undefined;

    // ── 1. Authorization header (for admin / legacy)
    const header = req.headers.authorization;
    if (header?.startsWith("Bearer ")) {
      token = header.split(" ")[1];
    }

    // ── 2. Cookie (PRIMARY for your app)
    if (!token && req.cookies?.accessToken) {
      token = req.cookies.accessToken;
    }

    // ── 3. SSE fallback
    if (!token && typeof req.query.token === "string") {
      token = req.query.token;
    }

    if (!token) {
      throw ApiError.unauthorized("No token provided");
    }

    try {
      const decoded = verifyAccessToken(token);
      req.user = decoded;
      next();
    } catch {
      throw ApiError.unauthorized("Invalid or expired token");
    }
  }
);

/* ─────────────────────────────────────────
   Authorization
───────────────────────────────────────── */
// export const authorize = (...roles: string[]) =>
//   (req: AuthRequest, _res: Response, next: NextFunction): void => {
//     if (!req.user) throw ApiError.unauthorized();

//     if (!roles.includes(req.user.role)) {
//       throw ApiError.forbidden("Permission denied");
//     }

//     next();
//   };

// export const adminOnly = authorize("admin");


// middleware/auth.ts  — only the adminOnly export needs updating

export const adminOnly = asyncHandler(
  async (req: AuthRequest, _res: Response, next: NextFunction) => {

    // Standard header first
    const header = req.headers.authorization;

    // ── SSE fallback ──────────────────────────────────────────────────────
    // EventSource cannot set custom headers, so SSE routes pass the token
    // as ?token=<accessToken>. We only accept it on GET requests so it
    // can never be used to bypass auth on mutating endpoints.
    const queryToken =
      req.method === 'GET' && typeof req.query.token === 'string'
        ? req.query.token
        : null;

    const raw = header?.startsWith('Bearer ')
      ? header.split(' ')[1]
      : queryToken;

    if (!raw) {
      throw ApiError.unauthorized('No admin token');
    }

    const decoded = verifyAccessToken(raw);

    if (decoded.role !== 'admin' && decoded.role !== 'superadmin') {
      throw ApiError.forbidden('Admin access only');
    }

    req.user = decoded;
    next();
  }
);