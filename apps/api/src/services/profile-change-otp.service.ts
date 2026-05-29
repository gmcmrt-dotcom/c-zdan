import { addMinutes } from "date-fns";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { db, tx } from "../db/client";
import { auditLog, profileChangeOtps, profiles, refreshTokens, systemLogs, users } from "../db/schema";
import { constantTimeEqual as constantTimeEqualStr, randomNumericCode, sha256Hex } from "../lib/random";
import { BadRequestError, ConflictError, NotFoundError, UnauthorizedError } from "../lib/errors";
import { logger } from "../lib/logger";

const OTP_TTL_MIN = 10;
const RATE_LIMIT_SEC = 60;
const MAX_ATTEMPTS = 5;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[0-9]{10}$/;

export async function requestProfileChangeOtp(
  userId: string,
  changeType: "email" | "phone",
  newValue: string,
): Promise<{ expiresIn: number }> {
  const value = newValue.trim();
  if (changeType === "email" && !EMAIL_RE.test(value)) throw new BadRequestError("BAD_EMAIL");
  if (changeType === "phone" && !PHONE_RE.test(value)) throw new BadRequestError("BAD_PHONE");

  // Uniqueness
  if (changeType === "email") {
    const [dup] = await db
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.email}) = ${value.toLowerCase()}`)
      .limit(1);
    if (dup) throw new ConflictError("EMAIL_EXISTS");
  } else {
    const [dup] = await db
      .select({ id: profiles.id })
      .from(profiles)
      .where(eq(profiles.phone, value))
      .limit(1);
    if (dup) throw new ConflictError("PHONE_EXISTS");
  }

  // Rate limit: 1 request / 60s per user+type
  const [recent] = await db
    .select({ id: profileChangeOtps.id, createdAt: profileChangeOtps.createdAt })
    .from(profileChangeOtps)
    .where(
      and(
        eq(profileChangeOtps.userId, userId),
        eq(profileChangeOtps.changeType, changeType),
        isNull(profileChangeOtps.consumedAt),
        gt(profileChangeOtps.createdAt, new Date(Date.now() - RATE_LIMIT_SEC * 1000)),
      ),
    )
    .orderBy(desc(profileChangeOtps.createdAt))
    .limit(1);
  if (recent) throw new ConflictError("RATE_LIMITED");

  const code = randomNumericCode(6);
  const codeHash = sha256Hex(code);
  const expiresAt = addMinutes(new Date(), OTP_TTL_MIN);
  await db.insert(profileChangeOtps).values({
    userId,
    changeType,
    newValue: value,
    codeHash,
    attempts: 0,
    expiresAt,
  });

  // N — P0-48 finish: send the OTP to the OLD address (the one currently
  // on file). For email changes, the user's current `users.email` IS the
  // old address — that's exactly what we want to notify. For phone changes
  // we don't have an SMS transport yet (separate workstream); we still log.
  if (changeType === "email") {
    try {
      const { sendEmail, profileChangeOtpTemplate } = await import("../lib/email");
      const [u] = await db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (u?.email) {
        const tpl = profileChangeOtpTemplate({
          name: null,
          otp: code,
          field: "email",
          notifyOldAddress: true,
        });
        const r = await sendEmail({ to: u.email, subject: tpl.subject, html: tpl.html });
        if (!r.ok) {
          logger.warn(
            { reason: r.error, userId },
            "profile-change OTP email send failed (OTP still issued; user must retry)",
          );
        } else {
          logger.info({ userId, transport: r.transport }, "profile-change OTP email sent to OLD address");
        }
      }
    } catch (err) {
      // Never block the OTP issue on a transport hiccup; the user can
      // request a new OTP and the structured rate limiter will let them.
      logger.warn({ err, userId }, "profile-change OTP email path errored");
    }
  } else {
    logger.info({ userId, changeType }, "profile-change OTP issued (no SMS transport)");
  }

  if (process.env.NODE_ENV !== "production") {
    // For local dev only — surface the code in logs so testers can use it.
    logger.warn({ userId, changeType, code }, "DEV-ONLY OTP echo (do NOT log in prod)");
  }

  return { expiresIn: OTP_TTL_MIN * 60 };
}

export async function verifyProfileChangeOtp(
  userId: string,
  changeType: "email" | "phone",
  newValue: string,
  code: string,
): Promise<void> {
  const codeHash = sha256Hex(code);
  const [row] = await db
    .select()
    .from(profileChangeOtps)
    .where(
      and(
        eq(profileChangeOtps.userId, userId),
        eq(profileChangeOtps.changeType, changeType),
        eq(profileChangeOtps.newValue, newValue.trim()),
        isNull(profileChangeOtps.consumedAt),
      ),
    )
    .orderBy(desc(profileChangeOtps.createdAt))
    .limit(1);
  if (!row) throw new NotFoundError("OTP_NOT_FOUND");
  if (row.expiresAt.getTime() < Date.now()) throw new BadRequestError("OTP_EXPIRED");
  if (row.attempts >= MAX_ATTEMPTS) throw new BadRequestError("OTP_LOCKED");

  // P3 — Constant-time compare to defeat the per-byte timing oracle that an
  // attacker could otherwise use to recover the hex hash one nibble at a time.
  if (!constantTimeEqualStr(row.codeHash, codeHash)) {
    await db
      .update(profileChangeOtps)
      .set({ attempts: row.attempts + 1 })
      .where(eq(profileChangeOtps.id, row.id));
    throw new UnauthorizedError("BAD_CODE");
  }

  await tx(async (trx) => {
    await trx
      .update(profileChangeOtps)
      .set({ consumedAt: new Date() })
      .where(eq(profileChangeOtps.id, row.id));

    if (changeType === "email") {
      const lower = row.newValue.toLowerCase();
      // emailVerifiedAt cleared so the access JWT's email claim doesn't
      // continue to assert verification of the OLD address.
      await trx.update(users).set({ email: lower, emailVerifiedAt: null }).where(eq(users.id, userId));
      await trx.update(profiles).set({ email: lower }).where(eq(profiles.id, userId));
    } else {
      await trx.update(profiles).set({ phone: row.newValue }).where(eq(profiles.id, userId));
    }

    // P0-48 (partial) — revoke ALL refresh tokens for this user. The stolen
    // bearer that initiated the change still has a valid access JWT until it
    // expires (~15 min), but cannot refresh — and the access JWT itself now
    // carries `email_verified_at=null` so downstream verification gates trip.
    // The email-OTP-to-OLD-address half of the fix is blocked on the email
    // transport (TODO Phase 11 — see requestProfileChangeOtp above).
    await trx
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));

    // Audit-log every self-service change so admin can trace post-incident.
    await trx.insert(auditLog).values({
      actorId: userId,
      action: `profile.${changeType}.self_changed`,
      resourceType: "profile",
      resourceId: userId,
      // `before` deliberately omits the old value to avoid PII duplication
      // in the audit table; the row's normal columns already track history.
      after: { changeType, newValue: row.newValue } as never,
      metadata: { sessions_revoked: true },
    });

    await trx.insert(systemLogs).values({
      actorId: userId,
      level: "info",
      source: "profile-change-otp",
      message: `profile.${changeType}.changed`,
      metadata: { changeType, newValue: row.newValue },
    });
  });
}
