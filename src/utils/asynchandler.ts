// src/utils/asyncHandler.ts
// Wraps any async route handler so you never need try/catch in controllers.
// Any thrown error is automatically forwarded to the global error middleware.

import type { Request, Response, NextFunction, RequestHandler } from "express";

type AsyncFn = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

export const asyncHandler =
  (fn: AsyncFn): RequestHandler =>
  (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);