// src/middlewares/mongoSanitize.ts
// Bun-compatible NoSQL injection sanitizer.
//
// Why not express-mongo-sanitize?
//   That package does `req[key] = sanitized` which triggers a TypeError in Bun
//   because Bun marks req.body, req.params, req.query, req.headers as readonly.
//
// What this does instead:
//   Recursively strips keys that start with "$" or contain "." from any object.
//   These are the characters MongoDB uses for operators — e.g. { "$gt": "" }
//   which can bypass login checks if not stripped.
//
// Covers the same attack vectors as express-mongo-sanitize.

import type { Request, Response, NextFunction } from "express";

// ─── Recursive sanitizer ──────────────────────────────────────────────────────
const sanitize = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(sanitize);
  }

  if (value !== null && typeof value === "object") {
    const clean: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>)) {
      // Drop keys that start with $ (MongoDB operators) or contain . (dot notation)
      if (key.startsWith("$") || key.includes(".")) continue;
      clean[key] = sanitize((value as Record<string, unknown>)[key]);
    }
    return clean;
  }

  return value;
};

// ─── Middleware ───────────────────────────────────────────────────────────────
// Instead of replacing req.body (readonly in Bun), we mutate the object IN PLACE
// by deleting dangerous keys directly from the existing object reference.
const sanitizeInPlace = (obj: Record<string, unknown>): void => {
  for (const key of Object.keys(obj)) {
    if (key.startsWith("$") || key.includes(".")) {
      delete obj[key];
      continue;
    }
    const val = obj[key];
    if (val !== null && typeof val === "object" && !Array.isArray(val)) {
      sanitizeInPlace(val as Record<string, unknown>);
    }
    if (Array.isArray(val)) {
      val.forEach(item => {
        if (item !== null && typeof item === "object") {
          sanitizeInPlace(item as Record<string, unknown>);
        }
      });
    }
  }
};

export const mongoSanitize = (_req: Request, _res: Response, next: NextFunction): void => {
  const req = _req as Request & Record<string, unknown>;

  // Mutate in place — never reassign the property itself (Bun readonly issue)
  if (req.body   && typeof req.body   === "object") sanitizeInPlace(req.body);
  if (req.params && typeof req.params === "object") sanitizeInPlace(req.params);
  if (req.query  && typeof req.query  === "object") sanitizeInPlace(req.query  as Record<string, unknown>);

  next();
};