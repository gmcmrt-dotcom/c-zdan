/**
 * Merchant BO endpoints — scoped to the calling merchant.
 *
 * `req.merchant.merchantId` is set by requireMerchant middleware. Everything in
 * this service uses it as the only authoritative scope (no inputs accepted).
 *
 * Merchant cannot see other merchants' data, member PII full view, or
 * provider_ledger details (per hard rule §13).
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, tx } from "../../db/client";
import { env } from "../../lib/env";
import {
  merchantApiCalls,
  merchantCashoutSessions,
  merchantCashPoolLog,
  merchantSettlementLog,
  merchantUserPermissionOverrides,
  merchantUsers,
  merchants,
  transactions,
} from "../../db/schema";
import { hmacSha256Hex, randomToken } from "../../lib/random";
import { encryptString } from "../../lib/crypto";
import { writeAudit } from "../admin/audit";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "../../lib/errors";

type Role = "owner" | "accountant" | "read_only";

async function allowedMerchantIds(
  merchantId: string,
  filter?: { merchantId?: string; merchantIds?: string[] },
): Promise<string[]> {
  const [m] = await db
    .select({
      merchantType: merchants.merchantType,
      merchantScope: merchants.merchantScope,
    })
    .from(merchants)
    .where(eq(merchants.id, merchantId))
    .limit(1);
  if (!m) throw new NotFoundError("MERCHANT_NOT_FOUND");

  const childRows =
    m.merchantScope === "parent"
      ? await db
          .select({ id: merchants.id })
          .from(merchants)
          .where(eq(merchants.parentMerchantId, merchantId))
      : [];

  const childIds = childRows.map((r) => r.id);
  const allowed = new Set([merchantId, ...childIds]);

  if (filter?.merchantIds?.length) {
    for (const id of filter.merchantIds) {
      if (!allowed.has(id)) throw new ForbiddenError("MERCHANT_SCOPE_DENIED");
    }
    return filter.merchantIds;
  }
  if (filter?.merchantId) {
    if (!allowed.has(filter.merchantId)) throw new ForbiddenError("MERCHANT_SCOPE_DENIED");
    return [filter.merchantId];
  }
  if (m.merchantScope === "parent" && childIds.length > 0) return childIds;
  return [merchantId];
}

export async function merchantSelf(merchantId: string) {
  const [m] = await db.select().from(merchants).where(eq(merchants.id, merchantId)).limit(1);
  if (!m) throw new NotFoundError("MERCHANT_NOT_FOUND");
  return {
    id: m.id,
    name: m.name,
    apiKey: m.apiKey,
    isActive: m.isActive,
    merchantType: m.merchantType,
    merchantScope: m.merchantScope,
    parentMerchantId: m.parentMerchantId,
    balance: Number(m.balance),
    cashoutReservedAmount: Number(m.cashoutReservedAmount),
    cashoutCommissionPct: Number(m.cashoutCommissionPct),
    cashoutFixedFee: Number(m.cashoutFixedFee),
    creditLimit: Number(m.creditLimit),
    cashPool: Number(m.cashPool),
    cashPoolUpdatedAt: m.cashPoolUpdatedAt?.toISOString() ?? null,
    commissionPct: Number(m.commissionPct),
    fixedFee: Number(m.fixedFee),
    ipWhitelist: m.ipWhitelist,
    webhookUrl: m.webhookUrl,
    topupInitUrl: m.topupInitUrl,
    integrationAdapter: m.integrationAdapter,
  };
}

export async function merchantSelfChildren(parentId: string) {
  const rows = await db
    .select({
      id: merchants.id,
      name: merchants.name,
      apiKey: merchants.apiKey,
      isActive: merchants.isActive,
      balance: merchants.balance,
      cashoutReservedAmount: merchants.cashoutReservedAmount,
      cashoutCommissionPct: merchants.cashoutCommissionPct,
      cashoutFixedFee: merchants.cashoutFixedFee,
    })
    .from(merchants)
    .where(eq(merchants.parentMerchantId, parentId));
  return rows.map((r) => ({
    ...r,
    balance: Number(r.balance),
    cashoutReservedAmount: Number(r.cashoutReservedAmount),
    cashoutCommissionPct: Number(r.cashoutCommissionPct),
    cashoutFixedFee: Number(r.cashoutFixedFee),
  }));
}

export async function merchantSelfRole(merchantUserId: string): Promise<{ role: Role | null }> {
  const [r] = await db
    .select({ role: merchantUsers.role })
    .from(merchantUsers)
    .where(eq(merchantUsers.id, merchantUserId))
    .limit(1);
  return { role: (r?.role as Role) ?? null };
}

export async function merchantSelfNav(merchantUserId: string, role: Role) {
  const [mu] = await db
    .select({ merchantId: merchantUsers.merchantId })
    .from(merchantUsers)
    .where(eq(merchantUsers.id, merchantUserId))
    .limit(1);
  const [m] = mu
    ? await db
        .select({
          name: merchants.name,
          merchantType: merchants.merchantType,
          merchantScope: merchants.merchantScope,
        })
        .from(merchants)
        .where(eq(merchants.id, mu.merchantId))
        .limit(1)
    : [];
  const isCommerce = m?.merchantType === "commerce";
  const isParent = m?.merchantScope === "parent";
  return {
    nav: [
      { key: "dashboard", label: "Dashboard", path: "/merchant" },
      { key: "settlement", label: "Settlement", path: "/merchant/settlement" },
      { key: "transactions", label: "Transactions", path: "/merchant/transactions" },
      { key: "api-calls", label: "API Calls", path: "/merchant/api-calls" },
      ...(isCommerce ? [{ key: "cashout", label: "Cashout", path: "/merchant/cashout" }] : []),
      ...(role === "owner"
        ? [
            { key: "settings", label: "Settings", path: "/merchant/settings" },
            { key: "users", label: "Users", path: "/merchant/users" },
            { key: "permissions", label: "Permissions", path: "/merchant/permissions" },
            ...(isParent
              ? [{ key: "children", label: "Children", path: "/merchant/children" }]
              : []),
          ]
        : []),
    ],
    role,
    merchantName: m?.name ?? null,
    merchantType: m?.merchantType ?? null,
    merchantScope: m?.merchantScope ?? null,
  };
}

export async function merchantSelfUpdateSettings(opts: {
  merchantId: string;
  role: Role;
  actorUserId: string;
  ip?: string | null;
  ipWhitelist?: string[] | null;
  webhookUrl?: string | null;
}) {
  if (opts.role !== "owner") throw new ForbiddenError("OWNER_REQUIRED");
  const patch: Partial<typeof merchants.$inferInsert> = {};
  if (opts.ipWhitelist !== undefined) patch.ipWhitelist = opts.ipWhitelist ?? [];
  if (opts.webhookUrl !== undefined) {
    patch.webhookUrl = opts.webhookUrl ?? null;
    patch.webhookUrlSetAt = opts.webhookUrl ? new Date() : null;
  }
  if (Object.keys(patch).length === 0) return { success: true };
  // P1 — snapshot the before row so the audit trail captures both sides of
  // the change. The redactor in writeAudit will mask anything sensitive.
  const [before] = await db
    .select({
      ipWhitelist: merchants.ipWhitelist,
      webhookUrl: merchants.webhookUrl,
    })
    .from(merchants)
    .where(eq(merchants.id, opts.merchantId))
    .limit(1);
  await db.update(merchants).set(patch).where(eq(merchants.id, opts.merchantId));
  await writeAudit({
    actorId: opts.actorUserId,
    action: "merchant.self_update_settings",
    resourceType: "merchant",
    resourceId: opts.merchantId,
    before: before ?? null,
    after: patch,
    ip: opts.ip ?? null,
  });
  return { success: true };
}

export async function merchantSelfRotateSigningSecret(opts: {
  merchantId: string;
  role: Role;
  actorUserId: string;
  ip?: string | null;
}) {
  if (opts.role !== "owner") throw new ForbiddenError("OWNER_REQUIRED");
  // P0-12 — write encrypted, clear plaintext, and (P1) also null out the
  // legacy x-api-secret hash via a dead random hash so the legacy header
  // path can no longer be authenticated for this merchant. Matches the
  // admin rotate path.
  const newSecret = randomToken(32);
  const signingSecretEncrypted = encryptString(newSecret);
  const deadHash = hmacSha256Hex(env.MERCHANT_HMAC_PEPPER ?? "fallback-pepper", randomToken(32));
  await db
    .update(merchants)
    .set({
      signingSecret: null,
      signingSecretEncrypted,
      signingSecretSetAt: new Date(),
      apiSecretHash: deadHash,
    })
    .where(eq(merchants.id, opts.merchantId));
  // P1 — audit the rotation event (the admin equivalent already audits).
  await writeAudit({
    actorId: opts.actorUserId,
    action: "merchant.self_rotate_secret",
    resourceType: "merchant",
    resourceId: opts.merchantId,
    ip: opts.ip ?? null,
  });
  return { success: true, signingSecret: newSecret };
}

export async function merchantSelfSettlement(opts: {
  merchantId: string;
  limit?: number;
  offset?: number;
  filterMerchantId?: string;
  filterMerchantIds?: string[];
}) {
  const limit = Math.min(opts.limit ?? 50, 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  const [m] = await db
    .select({ merchantType: merchants.merchantType })
    .from(merchants)
    .where(eq(merchants.id, opts.merchantId))
    .limit(1);
  if (!m) throw new NotFoundError("MERCHANT_NOT_FOUND");

  const scopeIds = await allowedMerchantIds(opts.merchantId, {
    merchantId: opts.filterMerchantId,
    merchantIds: opts.filterMerchantIds,
  });

  if (m.merchantType === "finance") {
    const rows = await db
      .select()
      .from(merchantCashPoolLog)
      .where(inArray(merchantCashPoolLog.merchantId, scopeIds))
      .orderBy(desc(merchantCashPoolLog.id))
      .limit(limit)
      .offset(offset);
    return {
      ledger: "cash_pool" as const,
      rows: rows.map((r) => ({
        id: Number(r.id),
        merchantId: r.merchantId,
        changeAmount: Number(r.changeAmount),
        balanceBefore: Number(r.balanceBefore),
        balanceAfter: Number(r.balanceAfter),
        reason: r.reason,
        referenceType: r.referenceType,
        referenceId: r.referenceId,
        notes: r.notes,
        createdAt: r.createdAt.toISOString(),
      })),
      limit,
      offset,
    };
  }

  const rows = await db
    .select()
    .from(merchantSettlementLog)
    .where(inArray(merchantSettlementLog.merchantId, scopeIds))
    .orderBy(desc(merchantSettlementLog.id))
    .limit(limit)
    .offset(offset);
  return {
    ledger: "settlement" as const,
    rows: rows.map((r) => ({
      id: Number(r.id),
      merchantId: r.merchantId,
      changeAmount: Number(r.changeAmount),
      balanceBefore: Number(r.balanceBefore),
      balanceAfter: Number(r.balanceAfter),
      reason: r.reason,
      referenceType: r.referenceType,
      referenceId: r.referenceId,
      notes: r.notes,
      createdAt: r.createdAt.toISOString(),
    })),
    limit,
    offset,
  };
}

export async function merchantSelfApiCalls(opts: {
  merchantId: string;
  limit?: number;
  offset?: number;
  filterMerchantId?: string;
  filterMerchantIds?: string[];
}) {
  const limit = Math.min(opts.limit ?? 50, 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  const scopeIds = await allowedMerchantIds(opts.merchantId, {
    merchantId: opts.filterMerchantId,
    merchantIds: opts.filterMerchantIds,
  });
  const rows = await db
    .select()
    .from(merchantApiCalls)
    .where(inArray(merchantApiCalls.merchantId, scopeIds))
    .orderBy(desc(merchantApiCalls.createdAt))
    .limit(limit)
    .offset(offset);
  return {
    rows: rows.map((r) => ({
      id: r.id,
      merchantId: r.merchantId,
      endpoint: r.endpoint,
      method: r.method,
      statusCode: r.statusCode,
      errorCode: r.errorCode,
      latencyMs: r.latencyMs,
      merchantRef: r.merchantRef,
      ip: r.ip,
      createdAt: r.createdAt.toISOString(),
    })),
    limit,
    offset,
  };
}

export async function merchantSelfCashoutSessions(opts: {
  merchantId: string;
  targetMerchantId?: string;
  limit?: number;
}) {
  const [m] = await db
    .select({ merchantType: merchants.merchantType, merchantScope: merchants.merchantScope })
    .from(merchants)
    .where(eq(merchants.id, opts.merchantId))
    .limit(1);
  if (!m || m.merchantType !== "commerce") {
    throw new ForbiddenError("COMMERCE_ONLY");
  }
  const scopeIds = await allowedMerchantIds(opts.merchantId, {
    merchantId: opts.targetMerchantId,
  });
  const limit = Math.min(opts.limit ?? 100, 200);
  const rows = await db
    .select()
    .from(merchantCashoutSessions)
    .where(inArray(merchantCashoutSessions.merchantId, scopeIds))
    .orderBy(desc(merchantCashoutSessions.createdAt))
    .limit(limit);
  return {
    rows: rows.map((r) => ({
      id: r.id,
      publicNo: r.publicNo,
      merchantId: r.merchantId,
      methodCode: r.methodCode,
      amount: Number(r.amount),
      fee: Number(r.fee),
      status: r.status,
      payoutAddress: r.payoutAddress,
      createdAt: r.createdAt.toISOString(),
    })),
  };
}

export async function merchantSelfTransactions(opts: {
  merchantId: string;
  limit?: number;
  offset?: number;
  filterMerchantId?: string;
  filterMerchantIds?: string[];
}) {
  const limit = Math.min(opts.limit ?? 50, 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  const scopeIds = await allowedMerchantIds(opts.merchantId, {
    merchantId: opts.filterMerchantId,
    merchantIds: opts.filterMerchantIds,
  });
  const merchantIdList = sql.join(
    scopeIds.map((id) => sql`${id}`),
    sql`, `,
  );
  const rows = await db.execute<{
    id: string;
    public_no: string;
    type: string;
    amount: string;
    fee: string;
    merchant_ref: string | null;
    created_at: Date;
  }>(sql`
    SELECT id, public_no, type, amount, fee, merchant_ref, created_at
    FROM transactions
    WHERE (metadata->>'merchant_id') IN (${merchantIdList})
    ORDER BY created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `);
  const list = rows as unknown as Array<{
    id: string;
    public_no: string;
    type: string;
    amount: string;
    fee: string;
    merchant_ref: string | null;
    created_at: Date;
  }>;
  return {
    rows: list.map((r) => ({
      id: r.id,
      publicNo: r.public_no,
      type: r.type,
      amount: Number(r.amount),
      fee: Number(r.fee),
      merchantRef: r.merchant_ref,
      createdAt: new Date(r.created_at).toISOString(),
    })),
    limit,
    offset,
  };
}

// ---------------- merchant users (owner-managed) ----------------
export async function merchantInviteUser(opts: {
  merchantId: string;
  invokerRole: Role;
  email: string;
  role: Role;
  fullName?: string | null;
}) {
  if (opts.invokerRole !== "owner") throw new ForbiddenError("OWNER_REQUIRED");
  const lower = opts.email.toLowerCase();
  const [dup] = await db
    .select({ id: merchantUsers.id })
    .from(merchantUsers)
    .where(
      and(
        eq(merchantUsers.merchantId, opts.merchantId),
        sql`lower(${merchantUsers.email}) = ${lower}`,
      ),
    )
    .limit(1);
  if (dup) throw new ConflictError("ALREADY_ATTACHED");
  const [row] = await db
    .insert(merchantUsers)
    .values({
      merchantId: opts.merchantId,
      email: lower,
      role: opts.role,
      fullName: opts.fullName ?? null,
      isActive: true,
    })
    .returning({ id: merchantUsers.id });
  return { success: true, merchantUserId: row?.id ?? null };
}

export async function merchantListUsers(merchantId: string) {
  const rows = await db
    .select()
    .from(merchantUsers)
    .where(eq(merchantUsers.merchantId, merchantId));
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    fullName: r.fullName,
    role: r.role,
    isActive: r.isActive,
    lastLoginAt: r.lastLoginAt?.toISOString() ?? null,
  }));
}

export async function merchantSetUserRole(opts: {
  merchantId: string;
  invokerRole: Role;
  targetMerchantUserId: string;
  newRole: Role;
}) {
  if (opts.invokerRole !== "owner") throw new ForbiddenError("OWNER_REQUIRED");
  await db
    .update(merchantUsers)
    .set({ role: opts.newRole, updatedAt: new Date() })
    .where(
      and(eq(merchantUsers.id, opts.targetMerchantUserId), eq(merchantUsers.merchantId, opts.merchantId)),
    );
  return { success: true };
}

export async function merchantSetUserActive(opts: {
  merchantId: string;
  invokerRole: Role;
  targetMerchantUserId: string;
  active: boolean;
}) {
  if (opts.invokerRole !== "owner") throw new ForbiddenError("OWNER_REQUIRED");
  await db
    .update(merchantUsers)
    .set({ isActive: opts.active, updatedAt: new Date() })
    .where(
      and(eq(merchantUsers.id, opts.targetMerchantUserId), eq(merchantUsers.merchantId, opts.merchantId)),
    );
  return { success: true };
}

export async function merchantSetUserPermission(opts: {
  merchantId: string;
  invokerRole: Role;
  invokerUserId: string;
  targetMerchantUserId: string;
  permissionKey: string;
  isAllowed: boolean;
}) {
  if (opts.invokerRole !== "owner") throw new ForbiddenError("OWNER_REQUIRED");
  const [target] = await db
    .select({ id: merchantUsers.id })
    .from(merchantUsers)
    .where(
      and(eq(merchantUsers.id, opts.targetMerchantUserId), eq(merchantUsers.merchantId, opts.merchantId)),
    )
    .limit(1);
  if (!target) throw new NotFoundError("MERCHANT_USER_NOT_FOUND");
  await db
    .insert(merchantUserPermissionOverrides)
    .values({
      merchantUserId: opts.targetMerchantUserId,
      permissionKey: opts.permissionKey,
      isAllowed: opts.isAllowed,
      createdBy: opts.invokerUserId,
    })
    .onConflictDoUpdate({
      target: [
        merchantUserPermissionOverrides.merchantUserId,
        merchantUserPermissionOverrides.permissionKey,
      ],
      set: { isAllowed: opts.isAllowed, createdBy: opts.invokerUserId },
    });
  return { success: true };
}

export async function merchantHasPermission(opts: {
  merchantUserId: string;
  permissionKey: string;
  role: Role;
}): Promise<{ allowed: boolean; reason: "role" | "override" | "denied" }> {
  // Owner has everything implicitly
  if (opts.role === "owner") return { allowed: true, reason: "role" };
  const [ov] = await db
    .select({ isAllowed: merchantUserPermissionOverrides.isAllowed })
    .from(merchantUserPermissionOverrides)
    .where(
      and(
        eq(merchantUserPermissionOverrides.merchantUserId, opts.merchantUserId),
        eq(merchantUserPermissionOverrides.permissionKey, opts.permissionKey),
      ),
    )
    .limit(1);
  if (ov) return { allowed: ov.isAllowed, reason: "override" };
  return { allowed: false, reason: "denied" };
}
