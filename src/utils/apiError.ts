// src/utils/ApiError.ts
// A typed error class so controllers can throw structured errors
// that the global error handler knows how to format.

export class ApiError extends Error {
  statusCode:    number;
  isOperational: boolean; // true = known/expected error, false = unexpected bug

  constructor(message: string, statusCode = 500, isOperational = true) {
    super(message);
    this.statusCode    = statusCode;
    this.isOperational = isOperational;
    Error.captureStackTrace(this, this.constructor);
  }

  // Convenience factory methods
  static badRequest(msg: string)            { return new ApiError(msg, 400); }
  static unauthorized(msg = "Unauthorized") { return new ApiError(msg, 401); }
  static forbidden(msg = "Forbidden")       { return new ApiError(msg, 403); }
  static notFound(msg = "Not found")        { return new ApiError(msg, 404); }
  static conflict(msg: string)              { return new ApiError(msg, 409); }
  static internal(msg = "Server error")     { return new ApiError(msg, 500, false); }
}