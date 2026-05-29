/**
 * O.3 — CSRF middleware (Q3 Option A).
 *
 * Double-submit cookie pattern:
 *
 *   1. On EVERY request we ensure a `csrf_token` cookie is set. The value
 *      is a random 32-byte hex; it's intentionally readable by JS (NOT
 *      HttpOnly) because the client must echo it back in the
 *      `X-CSRF-Token` header.
 *
 *   2. For state-changing methods (POST/PUT/PATCH/DELETE) we require:
 *        - the cookie to be present
 *        - the `X-CSRF-Token` header to be present
 *        - the two to match (constant-time)
 *
 *   3. Skipped routes:
 *        - GET/HEAD/OPTIONS (no state change)
 *        - `/merchant-api/*` + `/webhooks/*` (mounted BEFORE this middleware
 *          so they never reach here; HMAC-protected anyway)
 *        - `/auth/login`, `/auth/signup`, `/auth/refresh`, `/auth/logout`
 *          (bootstrap endpoints — caller has no cookie yet on the very
 *          first request; the response sets one)
 *        - Authorization-header-only callers (legacy clients with
 *          `Authorization: Bearer ...` — they don't ride on cookies so
 *          CSRF doesn't apply). Detected by presence of the header.
 */
import type { NextFunction, Request, Response } from "express";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { isProd } from "../lib/env";

const CSRF_COOKIE = "csrf_token";
const CSRF_HEADER = "x-csrf-token";
const CSRF_BYTES = 32;

const SKIP_PATH_PREFIXES = ["/merchant-api/", "/webhooks/", "/api/dev/"];
const SKIP_EXACT_PATHS = new Set<string>([
  "/api/auth/login",
  "/api/auth/signup",
  "/api/auth/refresh",
  "/api/auth/logout",
  "/api/auth/password/reset-request",
  "/api/auth/password/reset-confirm",
  "/api/auth/email/verify",
]);

function ensureCsrfCookie(req: Request, res: Response): string {
  const existing = req.cookies?.[CSRF_COOKIE];
  if (typeof existing === "string" && existing.length === CSRF_BYTES * 2) {
    return existing;
  }
  const fresh = randomBytes(CSRF_BYTES).toString("hex");
  res.cookie(CSRF_COOKIE, fresh, {
    httpOnly: false, // MUST be readable by the FE JS to echo back
    secure: isProd,
    sameSite: "lax",
    path: "/",
    // No expires/maxAge — session cookie. Rotates if the user closes the tab.
  });
  return fresh;
}

function tokensMatch(cookie: string, header: string): boolean {
  if (cookie.length !== header.length) return false;
  try {
    return timingSafeEqual(Buffer.from(cookie), Buffer.from(header));
  } catch {
    return false;
  }
}

export function csrfProtect(req: Request, res: Response, next: NextFunction): void {
  // Always ensure the cookie is set — even on GET — so the first
  // state-changing request after a fresh page load has a token to echo.
  ensureCsrfCookie(req, res);

  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return next();
  }

  // Skip-paths.
  if (SKIP_EXACT_PATHS.has(req.path)) return next();
  for (const prefix of SKIP_PATH_PREFIXES) {
    if (req.path.startsWith(prefix)) return next();
  }

  // Legacy Authorization-header callers (mobile / 3rd-party scripts) don't
  // ride on cookies; CSRF doesn't apply. Bearer-token theft is the
  // localStorage problem the cookie path is trying to fix; legacy clients
  // accept the residual risk.
  const auth = req.headers.authorization;
  if (auth && auth.toLowerCase().startsWith("bearer ")) {
    return next();
  }

  const cookieToken = req.cookies?.[CSRF_COOKIE];
  const headerToken = req.headers[CSRF_HEADER];
  if (
    typeof cookieToken !== "string" ||
    typeof headerToken !== "string" ||
    !tokensMatch(cookieToken, headerToken)
  ) {
    res.status(403).json({
      success: false,
      error_code: "CSRF_INVALID",
      message: "CSRF token mismatch or missing",
    });
    return;
  }
  next();
}
