/**
 * Admin referral remediation RPCs (K5 / P0-32).
 * Qualify / cancel / config — audited, no automatic payout (L5/K4).
 */
import { eq } from "drizzle-orm";
import { tx } from "../../db/client";
import { referralConfig, referrals } from "../../db/schema";
import { BadRequestError, NotFoundError, UnprocessableError } from "../../lib/errors";
import { writeAudit } from "./audit";

export async function qualifyReferralManual(opts: {
  actorId: string;
  referralId: string;
  reason: string;
  ip?: string | null;
  userAgent?: string | null;
}) {
  return tx(async (trx) => {
    const [row] = await trx
      .select()
      .from(referrals)
      .where(eq(referrals.id, opts.referralId))
      .limit(1);
    if (!row) throw new NotFoundError("REFERRAL_NOT_FOUND");
    if (row.status !== "pending") {
      throw new UnprocessableError("REFERRAL_NOT_PENDING");
    }
    const meta = { ...(row.meta ?? {}), admin_qualify_reason: opts.reason };
    await trx
      .update(referrals)
      .set({
        status: "qualified",
        qualifyingEvent: "admin_manual",
        qualifiedAt: new Date(),
        meta,
      })
      .where(eq(referrals.id, opts.referralId));
    await writeAudit({
      actorId: opts.actorId,
      action: "referral.admin_qualify",
      resourceType: "referral",
      resourceId: opts.referralId,
      before: { status: row.status },
      after: { status: "qualified", reason: opts.reason },
      ip: opts.ip ?? null,
      userAgent: opts.userAgent ?? null,
      trx,
    });
    return { success: true };
  });
}

export async function cancelReferral(opts: {
  actorId: string;
  referralId: string;
  reason: string;
  ip?: string | null;
  userAgent?: string | null;
}) {
  return tx(async (trx) => {
    const [row] = await trx
      .select()
      .from(referrals)
      .where(eq(referrals.id, opts.referralId))
      .limit(1);
    if (!row) throw new NotFoundError("REFERRAL_NOT_FOUND");
    if (row.status === "rewarded" || row.status === "cancelled") {
      throw new UnprocessableError("REFERRAL_NOT_CANCELLABLE");
    }
    const meta = {
      ...(row.meta ?? {}),
      cancelled_reason: opts.reason,
    };
    await trx
      .update(referrals)
      .set({
        status: "cancelled",
        cancelledAt: new Date(),
        meta,
      })
      .where(eq(referrals.id, opts.referralId));
    await writeAudit({
      actorId: opts.actorId,
      action: "referral.admin_cancel",
      resourceType: "referral",
      resourceId: opts.referralId,
      before: { status: row.status },
      after: { status: "cancelled", reason: opts.reason },
      ip: opts.ip ?? null,
      userAgent: opts.userAgent ?? null,
      trx,
    });
    return { success: true };
  });
}

export async function setReferralConfig(opts: {
  actorId: string;
  payload: {
    referrer_points: number;
    referrer_balance: number;
    referee_points: number;
    referee_balance: number;
    min_spend_to_qualify: number;
    monthly_referral_cap: number;
    monthly_reward_cap?: number;
    ip_rate_limit_per_24h: number;
    expire_after_days: number;
    is_active: boolean;
  };
  ip?: string | null;
  userAgent?: string | null;
}) {
  const p = opts.payload;
  if (p.expire_after_days < 1) throw new BadRequestError("EXPIRE_DAYS_INVALID");

  return tx(async (trx) => {
    const [before] = await trx.select().from(referralConfig).where(eq(referralConfig.id, true)).limit(1);

    await trx
      .insert(referralConfig)
      .values({
        id: true,
        referrerPoints: p.referrer_points,
        referrerBalance: String(p.referrer_balance),
        refereePoints: p.referee_points,
        refereeBalance: String(p.referee_balance),
        qualifyingSpendMin: String(p.min_spend_to_qualify),
        monthlyCapPerReferrer: p.monthly_referral_cap,
        ipCapPerDay: p.ip_rate_limit_per_24h,
        expireAfterDays: p.expire_after_days,
        isEnabled: p.is_active,
        updatedBy: opts.actorId,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: referralConfig.id,
        set: {
          referrerPoints: p.referrer_points,
          referrerBalance: String(p.referrer_balance),
          refereePoints: p.referee_points,
          refereeBalance: String(p.referee_balance),
          qualifyingSpendMin: String(p.min_spend_to_qualify),
          monthlyCapPerReferrer: p.monthly_referral_cap,
          ipCapPerDay: p.ip_rate_limit_per_24h,
          expireAfterDays: p.expire_after_days,
          isEnabled: p.is_active,
          updatedBy: opts.actorId,
          updatedAt: new Date(),
        },
      });

    await writeAudit({
      actorId: opts.actorId,
      action: "referral.config_update",
      resourceType: "referral_config",
      resourceId: "singleton",
      before: before ?? null,
      after: p,
      ip: opts.ip ?? null,
      userAgent: opts.userAgent ?? null,
      trx,
    });
    return { success: true };
  });
}
