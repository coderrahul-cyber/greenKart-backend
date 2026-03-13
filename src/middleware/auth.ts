// src/middlewares/auth.ts
import type { Request, Response, NextFunction } from "express";
import { verifyAccessToken, type TokenPayload } from "../utils/jwt";
import { ApiError } from "../utils/apiError";
import { asyncHandler } from "../utils/asynchandler";

export interface AuthRequest extends Request {
  user?: TokenPayload;
}

// ─── authenticate ─────────────────────────────────────────────────────────────
export const authenticate = asyncHandler(
  async (req: AuthRequest, _res: Response, next: NextFunction) => {
    const header = req.headers.authorization;

    // ── SSE fallback: EventSource can't send headers, so allow ?token= query param
    // Only accept this from SSE routes (Content-Type check happens after headers flush,
    // so we gate on the query param being present at all)
    let token: string | undefined;

    if (header?.startsWith("Bearer ")) {
      token = header.split(" ")[1];
    } else if (typeof req.query.token === "string" && req.query.token) {
      token = req.query.token;
    }

    if (!token) {
      throw ApiError.unauthorized("No token provided");
    }

    req.user = verifyAccessToken(token);
    next();
  }
);

// ─── authorize ────────────────────────────────────────────────────────────────
export const authorize = (...roles: string[]) =>
  (req: AuthRequest, _res: Response, next: NextFunction): void => {
    if (!req.user) throw ApiError.unauthorized();
    if (!roles.includes(req.user.role)) {
      throw ApiError.forbidden("You do not have permission to perform this action");
    }
    next();
  };

// ─── adminOnly guard ──────────────────────────────────────────────────────────
export const adminOnly = authorize("admin");