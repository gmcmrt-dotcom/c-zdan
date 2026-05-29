import { Router } from "express";
import rateLimit, { type RateLimitRequestHandler } from "express-rate-limit";
import { auth as A } from "@wallet/shared";
import { requireAuth, user } from "../middleware/auth";
import * as svc from "../services/auth.service";
import { recordLogin } from "../services/login-ip.service";
import {
  requestProfileChangeOtp,
  verifyProfileChangeOtp,
} from "../services/profile-change-otp.service";
import { cfCountry, clientIp, userAgent } from "../lib/req-meta";
import { BadRequestError } from "../lib/errors";
import { isProd, isTest } from "../lib/env";
import type { Response } from "express";
import type { IssuedTokens } from "../auth/sessions";

// O.2 — HttpOnly cookie helpers (Q3 Option A).
//
// We set BOTH the access and refresh tokens as HttpOnly cookies AND
// return them in the JSON body for one transition release. This lets
// older clients that still read from localStorage keep working while
// the cookie-aware path takes over. The eventual end state is to drop
// the body fields entirely (next major).
const ACCESS_COOKIE = "access_token";
const REFRESH_COOKIE = "refresh_token";

function setAuthCookies(res: Response, tokens: IssuedTokens): void {
  const accessExpires = new Date(tokens.accessExpiresAt);
  const refreshExpires = new Date(tokens.refreshExpiresAt);
  res.cookie(ACCESS_COOKIE, tokens.accessToken, {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/",
    expires: accessExpires,
  });
  res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/",
    expires: refreshExpires,
  });
}

function clearAuthCookies(res: Response): void {
  res.clearCookie(ACCESS_COOKIE, { path: "/" });
  res.clearCookie(REFRESH_COOKIE, { path: "/" });
}

export const authRouter = Router();

// P0-15 — rate limiters for the public/cheap auth surface.
//
// Notes on tuning:
//   - Keyed by IP. Combined with audit_log analysis the team can move to
//     per-user keying later (Redis store needed for multi-instance).
//   - Tests bypass via `isTest` so the smoke suite stays fast.
//   - 429 responses use the project's `{ error_code, message }` envelope so
//     the web client surfaces a consistent error.
function makeAuthLimiter(opts: { windowMs: number; max: number; code: string }): RateLimitRequestHandler {
  return rateLimit({
    windowMs: opts.windowMs,
    max: opts.max,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => isTest,
    handler: (_req, res) => {
      res.status(429).json({ error_code: opts.code, message: "rate limit" });
    },
  });
}

// Conservative initial limits — increase if production traffic warrants.
const loginLimiter = makeAuthLimiter({ windowMs: 15 * 60 * 1000, max: 20, code: "LOGIN_RATE_LIMIT" });
const signupLimiter = makeAuthLimiter({ windowMs: 60 * 60 * 1000, max: 10, code: "SIGNUP_RATE_LIMIT" });
const refreshLimiter = makeAuthLimiter({ windowMs: 60 * 1000, max: 30, code: "REFRESH_RATE_LIMIT" });
const identifierLimiter = makeAuthLimiter({ windowMs: 60 * 1000, max: 10, code: "ENUM_RATE_LIMIT" });
const passwordResetLimiter = makeAuthLimiter({ windowMs: 60 * 60 * 1000, max: 5, code: "RESET_RATE_LIMIT" });
const mfaChallengeLimiter = makeAuthLimiter({ windowMs: 60 * 1000, max: 10, code: "MFA_RATE_LIMIT" });
const otpLimiter = makeAuthLimiter({ windowMs: 60 * 60 * 1000, max: 10, code: "OTP_RATE_LIMIT" });

// ---- public ----
authRouter.post("/identifier-exists", identifierLimiter, async (req, res, next) => {
  try {
    const input = A.ProfileIdentifierExistsRequest.parse(req.body);
    res.json(await svc.identifierExists(input));
  } catch (e) { next(e); }
});

authRouter.post("/signup", signupLimiter, async (req, res, next) => {
  try {
    const input = A.SignupRequest.parse(req.body);
    const out = await svc.signup(input, { ip: clientIp(req), userAgent: userAgent(req) });
    setAuthCookies(res, out);
    res.status(201).json({
      accessToken: out.accessToken,
      refreshToken: out.refreshToken,
      accessExpiresAt: out.accessExpiresAt,
      refreshExpiresAt: out.refreshExpiresAt,
      aal: out.aal,
      userId: out.userId,
    });
  } catch (e) { next(e); }
});

authRouter.post("/login", loginLimiter, async (req, res, next) => {
  try {
    const input = A.LoginRequest.parse(req.body);
    const out = await svc.login(input, { ip: clientIp(req), userAgent: userAgent(req) });
    // O.2 — Set HttpOnly cookies. Body fields kept for back-compat.
    setAuthCookies(res, out);
    res.json({
      accessToken: out.accessToken,
      refreshToken: out.refreshToken,
      accessExpiresAt: out.accessExpiresAt,
      refreshExpiresAt: out.refreshExpiresAt,
      aal: out.aal,
      userId: out.userId,
      requiresMfa: out.requiresMfa,
    });
  } catch (e) { next(e); }
});

authRouter.post("/refresh", refreshLimiter, async (req, res, next) => {
  try {
    // O.2 — Accept refresh token from cookie first, fall back to body for
    // legacy callers. Same shape for the access token (caller doesn't pass
    // an access token to /refresh anyway).
    const cookieRefresh = req.cookies?.[REFRESH_COOKIE];
    const bodyRefresh =
      typeof (req.body as { refreshToken?: unknown } | undefined)?.refreshToken === "string"
        ? ((req.body as { refreshToken: string }).refreshToken)
        : undefined;
    const refreshToken = cookieRefresh ?? bodyRefresh;
    if (!refreshToken) throw new BadRequestError("MISSING_REFRESH");
    const out = await svc.refresh(refreshToken, {
      ip: clientIp(req),
      userAgent: userAgent(req),
    });
    setAuthCookies(res, out);
    res.json(out);
  } catch (e) { next(e); }
});

authRouter.post("/password/reset-request", passwordResetLimiter, async (req, res, next) => {
  try {
    const input = A.PasswordResetRequest.parse(req.body);
    const token = await svc.requestPasswordReset(input.email);
    // P1 — Always return success to avoid email enumeration. We only surface
    // the raw reset token in `NODE_ENV=development` (NOT `test` or `staging`)
    // so a mis-tagged staging env can't leak live tokens to anyone who
    // happens to hit the endpoint.
    if (process.env.NODE_ENV === "development" && token) {
      res.json({ success: true, devToken: token });
    } else {
      res.json({ success: true });
    }
  } catch (e) { next(e); }
});

authRouter.post("/password/reset-confirm", passwordResetLimiter, async (req, res, next) => {
  try {
    const input = A.PasswordResetConfirmRequest.parse(req.body);
    await svc.confirmPasswordReset(input.token, input.newPassword);
    res.json({ success: true });
  } catch (e) { next(e); }
});

authRouter.post("/email/verify", async (req, res, next) => {
  try {
    const token = String(req.body?.token ?? "");
    if (!token) throw new BadRequestError();
    await svc.confirmEmailVerification(token);
    res.json({ success: true });
  } catch (e) { next(e); }
});

// ---- authenticated ----
authRouter.get("/me", requireAuth, async (req, res, next) => {
  try {
    const u = user(req);
    const me = await svc.buildMe(u.id);
    me.user.aal = u.aal;
    res.json(me);
  } catch (e) { next(e); }
});

authRouter.post("/logout", requireAuth, async (req, res, next) => {
  try {
    const u = user(req);
    const input = A.LogoutRequest.parse(req.body ?? {});
    // O.2 — Accept refresh token from cookie first; fall back to body.
    const cookieRefresh = req.cookies?.[REFRESH_COOKIE];
    const refreshToken = input.refreshToken ?? (typeof cookieRefresh === "string" ? cookieRefresh : undefined);
    await svc.logout(u.id, refreshToken, input.allDevices ?? false);
    clearAuthCookies(res);
    res.json({ success: true });
  } catch (e) { next(e); }
});

authRouter.post("/password/change", requireAuth, async (req, res, next) => {
  try {
    const u = user(req);
    const input = A.PasswordChangeRequest.parse(req.body);
    await svc.changePassword(u.id, input.currentPassword, input.newPassword);
    res.json({ success: true });
  } catch (e) { next(e); }
});

authRouter.post("/mfa/enroll", requireAuth, async (req, res, next) => {
  try {
    const u = user(req);
    const input = A.MfaEnrollRequest.parse(req.body ?? {});
    res.json(await svc.mfaEnroll(u.id, u.email, input.friendlyName));
  } catch (e) { next(e); }
});

authRouter.post("/mfa/verify-enroll", requireAuth, async (req, res, next) => {
  try {
    const u = user(req);
    const input = A.MfaVerifyRequest.parse(req.body);
    // K3 — Returns the FRESHLY GENERATED backup codes alongside success
    // so the FE can show them to the user immediately.
    const out = await svc.mfaVerifyEnrollment(u.id, input.factorId, input.code);
    res.json({ success: true, backupCodes: out.backupCodes });
  } catch (e) { next(e); }
});

// K3 — Regenerate backup codes. Requires aal2 (so a stolen aal1 bearer
// can't pre-empt a victim's recovery sheet). Drops the existing unused
// set + issues a fresh 8.
authRouter.post("/mfa/backup-codes/regenerate", requireAuth, async (req, res, next) => {
  try {
    const u = user(req);
    if (u.aal !== "aal2") {
      const { ForbiddenError } = await import("../lib/errors");
      throw new ForbiddenError("AAL2_REQUIRED");
    }
    const codes = await svc.regenerateMfaBackupCodes(u.id);
    res.json({ success: true, backupCodes: codes, count: codes.length });
  } catch (e) { next(e); }
});

// K3 — How many unused backup codes remain. Used by the Profile MFA
// section to nudge the user to regenerate when they've used most of them.
authRouter.get("/mfa/backup-codes/count", requireAuth, async (req, res, next) => {
  try {
    const u = user(req);
    const count = await svc.countMfaBackupCodesRemaining(u.id);
    res.json({ count });
  } catch (e) { next(e); }
});

authRouter.post("/mfa/challenge", mfaChallengeLimiter, requireAuth, async (req, res, next) => {
  try {
    const u = user(req);
    const input = A.MfaChallengeRequest.parse(req.body);
    const tokens = await svc.mfaChallenge(u.id, u.email, input.code, {
      ip: clientIp(req),
      userAgent: userAgent(req),
    });
    // O.2 — Set the aal2-bearing cookies so subsequent requests are aal2.
    setAuthCookies(res, tokens);
    res.json(tokens);
  } catch (e) { next(e); }
});

authRouter.post("/mfa/unenroll", requireAuth, async (req, res, next) => {
  try {
    const u = user(req);
    const input = A.MfaUnenrollRequest.parse(req.body);
    // P0-49 — accept `code` (fresh TOTP) so the caller proves possession.
    // If the request is already aal2 (post-challenge), the service accepts
    // without requiring a code.
    const code = typeof (req.body as { code?: unknown } | undefined)?.code === "string"
      ? (req.body as { code: string }).code
      : undefined;
    await svc.mfaUnenroll(u.id, input.factorId, { code, aal: u.aal });
    res.json({ success: true });
  } catch (e) { next(e); }
});

authRouter.get("/mfa/factors", requireAuth, async (req, res, next) => {
  try {
    const u = user(req);
    const factors = await svc.mfaListFactors(u.id);
    res.json({ factors });
  } catch (e) { next(e); }
});

authRouter.post("/record-login", requireAuth, async (req, res, next) => {
  try {
    const u = user(req);
    const out = await recordLogin({
      userId: u.id,
      ip: clientIp(req),
      userAgent: userAgent(req),
      cfCountry: cfCountry(req),
    });
    res.json(out);
  } catch (e) { next(e); }
});

authRouter.post("/profile-change-otp", otpLimiter, requireAuth, async (req, res, next) => {
  try {
    const u = user(req);
    const input = A.ProfileChangeOtpRequest.parse(req.body);
    if (input.action === "request") {
      const r = await requestProfileChangeOtp(u.id, input.changeType, input.newValue);
      res.json({ success: true, expiresIn: r.expiresIn });
    } else {
      if (!input.code) throw new BadRequestError("BAD_CODE");
      await verifyProfileChangeOtp(u.id, input.changeType, input.newValue, input.code);
      res.json({ success: true });
    }
  } catch (e) { next(e); }
});
