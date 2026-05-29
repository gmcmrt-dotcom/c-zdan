/**
 * Admin: members management (search, list, freeze, KYC, balance/points adjust,
 * window-points cancel, login history).
 *
 * Service-layer port of the legacy `admin_*` member RPCs. All mutating
 * functions call `writeAudit` so admin actions remain queryable.
 */
import { addSeconds } from "date-fns";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { db, tx } from "../../db/client";
import {
  accounts,
  loyaltyPointsLog,
  profiles,
  transactions,
  userLoginIps,
  userRoles,
  users,
} from "../../db/schema";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../lib/errors";
import { makeTxPublicNo } from "../../lib/public-no";
import { maybeUpgradeTier } from "../loyalty-tier.service";
import { writeAudit } from "./audit";
import { withAdminIdempotency } from "./idempotency";

export { setMemberTier } from "../loyalty-tier.service";

export interface MemberFilters {
  search?: string;
  frozenFilter?: "all" | "frozen" | "active";
  kycFilter?: "all" | "none" | "pending" | "verified" | "rejected";
  createdFrom?: string;
  createdTo?: string;
  reservedOnly?: boolean;
  sortBy?: "created_at" | "member_no" | "email";
  sortDir?: "asc" | "desc";
  offset?: number;
  limit?: number;
  /**
   * P1 — When true, the caller has `members.pii:view_full` and rows are
   * returned with email/phone in clear. When false (default), each row is
   * masked server-side so the UI never receives raw PII for a caller that
   * only has `members.pii:view_masked` (or has no PII permission at all).
   */
  viewFullPii?: boolean;
}

function maskEmail(e: string | null): string | null {
  if (!e) return e;
  const [local, domain] = e.split("@", 2);
  if (!domain || !local) return e;
  if (local.length <= 2) return `${local[0] ?? "*"}***@${domain}`;
  return `${local.slice(0, 2)}***@${domain}`;
}

function maskPhone(p: string | null): string | null {
  if (!p) return p;
  const trimmed = p.replace(/\s+/g, "");
  if (trimmed.length <= 4) return "***" + trimmed.slice(-2);
  return trimmed.slice(0, 3) + "***" + trimmed.slice(-2);
}

function buildWhere(f: MemberFilters) {
  const conds = [] as ReturnType<typeof eq>[];
  if (f.frozenFilter === "frozen") conds.push(eq(profiles.isFrozen, true));
  if (f.frozenFilter === "active") conds.push(eq(profiles.isFrozen, false));
  if (f.kycFilter && f.kycFilter !== "all")
    conds.push(eq(profiles.kycStatus, f.kycFilter as never));
  if (f.search) {
    conds.push(
      sql`(profiles.member_no ILIKE ${`%${f.search}%`} OR profiles.email ILIKE ${`%${f.search}%`} OR profiles.first_name ILIKE ${`%${f.search}%`} OR profiles.last_name ILIKE ${`%${f.search}%`} OR profiles.phone ILIKE ${`%${f.search}%`})` as never,
    );
  }
  if (f.createdFrom) conds.push(gte(profiles.createdAt, new Date(f.createdFrom)));
  if (f.createdTo) conds.push(lte(profiles.createdAt, new Date(f.createdTo)));
  return conds.length ? and(...conds) : undefined;
}

export async function listMembers(f: MemberFilters) {
  const where = buildWhere(f);
  const limit = Math.min(f.limit ?? 50, 200);
  const offset = Math.max(f.offset ?? 0, 0);
  const sortDir = f.sortDir === "asc" ? "asc" : "desc";
  const orderCol =
    f.sortBy === "member_no" ? profiles.memberNo : f.sortBy === "email" ? profiles.email : profiles.createdAt;
  const rows = await db
    .select({
      userId: profiles.id,
      memberNo: profiles.memberNo,
      firstName: profiles.firstName,
      lastName: profiles.lastName,
      email: profiles.email,
      phone: profiles.phone,
      kycStatus: profiles.kycStatus,
      isFrozen: profiles.isFrozen,
      createdAt: profiles.createdAt,
      balance: accounts.balance,
      reservedBalance: accounts.reservedBalance,
      totalPoints: accounts.totalPoints,
    })
    .from(profiles)
    .leftJoin(accounts, eq(accounts.userId, profiles.id))
    .where(where)
    .orderBy(sortDir === "asc" ? orderCol : desc(orderCol))
    .limit(limit)
    .offset(offset);

  const [{ total } = { total: 0 }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(profiles)
    .where(where);

  let rowsFiltered = rows;
  if (f.reservedOnly) {
    rowsFiltered = rows.filter((r) => Number(r.reservedBalance ?? 0) > 0);
  }
  const full = f.viewFullPii === true;
  return {
    rows: rowsFiltered.map((r) => ({
      ...r,
      email: full ? r.email : maskEmail(r.email),
      phone: full ? r.phone : maskPhone(r.phone),
      balance: Number(r.balance ?? 0),
      reservedBalance: Number(r.reservedBalance ?? 0),
      totalPoints: r.totalPoints ?? 0,
      createdAt: r.createdAt.toISOString(),
    })),
    total,
    limit,
    offset,
  };
}

export async function membersSummary(_f: MemberFilters) {
  const [row] = await db.execute<{
    total: number;
    frozen: number;
    verified: number;
    pending_kyc: number;
    reserved_positive: number;
  }>(sql`
    SELECT
      (SELECT count(*)::int FROM profiles) AS total,
      (SELECT count(*)::int FROM profiles WHERE is_frozen) AS frozen,
      (SELECT count(*)::int FROM profiles WHERE kyc_status='verified') AS verified,
      (SELECT count(*)::int FROM profiles WHERE kyc_status='pending') AS pending_kyc,
      (SELECT count(*)::int FROM accounts WHERE reserved_balance > 0) AS reserved_positive
  `);
  return row;
}

/**
 * K4 — Admin "force logout this user" (Q24 decision). Revokes every active
 * refresh token for the target so all of their devices have to re-authenticate
 * on their next access-token refresh. Useful for: (a) "I think my account is
 * compromised, can you log me out everywhere", (b) staff demote response,
 * (c) lost-device after MFA reset. The user keeps their account; only the
 * sessions are killed. Audited.
 */
export async function forceLogoutMember(opts: {
  actorId: string;
  userId: string;
  reason?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}) {
  const { revokeAllForUser } = await import("../../auth/sessions");
  await tx(async (trx) => {
    const [target] = await trx
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.id, opts.userId))
      .limit(1);
    if (!target) throw new NotFoundError("USER_NOT_FOUND");
    await revokeAllForUser(opts.userId, trx);
    await writeAudit({
      actorId: opts.actorId,
      action: "member.force_logout",
      resourceType: "user",
      resourceId: opts.userId,
      before: null,
      after: { all_sessions_revoked: true },
      metadata: { reason: opts.reason ?? null },
      ip: opts.ip ?? null,
      userAgent: opts.userAgent ?? null,
      trx,
    });
  });
  return { success: true };
}

export async function freezeMember(opts: {
  actorId: string;
  userId: string;
  frozen: boolean;
  reason?: string | null;
  ip?: string | null;
}) {
  await tx(async (trx) => {
    const [before] = await trx
      .select({ isFrozen: profiles.isFrozen })
      .from(profiles)
      .where(eq(profiles.id, opts.userId))
      .limit(1);
    if (!before) throw new NotFoundError("MEMBER_NOT_FOUND");
    await trx.update(profiles).set({ isFrozen: opts.frozen, updatedAt: new Date() }).where(eq(profiles.id, opts.userId));
    await writeAudit({
      actorId: opts.actorId,
      action: opts.frozen ? "member.freeze" : "member.unfreeze",
      resourceType: "profile",
      resourceId: opts.userId,
      before,
      after: { isFrozen: opts.frozen },
      metadata: { reason: opts.reason ?? null },
      ip: opts.ip ?? null,
    });
  });
  return { success: true };
}

export async function setMemberKyc(opts: {
  actorId: string;
  userId: string;
  status: "none" | "pending" | "verified" | "rejected";
  reason?: string | null;
  ip?: string | null;
}) {
  await tx(async (trx) => {
    const [before] = await trx
      .select({ kycStatus: profiles.kycStatus })
      .from(profiles)
      .where(eq(profiles.id, opts.userId))
      .limit(1);
    if (!before) throw new NotFoundError("MEMBER_NOT_FOUND");
    await trx
      .update(profiles)
      .set({ kycStatus: opts.status, updatedAt: new Date() })
      .where(eq(profiles.id, opts.userId));
    await writeAudit({
      actorId: opts.actorId,
      action: "member.kyc",
      resourceType: "profile",
      resourceId: opts.userId,
      before,
      after: { kycStatus: opts.status },
      metadata: { reason: opts.reason ?? null },
      ip: opts.ip ?? null,
    });
  });
  return { success: true };
}

export async function updateMemberProfile(opts: {
  actorId: string;
  userId: string;
  /**
   * P0-45 — caller must set this to true ONLY when the actor has the
   * `bo_users:manage` permission. When false (the default), the service
   * refuses any update on a target that has a `user_roles` row, blocking the
   * admin-to-admin email takeover chain:
   *   admin A with members:view_full
   *     → PATCH /api/admin/members/{adminB}/profile {email: attacker@x}
   *     → /auth/password/reset-request on attacker@x
   *     → owns admin B.
   * The actor must use the dedicated /admin/bo-users surface (gated by
   * `bo_users:manage`) to touch staff accounts.
   */
  canManageStaff?: boolean;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string | null;
  ip?: string | null;
}) {
  return tx(async (trx) => {
    const [before] = await trx
      .select()
      .from(profiles)
      .where(eq(profiles.id, opts.userId))
      .limit(1);
    if (!before) throw new NotFoundError("MEMBER_NOT_FOUND");

    // P0-45 — refuse to mutate a staff target unless the actor has explicit
    // `bo_users:manage`. The check is in the service (not just the route) so
    // every entry point (REST, RPC, fn, future bulk APIs) inherits it.
    if (!opts.canManageStaff) {
      const [staffRow] = await trx
        .select({ role: userRoles.role })
        .from(userRoles)
        .where(eq(userRoles.userId, opts.userId))
        .limit(1);
      if (staffRow) {
        throw new ForbiddenError("TARGET_IS_STAFF_USE_BO_USERS");
      }
    }
    const patch: Partial<typeof profiles.$inferInsert> = { updatedAt: new Date() };
    if (opts.firstName !== undefined) patch.firstName = opts.firstName;
    if (opts.lastName !== undefined) patch.lastName = opts.lastName;
    if (opts.email !== undefined) patch.email = opts.email.toLowerCase();
    if (opts.phone !== undefined) patch.phone = opts.phone;
    await trx.update(profiles).set(patch).where(eq(profiles.id, opts.userId));
    if (opts.email !== undefined) {
      await trx
        .update(users)
        .set({ email: opts.email.toLowerCase(), updatedAt: new Date() })
        .where(eq(users.id, opts.userId));
    }
    await writeAudit({
      actorId: opts.actorId,
      action: "member.profile_update",
      resourceType: "profile",
      resourceId: opts.userId,
      before,
      after: patch,
      ip: opts.ip ?? null,
    });
    return { success: true };
  });
}

export async function adjustBalance(opts: {
  actorId: string;
  userId: string;
  amount: number;
  reason: string;
  ip?: string | null;
  /**
   * H4 — Optional idempotency key. When supplied, repeat submissions with
   * the same `(actorId, "member.balance_adjust", idempotencyKey)` return
   * the cached result instead of double-debiting. Closes the admin
   * double-click race.
   */
  idempotencyKey?: string | null;
}) {
  if (!opts.reason?.trim()) throw new BadRequestError("REASON_REQUIRED");
  if (opts.amount === 0) throw new BadRequestError("AMOUNT_ZERO");
  return tx(async (trx) =>
    withAdminIdempotency(
      trx,
      { actorId: opts.actorId, action: "member.balance_adjust", key: opts.idempotencyKey ?? null },
      async () => adjustBalanceInner(trx, opts),
    ),
  );
}

async function adjustBalanceInner(
  trx: import("../../db/client").Database,
  opts: {
    actorId: string;
    userId: string;
    amount: number;
    reason: string;
    ip?: string | null;
  },
): Promise<{ success: true; transactionId: string | null }> {
    // P0-2 — lock the account row before read+update so concurrent admin
    // adjusts and member-side spends are serialised.
    const [acc] = await trx.execute<{ balance: string }>(sql`
      SELECT balance FROM accounts WHERE user_id = ${opts.userId} FOR UPDATE
    `);
    if (!acc) throw new NotFoundError("ACCOUNT_NOT_FOUND");
    await trx
      .update(accounts)
      .set({
        balance: sql`${accounts.balance} + ${String(opts.amount)}`,
        updatedAt: new Date(),
      })
      .where(eq(accounts.userId, opts.userId));
    // P0-40 — stamp the post-adjust balance on the tx row so audit /
    // dispute resolution can trace the running balance.
    const balanceAfter = (Number(acc.balance) + opts.amount).toFixed(2);
    // P3 — use the canonical PREFIX-YYYYMMDD-NNNNNN public_no allocator
    // instead of the ad-hoc `ADJ-${Date.now()}-${random}` string. The legacy
    // shape didn't match HARD_RULES §14 and could collide.
    const publicNo = await makeTxPublicNo(trx, "adjustment");
    const [txn] = await trx
      .insert(transactions)
      .values({
        publicNo,
        userId: opts.userId,
        type: "adjustment",
        status: "completed",
        amount: String(Math.abs(opts.amount)),
        fee: "0",
        balanceAfter,
        description: opts.reason,
        metadata: { direction: opts.amount > 0 ? "credit" : "debit", actor_id: opts.actorId },
      })
      .returning({ id: transactions.id });
    await writeAudit({
      actorId: opts.actorId,
      action: "member.balance_adjust",
      resourceType: "profile",
      resourceId: opts.userId,
      before: { balance: Number(acc.balance) },
      after: { balance: Number(acc.balance) + opts.amount },
      metadata: { amount: opts.amount, reason: opts.reason, tx_id: txn?.id ?? null },
      ip: opts.ip ?? null,
    });
    return { success: true, transactionId: txn?.id ?? null };
}

export async function awardPoints(opts: {
  actorId: string;
  userId: string;
  points: number;
  reason: string;
  ip?: string | null;
}) {
  if (!opts.reason?.trim()) throw new BadRequestError("REASON_REQUIRED");
  if (opts.points === 0) throw new BadRequestError("POINTS_ZERO");
  // P1 — Negative points must NOT be processed by `awardPoints`. The
  // legitimate "remove points" path is `cancelUserWindowPoints` (which is
  // idempotency-keyed). Allowing arbitrary negative values via this RPC was
  // an unaudited debit channel — admin fat-finger or an exploited override
  // could drive balances negative silently.
  if (opts.points < 0) throw new BadRequestError("POINTS_NEGATIVE_NOT_ALLOWED");
  if (!Number.isInteger(opts.points)) throw new BadRequestError("POINTS_NOT_INTEGER");
  return tx(async (trx) => {
    const [acc] = await trx
      .select({ totalPoints: accounts.totalPoints })
      .from(accounts)
      .where(eq(accounts.userId, opts.userId))
      .limit(1);
    if (!acc) throw new NotFoundError("ACCOUNT_NOT_FOUND");
    await trx
      .update(accounts)
      .set({ totalPoints: sql`${accounts.totalPoints} + ${opts.points}`, updatedAt: new Date() })
      .where(eq(accounts.userId, opts.userId));
    const [row] = await trx
      .insert(loyaltyPointsLog)
      .values({
        userId: opts.userId,
        points: opts.points,
        reason: `admin:${opts.reason}`,
      })
      .returning({ id: loyaltyPointsLog.id });
    await writeAudit({
      actorId: opts.actorId,
      action: "member.points_award",
      resourceType: "profile",
      resourceId: opts.userId,
      before: { totalPoints: acc.totalPoints },
      after: { totalPoints: acc.totalPoints + opts.points },
      metadata: { points: opts.points, reason: opts.reason, log_id: row?.id ?? null },
      ip: opts.ip ?? null,
      trx,
    });
    // L2 — admin point grant may cross a tier threshold.
    await maybeUpgradeTier(opts.userId, trx);
    return { success: true };
  });
}

export async function cancelUserWindowPoints(opts: {
  actorId: string;
  userId: string;
  windowStart: string;
  windowEnd: string;
  reason: string;
  ip?: string | null;
}) {
  if (!opts.reason?.trim()) throw new BadRequestError("REASON_REQUIRED");
  // P0-38 — idempotency. Previously this fn re-summed the original positive
  // entries (filtered NOT LIKE 'admin:cancel%') and subtracted again every
  // call, so admin double-click = double point debit (drives points negative).
  // We compute a deterministic key from (userId, windowStart, windowEnd) and
  // check for a prior cancel-window row tagged with that key. If one exists,
  // return the previous result instead of re-applying.
  const windowKey = `cw:${opts.userId}:${opts.windowStart}:${opts.windowEnd}`;
  return tx(async (trx) => {
    const prior = await trx.execute<{ points: number }>(sql`
      SELECT points FROM loyalty_points_log
      WHERE user_id = ${opts.userId}
        AND reason LIKE 'admin:cancel-window:%'
        AND metadata->>'window_key' = ${windowKey}
      LIMIT 1
    `);
    const priorRows = prior as unknown as Array<{ points: number }>;
    if (priorRows.length > 0) {
      return { success: true, cancelled: Math.abs(priorRows[0]!.points), idempotent: true };
    }

    // Lock the account row so a concurrent award/cancel cannot interleave
    // between the sum read and the subtract.
    await trx.execute(sql`SELECT 1 FROM accounts WHERE user_id = ${opts.userId} FOR UPDATE`);

    const sum = await trx.execute<{ s: number }>(sql`
      SELECT COALESCE(sum(points),0)::int AS s
      FROM loyalty_points_log
      WHERE user_id = ${opts.userId}
        AND created_at >= ${opts.windowStart}::timestamptz
        AND created_at < ${opts.windowEnd}::timestamptz
        AND reason NOT LIKE 'admin:cancel%'
    `);
    const total = (sum as unknown as Array<{ s: number }>)[0]?.s ?? 0;
    if (total <= 0) return { success: true, cancelled: 0 };
    await trx
      .update(accounts)
      .set({ totalPoints: sql`GREATEST(${accounts.totalPoints} - ${total}, 0)`, updatedAt: new Date() })
      .where(eq(accounts.userId, opts.userId));
    await trx.insert(loyaltyPointsLog).values({
      userId: opts.userId,
      points: -total,
      reason: `admin:cancel-window:${opts.reason}`,
      metadata: {
        window_start: opts.windowStart,
        window_end: opts.windowEnd,
        window_key: windowKey,
        actor_id: opts.actorId,
      },
    });
    await writeAudit({
      actorId: opts.actorId,
      action: "member.points_cancel_window",
      resourceType: "profile",
      resourceId: opts.userId,
      metadata: { window_start: opts.windowStart, window_end: opts.windowEnd, cancelled: total, reason: opts.reason },
      ip: opts.ip ?? null,
    });
    return { success: true, cancelled: total };
  });
}

export async function memberLoginHistory(userId: string, limit = 50) {
  const rows = await db
    .select()
    .from(userLoginIps)
    .where(eq(userLoginIps.userId, userId))
    .orderBy(desc(userLoginIps.createdAt))
    .limit(Math.min(limit, 200));
  return rows.map((r) => ({
    id: r.id,
    ipAddress: r.ipAddress,
    userAgent: r.userAgent,
    // K1-r — Geo restored via local geoip-lite (no API call).
    country: r.country,
    city: r.city,
    deviceType: r.deviceType,
    browser: r.browser,
    os: r.os,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function dashboardStats(_since?: string, _until?: string) {
  const [row] = await db.execute<{
    member_count: number;
    active_topups: number;
    active_withdraws: number;
    total_member_balance: string;
    total_merchant_balance: string;
  }>(sql`
    SELECT
      (SELECT count(*)::int FROM profiles) AS member_count,
      (SELECT count(*)::int FROM topup_sessions WHERE status IN ('pending','awaiting_member_action','member_confirmed','redirected')) AS active_topups,
      (SELECT count(*)::int FROM withdraw_sessions WHERE status IN ('pending','sent_to_merchant')) AS active_withdraws,
      (SELECT COALESCE(sum(balance),0)::text FROM accounts) AS total_member_balance,
      (SELECT COALESCE(sum(balance),0)::text FROM merchants WHERE merchant_type='commerce') AS total_merchant_balance
  `);
  return row;
}
