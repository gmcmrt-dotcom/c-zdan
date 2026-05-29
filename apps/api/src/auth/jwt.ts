import { SignJWT, jwtVerify } from "jose";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { env } from "../lib/env";
import { UnauthorizedError } from "../lib/errors";
import { isAccessJtiDenied } from "./jti-denylist";

const ACCESS_SECRET = new TextEncoder().encode(env.JWT_ACCESS_SECRET);
// O.1 — JWT_REFRESH_SECRET retained ONLY for back-compat with any
// historical code paths or external integrations; refresh tokens are
// now opaque random blobs verified by DB lookup (see auth/sessions.ts).
// The signed-JWT refresh path is dead code; `signRefreshToken` and
// `verifyRefreshToken` remain as stubs that throw — any caller still
// invoking them is a bug.
const REFRESH_SECRET = new TextEncoder().encode(env.JWT_REFRESH_SECRET);
const ISSUER = "wallet-api";
const AUDIENCE = "wallet-app";

export type AuthAal = "aal1" | "aal2";

export interface AccessClaims {
  sub: string;
  email: string;
  aal: AuthAal;
  jti: string;
  iat: number;
  exp: number;
  iss: string;
  aud: string | string[];
}

export interface RefreshClaims {
  sub: string;
  jti: string; // refresh_tokens.id (also looked up server-side)
  aal: AuthAal;
  iat: number;
  exp: number;
  iss: string;
  aud: string | string[];
}

// P1 — Zod-validate the JWT payload after signature check. `jose` only
// verifies signature/iss/aud/exp; the inner claims could still be anything
// (e.g. `sub: 42` from a buggy issuer). Validating shape here means
// downstream code can treat the claims as the strict TypeScript type
// without unchecked `as` casts; malformed tokens fail with JWT_INVALID
// before they reach any service.
const UUID = z.string().uuid();
const EMAIL = z.string().email().max(320);
const AAL = z.enum(["aal1", "aal2"]);

const AccessClaimsSchema = z.object({
  sub: UUID,
  email: EMAIL,
  aal: AAL,
  jti: UUID,
  iat: z.number().int(),
  exp: z.number().int(),
  iss: z.string(),
  aud: z.union([z.string(), z.array(z.string())]),
});

const RefreshClaimsSchema = z.object({
  sub: UUID,
  jti: UUID,
  aal: AAL,
  iat: z.number().int(),
  exp: z.number().int(),
  iss: z.string(),
  aud: z.union([z.string(), z.array(z.string())]),
});

export async function signAccessToken(
  userId: string,
  email: string,
  aal: AuthAal,
): Promise<string> {
  // P2 — Every access token now carries a unique `jti` so individual tokens
  // can be revoked via the in-process denylist (auth/jti-denylist.ts) without
  // waiting for the natural TTL. The claim is validated by Zod on verify so
  // a malformed/missing jti makes the token unusable.
  return new SignJWT({ aal, email })
    .setProtectedHeader({ alg: "HS256" })
    .setJti(randomUUID())
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${env.JWT_ACCESS_TTL_SEC}s`)
    .sign(ACCESS_SECRET);
}

/**
 * O.1 — DEPRECATED stub. Refresh tokens are now opaque random blobs
 * (see `auth/sessions.ts::issueTokens`). Calling this is a bug.
 */
export async function signRefreshToken(
  _userId: string,
  _jti: string,
  _aal: AuthAal,
): Promise<string> {
  throw new Error("signRefreshToken is deprecated — refresh tokens are now opaque random blobs (see auth/sessions.ts)");
}

export async function verifyAccessToken(token: string): Promise<AccessClaims> {
  let payload: unknown;
  try {
    ({ payload } = await jwtVerify(token, ACCESS_SECRET, {
      issuer: ISSUER,
      audience: AUDIENCE,
    }));
  } catch {
    throw new UnauthorizedError("JWT_INVALID", "Invalid or expired access token");
  }
  const parsed = AccessClaimsSchema.safeParse(payload);
  if (!parsed.success) {
    throw new UnauthorizedError("JWT_INVALID", "Malformed access token claims");
  }
  // P2 — Check the emergency-revoke denylist. The map is process-local so
  // multi-node deploys would need a Redis-backed implementation (the
  // function signature is stable for that swap).
  if (isAccessJtiDenied(parsed.data.jti)) {
    throw new UnauthorizedError("JWT_REVOKED", "Access token has been revoked");
  }
  return parsed.data;
}

/**
 * O.1 — DEPRECATED stub. Refresh tokens are now opaque random blobs
 * verified by DB lookup; see `auth/sessions.ts::findActiveRefreshTokenForUpdate`.
 */
export async function verifyRefreshToken(_token: string): Promise<RefreshClaims> {
  throw new UnauthorizedError("REFRESH_VERIFY_DEPRECATED", "refresh tokens are now opaque; use sessions.findActiveRefreshTokenForUpdate");
}
