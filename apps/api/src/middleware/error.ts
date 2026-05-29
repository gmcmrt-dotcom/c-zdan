import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";
import { AppError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";

export const notFound: RequestHandler = (_req, res) => {
  // P3 — Don't echo the requested path in the 404 body. The path tells the
  // caller what they tried and reflects in scanner / log-replay tooling; it
  // also gives WAFs noise. The status code alone is enough.
  res.status(404).json({ success: false, error_code: "NOT_FOUND" });
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof ZodError) {
    res.status(400).json({
      success: false,
      error_code: "VALIDATION_ERROR",
      issues: err.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
        code: i.code,
      })),
    });
    return;
  }

  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      error_code: err.errorCode,
      message: err.message,
      ...(err.details !== undefined ? { details: err.details } : {}),
    });
    return;
  }

  // express.json() raises SyntaxError with `type: "entity.parse.failed"` when
  // the request body isn't valid JSON. Map to the merchant-API contract.
  if (err && typeof err === "object") {
    const e = err as { type?: string; status?: number; statusCode?: number };
    if (e.type === "entity.parse.failed") {
      res.status(400).json({ success: false, error_code: "BAD_JSON" });
      return;
    }
    // multer / payload-size errors also surface here
    if (e.type === "entity.too.large") {
      res.status(413).json({ success: false, error_code: "PAYLOAD_TOO_LARGE" });
      return;
    }
    // multer single-file rejection has its own MulterError shape
    if (err instanceof Error && err.name === "MulterError") {
      res.status(400).json({ success: false, error_code: "UPLOAD_ERROR", message: err.message });
      return;
    }
  }

  logger.error({ err, path: req.path }, "unhandled error");
  res.status(500).json({ success: false, error_code: "INTERNAL_ERROR" });
};
