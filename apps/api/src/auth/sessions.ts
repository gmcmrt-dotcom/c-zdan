import { addSeconds } from "date-fns";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, type Database } from "../db/client";
import { refreshTokens } from "../db/schema";
import { env } from "../lib/env";
import { randomToken, sha256Hex } from "../lib/random";
import { signAccessToken, type AuthAal } from "./jwt";

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: string; // ISO
  refreshExpiresAt: string;
  aal: AuthAal;
}

// O.1 — Opaque refresh tokens (P0-47 Option A, Q1 decision).
//
// We generate a random 48-byte token and return it to the client as-is
// (an opaque blob, NOT a JWT). The server stores only `sha256(token)`
// in `auth_refresh_tokens.token_hash`. On refresh, we look up the row
// by hash; if the row exists, is not revoked, and is not expired, we
// rotate it. There is no JWT-signature path for refresh — the DB row
// IS the source of truth. A leaked `JWT_REFRESH_SECRET` is therefore
// no longer sufficient to forge a refresh token.
//
// `tokenPrefix` is the first 8 chars of the plaintext, kept in the row
// so a forensic lookup can identify which session a logged action came
// from without needing the plaintext.

export async function issueTokens(
  userId: string,
  email: string,
  aal: AuthAal,
  meta: { ip?: string | null; userAgent?: string | null } = {},
): Promise<IssuedTokens> {
  const refreshOpaque = randomToken(48);
  const tokenHash = sha256Hex(refreshOpaque);
  const expiresAt = addSeconds(new Date(), env.JWT_REFRESH_TTL_SEC);
  await db
    .insert(refreshTokens)
    .values({
      userId,
      tokenHash,
      aal,
      expiresAt,
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    });

  const accessToken = await signAccessToken(userId, email, aal);
  return {
    accessToken,
    // O.1 — Opaque refresh, NOT a JWT. The client must store this verbatim
    // and present it back on /auth/refresh and /auth/logout.
    refreshToken: refreshOpaque,
    accessExpiresAt: addSeconds(new Date(), env.JWT_ACCESS_TTL_SEC).toISOString(),
    refreshExpiresAt: expiresAt.toISOString(),
    aal,
  };
}

/**
 * O.1 — Lookup an active refresh token row by the OPAQUE token's sha256
 * hash. Returns null if missing/revoked/expired. Used by refresh +
 * logout paths.
 */
export async function findActiveRefreshTokenByOpaque(plaintext: string) {
  const tokenHash = sha256Hex(plaintext);
  const [row] = await db
    .select()
    .from(refreshTokens)
    .where(and(eq(refreshTokens.tokenHash, tokenHash), isNull(refreshTokens.revokedAt)))
    .limit(1);
  if (!row) return null;
  if (row.expiresAt.getTime() < Date.now()) return null;
  return row;
}

/**
 * P1 — Lock-and-check variant for the refresh path. Locks by `token_hash`
 * (the only client-known identifier post-O.1). Two concurrent refreshes
 * for the same token: one rotates, the other sees `revoked_at IS NOT NULL`.
 *
 * Bumped from O.0: was keyed by `id` (JWT jti). The new shape is keyed
 * by the opaque-hash because the client no longer presents an id, only
 * the plaintext token.
 */
export async function findActiveRefreshTokenForUpdate(trx: Database, plaintext: string) {
  const tokenHash = sha256Hex(plaintext);
  // Drizzle's `.execute` with a raw SQL template returns scalar timestamp
  // columns as strings (postgres-js doesn't apply Drizzle's column-level Date
  // mapper when the call bypasses the table builder). Batch O wrote the
  // shape assuming Dates and crashed at runtime with `.getTime is not a
  // function`. Coerce defensively — both ISO strings and Dates are valid
  // inputs to `new Date()`.
  const [row] = await trx.execute<{
    id: string;
    user_id: string;
    aal: string;
    expires_at: string | Date;
    revoked_at: string | Date | null;
  }>(sql`
    SELECT id, user_id, aal, expires_at, revoked_at
    FROM refresh_tokens
    WHERE token_hash = ${tokenHash}
    FOR UPDATE
  `);
  if (!row) return null;
  if (row.revoked_at) return null;
  const expiresAt = new Date(row.expires_at);
  if (expiresAt.getTime() < Date.now()) return null;
  return {
    id: row.id,
    userId: row.user_id,
    aal: row.aal as AuthAal,
    expiresAt,
  };
}

export async function revokeRefreshToken(jti: string, trx: Database = db): Promise<void> {
  await trx
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(eq(refreshTokens.id, jti));
}

export async function revokeAllForUser(userId: string, trx: Database = db): Promise<void> {
  await trx
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
}
