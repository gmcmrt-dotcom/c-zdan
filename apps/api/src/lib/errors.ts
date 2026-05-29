/**
 * Domain errors. All errors thrown from services should extend AppError so the
 * Express error middleware can map them to consistent JSON responses.
 *
 * Error codes mirror the original Supabase edge function error codes wherever
 * the frontend's `translateError()` already knows the string. New codes should
 * use SCREAMING_SNAKE_CASE.
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly errorCode: string;
  readonly details?: unknown;

  constructor(statusCode: number, errorCode: string, message?: string, details?: unknown) {
    super(message ?? errorCode);
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.details = details;
    this.name = "AppError";
  }
}

export class BadRequestError extends AppError {
  constructor(errorCode = "BAD_REQUEST", message?: string, details?: unknown) {
    super(400, errorCode, message, details);
  }
}
export class UnauthorizedError extends AppError {
  constructor(errorCode = "UNAUTHORIZED", message?: string) {
    super(401, errorCode, message);
  }
}
export class ForbiddenError extends AppError {
  constructor(errorCode = "FORBIDDEN", message?: string) {
    super(403, errorCode, message);
  }
}
export class NotFoundError extends AppError {
  constructor(errorCode = "NOT_FOUND", message?: string) {
    super(404, errorCode, message);
  }
}
export class ConflictError extends AppError {
  constructor(errorCode = "CONFLICT", message?: string, details?: unknown) {
    super(409, errorCode, message, details);
  }
}
export class UnprocessableError extends AppError {
  constructor(errorCode = "UNPROCESSABLE", message?: string, details?: unknown) {
    super(422, errorCode, message, details);
  }
}
