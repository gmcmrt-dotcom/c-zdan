import type { NextFunction, Request, RequestHandler, Response } from "express";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import { merchantUsers, profiles, userRoles, users } from "../db/schema";
import { verifyAccessToken, type AuthAal } from "../auth/jwt";
import { ForbiddenError, UnauthorizedError } from "../lib/errors";

export interface RequestUser {
  id: string;
  email: string;
  aal: AuthAal;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: RequestUser;
    }
  }
}

function extractBearer(req: Request): string | null {
  const h = req.headers.authorization;
  if (!h || typeof h !== "string") return null;
  const [scheme, token] = h.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

// O.2 — Read access token from HttpOnly cookie OR Authorization header
// (Q3 Option A). Cookie takes precedence so a cookie-aware client never
// accidentally falls back to a stale header. Legacy clients (mobile,
// 3rd-party integrations using `Authorization: Bearer`) continue to work.
function extractAccessToken(req: Request): string | null {
  const cookieToken = req.cookies?.access_token;
  if (typeof cookieToken === "string" && cookieToken.length > 0) return cookieToken;
  return extractBearer(req);
}

/** Require a valid access JWT. Populates req.user. */
export const requireAuth: RequestHandler = async (req, _res, next) => {
  try {
    const token = extractAccessToken(req);
    if (!token) throw new UnauthorizedError("MISSING_TOKEN");
    const claims = await verifyAccessToken(token);
    // After a local db:reset the JWT may still verify but `sub` no longer
    // exists — loadUserPerms would be empty and BO calls fail closed with
    // PERMISSION_DENIED instead of a clean 401. Fail fast here.
    const [row] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, claims.sub))
      .limit(1);
    if (!row) throw new UnauthorizedError("USER_NOT_FOUND");
    req.user = { id: claims.sub, email: claims.email, aal: claims.aal };
    next();
  } catch (err) {
    next(err);
  }
};

// P3 — `optionalAuth` middleware removed. It was exported but unused, and
// "fail-open auth" is a dangerous default to keep on the shelf — a future
// route added with it would silently degrade to anonymous on a bad token.
// If a route ever genuinely needs it, re-introduce it inline at the route
// site so the choice is visible.

/**
 * Require any user_roles row (admin/accounting/support).
 *
 * P0-9 — AAL2 policy.
 *
 *   When `opts.aal2 === true` or the global env flag `STAFF_AAL2_REQUIRED=true`
 *   is set, staff JWTs MUST carry `aal=aal2` (i.e. the user has just completed
 *   the TOTP challenge via `/auth/mfa/challenge`). This protects every
 *   privileged BO operation against stolen aal1 access tokens.
 *
 *   Default is OFF so existing operators have time to enroll TOTP and refresh
 *   their sessions to aal2 without an immediate lockout. The risk note in the
 *   go-live plan documents the rollout sequence: enroll → flip the flag.
 */
export function requireStaff(opts?: { aal2?: boolean }): RequestHandler {
  const localAal2 = opts?.aal2 ?? false;
  return async (req, _res, next) => {
    try {
      if (!req.user) throw new UnauthorizedError();
      const roles = await db
        .select({ role: userRoles.role })
        .from(userRoles)
        .where(eq(userRoles.userId, req.user.id));
      if (roles.length === 0) throw new ForbiddenError("STAFF_REQUIRED");
      const requireAal2 = localAal2 || process.env.STAFF_AAL2_REQUIRED === "true";
      if (requireAal2 && req.user.aal !== "aal2") throw new ForbiddenError("MFA_REQUIRED");
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** Require a row in merchant_users (any role). Sets req.merchant. */
export interface RequestMerchant {
  merchantUserId: string;
  merchantId: string;
  role: "owner" | "accountant" | "read_only";
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      merchant?: RequestMerchant;
    }
  }
}

export const requireMerchant: RequestHandler = async (req, _res, next) => {
  try {
    if (!req.user) throw new UnauthorizedError();
    // P1 — Multi-merchant users must specify which merchant context to use.
    // Previously `.limit(1)` returned an arbitrary row when the caller belonged
    // to multiple merchants, so the active context was non-deterministic.
    // The `X-Merchant-Id` header lets the caller pick; we then validate that
    // they actually belong to that merchant (and the row is active).
    const headerMerchantId = (req.headers["x-merchant-id"] as string | undefined)?.trim() || null;

    const rows = await db
      .select({
        id: merchantUsers.id,
        merchantId: merchantUsers.merchantId,
        role: merchantUsers.role,
        isActive: merchantUsers.isActive,
      })
      .from(merchantUsers)
      .where(and(eq(merchantUsers.userId, req.user.id), eq(merchantUsers.isActive, true)));

    if (rows.length === 0) throw new ForbiddenError("MERCHANT_REQUIRED");

    let row = rows[0];
    if (rows.length > 1) {
      if (!headerMerchantId) {
        throw new ForbiddenError("MERCHANT_HEADER_REQUIRED");
      }
      const match = rows.find((r) => r.merchantId === headerMerchantId);
      if (!match) throw new ForbiddenError("MERCHANT_NOT_MEMBER");
      row = match;
    } else if (headerMerchantId && row && row.merchantId !== headerMerchantId) {
      // Single-membership user passed a header that doesn't match — fail
      // closed so a misconfigured client surfaces the bug.
      throw new ForbiddenError("MERCHANT_NOT_MEMBER");
    }
    if (!row) throw new ForbiddenError("MERCHANT_REQUIRED");

    req.merchant = {
      merchantUserId: row.id,
      merchantId: row.merchantId,
      role: row.role as RequestMerchant["role"],
    };
    next();
  } catch (err) {
    next(err);
  }
};

/** Tiny helper to read the authed user or 401. Use after requireAuth. */
export function user(req: Request): RequestUser {
  if (!req.user) throw new UnauthorizedError();
  return req.user;
}

/**
 * P1 — Reject every state-changing request for a frozen member.
 *
 * Use AFTER `requireAuth` on routes that move money or accept member input
 * that could be exploited (payment-code create, topup init, withdraw
 * request, chat messages, etc.). Previously the freeze check was scattered
 * across services (only merchant-credit checked it for Flow B); this
 * middleware is the durable gate.
 *
 * GET/HEAD are allowed even when frozen so the member can still see their
 * balance, sessions, profile, etc. The freeze blocks state-changing
 * requests only. The login path itself blocks frozen members already
 * (auth.service.ts), so this catches the window between login and a
 * freeze flip.
 */
export const requireUnfrozen: RequestHandler = async (req, _res, next) => {
  try {
    if (!req.user) throw new UnauthorizedError();
    // Read-only GETs are allowed even when frozen so the member can still
    // see their balance, settings, etc. The freeze blocks state-changing
    // requests only.
    if (req.method === "GET" || req.method === "HEAD") return next();
    const [p] = await db
      .select({ isFrozen: profiles.isFrozen })
      .from(profiles)
      .where(eq(profiles.id, req.user.id))
      .limit(1);
    if (p?.isFrozen) throw new ForbiddenError("ACCOUNT_FROZEN");
    next();
  } catch (err) {
    next(err);
  }
};
