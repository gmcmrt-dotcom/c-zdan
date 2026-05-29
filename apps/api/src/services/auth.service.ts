import { addSeconds } from "date-fns";
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { auth as AuthDto } from "@wallet/shared";
import { db, tx } from "../db/client";
import {
  accounts,
  emailVerificationTokens,
  passwordResetTokens,
  profiles,
  refreshTokens,
  userMfaBackupCodes,
  userMfaFactors,
  userRoles,
  users,
} from "../db/schema";
import { hashPassword, verifyPassword } from "../auth/passwords";
import {
  buildTotpQrDataUrl,
  buildTotpUri,
  decodeTotpSecret,
  encodeTotpSecret,
  generateTotpSecret,
  verifyTotpCode,
  verifyTotpCodeWithStep,
} from "../auth/mfa";
import {
  findActiveRefreshTokenForUpdate,
  issueTokens,
  revokeAllForUser,
  revokeRefreshToken,
  type IssuedTokens,
} from "../auth/sessions";
import { type AuthAal } from "../auth/jwt";
import { genMemberNo, genReferralCode, randomToken, sha256Hex } from "../lib/random";
import {
  AppError,
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
} from "../lib/errors";
import { logger } from "../lib/logger";
import { env } from "../lib/env";

const PHONE_E164_RE = /^[0-9]{10}$/;

function normalizeEmail(s: string): string {
  return s.trim().toLowerCase();
}

function toTitleCaseTr(s: string): string {
  return s
    .trim()
    .toLocaleLowerCase("tr-TR")
    .split(/\s+/)
    .map((w) => w.charAt(0).toLocaleUpperCase("tr-TR") + w.slice(1))
    .join(" ");
}

function reqIpUa(meta?: { ip?: string | null; userAgent?: string | null }) {
  return { ip: meta?.ip ?? null, userAgent: meta?.userAgent ?? null };
}

async function pickUnusedMemberNo(): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const candidate = genMemberNo();
    const [exists] = await db
      .select({ id: profiles.id })
      .from(profiles)
      .where(eq(profiles.memberNo, candidate))
      .limit(1);
    if (!exists) return candidate;
  }
  throw new Error("could not allocate member_no after 20 attempts");
}

async function pickUnusedReferralCode(): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const candidate = genReferralCode();
    const [exists] = await db
      .select({ id: profiles.id })
      .from(profiles)
      .where(eq(profiles.referralCode, candidate))
      .limit(1);
    if (!exists) return candidate;
  }
  throw new Error("could not allocate referral_code after 20 attempts");
}

export async function identifierExists(input: AuthDto.ProfileIdentifierExistsRequest) {
  let email_exists = false;
  let phone_exists = false;
  if (input.email) {
    const [row] = await db
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.email}) = ${normalizeEmail(input.email)}`)
      .limit(1);
    email_exists = !!row;
  }
  if (input.phone) {
    if (!PHONE_E164_RE.test(input.phone)) throw new BadRequestError("BAD_PHONE");
    const [row] = await db
      .select({ id: profiles.id })
      .from(profiles)
      .where(eq(profiles.phone, input.phone))
      .limit(1);
    phone_exists = !!row;
  }
  return { email_exists, phone_exists };
}

export interface SignupContext {
  ip?: string | null;
  userAgent?: string | null;
}

export async function signup(
  input: AuthDto.SignupRequest,
  ctx: SignupContext = {},
): Promise<IssuedTokens & { userId: string }> {
  const email = normalizeEmail(input.email);
  const firstName = toTitleCaseTr(input.firstName);
  const lastName = toTitleCaseTr(input.lastName);
  const phone = input.phone?.trim() || null;
  if (phone && !PHONE_E164_RE.test(phone)) throw new BadRequestError("BAD_PHONE");

  // K2 — Suppress signup enumeration oracle (Q20 decision).
  //
  // The previous shape threw distinct `EMAIL_EXISTS` / `PHONE_EXISTS`
  // errors, which let an attacker iterate emails/phones via the public
  // signup endpoint to enumerate registered users. We now return a single
  // `SIGNUP_REJECTED` on duplicate, and the server log retains the
  // distinct reason for support / fraud review. Users who hit this
  // condition must use "Forgot password?" to discover that they already
  // have an account (which leaks via a separate, rate-limited flow).
  const dup = await identifierExists({ email, phone: phone ?? undefined });
  if (dup.email_exists || dup.phone_exists) {
    logger.info(
      { reason: dup.email_exists ? "EMAIL_EXISTS" : "PHONE_EXISTS", ip: ctx.ip ?? null },
      "signup rejected (uniform SIGNUP_REJECTED)",
    );
    throw new ConflictError("SIGNUP_REJECTED");
  }

  const passwordHash = await hashPassword(input.password);
  const memberNo = await pickUnusedMemberNo();
  const referralCode = await pickUnusedReferralCode();

  const created = await tx(async (trx) => {
    const [u] = await trx
      .insert(users)
      .values({ email, passwordHash })
      .returning({ id: users.id, email: users.email });
    if (!u) throw new Error("user insert failed");

    await trx.insert(profiles).values({
      id: u.id,
      email,
      firstName,
      lastName,
      phone,
      memberNo,
      referralCode,
      signupIp: ctx.ip ?? null,
      signupUa: ctx.userAgent ?? null,
      signupAt: new Date(),
    });

    await trx.insert(accounts).values({
      userId: u.id,
      balance: "0",
      reservedBalance: "0",
      totalPoints: 0,
    });

    return u;
  });

  // TODO Phase 11: enqueue verification email via event_outbox.
  const tokens = await issueTokens(created.id, created.email, "aal1", reqIpUa(ctx));
  return { ...tokens, userId: created.id };
}

// P1 (auth) — Pre-computed bcrypt hash of a random throwaway password. Used
// when login is called with an unknown email so the response timing matches
// the "found user" branch and bcrypt cost is paid every request. This closes
// the user-enumeration timing oracle that previously distinguished missing
// from existing accounts by latency.
const TIMING_BCRYPT_DUMMY_HASH =
  "$2a$12$1KFqyz1KFqyz1KFqyz1KFOe5cTM0lA9.0vBu/8wkXJ.NPp0w0sFhO";

// P1 — Account lockout policy. After `LOCKOUT_THRESHOLD` consecutive failed
// logins for the same user, set `locked_until = now() + LOCKOUT_WINDOW_SEC`.
// On a successful login we reset both columns. The lock complements the
// per-IP rate limit (which doesn't catch distributed credential-stuffing).
const LOCKOUT_THRESHOLD = 10;
const LOCKOUT_WINDOW_SEC = 15 * 60;

// J5 — Session-fixation defence (doc note).
//
// This service does NOT rely on server-side session ids — we issue stateless
// JWT pairs on `login` (`signAccessToken` + `signRefreshToken`) and store the
// refresh hash in `auth_refresh_tokens`. A successful login therefore
// always produces a fresh `(jti, refresh_id)` pair that is unrelated to
// any pre-auth state the client might have held; an attacker cannot
// "pre-set" a session id and have it elevated after the victim logs in.
//
// On a password change OR MFA enroll/unenroll OR email change we explicitly
// `revokeAllForUser` so any token issued before the security-state change
// is dead. That is the analogous protection to the classic "regenerate
// session id on auth state change" rule for cookie-session frameworks.
//
// Refresh-token rotation: `refresh` (below) consumes the old refresh row
// and issues a new pair, atomically inside a transaction with
// `findActiveRefreshTokenForUpdate`. A replay of the old refresh fails
// the `revoked_at IS NULL` predicate and yields a single `INVALID_REFRESH`
// — there is no window in which both the old and new refresh tokens are
// simultaneously valid.

export async function login(
  input: AuthDto.LoginRequest,
  ctx: { ip?: string | null; userAgent?: string | null } = {},
): Promise<IssuedTokens & { userId: string; requiresMfa: boolean }> {
  const email = normalizeEmail(input.email);
  const [u] = await db
    .select({
      id: users.id,
      email: users.email,
      passwordHash: users.passwordHash,
      isActive: users.isActive,
      failedLoginCount: users.failedLoginCount,
      lockedUntil: users.lockedUntil,
    })
    .from(users)
    .where(sql`lower(${users.email}) = ${email}`)
    .limit(1);

  // P1 — same error for missing-user vs bad-password vs disabled-user so the
  // response doesn't reveal account state. The dummy bcrypt call equalises
  // request timing for the missing-user branch.
  if (!u) {
    await verifyPassword(input.password, TIMING_BCRYPT_DUMMY_HASH).catch(() => false);
    throw new UnauthorizedError("BAD_CREDENTIALS");
  }

  // P1 — short-circuit if the account is currently locked. We still run a
  // dummy bcrypt to keep response timing constant with the un-locked branch
  // (otherwise an attacker can probe lock state by latency).
  if (u.lockedUntil && u.lockedUntil.getTime() > Date.now()) {
    await verifyPassword(input.password, TIMING_BCRYPT_DUMMY_HASH).catch(() => false);
    throw new UnauthorizedError("BAD_CREDENTIALS");
  }

  const ok = await verifyPassword(input.password, u.passwordHash);
  if (!u.isActive || !ok) {
    // P1 — bump failed-login counter, escalate to lockout when threshold hit.
    // `failed_login_count + 1` is computed in SQL to be safe against
    // concurrent failed logins racing here.
    const newCount = (u.failedLoginCount ?? 0) + 1;
    const triggerLock = newCount >= LOCKOUT_THRESHOLD;
    await db
      .update(users)
      .set({
        failedLoginCount: sql`${users.failedLoginCount} + 1`,
        lockedUntil: triggerLock
          ? new Date(Date.now() + LOCKOUT_WINDOW_SEC * 1000)
          : users.lockedUntil,
      })
      .where(eq(users.id, u.id));
    throw new UnauthorizedError("BAD_CREDENTIALS");
  }

  // P1 — block frozen members from logging in. Money-flow routes already
  // check this for some flows, but a global gate is the more durable answer.
  const [p] = await db
    .select({ isFrozen: profiles.isFrozen })
    .from(profiles)
    .where(eq(profiles.id, u.id))
    .limit(1);
  if (p?.isFrozen) throw new ForbiddenError("ACCOUNT_FROZEN");

  // P1 — successful login resets the lockout counter.
  if (u.failedLoginCount !== 0 || u.lockedUntil !== null) {
    await db
      .update(users)
      .set({ failedLoginCount: 0, lockedUntil: null })
      .where(eq(users.id, u.id));
  }

  const requiresMfa = await hasStaffRole(u.id);
  const tokens = await issueTokens(u.id, u.email, "aal1", reqIpUa(ctx));

  return { ...tokens, userId: u.id, requiresMfa };
}

/** Any `user_roles` row (admin / accounting / support). */
export async function hasStaffRole(userId: string): Promise<boolean> {
  const [r] = await db
    .select({ id: userRoles.id })
    .from(userRoles)
    .where(eq(userRoles.userId, userId))
    .limit(1);
  return !!r;
}

export async function refresh(
  refreshTokenOpaque: string,
  ctx: { ip?: string | null; userAgent?: string | null } = {},
): Promise<IssuedTokens> {
  // O.1 — Opaque refresh tokens (Q1 Option A). The client presents the
  // plaintext blob we issued at login. We hash it, look up the row,
  // and lock it inside the same tx as the rotation. No JWT signature
  // is involved — the DB lookup IS the verification step. A stolen
  // `JWT_REFRESH_SECRET` is no longer usable for refresh forgery.
  if (!refreshTokenOpaque || refreshTokenOpaque.length < 32) {
    throw new UnauthorizedError("REFRESH_INVALID");
  }

  return tx(async (trx) => {
    const row = await findActiveRefreshTokenForUpdate(trx, refreshTokenOpaque);
    if (!row) {
      // O.1 / P1 — Refresh-reuse detection.
      //
      // The token hash didn't match any active row. With opaque tokens
      // there are three possibilities:
      //   (a) it never existed (typo / forgery attempt) → fail
      //   (b) it was rotated by an earlier refresh → an attacker is
      //       replaying a stolen one; we should burn the family
      //   (c) it was just revoked by a logout → fail
      //
      // We can't distinguish (a) from (b)/(c) without a probe lookup
      // that includes revoked rows. Do that probe to find the user
      // and burn the family if a previously-known token is being
      // replayed.
      const probe = await trx.execute<{ user_id: string }>(sql`
        SELECT user_id FROM refresh_tokens
        WHERE token_hash = ${sha256Hex(refreshTokenOpaque)}
        LIMIT 1
      `);
      const probedUserId = probe[0]?.user_id;
      if (probedUserId) {
        try {
          await revokeAllForUser(probedUserId, trx);
        } catch {
          /* logging only — don't mask the original error */
        }
        throw new UnauthorizedError("REFRESH_REVOKED");
      }
      throw new UnauthorizedError("REFRESH_INVALID");
    }

    // rotate (under the same lock)
    await revokeRefreshToken(row.id, trx);
    const [u] = await trx
      .select({ email: users.email, isActive: users.isActive })
      .from(users)
      .where(eq(users.id, row.userId))
      .limit(1);
    if (!u || !u.isActive) throw new UnauthorizedError("USER_DISABLED");

    return issueTokens(row.userId, u.email, row.aal, reqIpUa(ctx));
  });
}

export async function logout(
  userId: string,
  refreshTokenOpaque: string | undefined,
  allDevices: boolean,
): Promise<void> {
  if (allDevices) {
    await revokeAllForUser(userId);
    return;
  }
  if (!refreshTokenOpaque) return;
  // O.1 — Hash + lookup + revoke. Silent fail on missing row (idempotent).
  try {
    const tokenHash = sha256Hex(refreshTokenOpaque);
    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(refreshTokens.tokenHash, tokenHash),
          eq(refreshTokens.userId, userId),
        ),
      );
  } catch {
    // ignore; idempotent logout
  }
}

export async function buildMe(userId: string): Promise<AuthDto.MeResponse> {
  const [u] = await db
    .select({
      id: users.id,
      email: users.email,
      emailVerifiedAt: users.emailVerifiedAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!u) throw new NotFoundError("USER_NOT_FOUND");

  const [p] = await db.select().from(profiles).where(eq(profiles.id, userId)).limit(1);

  const roles = await db.select().from(userRoles).where(eq(userRoles.userId, userId));
  const factors = await db
    .select()
    .from(userMfaFactors)
    .where(and(eq(userMfaFactors.userId, userId), isNotNull(userMfaFactors.verifiedAt)));

  // merchant membership
  const { merchantUsers } = await import("../db/schema");
  const [m] = await db
    .select({ merchantId: merchantUsers.merchantId, role: merchantUsers.role })
    .from(merchantUsers)
    .where(and(eq(merchantUsers.userId, userId), eq(merchantUsers.isActive, true)))
    .limit(1);

  // affiliate membership (only if feature enabled)
  let isAffiliate = false;
  if (env.AFFILIATE_SYSTEM_ENABLED) {
    const { merchantAffiliates } = await import("../db/schema");
    const [a] = await db
      .select({ id: merchantAffiliates.id })
      .from(merchantAffiliates)
      .where(
        and(
          eq(merchantAffiliates.status, "active"),
          sql`(${merchantAffiliates.authUserId} = ${userId} OR ${merchantAffiliates.linkedUserId} = ${userId})`,
        ),
      )
      .limit(1);
    isAffiliate = !!a;
  }

  const isStaff = roles.length > 0;
  const requiresMfa = isStaff;

  // permissions: union of bo_permissions for roles minus/plus overrides
  const permissions = await loadPermissionsForUser(userId);

  return {
    user: {
      id: u.id,
      email: u.email,
      emailVerified: !!u.emailVerifiedAt,
      aal: "aal1", // overwritten by caller using JWT claims
    },
    profile: p
      ? {
          memberNo: p.memberNo,
          firstName: p.firstName,
          lastName: p.lastName,
          phone: p.phone,
          kycStatus: p.kycStatus,
          isFrozen: p.isFrozen,
          referralCode: p.referralCode,
        }
      : null,
    memberships: {
      isStaff,
      roles: roles.map((r) => r.role),
      merchantId: m?.merchantId ?? null,
      merchantRole: (m?.role as AuthDto.MeResponse["memberships"]["merchantRole"]) ?? null,
      isAffiliate,
    },
    mfa: {
      enabled: factors.length > 0,
      required: requiresMfa,
      factorsCount: factors.length,
    },
    permissions,
  };
}

export async function loadPermissionsForUser(
  userId: string,
): Promise<Array<{ resource: string; action: string }>> {
  const result = await db.execute(sql`
    WITH role_perms AS (
      SELECT bp.resource, bp.action
      FROM bo_permissions bp
      JOIN user_roles ur ON ur.role = bp.role
      WHERE ur.user_id = ${userId} AND bp.granted = TRUE
    ),
    overrides AS (
      SELECT resource, action, granted
      FROM user_permission_overrides
      WHERE user_id = ${userId}
    )
    SELECT DISTINCT resource, action FROM role_perms
    WHERE NOT EXISTS (SELECT 1 FROM overrides o WHERE o.resource = role_perms.resource AND o.action = role_perms.action AND o.granted = FALSE)
    UNION
    SELECT resource, action FROM overrides WHERE granted = TRUE
  `);
  return (result as unknown as Array<{ resource: string; action: string }>).map((r) => ({
    resource: r.resource,
    action: r.action,
  }));
}

// ---------------------- MFA ----------------------

// ---------- K3: MFA backup codes (Q11) ----------
//
// Codes are 10 chars, base32-ish (no I/O/0/1 to avoid OCR confusion).
// Stored only as sha256 hashes; the plaintext leaves the server exactly
// ONCE (when generated). 8 codes per regeneration. The codes can be
// presented at `/auth/mfa/challenge` in place of a TOTP code; consuming
// a code marks it used so it cannot be replayed.

const BACKUP_CODE_COUNT = 8;
const BACKUP_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1
const BACKUP_CODE_LENGTH = 10;

function generateBackupCode(): string {
  const buf = randomToken(16);
  let out = "";
  for (let i = 0; i < BACKUP_CODE_LENGTH; i++) {
    out += BACKUP_CODE_ALPHABET[buf.charCodeAt(i) % BACKUP_CODE_ALPHABET.length];
  }
  // Format as XXXXX-XXXXX for human readability.
  return `${out.slice(0, 5)}-${out.slice(5)}`;
}

function normaliseBackupCode(input: string): string {
  // Accept the displayed `XXXXX-XXXXX` form, lowercase, or with spaces.
  return input.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

/**
 * Generate + persist a fresh set of 8 backup codes for `userId`. Drops
 * any existing unused codes first (a regeneration invalidates the old
 * set so a printed sheet that's been compromised can be rotated).
 * Returns the plaintext codes — the caller MUST display them to the
 * user immediately and never store them anywhere else.
 */
export async function regenerateMfaBackupCodes(userId: string): Promise<string[]> {
  return tx(async (trx) => {
    await trx
      .delete(userMfaBackupCodes)
      .where(eq(userMfaBackupCodes.userId, userId));
    const plain: string[] = [];
    const rows: { userId: string; codeHash: string }[] = [];
    for (let i = 0; i < BACKUP_CODE_COUNT; i++) {
      const code = generateBackupCode();
      plain.push(code);
      rows.push({ userId, codeHash: sha256Hex(normaliseBackupCode(code)) });
    }
    await trx.insert(userMfaBackupCodes).values(rows);
    return plain;
  });
}

/**
 * Attempt to consume a backup code on behalf of `userId`. Returns true
 * if the code matched an unused row (which is now marked consumed).
 * Constant-time-ish: every call hits the DB exactly once whether the
 * code was right or wrong.
 */
export async function consumeMfaBackupCode(userId: string, code: string): Promise<boolean> {
  const norm = normaliseBackupCode(code);
  if (norm.length < 6) return false; // obvious garbage; skip the DB hit
  const hash = sha256Hex(norm);
  const result = await db
    .update(userMfaBackupCodes)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(userMfaBackupCodes.userId, userId),
        eq(userMfaBackupCodes.codeHash, hash),
        isNull(userMfaBackupCodes.consumedAt),
      ),
    )
    .returning({ id: userMfaBackupCodes.id });
  return result.length > 0;
}

export async function countMfaBackupCodesRemaining(userId: string): Promise<number> {
  const [row] = await db.execute<{ n: string | number }>(sql`
    SELECT count(*) AS n FROM user_mfa_backup_codes
     WHERE user_id = ${userId} AND consumed_at IS NULL
  `);
  return Number(row?.n ?? 0);
}

export async function mfaEnroll(
  userId: string,
  email: string,
  friendlyName: string,
): Promise<AuthDto.MfaEnrollResponse> {
  // H1 — MFA enrollment is one-shot: the plaintext secret is returned to the
  // caller ONCE on this response and never again (the DB stores only the
  // AES-GCM-encrypted version, and no other endpoint decrypts + returns it).
  // To make this property robust against accidental re-issue we drop any
  // pending unverified factor for the same user before inserting the new
  // row. Multiple parallel un-finished enrollments would otherwise let an
  // attacker who racked up several rows pick whichever secret was easier
  // to capture from logs/screenshots/QR cache.
  return tx(async (trx) => {
    await trx
      .delete(userMfaFactors)
      .where(and(eq(userMfaFactors.userId, userId), isNull(userMfaFactors.verifiedAt)));
    const secret = generateTotpSecret();
    const [row] = await trx
      .insert(userMfaFactors)
      .values({ userId, friendlyName, secretEncrypted: encodeTotpSecret(secret) })
      .returning({ id: userMfaFactors.id });
    if (!row) throw new Error("mfa factor insert failed");
    return {
      factorId: row.id,
      secret,
      uri: buildTotpUri(email, secret),
      qrDataUrl: await buildTotpQrDataUrl(email, secret),
    };
  });
}

export async function mfaVerifyEnrollment(
  userId: string,
  factorId: string,
  code: string,
): Promise<{ backupCodes: string[] }> {
  const [f] = await db
    .select()
    .from(userMfaFactors)
    .where(and(eq(userMfaFactors.id, factorId), eq(userMfaFactors.userId, userId)))
    .limit(1);
  if (!f) throw new NotFoundError("FACTOR_NOT_FOUND");
  const secret = decodeTotpSecret(f.secretEncrypted);
  const r = verifyTotpCodeWithStep(code, secret);
  if (!r.ok || r.matchedStep === null) throw new UnauthorizedError("BAD_CODE");
  await db
    .update(userMfaFactors)
    .set({ verifiedAt: new Date(), lastUsedAt: new Date(), lastUsedStep: r.matchedStep })
    .where(eq(userMfaFactors.id, factorId));

  // K3 — Generate + return one-time backup codes on the FIRST successful
  // enrollment verify. The plaintext leaves the server exactly here; the
  // FE must show them to the user immediately (download / print) and we
  // never reveal them again. Regenerating later invalidates this set.
  const backupCodes = await regenerateMfaBackupCodes(userId);

  // P1 — A newly-verified MFA factor changes the user's security posture;
  // force every other active session to re-authenticate so a session that
  // existed BEFORE MFA enrollment can't continue as aal1. The caller's own
  // current refresh is included (the UI just re-logs in via mfaChallenge).
  await revokeAllForUser(userId);

  return { backupCodes };
}

export async function mfaChallenge(
  userId: string,
  email: string,
  code: string,
  ctx: { ip?: string | null; userAgent?: string | null } = {},
): Promise<IssuedTokens> {
  const factors = await db
    .select()
    .from(userMfaFactors)
    .where(and(eq(userMfaFactors.userId, userId), isNotNull(userMfaFactors.verifiedAt)));
  if (factors.length === 0) throw new ForbiddenError("MFA_NOT_ENROLLED");

  // K3 — Backup code shortcut. The displayed form is `XXXXX-XXXXX` (10
  // alphanumeric chars, dash-separated, no I/O/0/1). We detect that
  // shape before the TOTP check so a user typing a backup code never
  // accidentally trips the "BAD_CODE" path. Backup codes are sha256-
  // hashed and single-use.
  const normalised = code.replace(/[^A-Za-z0-9]/g, "");
  if (normalised.length >= 9) {
    const consumed = await consumeMfaBackupCode(userId, code);
    if (consumed) {
      // Mark the FIRST enrolled factor's lastUsedAt so the UI's "last
      // verified" timestamp keeps moving; doesn't touch lastUsedStep
      // because a backup code isn't a step.
      const [f] = factors;
      if (f) {
        await db
          .update(userMfaFactors)
          .set({ lastUsedAt: new Date() })
          .where(eq(userMfaFactors.id, f.id));
      }
      return issueTokens(userId, email, "aal2", reqIpUa(ctx));
    }
    // If the shape looked like a backup code but didn't match, fall
    // through to TOTP check. Some legitimate TOTPs are 6 digits and
    // would never reach this branch anyway.
  }

  // P1 — Replay-safe verify. We compute which 30-sec step the submitted
  // code matched and persist it on the factor row; any future attempt that
  // resolves to the same (or older) step is rejected even though the code
  // is still inside its 30-second validity window. Without this, an
  // attacker who captures a single TOTP code (man-in-the-middle, screen
  // recording, shoulder-surf) can replay it for up to 60 seconds.
  let matchedFactorId: string | null = null;
  let matchedStep = -1;
  for (const f of factors) {
    const secret = decodeTotpSecret(f.secretEncrypted);
    const r = verifyTotpCodeWithStep(code, secret);
    if (r.ok && r.matchedStep !== null) {
      // Reject reuse of the same (or older) step on this factor.
      if (f.lastUsedStep !== null && f.lastUsedStep >= r.matchedStep) {
        throw new UnauthorizedError("CODE_REUSED");
      }
      matchedFactorId = f.id;
      matchedStep = r.matchedStep;
      break;
    }
  }
  if (!matchedFactorId) throw new UnauthorizedError("BAD_CODE");

  // Atomically record the matched step on the specific factor; this is the
  // single-use latch. Other factors keep their previous step (so a member
  // with two enrolled devices can independently use both).
  await db
    .update(userMfaFactors)
    .set({ lastUsedAt: new Date(), lastUsedStep: matchedStep })
    .where(eq(userMfaFactors.id, matchedFactorId));

  return issueTokens(userId, email, "aal2", reqIpUa(ctx));
}

/**
 * P0-49 — Remove a TOTP factor only after the caller proves possession.
 *
 * The previous shape only required a valid access token, so a stolen aal1
 * bearer could strip the victim's MFA and then trigger password reset for a
 * full takeover. Now `mfaUnenroll` requires either:
 *   - an aal2 JWT (the caller just challenged the same factor), OR
 *   - a fresh TOTP `code` that verifies against the factor about to be deleted.
 *
 * Staff users have an extra guard: if the env flag `STAFF_AAL2_REQUIRED` is
 * on, staff must use AAL2 to unenroll regardless of code presence (a stolen
 * aal1 access token cannot challenge-and-unenroll in one shot).
 */
export async function mfaUnenroll(
  userId: string,
  factorId: string,
  opts?: { code?: string; aal?: AuthAal },
): Promise<void> {
  const [f] = await db
    .select()
    .from(userMfaFactors)
    .where(and(eq(userMfaFactors.id, factorId), eq(userMfaFactors.userId, userId)))
    .limit(1);
  if (!f) throw new NotFoundError("FACTOR_NOT_FOUND");

  const staffEnforce = process.env.STAFF_AAL2_REQUIRED === "true" && (await hasStaffRole(userId));
  if (staffEnforce && opts?.aal !== "aal2") {
    throw new ForbiddenError("AAL2_REQUIRED");
  }

  const okByAal2 = opts?.aal === "aal2";
  // P1 — Code-path step-up also respects replay protection: if the same
  // code was used for the immediately-prior challenge, refuse. Together
  // with P0-49 (which already requires code OR aal2) this means a stolen
  // bearer + captured code can't unenroll in one shot.
  let okByCode = false;
  if (!okByAal2 && opts?.code) {
    const r = verifyTotpCodeWithStep(opts.code, decodeTotpSecret(f.secretEncrypted));
    if (r.ok && r.matchedStep !== null) {
      if (f.lastUsedStep !== null && f.lastUsedStep >= r.matchedStep) {
        throw new ForbiddenError("CODE_REUSED");
      }
      okByCode = true;
    }
  }
  if (!okByAal2 && !okByCode) {
    throw new ForbiddenError("MFA_STEP_UP_REQUIRED");
  }

  await db
    .delete(userMfaFactors)
    .where(and(eq(userMfaFactors.id, factorId), eq(userMfaFactors.userId, userId)));

  // P1 — Removing an MFA factor weakens the user's security posture; revoke
  // every active refresh so any session that held an aal2 JWT (or any other
  // session at all) is forced to re-authenticate.
  await revokeAllForUser(userId);
}

export interface MfaFactorListItem {
  id: string;
  type: "totp";
  friendlyName: string;
  verifiedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

export async function mfaListFactors(userId: string): Promise<MfaFactorListItem[]> {
  const rows = await db
    .select()
    .from(userMfaFactors)
    .where(eq(userMfaFactors.userId, userId));
  return rows.map((r) => ({
    id: r.id,
    type: "totp",
    friendlyName: r.friendlyName,
    verifiedAt: r.verifiedAt ? r.verifiedAt.toISOString() : null,
    lastUsedAt: r.lastUsedAt ? r.lastUsedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  }));
}

// ---------------- Password reset / change ----------------

export async function requestPasswordReset(email: string): Promise<string | null> {
  const e = normalizeEmail(email);
  const [u] = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = ${e}`)
    .limit(1);
  if (!u) return null; // do not reveal existence
  const tokenPlain = randomToken(32);
  const tokenHash = sha256Hex(tokenPlain);
  const expiresAt = addSeconds(new Date(), 60 * 60); // 1h
  await db.insert(passwordResetTokens).values({ userId: u.id, tokenHash, expiresAt });
  return tokenPlain;
}

export async function confirmPasswordReset(token: string, newPassword: string): Promise<void> {
  const hash = sha256Hex(token);
  const [row] = await db
    .select()
    .from(passwordResetTokens)
    .where(eq(passwordResetTokens.tokenHash, hash))
    .limit(1);
  // I3 — Uniform `TOKEN_INVALID` for missing / used / expired. Distinct
  // codes leak whether a token ever existed and whether it's still in its
  // validity window, which helps an attacker timing the reset-link reuse
  // race. The server log still records the specific reason.
  if (!row) {
    logger.info({ tokenHash: hash.slice(0, 8) }, "password reset confirm: TOKEN_INVALID (missing)");
    throw new BadRequestError("TOKEN_INVALID");
  }
  if (row.consumedAt) {
    logger.info({ tokenHash: hash.slice(0, 8) }, "password reset confirm: TOKEN_INVALID (used)");
    throw new BadRequestError("TOKEN_INVALID");
  }
  if (row.expiresAt.getTime() < Date.now()) {
    logger.info({ tokenHash: hash.slice(0, 8) }, "password reset confirm: TOKEN_INVALID (expired)");
    throw new BadRequestError("TOKEN_INVALID");
  }

  const passwordHash = await hashPassword(newPassword);
  await tx(async (trx) => {
    await trx
      .update(passwordResetTokens)
      .set({ consumedAt: new Date() })
      .where(eq(passwordResetTokens.id, row.id));
    await trx.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, row.userId));
    await trx
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(refreshTokens.userId, row.userId));
  });
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const [u] = await db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!u) throw new NotFoundError();
  const ok = await verifyPassword(currentPassword, u.passwordHash);
  if (!ok) throw new UnauthorizedError("BAD_CURRENT_PASSWORD");
  const passwordHash = await hashPassword(newPassword);
  await db.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, userId));
  // P1 — Revoke every refresh token after a password change. The previous
  // version left other sessions valid until their natural expiry, so a stolen
  // refresh could survive the password rotation.
  await revokeAllForUser(userId);
}

// ---------------- Email verification (token-based) ----------------

export async function issueEmailVerificationToken(userId: string, email: string): Promise<string> {
  const tokenPlain = randomToken(32);
  const tokenHash = sha256Hex(tokenPlain);
  const expiresAt = addSeconds(new Date(), 60 * 60 * 24);
  await db.insert(emailVerificationTokens).values({ userId, email, tokenHash, expiresAt });
  return tokenPlain;
}

export async function confirmEmailVerification(token: string): Promise<void> {
  const hash = sha256Hex(token);
  const [row] = await db
    .select()
    .from(emailVerificationTokens)
    .where(eq(emailVerificationTokens.tokenHash, hash))
    .limit(1);
  // I3 — Same uniform `TOKEN_INVALID` as the password-reset confirm path.
  if (!row) {
    logger.info({ tokenHash: hash.slice(0, 8) }, "email verify: TOKEN_INVALID (missing)");
    throw new BadRequestError("TOKEN_INVALID");
  }
  if (row.consumedAt) {
    logger.info({ tokenHash: hash.slice(0, 8) }, "email verify: TOKEN_INVALID (used)");
    throw new BadRequestError("TOKEN_INVALID");
  }
  if (row.expiresAt.getTime() < Date.now()) {
    logger.info({ tokenHash: hash.slice(0, 8) }, "email verify: TOKEN_INVALID (expired)");
    throw new BadRequestError("TOKEN_INVALID");
  }
  await tx(async (trx) => {
    await trx
      .update(emailVerificationTokens)
      .set({ consumedAt: new Date() })
      .where(eq(emailVerificationTokens.id, row.id));
    await trx.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, row.userId));
  });
}
