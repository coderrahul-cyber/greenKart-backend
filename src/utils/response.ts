// src/utils/response.ts
// Consistent response shape across the entire API:
// { success, message, data? }  or  { success, message, error? }

import type { Response } from "express";

interface SuccessPayload<T> {
  success: true;
  message: string;
  data:    T;
}

interface ErrorPayload {
  success: false;
  message: string;
  error?:  string;
}

export const sendSuccess = <T>(
  res:     Response,
  data:    T,
  message = "Success",
  status  = 200
): Response =>
  res.status(status).json({ success: true, message, data } as SuccessPayload<T>);

export const sendCreated = <T>(res: Response, data: T, message = "Created"): Response =>
  sendSuccess(res, data, message, 201);

export const sendError = (
  res:     Response,
  message: string,
  status  = 500,
  error?:  string
): Response =>
  res.status(status).json({ success: false, message, error } as ErrorPayload);