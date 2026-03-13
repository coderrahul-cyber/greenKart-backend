/* eslint-disable @typescript-eslint/no-explicit-any */
// src/middlewares/errorHandler.ts
import type { Request, Response, NextFunction } from "express";
import { ApiError } from "../utils/apiError";
import { sendError } from "../utils/response";
import { env } from "../config/env";

// ─── 404 handler ─────────────────────────────────────────────────────────────
// Mount this AFTER all your routes in server.ts
export const notFound = (_req: Request, _res: Response, next: NextFunction): void => {
  next(new ApiError(`Route not found`, 404));
};


// ─── Global error handler ─────────────────────────────────────────────────────
// Mount this LAST in server.ts — Express identifies it by the 4-param signature
export const errorHandler = (
  err:  Error,
  _req: Request,
  res:  Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
): void => {

  // 1. Our own operational errors (thrown via ApiError)
  if (err instanceof ApiError) {
    sendError(res, err.message, err.statusCode);
    return;
  }

  // 2. Mongoose duplicate key  (e.g. unique email or phone)
  if ("code" in err && (err as { code: unknown }).code === 11000) {
    const field = Object.keys((err as any).keyValue ?? {})[0] ?? "field";
    sendError(res, `${field} already exists`, 409);
    return;
  }

  // 3. Mongoose validation error
  if (err.name === "ValidationError") {
    const messages = Object.values((err as any).errors).map((e: any) => e.message as string);
    sendError(res, messages.join(", "), 400);
    return;
  }

  // 4. JWT errors
  if (err.name === "JsonWebTokenError")  { sendError(res, "Invalid token", 401); return; }
  if (err.name === "TokenExpiredError")  { sendError(res, "Token expired",  401); return; }

  // 5. Unknown / unexpected error — log it, hide details in production
  console.error("Unhandled error:", err);
  sendError(
    res,
    env.isDev ? err.message : "Something went wrong",
    500,
    env.isDev ? err.stack   : undefined
  );
};