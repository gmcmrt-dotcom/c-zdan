/**
 * Generic table-query shim endpoint.
 *
 * The web client uses `dbSelect / dbInsert / dbUpdate / dbDelete` helpers from
 * `apps/web/src/lib/db.ts`. They serialise the operation, where-clause, columns
 * and order into a JSON body and POST it to `/api/from/<table>`. Here we
 * dispatch by table name to a typed handler that:
 *
 *   - validates the requested op against an allow-list per table
 *   - re-scopes the query so users can only see/touch their own rows
 *   - returns `{ data, error }` in the envelope expected by `db.ts`
 *
 * Anything not on the allow-list returns 404 TABLE_NOT_EXPOSED so the
 * frontend renders empty rather than crashing.
 */
import { Router } from "express";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client";
import {
  accounts,
  auditLog,
  boPermissions,
  chatAttachments,
  chatCannedResponses,
  chatMessages,
  chatProfileChangeRequests,
  chatRoutingRules,
  chatThreads,
  errorDiagnostics,
  eventOutbox,
  helpArticles,
  loyaltyPointsLog,
  loyaltyRules,
  loyaltyTiers,
  mailTemplates,
  merchantAffiliateLedger,
  merchantAffiliateLinks,
  merchantAffiliatePayouts,
  merchantAffiliates,
  merchantApiCalls,
  merchantApplications,
  merchantCashPoolLog,
  merchantCashoutMethods,
  merchantCashoutSessions,
  merchantMethods,
  merchantSettlementLog,
  merchantUserPermissionOverrides,
  merchantUsers,
  merchants,
  notificationPreferences,
  notifications,
  paymentMethodTypes,
  paymentProviders,
  paymentRoutingRules,
  profiles,
  profitShareAllocations,
  profitShareCampaigns,
  providerLedger,
  referralConfig,
  referralRewardsLog,
  referrals,
  settings,
  suggestions,
  systemLogs,
  telegramTemplates,
  topupRequests,
  topupSessions,
  transactions,
  userLoginIps,
  userPermissionOverrides,
  userRoles,
  userSpecialDays,
  withdrawRequests,
  withdrawSessions,
} from "../db/schema";
import { or as orSql, type SQL } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import { env } from "../lib/env";
import { snakeify } from "../lib/snakeify";
import { requireAuth, requireStaff, user } from "../middleware/auth";
import { loadUserPerms, requirePerm } from "../middleware/permission";
import { AppError, BadRequestError, ForbiddenError } from "../lib/errors";
import { logger } from "../lib/logger";
import { writeAudit } from "../services/admin/audit";
import { clientIp } from "../lib/req-meta";

type Op = "select" | "insert" | "update" | "delete";
const FromBody = z.object({
  op: z.enum(["select", "insert", "update", "delete"]),
  cols: z.string().optional(),
  where: z
    .array(z.object({ col: z.string(), op: z.enum(["eq", "neq", "in", "gt", "gte", "lt", "lte"]), val: z.unknown() }))
    .optional()
    .default([]),
  /**
   * PostgREST-style OR specs: ["col.op.val,col.op.val,...", ...].
   * Each comma-separated chunk is one OR-joined predicate group.
   */
  or: z.array(z.string()).optional(),
  order: z.object({ col: z.string(), asc: z.boolean().default(false) }).optional(),
  // P1 — Cap from-shim reads at 500 rows. Previously 10000, which let any
  // authed user with a valid scope pull tens of thousands of rows in one
  // request (memory + bandwidth DoS). Admin pages have always paginated;
  // legitimate use stays well under 500.
  limit: z.number().int().min(1).max(500).optional(),
  offset: z.number().int().nonnegative().optional(),
  values: z.unknown().optional(),
  single: z.boolean().optional(),
  maybeSingle: z.boolean().optional(),
  count: z.enum(["exact", "planned", "estimated"]).optional(),
  head: z.boolean().optional(),
});
type FromBody = z.infer<typeof FromBody>;

/**
 * Parse a single OR-spec like "col.op.val,col.op.val,col.ilike.%foo%" into
 * an array of { col, op, val } parts. Supports eq/neq/ilike/in operators.
 * Values may contain commas only if URL-encoded; we trust the caller's quoting.
 */
function parseOrSpec(spec: string): Array<{ col: string; op: string; val: string }> {
  return spec
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((part) => {
      const [col, op, ...rest] = part.split(".");
      return { col: col ?? "", op: op ?? "eq", val: rest.join(".") };
    })
    .filter((p) => p.col && p.op);
}

type DbAny = typeof db;

interface HandlerCtx {
  req: import("express").Request;
  body: FromBody;
}

/** Per-table dispatcher. */
type TableHandler = (ctx: HandlerCtx) => Promise<unknown>;

// ============================== USER ROLES ==============================
const userRolesHandler: TableHandler = async ({ req, body }) => {
  // admin/staff only
  if (!req.user || !req.perms?.has("bo_users:view")) throw new ForbiddenError("PERMISSION_DENIED");

  if (body.op === "select") {
    const filters = (body.where ?? []).map((w) => {
      if (w.col === "user_id" && w.op === "eq") return eq(userRoles.userId, String(w.val));
      if (w.col === "user_id" && w.op === "in" && Array.isArray(w.val))
        return inArray(userRoles.userId, w.val as string[]);
      if (w.col === "role" && w.op === "eq") return eq(userRoles.role, w.val as never);
      return null;
    }).filter((x): x is NonNullable<typeof x> => x !== null);
    const rows = await db
      .select({ user_id: userRoles.userId, role: userRoles.role })
      .from(userRoles)
      .where(filters.length ? and(...filters) : undefined);
    if (body.maybeSingle || body.single) return rows[0] ?? null;
    return rows;
  }
  if (body.op === "insert") {
    if (!req.perms?.has("bo_users:manage_roles")) throw new ForbiddenError("PERMISSION_DENIED");
    const v = body.values as { user_id: string; role: string };
    const [row] = await db
      .insert(userRoles)
      .values({ userId: v.user_id, role: v.role as never })
      .onConflictDoNothing()
      .returning({ user_id: userRoles.userId, role: userRoles.role });
    return row ?? null;
  }
  if (body.op === "delete") {
    if (!req.perms?.has("bo_users:manage_roles")) throw new ForbiddenError("PERMISSION_DENIED");
    const userIdW = body.where?.find((w) => w.col === "user_id" && w.op === "eq");
    const roleW = body.where?.find((w) => w.col === "role" && w.op === "eq");
    if (!userIdW || !roleW) throw new AppError(400, "BAD_FILTER");
    await db
      .delete(userRoles)
      .where(
        and(eq(userRoles.userId, String(userIdW.val)), eq(userRoles.role, roleW.val as never)),
      );
    return null;
  }
  throw new AppError(400, "UNSUPPORTED_OP");
};

// ============================== BO PERMISSIONS ==============================
const boPermsHandler: TableHandler = async ({ req, body }) => {
  if (!req.user || !req.perms?.has("permissions:view")) throw new ForbiddenError("PERMISSION_DENIED");
  if (body.op !== "select") throw new AppError(400, "READONLY");
  const rows = await db
    .select({
      role: boPermissions.role,
      resource: boPermissions.resource,
      action: boPermissions.action,
      granted: boPermissions.granted,
    })
    .from(boPermissions);
  return body.maybeSingle ? rows[0] ?? null : rows;
};

// ============================== USER PERMISSION OVERRIDES ==============================
const userPermOverridesHandler: TableHandler = async ({ req, body }) => {
  if (!req.user || !req.perms?.has("permissions:view")) throw new ForbiddenError("PERMISSION_DENIED");
  if (body.op === "select") {
    const rows = await db
      .select({
        id: userPermissionOverrides.id,
        user_id: userPermissionOverrides.userId,
        resource: userPermissionOverrides.resource,
        action: userPermissionOverrides.action,
        granted: userPermissionOverrides.granted,
        reason: userPermissionOverrides.reason,
        created_at: userPermissionOverrides.createdAt,
      })
      .from(userPermissionOverrides);
    return rows;
  }
  if (body.op === "insert") {
    if (!req.perms?.has("permissions:manage_overrides")) throw new ForbiddenError("PERMISSION_DENIED");
    const v = body.values as { user_id: string; resource: string; action: string; granted: boolean; reason?: string };

    // P1 — Validate the (resource, action) pair against the bo_permissions
    // registry. The previous shape accepted arbitrary strings, so an admin
    // with `permissions:manage_overrides` could grant a member an override
    // for a non-existent or typo'd permission key (`memebrs:view_full`) AND
    // could grant themselves permission keys not in the seed (`bo_users:*`
    // override on a non-staff user, etc.). Restricting the value space to
    // known seeded keys closes the privilege-create surface.
    const resource = String(v.resource ?? "").trim();
    const action = String(v.action ?? "").trim();
    if (!resource || !action) throw new AppError(400, "RESOURCE_ACTION_REQUIRED");
    const [known] = await db
      .select({ id: boPermissions.id })
      .from(boPermissions)
      .where(and(eq(boPermissions.resource, resource), eq(boPermissions.action, action)))
      .limit(1);
    if (!known) throw new AppError(400, "UNKNOWN_PERMISSION_KEY");

    const [row] = await db
      .insert(userPermissionOverrides)
      .values({
        userId: v.user_id,
        resource,
        action,
        granted: v.granted,
        reason: v.reason ?? null,
        createdBy: req.user.id,
      })
      .returning();
    return row;
  }
  if (body.op === "delete") {
    if (!req.perms?.has("permissions:manage_overrides")) throw new ForbiddenError("PERMISSION_DENIED");
    const idW = body.where?.find((w) => w.col === "id" && w.op === "eq");
    if (!idW) throw new AppError(400, "BAD_FILTER");
    await db.delete(userPermissionOverrides).where(eq(userPermissionOverrides.id, String(idW.val)));
    return null;
  }
  throw new AppError(400, "UNSUPPORTED_OP");
};

// ============================== USER LOGIN IPS ==============================
/**
 * Login history rows. Members can see their own; staff with `bo_users:view`
 * or `members:view_full|view_masked` can read other users' history (used by
 * `admin/users`, MemberDetail, BOUserDetailPage). The DB column is
 * `ip_address`; the wire shape exposes it as `ip` (legacy frontend expects
 * that — see Users.tsx ActivityTabs and BOUserDetailPage LoginsTab).
 */
const userLoginIpsHandler: TableHandler = async ({ req, body }) => {
  if (!req.user) throw new ForbiddenError("PERMISSION_DENIED");
  if (body.op !== "select") throw new AppError(400, "READONLY");

  const isStaff = !!(
    req.perms &&
    (req.perms.has("bo_users:view") ||
      req.perms.has("members:view_full") ||
      req.perms.has("members:view_masked"))
  );

  const filters: Array<SQL> = [];
  for (const w of body.where ?? []) {
    if (w.col === "user_id" && w.op === "eq")
      filters.push(eq(userLoginIps.userId, String(w.val)));
    else if (w.col === "user_id" && w.op === "in" && Array.isArray(w.val))
      filters.push(inArray(userLoginIps.userId, w.val as string[]));
  }
  if (!isStaff) filters.push(eq(userLoginIps.userId, req.user.id));

  const ord = body.order;
  const orderBy = ord?.col === "created_at"
    ? (ord.asc ? asc(userLoginIps.createdAt) : desc(userLoginIps.createdAt))
    : desc(userLoginIps.createdAt);

  const rows = await db
    .select()
    .from(userLoginIps)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(orderBy)
    .limit(Math.min(body.limit ?? 100, 500));

  const out = rows.map((r) => ({
    id: r.id,
    user_id: r.userId,
    ip: r.ipAddress,
    user_agent: r.userAgent,
    // K1-r — Geo restored via local geoip-lite (no API call).
    country: r.country,
    country_code: r.countryCode,
    city: r.city,
    region: r.region,
    device_type: r.deviceType,
    browser: r.browser,
    browser_version: r.browserVersion,
    os: r.os,
    os_version: r.osVersion,
    created_at: r.createdAt,
  }));
  if (body.maybeSingle || body.single) return out[0] ?? null;
  return out;
};

// ============================== PROFILES (admin self-service reads) ==============================
const profilesHandler: TableHandler = async ({ req, body }) => {
  if (!req.user) throw new ForbiddenError("PERMISSION_DENIED");

  if (body.op === "update") {
    // Only the is_frozen flag is mutable through this shim; everything else
    // (name/email/phone) goes through POST /api/admin/members/:id/profile, and
    // KYC goes through POST /api/admin/members/:id/kyc.
    if (!req.perms?.has("members:freeze")) throw new ForbiddenError("PERMISSION_DENIED");
    const idW = body.where?.find((w) => w.col === "id" && w.op === "eq");
    if (!idW) throw new BadRequestError("BAD_FILTER");
    const v = (body.values ?? {}) as Record<string, unknown>;
    const allowed = new Set(["is_frozen"]);
    const rejected: string[] = [];
    for (const k of Object.keys(v)) if (!allowed.has(k)) rejected.push(k);
    if (rejected.length) logger.warn({ rejected }, "profiles update: rejected fields");
    if (v.is_frozen === undefined) throw new BadRequestError("NO_FIELDS");

    const userId = String(idW.val);
    const [before] = await db.select().from(profiles).where(eq(profiles.id, userId)).limit(1);
    if (!before) throw new AppError(404, "MEMBER_NOT_FOUND");
    const frozen = Boolean(v.is_frozen);
    await db.update(profiles).set({ isFrozen: frozen }).where(eq(profiles.id, userId));
    await writeAudit({
      actorId: req.user.id,
      action: frozen ? "member.freeze" : "member.unfreeze",
      resourceType: "member",
      resourceId: userId,
      before: { is_frozen: before.isFrozen },
      after: { is_frozen: frozen },
      ip: clientIp(req),
    });
    return null;
  }

  if (body.op !== "select") throw new AppError(400, "READONLY");
  const isAdmin = req.perms?.has("members:view_masked") || req.perms?.has("members:view_full");
  const filters: Array<ReturnType<typeof eq>> = (body.where ?? []).map((w) => {
    if (w.col === "id" && w.op === "eq") return eq(profiles.id, String(w.val));
    if (w.col === "id" && w.op === "in" && Array.isArray(w.val))
      return inArray(profiles.id, w.val as string[]);
    if (w.col === "member_no" && w.op === "eq") return eq(profiles.memberNo, String(w.val));
    return null as unknown as ReturnType<typeof eq>;
  }).filter((x) => x != null) as Array<ReturnType<typeof eq>>;

  // Non-admin: force scope to self
  if (!isAdmin) filters.push(eq(profiles.id, req.user.id));

  // OR-of-ILIKE search across email/first_name/last_name (admin only)
  if (isAdmin && body.or && body.or.length) {
    for (const spec of body.or) {
      const parts = parseOrSpec(spec);
      const orCols = parts.map((p) => {
        const v = String(p.val);
        if (p.col === "email" && p.op === "ilike") return sql`${profiles.email} ILIKE ${v}`;
        if (p.col === "first_name" && p.op === "ilike") return sql`${profiles.firstName} ILIKE ${v}`;
        if (p.col === "last_name" && p.op === "ilike") return sql`${profiles.lastName} ILIKE ${v}`;
        if (p.col === "phone" && p.op === "ilike") return sql`${profiles.phone} ILIKE ${v}`;
        if (p.col === "member_no" && p.op === "ilike") return sql`${profiles.memberNo} ILIKE ${v}`;
        return null;
      }).filter((x): x is NonNullable<typeof x> => x != null);
      if (orCols.length) filters.push(orSql(...orCols) as never);
    }
  }

  const rows = await db
    .select({
      id: profiles.id,
      email: profiles.email,
      first_name: profiles.firstName,
      last_name: profiles.lastName,
      phone: profiles.phone,
      member_no: profiles.memberNo,
      kyc_status: profiles.kycStatus,
      is_frozen: profiles.isFrozen,
      referral_code: profiles.referralCode,
      created_at: profiles.createdAt,
    })
    .from(profiles)
    .where(filters.length ? and(...filters) : undefined)
    .limit(Math.min(body.limit ?? 200, 500));
  if (body.maybeSingle || body.single) return rows[0] ?? null;
  return rows;
};

// ============================== MERCHANT AFFILIATES ==============================
const merchantAffiliatesHandler: TableHandler = async ({ req, body }) => {
  if (!req.user) throw new ForbiddenError("PERMISSION_DENIED");
  if (body.op !== "select") throw new AppError(400, "READONLY");
  // Feature-flagged off — return empty so AffiliateLayout / pages render gracefully.
  if (!env.AFFILIATE_SYSTEM_ENABLED) {
    return body.maybeSingle || body.single ? null : [];
  }
  const filters: Array<SQL> = [];
  for (const w of body.where ?? []) {
    if (w.col === "id" && w.op === "eq") filters.push(eq(merchantAffiliates.id, String(w.val)));
    if (w.col === "status" && w.op === "eq")
      filters.push(eq(merchantAffiliates.status, String(w.val)));
  }
  // OR over auth_user_id / linked_user_id (the AffiliateLayout pattern)
  if (body.or && body.or.length) {
    for (const spec of body.or) {
      const parts = parseOrSpec(spec);
      const orCols = parts.map((p) => {
        if (p.col === "auth_user_id" && p.op === "eq")
          return eq(merchantAffiliates.authUserId, String(p.val));
        if (p.col === "linked_user_id" && p.op === "eq")
          return eq(merchantAffiliates.linkedUserId, String(p.val));
        return null;
      }).filter((x): x is NonNullable<typeof x> => x != null);
      if (orCols.length) filters.push(orSql(...orCols) as never);
    }
  }
  // P0-6 — non-staff callers can only read their own affiliate row (matching
  // linked_user_id or auth_user_id). Previously any authenticated member could
  // dump the entire affiliate table including IBAN, name, phone.
  const staffReader = hasPerm("affiliates:view", "affiliates:manage")(req);
  if (!staffReader) {
    filters.push(
      orSql(
        eq(merchantAffiliates.linkedUserId, req.user.id),
        eq(merchantAffiliates.authUserId, req.user.id),
      ) as never,
    );
  }
  const rows = await db
    .select({
      id: merchantAffiliates.id,
      kind: merchantAffiliates.kind,
      code: merchantAffiliates.code,
      name: merchantAffiliates.name,
      email: merchantAffiliates.email,
      phone: merchantAffiliates.phone,
      iban: merchantAffiliates.iban,
      status: merchantAffiliates.status,
    })
    .from(merchantAffiliates)
    .where(filters.length ? and(...filters) : undefined)
    .limit(Math.min(body.limit ?? 50, 200));
  return body.maybeSingle || body.single ? rows[0] ?? null : rows;
};

// ============================== AUDIT LOG ==============================
const auditLogHandler: TableHandler = async ({ req, body }) => {
  if (!req.perms?.has("audit_log:view") && !req.perms?.has("system_logs:view"))
    throw new ForbiddenError("PERMISSION_DENIED");
  if (body.op !== "select") throw new AppError(400, "READONLY");
  const filters: Array<ReturnType<typeof eq>> = [];
  for (const w of body.where ?? []) {
    if (w.col === "actor_id" && w.op === "eq") filters.push(eq(auditLog.actorId, String(w.val)));
    if (w.col === "resource_type" && w.op === "eq")
      filters.push(eq(auditLog.resourceType, String(w.val)));
    if (w.col === "resource_id" && w.op === "eq")
      filters.push(eq(auditLog.resourceId, String(w.val)));
    if (w.col === "action" && w.op === "eq") filters.push(eq(auditLog.action, String(w.val)));
  }
  // OR support: resource_id.eq.X,context->>user_id.eq.X  (legacy MemberDetail pattern)
  if (body.or && body.or.length) {
    for (const spec of body.or) {
      const parts = parseOrSpec(spec);
      const orCols = parts.map((p) => {
        if (p.col === "resource_id" && p.op === "eq") return eq(auditLog.resourceId, String(p.val));
        if (p.op === "eq" && p.col.startsWith("context->>"))
          return sql`${auditLog.metadata} ->> ${p.col.slice("context->>".length)} = ${String(p.val)}`;
        if (p.op === "eq" && p.col.startsWith("metadata->>"))
          return sql`${auditLog.metadata} ->> ${p.col.slice("metadata->>".length)} = ${String(p.val)}`;
        return null;
      }).filter((x): x is NonNullable<typeof x> => x != null);
      if (orCols.length) filters.push(orSql(...orCols) as never);
    }
  }
  const rows = await db
    .select({
      id: auditLog.id,
      actor_id: auditLog.actorId,
      action: auditLog.action,
      resource_type: auditLog.resourceType,
      resource_id: auditLog.resourceId,
      before: auditLog.before,
      after: auditLog.after,
      context: auditLog.metadata,
      ip: auditLog.ip,
      created_at: auditLog.createdAt,
    })
    .from(auditLog)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(auditLog.createdAt))
    .limit(Math.min(body.limit ?? 100, 500));
  return rows;
};

// ============================== NOTIFICATIONS (member-scoped) ==============================
const notificationsHandler: TableHandler = async ({ req, body }) => {
  if (!req.user) throw new ForbiddenError("PERMISSION_DENIED");

  if (body.op === "update") {
    // Self-scope: a user can only mark their own notifications read.
    // The schema has no `dismissed_at` column — treat dismiss the same as read.
    const idW = body.where?.find((w) => w.col === "id" && w.op === "eq");
    if (!idW) throw new BadRequestError("BAD_FILTER");
    const v = (body.values ?? {}) as Record<string, unknown>;
    const wantsMark = v.read_at !== undefined || v.dismissed_at !== undefined;
    if (!wantsMark) throw new BadRequestError("NO_FIELDS");
    const readAt =
      v.read_at != null
        ? new Date(String(v.read_at))
        : v.dismissed_at != null
          ? new Date(String(v.dismissed_at))
          : new Date();
    await db
      .update(notifications)
      .set({ readAt })
      .where(and(eq(notifications.id, String(idW.val)), eq(notifications.userId, req.user.id)));
    return null;
  }

  if (body.op !== "select") throw new AppError(400, "READONLY");
  const onlyUnreadFilter = body.where?.find((w) => w.col === "read_at" && (w.op === "eq" || w.op === "neq"));
  const whereSelf = eq(notifications.userId, req.user.id);
  let q: Array<typeof whereSelf> = [whereSelf];
  if (onlyUnreadFilter && onlyUnreadFilter.val === null) {
    q.push(sql`${notifications.readAt} IS NULL` as unknown as typeof whereSelf);
  }
  const rows = await db
    .select({
      id: notifications.id,
      user_id: notifications.userId,
      category: notifications.category,
      title_tr: notifications.titleTr,
      body_tr: notifications.bodyTr,
      title_en: notifications.titleEn,
      body_en: notifications.bodyEn,
      link_url: notifications.linkUrl,
      read_at: notifications.readAt,
      created_at: notifications.createdAt,
    })
    .from(notifications)
    .where(q.length === 1 ? q[0] : and(...q))
    .orderBy(body.order?.asc ? asc(notifications.createdAt) : desc(notifications.createdAt))
    .limit(Math.min(body.limit ?? 50, 200));
  return rows;
};

// ============================== CHAT_THREADS (staff list + counts) ==============================
const chatThreadsHandler: TableHandler = async ({ req, body }) => {
  if (!req.user) throw new ForbiddenError("PERMISSION_DENIED");
  const isStaff = req.perms && (req.perms.has("chat:view") || req.perms.has("chat:view_all"));
  // count-only HEAD requests used by AdminLayout sidebar
  if (body.head && body.count === "exact") {
    if (!isStaff) return [];
    const statusIn = body.where?.find((w) => w.col === "status" && w.op === "in");
    const cond = statusIn && Array.isArray(statusIn.val)
      ? inArray(chatThreads.status, statusIn.val as never[])
      : undefined;
    const [r] = await db.select({ c: sql<number>`count(*)::int` }).from(chatThreads).where(cond);
    return { count: r?.c ?? 0 };
  }
  if (body.op !== "select") throw new AppError(400, "READONLY");
  const filters = (body.where ?? []).map((w) => {
    if (w.col === "id" && w.op === "eq") return eq(chatThreads.id, String(w.val));
    if (w.col === "user_id" && w.op === "eq") return eq(chatThreads.userId, String(w.val));
    if (w.col === "status" && w.op === "in" && Array.isArray(w.val))
      return inArray(chatThreads.status, w.val as never[]);
    return null;
  }).filter((x): x is NonNullable<typeof x> => x !== null);
  if (!isStaff) filters.push(eq(chatThreads.userId, req.user.id)); // member can only see their own
  let q = db
    .select()
    .from(chatThreads)
    .where(filters.length ? and(...filters) : undefined)
    .$dynamic();
  const ord = body.order;
  if (ord?.col === "last_message_at")
    q = q.orderBy(ord.asc ? asc(chatThreads.lastMessageAt) : desc(chatThreads.lastMessageAt));
  else if (ord?.col === "created_at")
    q = q.orderBy(ord.asc ? asc(chatThreads.createdAt) : desc(chatThreads.createdAt));
  else if (ord?.col === "updated_at")
    q = q.orderBy(ord.asc ? asc(chatThreads.updatedAt) : desc(chatThreads.updatedAt));
  if (body.limit) q = q.limit(Math.min(body.limit, 500));
  const rows = await q;
  const out = rows.map((r) => snakeify<Record<string, unknown>>(r));
  return body.maybeSingle || body.single ? out[0] ?? null : out;
};

// ============================== MERCHANT API CALLS ==============================
const merchantApiCallsHandler: TableHandler = async ({ req, body }) => {
  if (!req.perms?.has("finance_integrations:view") && !req.perms?.has("merchants:view_full"))
    throw new ForbiddenError("PERMISSION_DENIED");
  if (body.op !== "select") throw new AppError(400, "READONLY");
  const limit = Math.min(body.limit ?? 50, 200);
  const rows = await db
    .select()
    .from(merchantApiCalls)
    .orderBy(desc(merchantApiCalls.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    merchant_id: r.merchantId,
    endpoint: r.endpoint,
    method: r.method,
    status_code: r.statusCode,
    error_code: r.errorCode,
    latency_ms: r.latencyMs,
    merchant_ref: r.merchantRef,
    ip: r.ip,
    created_at: r.createdAt,
  }));
};

// ============================== SYSTEM LOGS ==============================
const systemLogsHandler: TableHandler = async ({ req, body }) => {
  if (!req.perms?.has("system_logs:view")) throw new ForbiddenError("PERMISSION_DENIED");
  if (body.op !== "select") throw new AppError(400, "READONLY");
  const rows = await db
    .select()
    .from(systemLogs)
    .orderBy(desc(systemLogs.createdAt))
    .limit(Math.min(body.limit ?? 100, 500));
  return rows.map((r) => ({
    id: r.id,
    actor_id: r.actorId,
    level: r.level,
    source: r.source,
    message: r.message,
    metadata: r.metadata,
    created_at: r.createdAt,
  }));
};

// ============================== PAYMENT PROVIDERS ==============================
// Legacy reference table — only read by admin Commissions for a historical aggregate.
// Gate to any staff user (every staff role has `transactions:view_full` or a similar read perm).
const paymentProvidersHandler: TableHandler = async ({ req, body }) => {
  if (!req.user) throw new ForbiddenError("PERMISSION_DENIED");
  if (body.op === "select") {
    const filters: Array<ReturnType<typeof eq>> = [];
    for (const w of body.where ?? []) {
      if (w.col === "id" && w.op === "eq") filters.push(eq(paymentProviders.id, String(w.val)));
      if (w.col === "code" && w.op === "eq") filters.push(eq(paymentProviders.code, String(w.val)));
      if (w.col === "is_active" && w.op === "eq")
        filters.push(eq(paymentProviders.isActive, Boolean(w.val)));
    }
    const ord = body.order;
    let q = db.select().from(paymentProviders).where(filters.length ? and(...filters) : undefined).$dynamic();
    if (ord?.col === "name") q = q.orderBy(ord.asc ? asc(paymentProviders.name) : desc(paymentProviders.name));
    else if (ord?.col === "sort_order") q = q.orderBy(ord.asc ? asc(paymentProviders.sortOrder) : desc(paymentProviders.sortOrder));
    else if (ord?.col === "code") q = q.orderBy(ord.asc ? asc(paymentProviders.code) : desc(paymentProviders.code));
    if (body.limit) q = q.limit(Math.min(body.limit, 500));
    const rows = await q;
    const out = rows.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      is_active: r.isActive,
      commission_pct: Number(r.commissionPct),
      fixed_fee: Number(r.fixedFee),
      per_tx_limit: r.perTxLimit != null ? Number(r.perTxLimit) : null,
      daily_limit: r.dailyLimit != null ? Number(r.dailyLimit) : null,
      min_amount: r.minAmount != null ? Number(r.minAmount) : null,
      sort_order: r.sortOrder,
      config: r.config,
      created_at: r.createdAt,
    }));
    return body.maybeSingle || body.single ? out[0] ?? null : out;
  }
  if (body.op === "insert") {
    // P0 (audit): payment provider config holds API keys, base URLs and weights.
    // Mutations require explicit `commissions:manage` (admin role per seed).
    if (!req.perms?.has("commissions:manage") && !req.perms?.has("settings:manage")) {
      throw new ForbiddenError("PERMISSION_DENIED");
    }
    const v = body.values as Record<string, unknown>;
    const [row] = await db
      .insert(paymentProviders)
      .values({
        code: String(v.code),
        name: String(v.name),
        isActive: v.is_active !== false,
        commissionPct: v.commission_pct != null ? String(v.commission_pct) : undefined,
        fixedFee: v.fixed_fee != null ? String(v.fixed_fee) : undefined,
        perTxLimit: v.per_tx_limit != null ? String(v.per_tx_limit) : undefined,
        dailyLimit: v.daily_limit != null ? String(v.daily_limit) : undefined,
        minAmount: v.min_amount != null ? String(v.min_amount) : undefined,
        sortOrder: v.sort_order != null ? Number(v.sort_order) : 0,
        config: (v.config ?? {}) as Record<string, unknown>,
      })
      .returning({ id: paymentProviders.id });
    await writeAudit({
      actorId: req.user.id,
      action: "payment_provider.create",
      resourceType: "payment_provider",
      resourceId: row?.id ?? null,
      after: { code: String(v.code), name: String(v.name) },
      ip: clientIp(req),
    });
    return row ?? null;
  }
  if (body.op === "update") {
    if (!req.perms?.has("commissions:manage") && !req.perms?.has("settings:manage")) {
      throw new ForbiddenError("PERMISSION_DENIED");
    }
    const v = body.values as Record<string, unknown>;
    const idW = body.where?.find((w) => w.col === "id" && w.op === "eq");
    if (!idW) throw new AppError(400, "BAD_FILTER");
    const patch: Record<string, unknown> = {};
    if (v.code !== undefined) patch.code = String(v.code);
    if (v.name !== undefined) patch.name = String(v.name);
    if (v.is_active !== undefined) patch.isActive = Boolean(v.is_active);
    if (v.commission_pct !== undefined) patch.commissionPct = String(v.commission_pct);
    if (v.fixed_fee !== undefined) patch.fixedFee = String(v.fixed_fee);
    if (v.per_tx_limit !== undefined) patch.perTxLimit = v.per_tx_limit == null ? null : String(v.per_tx_limit);
    if (v.daily_limit !== undefined) patch.dailyLimit = v.daily_limit == null ? null : String(v.daily_limit);
    if (v.min_amount !== undefined) patch.minAmount = v.min_amount == null ? null : String(v.min_amount);
    if (v.sort_order !== undefined) patch.sortOrder = Number(v.sort_order);
    if (v.config !== undefined) patch.config = v.config as Record<string, unknown>;
    await db.update(paymentProviders).set(patch).where(eq(paymentProviders.id, String(idW.val)));
    await writeAudit({
      actorId: req.user.id,
      action: "payment_provider.update",
      resourceType: "payment_provider",
      resourceId: String(idW.val),
      after: patch,
      ip: clientIp(req),
    });
    return null;
  }
  throw new AppError(400, "UNSUPPORTED_OP");
};

// ============================== PAYMENT METHOD TYPES ==============================
const paymentMethodTypesHandler: TableHandler = async ({ req, body }) => {
  if (!req.user) throw new ForbiddenError("PERMISSION_DENIED");
  if (body.op !== "select") throw new AppError(400, "READONLY");
  const filters: Array<ReturnType<typeof eq>> = [];
  for (const w of body.where ?? []) {
    if (w.col === "code" && w.op === "eq") filters.push(eq(paymentMethodTypes.code, String(w.val)));
    if (w.col === "is_enabled" && w.op === "eq")
      filters.push(eq(paymentMethodTypes.isEnabled, Boolean(w.val)));
    if (w.col === "available_for" && w.op === "eq")
      filters.push(eq(paymentMethodTypes.availableFor, String(w.val)));
  }
  const rows = await db
    .select()
    .from(paymentMethodTypes)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(asc(paymentMethodTypes.sortOrder));
  return rows.map((r) => ({
    code: r.code,
    label_tr: r.labelTr,
    label_en: r.labelEn,
    available_for: r.availableFor,
    is_enabled: r.isEnabled,
    sort_order: r.sortOrder,
    description_tr: r.descriptionTr,
    description_en: r.descriptionEn,
    withdraw_eta_min: r.withdrawEtaMin,
    withdraw_eta_max: r.withdrawEtaMax,
    withdraw_eta_unit: r.withdrawEtaUnit,
  }));
};

// ============================== MERCHANTS (admin reads + safe updates) ==============================
/**
 * Allow-list of `merchants` columns updatable via the shim.
 * Each entry maps a wire JSON name → { drizzleKey, kind } where `kind`
 * picks the right coercion (numeric stays string, boolean is Boolean, …).
 *
 * Strictly excludes money / security columns enforced by hard rules
 * (`docs/HARD_RULES.md` #2, #8.1, #11, #12, #15):
 *   - balance, credit_limit, cash_pool, cashout_reserved_amount → atomic services only
 *   - api_key, api_secret_hash, signing_secret(_set_at) → /api/admin/merchants/:id/rotate-secret
 *   - merchant_type, merchant_scope, parent_merchant_id → onboarding RPCs only
 *   - failure_rate_pct, last_failure_at, avg_withdraw_seconds → cron / system maintained
 */
type ColCoercion = "text" | "numeric" | "bool" | "stringArray";
const MERCHANT_UPDATE_FIELDS: Record<string, { key: string; coerce: ColCoercion }> = {
  name: { key: "name", coerce: "text" },
  notes: { key: "notes", coerce: "text" },
  is_active: { key: "isActive", coerce: "bool" },
  webhook_url: { key: "webhookUrl", coerce: "text" },
  topup_init_url: { key: "topupInitUrl", coerce: "text" },
  integration_adapter: { key: "integrationAdapter", coerce: "text" },
  ip_whitelist: { key: "ipWhitelist", coerce: "stringArray" },
  commission_pct: { key: "commissionPct", coerce: "numeric" },
  fixed_fee: { key: "fixedFee", coerce: "numeric" },
  commission_direction: { key: "commissionDirection", coerce: "text" },
  deposit_commission_pct: { key: "depositCommissionPct", coerce: "numeric" },
  deposit_fixed_fee: { key: "depositFixedFee", coerce: "numeric" },
  withdraw_commission_pct: { key: "withdrawCommissionPct", coerce: "numeric" },
  withdraw_fixed_fee: { key: "withdrawFixedFee", coerce: "numeric" },
  daily_limit: { key: "dailyLimit", coerce: "numeric" },
  per_tx_limit: { key: "perTxLimit", coerce: "numeric" },
  deposit_min_amount: { key: "depositMinAmount", coerce: "numeric" },
  deposit_max_amount: { key: "depositMaxAmount", coerce: "numeric" },
  withdraw_min_amount: { key: "withdrawMinAmount", coerce: "numeric" },
  withdraw_max_amount: { key: "withdrawMaxAmount", coerce: "numeric" },
  cashout_commission_pct: { key: "cashoutCommissionPct", coerce: "numeric" },
  cashout_fixed_fee: { key: "cashoutFixedFee", coerce: "numeric" },
  finance_collection_fee_pct: { key: "financeCollectionFeePct", coerce: "numeric" },
  finance_collection_fixed_fee: { key: "financeCollectionFixedFee", coerce: "numeric" },
  overdraft_enabled: { key: "overdraftEnabled", coerce: "bool" },
  overdraft_limit: { key: "overdraftLimit", coerce: "numeric" },
  cash_pool_api_url: { key: "cashPoolApiUrl", coerce: "text" },
  cash_pool_api_method: { key: "cashPoolApiMethod", coerce: "text" },
  cash_pool_jq_path: { key: "cashPoolJqPath", coerce: "text" },
};

function coerceValue(coerce: ColCoercion, val: unknown): unknown {
  if (val == null) return null;
  switch (coerce) {
    case "bool":
      return Boolean(val);
    case "numeric":
      return String(val);
    case "stringArray":
      return Array.isArray(val) ? val.map(String) : [];
    case "text":
    default:
      return String(val);
  }
}

const merchantsHandler: TableHandler = async ({ req, body }) => {
  if (!req.perms?.has("merchants:view_full") && !req.perms?.has("merchants:view_masked"))
    throw new ForbiddenError("PERMISSION_DENIED");

  if (body.op === "update") {
    if (!req.perms?.has("merchants:update"))
      throw new ForbiddenError("PERMISSION_DENIED");
    const idW = body.where?.find((w) => w.col === "id" && w.op === "eq");
    if (!idW) throw new BadRequestError("BAD_FILTER");
    const v = (body.values ?? {}) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    const rejected: string[] = [];
    for (const [k, val] of Object.entries(v)) {
      const spec = MERCHANT_UPDATE_FIELDS[k];
      if (!spec) {
        rejected.push(k);
        continue;
      }
      patch[spec.key] = coerceValue(spec.coerce, val);
    }
    if (rejected.length) {
      logger.warn({ rejected, merchantId: idW.val }, "merchants update: rejected fields");
    }
    if (Object.keys(patch).length === 0) throw new BadRequestError("NO_FIELDS");

    const merchantId = String(idW.val);
    const [before] = await db
      .select()
      .from(merchants)
      .where(eq(merchants.id, merchantId))
      .limit(1);
    if (!before) throw new AppError(404, "MERCHANT_NOT_FOUND");
    await db.update(merchants).set(patch).where(eq(merchants.id, merchantId));
    await writeAudit({
      actorId: req.user!.id,
      action: "merchant.update",
      resourceType: "merchant",
      resourceId: merchantId,
      before: snakeify(before),
      after: { patch, rejected: rejected.length ? rejected : undefined },
      ip: clientIp(req),
    });
    return null;
  }

  if (body.op !== "select") throw new AppError(400, "READONLY");
  const filters: Array<ReturnType<typeof eq>> = [];
  for (const w of body.where ?? []) {
    if (w.col === "id" && w.op === "eq") filters.push(eq(merchants.id, String(w.val)));
    if (w.col === "id" && w.op === "in" && Array.isArray(w.val))
      filters.push(inArray(merchants.id, w.val as string[]));
    if (w.col === "merchant_type" && w.op === "eq")
      filters.push(eq(merchants.merchantType, w.val as never));
    if (w.col === "is_active" && w.op === "eq")
      filters.push(eq(merchants.isActive, Boolean(w.val)));
    if (w.col === "merchant_scope" && w.op === "eq")
      filters.push(eq(merchants.merchantScope, String(w.val)));
    if (w.col === "parent_merchant_id" && w.op === "eq")
      filters.push(eq(merchants.parentMerchantId, String(w.val)));
  }
  const ord = body.order;
  let q = db.select().from(merchants).where(filters.length ? and(...filters) : undefined).$dynamic();
  if (ord?.col === "name") q = q.orderBy(ord.asc ? asc(merchants.name) : desc(merchants.name));
  else if (ord?.col === "created_at")
    q = q.orderBy(ord.asc ? asc(merchants.createdAt) : desc(merchants.createdAt));
  if (body.limit) q = q.limit(Math.min(body.limit, 500));
  const rows = await q;
  // Use snakeify so EVERY column is returned in snake_case — legacy pages
  // read ip_whitelist, signing_secret-related flags, deposit/withdraw splits,
  // overdraft, failure metrics, cashout fields, etc. Hand-picking the list
  // would inevitably miss something the next admin page needs.
  const out = rows.map((r) => snakeify<Record<string, unknown>>(r));
  return body.maybeSingle || body.single ? out[0] ?? null : out;
};

// ============================== TRANSACTIONS (admin/member read) ==============================
const transactionsHandler: TableHandler = async ({ req, body }) => {
  if (!req.user) throw new ForbiddenError("PERMISSION_DENIED");
  if (body.op !== "select") throw new AppError(400, "READONLY");
  const isStaff = req.perms && (req.perms.has("transactions:view_full") || req.perms.has("transactions:view_masked"));
  const filters: Array<SQL> = [];
  for (const w of body.where ?? []) {
    if (w.col === "id" && w.op === "eq") filters.push(eq(transactions.id, String(w.val)));
    else if (w.col === "user_id" && w.op === "eq") filters.push(eq(transactions.userId, String(w.val)));
    else if (w.col === "user_id" && w.op === "in" && Array.isArray(w.val))
      filters.push(inArray(transactions.userId, w.val as string[]));
    else if (w.col === "status" && w.op === "eq") filters.push(eq(transactions.status, w.val as never));
    else if (w.col === "status" && w.op === "in" && Array.isArray(w.val))
      filters.push(inArray(transactions.status, w.val as never[]));
    else if (w.col === "type" && w.op === "eq") filters.push(eq(transactions.type, w.val as never));
    else if (w.col === "type" && w.op === "in" && Array.isArray(w.val))
      filters.push(inArray(transactions.type, w.val as never[]));
    else if (w.col === "created_at" && w.op === "gte")
      filters.push(sql`${transactions.createdAt} >= ${String(w.val)}::timestamptz`);
    else if (w.col === "created_at" && w.op === "lte")
      filters.push(sql`${transactions.createdAt} <= ${String(w.val)}::timestamptz`);
    else if (w.col === "created_at" && w.op === "lt")
      filters.push(sql`${transactions.createdAt} < ${String(w.val)}::timestamptz`);
    else if (w.col === "created_at" && w.op === "gt")
      filters.push(sql`${transactions.createdAt} > ${String(w.val)}::timestamptz`);
    else if (w.col === "amount" && w.op === "gte")
      filters.push(sql`${transactions.amount} >= ${Number(w.val)}`);
    else if (w.col === "amount" && w.op === "lte")
      filters.push(sql`${transactions.amount} <= ${Number(w.val)}`);
    // jsonb path filters: `metadata->>merchant_id` and friends.
    else if (w.col.startsWith("metadata->>")) {
      const key = w.col.slice("metadata->>".length);
      if (w.op === "eq") {
        filters.push(sql`${transactions.metadata} ->> ${key} = ${String(w.val)}`);
      } else if (w.op === "in" && Array.isArray(w.val)) {
        const vals = (w.val as unknown[]).map(String);
        if (vals.length > 0) {
          // drizzle expands ${array} into a `(v1, v2, ...)` row tuple, which
          // is exactly what `IN` wants. Each element is a bound parameter.
          filters.push(sql`(${transactions.metadata} ->> ${key}) IN ${vals}`);
        } else {
          // Empty IN → match nothing (consistent with PostgREST semantics).
          filters.push(sql`false`);
        }
      } else if (w.op === "neq") {
        filters.push(sql`${transactions.metadata} ->> ${key} <> ${String(w.val)}`);
      }
    }
  }
  if (!isStaff) filters.push(eq(transactions.userId, req.user.id));
  const limit = Math.min(body.limit ?? 100, 500); // P1 — see FromBody.limit cap
  const ord = body.order;
  const orderBy = ord?.col === "created_at"
    ? (ord.asc ? asc(transactions.createdAt) : desc(transactions.createdAt))
    : desc(transactions.createdAt);
  const rows = await db
    .select()
    .from(transactions)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(orderBy)
    .limit(limit);
  // P0-7 — HARD_RULES #4: members never see merchant_ref / description /
  // fee / external_tx_id / metadata. Staff with the proper view perm sees the
  // full row for ops/recon purposes.
  if (isStaff) {
    return rows.map((r) => ({
      id: r.id,
      public_no: r.publicNo,
      user_id: r.userId,
      type: r.type,
      status: r.status,
      amount: Number(r.amount),
      fee: Number(r.fee),
      balance_after: r.balanceAfter != null ? Number(r.balanceAfter) : null,
      description: r.description,
      reference_id: r.referenceId,
      metadata: r.metadata,
      merchant_ref: r.merchantRef,
      external_tx_id: r.externalTxId,
      created_at: r.createdAt,
    }));
  }
  return rows.map((r) => ({
    id: r.id,
    public_no: r.publicNo,
    user_id: r.userId,
    type: r.type,
    status: r.status,
    amount: Number(r.amount),
    balance_after: r.balanceAfter != null ? Number(r.balanceAfter) : null,
    created_at: r.createdAt,
  }));
};

// ============================== MERCHANT SETTLEMENT LOG ==============================
const merchantSettlementLogHandler: TableHandler = async ({ req, body }) => {
  if (!req.perms?.has("reconciliation:view") && !req.perms?.has("merchants:view_full"))
    throw new ForbiddenError("PERMISSION_DENIED");
  if (body.op !== "select") throw new AppError(400, "READONLY");
  const filters: Array<ReturnType<typeof eq>> = [];
  for (const w of body.where ?? []) {
    if (w.col === "merchant_id" && w.op === "eq")
      filters.push(eq(merchantSettlementLog.merchantId, String(w.val)));
    if (w.col === "reference_id" && w.op === "eq")
      filters.push(eq(merchantSettlementLog.referenceId, String(w.val)));
    if (w.col === "reason" && w.op === "eq")
      filters.push(eq(merchantSettlementLog.reason, String(w.val)));
  }
  const rows = await db
    .select()
    .from(merchantSettlementLog)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(merchantSettlementLog.id))
    .limit(Math.min(body.limit ?? 100, 1000));
  return rows.map((r) => ({
    id: String(r.id), // bigserial → string
    merchant_id: r.merchantId,
    change_amount: Number(r.changeAmount),
    balance_before: Number(r.balanceBefore),
    balance_after: Number(r.balanceAfter),
    reason: r.reason,
    reference_type: r.referenceType,
    reference_id: r.referenceId,
    notes: r.notes,
    created_at: r.createdAt,
  }));
};

// ============================== MERCHANT CASH POOL LOG ==============================
const merchantCashPoolLogHandler: TableHandler = async ({ req, body }) => {
  if (!req.perms?.has("merchants.cash_pool:view_full") && !req.perms?.has("merchants:view_full"))
    throw new ForbiddenError("PERMISSION_DENIED");
  if (body.op !== "select") throw new AppError(400, "READONLY");
  const filters: Array<ReturnType<typeof eq>> = [];
  for (const w of body.where ?? []) {
    if (w.col === "merchant_id" && w.op === "eq")
      filters.push(eq(merchantCashPoolLog.merchantId, String(w.val)));
  }
  const rows = await db
    .select()
    .from(merchantCashPoolLog)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(merchantCashPoolLog.id))
    .limit(Math.min(body.limit ?? 100, 1000));
  return rows.map((r) => ({
    id: String(r.id),
    merchant_id: r.merchantId,
    change_amount: Number(r.changeAmount),
    balance_before: Number(r.balanceBefore),
    balance_after: Number(r.balanceAfter),
    reason: r.reason,
    // P1 — the dropped `note` column is back-compat aliased to `notes` so
    // any web UI key it on legacy column doesn't 500 when the field is null.
    note: r.notes,
    notes: r.notes,
    collection_fee_amount: r.collectionFeeAmount != null ? Number(r.collectionFeeAmount) : null,
    created_at: r.createdAt,
  }));
};

// ============================== MERCHANT APPLICATIONS ==============================
const merchantApplicationsHandler: TableHandler = async ({ req, body }) => {
  if (!req.perms?.has("merchants:approve") && !req.perms?.has("merchants:view_full"))
    throw new ForbiddenError("PERMISSION_DENIED");
  if (body.op !== "select") throw new AppError(400, "READONLY");
  const filters = (body.where ?? [])
    .map((w) => {
      if (w.col === "id" && w.op === "eq") return eq(merchantApplications.id, String(w.val));
      if (w.col === "status" && w.op === "eq")
        return eq(merchantApplications.status, String(w.val));
      if (w.col === "status" && w.op === "in" && Array.isArray(w.val))
        return inArray(merchantApplications.status, w.val as string[]);
      return null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  const ord = body.order;
  let q = db
    .select()
    .from(merchantApplications)
    .where(filters.length ? and(...filters) : undefined)
    .$dynamic();
  if (ord?.col === "created_at")
    q = q.orderBy(ord.asc ? asc(merchantApplications.createdAt) : desc(merchantApplications.createdAt));
  else q = q.orderBy(desc(merchantApplications.createdAt));
  const rows = await q.limit(Math.min(body.limit ?? 100, 500));
  return rows.map((r) => snakeify<Record<string, unknown>>(r));
};

// ============================== SETTINGS ==============================
// P1 — Settings writes are now restricted to a known allowlist. The previous
// shape accepted arbitrary keys + arbitrary jsonb values, so an admin with
// `settings:manage` could create rogue settings rows OR overwrite seeded
// keys with malformed payloads. The allowlist + per-key Zod validator means
// only documented keys with documented shapes get written, and every
// successful write is audited (so post-incident we can trace WHO changed
// WHAT and WHEN).
const SETTINGS_ALLOWLIST: Record<string, z.ZodTypeAny> = {
  affiliate_system_enabled: z.boolean(),
  topup_session_ttl_seconds: z.number().int().positive().max(60 * 60 * 24),
  withdraw_session_ttl_seconds: z.number().int().positive().max(60 * 60 * 24),
  payment_code_default_ttl_seconds: z.number().int().positive().max(60 * 60 * 24),
  merchant_idempotency_ttl_days: z.number().int().positive().max(90),
  loyalty_default_multiplier: z.number().min(0).max(100),
  password_otp_ttl_minutes: z.number().int().positive().max(60),
  // OTP (admin BO /admin/settings)
  otp_length: z.number().int().min(4).max(8),
  otp_ttl_minutes: z.number().int().positive().max(60),
  otp_max_attempts: z.number().int().positive().max(20),
  otp_resend_seconds: z.number().int().positive().max(600),
  // Loyalty (admin BO /admin/settings — K2)
  first_topup_bonus: z.number().int().min(0).max(1_000_000),
  first_topup_bonus_v2: z.number().int().min(0).max(1_000_000),
  monthly_active_threshold: z.number().int().min(1).max(1000),
  monthly_active_bonus: z.number().int().min(0).max(1_000_000),
  monthly_active_bonus_v2: z.number().int().min(0).max(1_000_000),
  birthday_bonus_points: z.number().int().min(0).max(1_000_000),
  profile_complete_bonus: z.number().int().min(0).max(1_000_000),
  points_per_topup_unit: z.number().positive().max(1_000_000),
  points_per_topup_unit_v2: z.number().positive().max(1_000_000),
  points_per_spend_unit: z.number().positive().max(1_000_000),
  points_per_spend_unit_v2: z.number().positive().max(1_000_000),
  withdraw_penalty_per_unit: z.number().positive().max(1_000_000),
  turnover_bonus_log_base: z.number().min(1.01).max(10),
  // System
  payment_code_lengths: z.array(z.number().int().positive().max(60 * 24 * 365)).min(1).max(20),
};

const settingsHandler: TableHandler = async ({ req, body }) => {
  if (!req.perms?.has("settings:view") && !req.perms?.has("settings:manage"))
    throw new ForbiddenError("PERMISSION_DENIED");
  if (body.op === "select") {
    const filters: Array<ReturnType<typeof eq>> = [];
    for (const w of body.where ?? []) {
      if (w.col === "key" && w.op === "eq") filters.push(eq(settings.key, String(w.val)));
    }
    const rows = await db.select().from(settings).where(filters.length ? and(...filters) : undefined);
    if (body.maybeSingle || body.single) return rows[0] ?? null;
    return rows;
  }
  if (body.op === "update") {
    if (!req.perms?.has("settings:manage")) throw new ForbiddenError("PERMISSION_DENIED");
    const v = body.values as { value?: unknown; description?: string };
    const keyW = body.where?.find((w) => w.col === "key" && w.op === "eq");
    if (!keyW) throw new AppError(400, "BAD_FILTER");
    const key = String(keyW.val);
    const validator = SETTINGS_ALLOWLIST[key];
    if (!validator) throw new AppError(400, "UNKNOWN_SETTING_KEY");
    const parsed = validator.safeParse(v.value);
    if (!parsed.success) throw new AppError(400, "BAD_SETTING_VALUE");
    // Snapshot before so the audit row shows the diff. The redactor in
    // writeAudit will mask anything sensitive.
    const [before] = await db
      .select({ key: settings.key, value: settings.value })
      .from(settings)
      .where(eq(settings.key, key))
      .limit(1);
    await db
      .update(settings)
      .set({
        value: parsed.data as never,
        description: v.description,
        updatedBy: req.user!.id,
        updatedAt: new Date(),
      })
      .where(eq(settings.key, key));
    await writeAudit({
      actorId: req.user!.id,
      action: "settings.update",
      resourceType: "settings",
      resourceId: key,
      before: before ?? null,
      after: { key, value: parsed.data },
      ip: req.ip ?? null,
    });
    return null;
  }
  throw new AppError(400, "UNSUPPORTED_OP");
};

// ============================== HELP ARTICLES ==============================
const helpArticlesHandler: TableHandler = async ({ req, body }) => {
  if (!req.user) throw new ForbiddenError("PERMISSION_DENIED");
  if (body.op !== "select") throw new AppError(400, "READONLY");
  const filters: Array<ReturnType<typeof eq>> = [eq(helpArticles.isActive, true)];
  for (const w of body.where ?? []) {
    if (w.col === "page_key" && w.op === "eq")
      filters.push(eq(helpArticles.pageKey, String(w.val)));
    if (w.col === "locale" && w.op === "eq") filters.push(eq(helpArticles.locale, String(w.val)));
  }
  const rows = await db
    .select()
    .from(helpArticles)
    .where(and(...filters))
    .orderBy(asc(helpArticles.sortOrder))
    .limit(Math.min(body.limit ?? 20, 100));
  return rows;
};

// ============================== SUGGESTIONS ==============================
const suggestionsHandler: TableHandler = async ({ req, body }) => {
  if (!req.user) throw new ForbiddenError("PERMISSION_DENIED");

  if (body.op === "update") {
    // A user can only acknowledge/dismiss suggestions targeted at themselves.
    // The schema only models `acknowledged_at` + `acknowledged_by`; dismissals
    // are mapped onto the same column (graceful degradation).
    const idW = body.where?.find((w) => w.col === "id" && w.op === "eq");
    if (!idW) throw new BadRequestError("BAD_FILTER");
    const v = (body.values ?? {}) as Record<string, unknown>;
    const wantsAck = v.acknowledged_at !== undefined || v.dismissed_at !== undefined;
    if (!wantsAck) throw new BadRequestError("NO_FIELDS");
    const acknowledgedAt =
      v.acknowledged_at != null
        ? new Date(String(v.acknowledged_at))
        : v.dismissed_at != null
          ? new Date(String(v.dismissed_at))
          : new Date();
    await db
      .update(suggestions)
      .set({ acknowledgedAt, acknowledgedBy: req.user.id })
      .where(
        and(eq(suggestions.id, String(idW.val)), eq(suggestions.audienceUserId, req.user.id)),
      );
    return null;
  }

  if (body.op !== "select") throw new AppError(400, "READONLY");
  // Suggestions are member-facing tips; staff with members:view_full may want
  // to inspect/clear them across users. Anyone else is scoped to their own row.
  const isStaff = !!(req.perms && req.perms.has("members:view_full"));
  const filters: Array<ReturnType<typeof eq>> = [];
  if (!isStaff) filters.push(eq(suggestions.audienceUserId, req.user.id));
  for (const w of body.where ?? []) {
    if (w.col === "kind" && w.op === "eq") filters.push(eq(suggestions.kind, String(w.val)));
    if (w.col === "audience_user_id" && w.op === "eq")
      filters.push(eq(suggestions.audienceUserId, String(w.val)));
  }
  const rows = await db
    .select()
    .from(suggestions)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(suggestions.createdAt))
    .limit(Math.min(body.limit ?? 50, 200));
  return rows;
};

// ============================== Generic read-only builder ==============================
/**
 * Factory: build a TableHandler for a table that supports SELECT only, with
 * an allow-list of filter columns + order columns. Snakeifies every row so we
 * never miss a legacy column.
 *
 * Use `genericReadHandler` for any admin-read-only table. For tables that
 * need member-scoping, mutations, or OR support, keep / add a custom handler.
 */
type ColMap = Record<string, AnyPgColumn>;

interface GenericReadOpts {
  /** Drizzle table reference. */
  table: PgTable;
  /** Permission check; must return true for the request to proceed. */
  permit: (req: import("express").Request) => boolean;
  /** Cols allowed in `where[]` filters; key is JSON name, value is Drizzle col. */
  filterCols?: ColMap;
  /** Cols allowed in `order`. */
  orderCols?: ColMap;
  /** Default order column when none specified. */
  defaultOrder?: { col: AnyPgColumn; asc: boolean };
  /** Max rows ever returned. */
  maxLimit?: number;
  /** Optional per-request mutator (e.g. inject "user_id = req.user.id" for member scope). */
  scopeRow?: (req: import("express").Request) => SQL | null;
}

function genericReadHandler(opts: GenericReadOpts): TableHandler {
  return async ({ req, body }) => {
    if (!opts.permit(req)) throw new ForbiddenError("PERMISSION_DENIED");
    if (body.op !== "select") throw new AppError(400, "READONLY");

    const filters: Array<SQL | undefined> = [];
    const scope = opts.scopeRow?.(req);
    if (scope) filters.push(scope);

    for (const w of body.where ?? []) {
      const col = opts.filterCols?.[w.col];
      if (!col) continue;
      if (w.op === "eq") filters.push(eq(col, w.val as never));
      else if (w.op === "neq")
        filters.push(sql`${col} <> ${w.val as never}`);
      else if (w.op === "in" && Array.isArray(w.val))
        filters.push(inArray(col, w.val as never[]));
      else if (w.op === "gt") filters.push(sql`${col} > ${w.val as never}`);
      else if (w.op === "gte") filters.push(sql`${col} >= ${w.val as never}`);
      else if (w.op === "lt") filters.push(sql`${col} < ${w.val as never}`);
      else if (w.op === "lte") filters.push(sql`${col} <= ${w.val as never}`);
    }

    let q = db.select().from(opts.table).where(filters.length ? and(...(filters.filter(Boolean) as SQL[])) : undefined).$dynamic();

    const orderRequested = body.order;
    if (orderRequested && opts.orderCols?.[orderRequested.col]) {
      const col = opts.orderCols[orderRequested.col]!;
      const ascending =
        orderRequested.asc !== undefined
          ? orderRequested.asc
          : (opts.defaultOrder?.asc ?? true);
      q = q.orderBy(ascending ? asc(col) : desc(col));
    } else if (opts.defaultOrder) {
      q = q.orderBy(opts.defaultOrder.asc ? asc(opts.defaultOrder.col) : desc(opts.defaultOrder.col));
    }

    const limit = Math.min(body.limit ?? 100, opts.maxLimit ?? 500);
    q = q.limit(limit);
    if (body.offset) q = q.offset(body.offset);

    const rows = await q;
    const out = rows.map((r) => snakeify<Record<string, unknown>>(r));
    return body.maybeSingle || body.single ? out[0] ?? null : out;
  };
}

const isAuthed = () => true;
const hasPerm = (...keys: string[]) => (req: import("express").Request) =>
  !!req.perms && keys.some((k) => req.perms!.has(k));

/**
 * P0-46 — `isStaff` is **per-table**, not global. The old `req.perms.size > 0`
 * heuristic meant a single harmless permission override (e.g. `dashboard:view`)
 * would bypass per-user `scopeRow` filters on accounts/transactions/sessions
 * and leak every member's data. Each table now passes its own list of
 * permissions that should grant cross-tenant view; everyone else is scoped to
 * their own user_id.
 */
const canSeeAllFor = (...keys: string[]) =>
  (req: import("express").Request) => hasPerm(...keys)(req);

// ============================== Generic-table registrations ==============================
//
// P0-6 — chat/PCR/attachment reads must be scoped to the caller's threads.
// Previously these handlers accepted `!!req.user` with no ownership check,
// letting any authed user dump any thread's messages/attachments/PCRs by
// passing the thread UUID as a filter.
const canSeeAllChat = canSeeAllFor("chat:view", "chat:view_all", "chat:reply");
const ownThreadIdsSql = (userId: string) =>
  sql`(SELECT id FROM chat_threads WHERE user_id = ${userId})`;

const chatMessagesHandler = genericReadHandler({
  table: chatMessages,
  permit: (req) =>
    hasPerm("chat:view", "chat:view_all", "chat:reply")(req) || !!req.user,
  filterCols: {
    thread_id: chatMessages.threadId,
    sender_role: chatMessages.senderRole,
    sender_user_id: chatMessages.senderUserId,
  },
  orderCols: { created_at: chatMessages.createdAt },
  defaultOrder: { col: chatMessages.createdAt, asc: true },
  scopeRow: (req) =>
    canSeeAllChat(req)
      ? null
      : sql`${chatMessages.threadId} IN ${ownThreadIdsSql(req.user!.id)}`,
});

const chatAttachmentsHandler = genericReadHandler({
  table: chatAttachments,
  permit: (req) => !!req.user,
  filterCols: {
    thread_id: chatAttachments.threadId,
    message_id: chatAttachments.messageId,
    status: chatAttachments.status,
  },
  orderCols: { created_at: chatAttachments.createdAt },
  defaultOrder: { col: chatAttachments.createdAt, asc: true },
  scopeRow: (req) =>
    canSeeAllChat(req)
      ? null
      : sql`${chatAttachments.threadId} IN ${ownThreadIdsSql(req.user!.id)}`,
});

const chatPcrHandler = genericReadHandler({
  table: chatProfileChangeRequests,
  permit: (req) => !!req.user,
  filterCols: {
    thread_id: chatProfileChangeRequests.threadId,
    user_id: chatProfileChangeRequests.userId,
    status: chatProfileChangeRequests.status,
  },
  orderCols: { created_at: chatProfileChangeRequests.createdAt },
  defaultOrder: { col: chatProfileChangeRequests.createdAt, asc: false },
  scopeRow: (req) =>
    canSeeAllFor("chat:view", "chat:view_all", "chat:reply", "chat:approve_pcr")(req)
      ? null
      : eq(chatProfileChangeRequests.userId, req.user!.id),
});

const chatCannedRead = genericReadHandler({
  table: chatCannedResponses,
  permit: hasPerm("chat:view", "chat:view_all", "templates:view", "templates:manage"),
  filterCols: { category: chatCannedResponses.category, is_active: chatCannedResponses.isActive },
  orderCols: { title: chatCannedResponses.title, created_at: chatCannedResponses.createdAt },
});
const chatCannedHandler: TableHandler = async (ctx) => {
  if (ctx.body.op === "select") return chatCannedRead(ctx);
  if (ctx.body.op === "update") {
    if (!ctx.req.perms?.has("templates:manage")) throw new ForbiddenError("PERMISSION_DENIED");
    const idW = ctx.body.where?.find((w) => w.col === "id" && w.op === "eq");
    if (!idW) throw new BadRequestError("BAD_FILTER");
    const v = (ctx.body.values ?? {}) as Record<string, unknown>;
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (v.title !== undefined) patch.title = String(v.title);
    if (v.body !== undefined) patch.body = String(v.body);
    if (v.is_active !== undefined) patch.isActive = Boolean(v.is_active);
    if (v.trigger_keywords !== undefined)
      patch.triggerKeywords = Array.isArray(v.trigger_keywords)
        ? (v.trigger_keywords as unknown[]).map(String)
        : [];
    if (v.category !== undefined) patch.category = v.category as never;
    if (Object.keys(patch).length === 1) throw new BadRequestError("NO_FIELDS");

    const id = String(idW.val);
    const [before] = await db
      .select()
      .from(chatCannedResponses)
      .where(eq(chatCannedResponses.id, id))
      .limit(1);
    if (!before) throw new AppError(404, "CANNED_NOT_FOUND");
    await db.update(chatCannedResponses).set(patch).where(eq(chatCannedResponses.id, id));
    await writeAudit({
      actorId: ctx.req.user!.id,
      action: "chat_canned.update",
      resourceType: "chat_canned_response",
      resourceId: id,
      before: snakeify(before),
      after: snakeify(patch),
      ip: clientIp(ctx.req),
    });
    return null;
  }
  throw new AppError(400, "UNSUPPORTED_OP");
};

const chatRoutingHandler = genericReadHandler({
  table: chatRoutingRules,
  permit: hasPerm("chat:view_all", "settings:view"),
  filterCols: { category: chatRoutingRules.category, is_active: chatRoutingRules.isActive },
});

const loyaltyTiersRead = genericReadHandler({
  table: loyaltyTiers,
  permit: isAuthed,
  filterCols: { id: loyaltyTiers.id, is_archived: loyaltyTiers.isArchived },
  orderCols: { sort_order: loyaltyTiers.sortOrder, min_points: loyaltyTiers.minPoints },
  defaultOrder: { col: loyaltyTiers.sortOrder, asc: true },
});
const loyaltyTiersHandler: TableHandler = async (ctx) => {
  if (ctx.body.op === "select") return loyaltyTiersRead(ctx);
  if (ctx.body.op === "update") {
    if (!ctx.req.perms?.has("loyalty:manage")) throw new ForbiddenError("PERMISSION_DENIED");
    const idW = ctx.body.where?.find((w) => w.col === "id" && w.op === "eq");
    if (!idW) throw new BadRequestError("BAD_FILTER");
    const v = (ctx.body.values ?? {}) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    if (v.display_name !== undefined) patch.displayName = String(v.display_name);
    if (v.level_name !== undefined) patch.levelName = String(v.level_name);
    if (v.sub_rank !== undefined) patch.subRank = Number(v.sub_rank);
    if (v.sort_order !== undefined) patch.sortOrder = Number(v.sort_order);
    if (v.min_points !== undefined) patch.minPoints = Number(v.min_points);
    if (v.min_turnover !== undefined) patch.minTurnover = String(v.min_turnover);
    if (v.commission_discount_pct !== undefined)
      patch.commissionDiscountPct = String(v.commission_discount_pct);
    if (v.point_multiplier !== undefined) patch.pointMultiplier = String(v.point_multiplier);
    if (v.cashback_pct !== undefined) {
      // Hard rule (docs/LOYALTY_V3.md, CLAUDE.md): cashback capped at 1.5%.
      const capped = Math.min(Math.max(Number(v.cashback_pct) || 0, 0), 1.5);
      patch.cashbackPct = String(capped);
    }
    if (v.is_archived !== undefined) patch.isArchived = Boolean(v.is_archived);
    if (Object.keys(patch).length === 0) throw new BadRequestError("NO_FIELDS");

    const id = Number(idW.val);
    const [before] = await db.select().from(loyaltyTiers).where(eq(loyaltyTiers.id, id)).limit(1);
    if (!before) throw new AppError(404, "TIER_NOT_FOUND");
    await db.update(loyaltyTiers).set(patch).where(eq(loyaltyTiers.id, id));
    await writeAudit({
      actorId: ctx.req.user!.id,
      action: "loyalty_tier.update",
      resourceType: "loyalty_tier",
      resourceId: String(id),
      before,
      after: patch,
      ip: clientIp(ctx.req),
    });
    return null;
  }
  throw new AppError(400, "UNSUPPORTED_OP");
};

const loyaltyRulesRead = genericReadHandler({
  table: loyaltyRules,
  permit: hasPerm("loyalty:view", "loyalty:manage"),
  filterCols: { key: loyaltyRules.key, is_active: loyaltyRules.isActive },
  orderCols: { key: loyaltyRules.key },
});
const loyaltyRulesHandler: TableHandler = async (ctx) => {
  if (ctx.body.op === "select") return loyaltyRulesRead(ctx);
  if (ctx.body.op === "update") {
    if (!ctx.req.perms?.has("loyalty:manage")) throw new ForbiddenError("PERMISSION_DENIED");
    const idW = ctx.body.where?.find((w) => w.col === "id" && w.op === "eq");
    if (!idW) throw new BadRequestError("BAD_FILTER");
    const v = (ctx.body.values ?? {}) as Record<string, unknown>;
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (v.value !== undefined) patch.value = v.value as never;
    if (v.description !== undefined)
      patch.description = v.description == null ? null : String(v.description);
    if (v.is_active !== undefined) patch.isActive = Boolean(v.is_active);

    const id = Number(idW.val);
    const [before] = await db.select().from(loyaltyRules).where(eq(loyaltyRules.id, id)).limit(1);
    if (!before) throw new AppError(404, "RULE_NOT_FOUND");
    await db.update(loyaltyRules).set(patch).where(eq(loyaltyRules.id, id));
    await writeAudit({
      actorId: ctx.req.user!.id,
      action: "loyalty_rule.update",
      resourceType: "loyalty_rule",
      resourceId: String(id),
      before,
      after: patch,
      ip: clientIp(ctx.req),
    });
    return null;
  }
  throw new AppError(400, "UNSUPPORTED_OP");
};
const loyaltyPointsLogHandler = genericReadHandler({
  table: loyaltyPointsLog,
  permit: (req) => hasPerm("loyalty:view", "loyalty:manage")(req) || !!req.user,
  filterCols: { user_id: loyaltyPointsLog.userId },
  orderCols: { created_at: loyaltyPointsLog.createdAt },
  defaultOrder: { col: loyaltyPointsLog.createdAt, asc: false },
  scopeRow: (req) =>
    canSeeAllFor("loyalty:view", "loyalty:manage")(req)
      ? null
      : eq(loyaltyPointsLog.userId, req.user!.id),
});

const referralsHandler = genericReadHandler({
  table: referrals,
  permit: (req) => hasPerm("referrals:view", "referrals:manage")(req) || !!req.user,
  filterCols: {
    id: referrals.id,
    referrer_user_id: referrals.referrerUserId,
    referee_user_id: referrals.refereeUserId,
    status: referrals.status,
  },
  orderCols: { created_at: referrals.createdAt },
  defaultOrder: { col: referrals.createdAt, asc: false },
  // Members can only see referrals where they are the referrer or the referee.
  scopeRow: (req) =>
    canSeeAllFor("referrals:view", "referrals:manage")(req)
      ? null
      : orSql(
          eq(referrals.referrerUserId, req.user!.id),
          eq(referrals.refereeUserId, req.user!.id),
        )!,
});
const referralConfigHandler = genericReadHandler({
  table: referralConfig,
  permit: isAuthed,
});
const referralRewardsLogHandler = genericReadHandler({
  table: referralRewardsLog,
  permit: (req) => hasPerm("referrals:view", "referrals:manage")(req) || !!req.user,
  filterCols: {
    referral_id: referralRewardsLog.referralId,
    recipient_user_id: referralRewardsLog.recipientUserId,
  },
  orderCols: { created_at: referralRewardsLog.createdAt },
  defaultOrder: { col: referralRewardsLog.createdAt, asc: false },
  scopeRow: (req) =>
    canSeeAllFor("referrals:view", "referrals:manage")(req)
      ? null
      : eq(referralRewardsLog.recipientUserId, req.user!.id),
});

const profitShareCampaignsHandler = genericReadHandler({
  table: profitShareCampaigns,
  permit: hasPerm("profit_share:view", "profit_share:manage"),
  filterCols: { id: profitShareCampaigns.id, status: profitShareCampaigns.status },
  orderCols: { created_at: profitShareCampaigns.createdAt, period_from: profitShareCampaigns.periodFrom },
  defaultOrder: { col: profitShareCampaigns.createdAt, asc: false },
});
const profitShareAllocationsHandler = genericReadHandler({
  table: profitShareAllocations,
  permit: (req) =>
    hasPerm("profit_share:view", "profit_share:manage")(req) || !!req.user,
  filterCols: {
    campaign_id: profitShareAllocations.campaignId,
    user_id: profitShareAllocations.userId,
    status: profitShareAllocations.status,
  },
  orderCols: { rank_no: profitShareAllocations.rankNo, created_at: profitShareAllocations.createdAt },
  scopeRow: (req) =>
    canSeeAllFor("profit_share:view", "profit_share:manage")(req)
      ? null
      : eq(profitShareAllocations.userId, req.user!.id),
});

const mailTemplatesRead = genericReadHandler({
  table: mailTemplates,
  permit: hasPerm("templates:view", "templates:manage"),
  filterCols: {
    template_key: mailTemplates.templateKey,
    locale: mailTemplates.locale,
    audience: mailTemplates.audience,
    is_active: mailTemplates.isActive,
  },
  orderCols: { template_key: mailTemplates.templateKey, updated_at: mailTemplates.updatedAt },
});
const mailTemplatesHandler: TableHandler = async (ctx) => {
  if (ctx.body.op === "select") return mailTemplatesRead(ctx);
  if (ctx.body.op === "update") {
    if (!ctx.req.perms?.has("templates:manage")) throw new ForbiddenError("PERMISSION_DENIED");
    const idW = ctx.body.where?.find((w) => w.col === "id" && w.op === "eq");
    if (!idW) throw new BadRequestError("BAD_FILTER");
    const v = (ctx.body.values ?? {}) as Record<string, unknown>;
    const patch: Record<string, unknown> = { updatedAt: new Date(), updatedBy: ctx.req.user!.id };
    if (v.subject !== undefined) patch.subject = String(v.subject);
    if (v.body_html !== undefined) patch.bodyHtml = String(v.body_html);
    if (v.body_text !== undefined)
      patch.bodyText = v.body_text == null ? null : String(v.body_text);
    if (v.is_active !== undefined) patch.isActive = Boolean(v.is_active);
    if (v.description !== undefined)
      patch.description = v.description == null ? null : String(v.description);
    if (Object.keys(patch).length === 2) throw new BadRequestError("NO_FIELDS");

    const id = String(idW.val);
    const [before] = await db.select().from(mailTemplates).where(eq(mailTemplates.id, id)).limit(1);
    if (!before) throw new AppError(404, "TEMPLATE_NOT_FOUND");
    await db.update(mailTemplates).set(patch).where(eq(mailTemplates.id, id));
    await writeAudit({
      actorId: ctx.req.user!.id,
      action: "mail_template.update",
      resourceType: "mail_template",
      resourceId: id,
      before: snakeify(before),
      after: snakeify(patch),
      metadata: { template_key: before.templateKey, locale: before.locale },
      ip: clientIp(ctx.req),
    });
    return null;
  }
  throw new AppError(400, "UNSUPPORTED_OP");
};

const telegramTemplatesRead = genericReadHandler({
  table: telegramTemplates,
  permit: hasPerm("templates:view", "templates:manage"),
  filterCols: {
    template_key: telegramTemplates.templateKey,
    locale: telegramTemplates.locale,
    is_active: telegramTemplates.isActive,
  },
});
const telegramTemplatesHandler: TableHandler = async (ctx) => {
  if (ctx.body.op === "select") return telegramTemplatesRead(ctx);
  if (ctx.body.op === "update") {
    if (!ctx.req.perms?.has("templates:manage")) throw new ForbiddenError("PERMISSION_DENIED");
    const idW = ctx.body.where?.find((w) => w.col === "id" && w.op === "eq");
    if (!idW) throw new BadRequestError("BAD_FILTER");
    const v = (ctx.body.values ?? {}) as Record<string, unknown>;
    const patch: Record<string, unknown> = { updatedAt: new Date(), updatedBy: ctx.req.user!.id };
    if (v.body_md !== undefined) patch.bodyMd = String(v.body_md);
    if (v.is_active !== undefined) patch.isActive = Boolean(v.is_active);
    if (v.description !== undefined)
      patch.description = v.description == null ? null : String(v.description);
    if (Object.keys(patch).length === 2) throw new BadRequestError("NO_FIELDS");

    const id = String(idW.val);
    const [before] = await db
      .select()
      .from(telegramTemplates)
      .where(eq(telegramTemplates.id, id))
      .limit(1);
    if (!before) throw new AppError(404, "TEMPLATE_NOT_FOUND");
    await db.update(telegramTemplates).set(patch).where(eq(telegramTemplates.id, id));
    await writeAudit({
      actorId: ctx.req.user!.id,
      action: "telegram_template.update",
      resourceType: "telegram_template",
      resourceId: id,
      before: snakeify(before),
      after: snakeify(patch),
      metadata: { template_key: before.templateKey, locale: before.locale },
      ip: clientIp(ctx.req),
    });
    return null;
  }
  throw new AppError(400, "UNSUPPORTED_OP");
};

const merchantCashoutMethodsRead = genericReadHandler({
  table: merchantCashoutMethods,
  permit: isAuthed,
  filterCols: { code: merchantCashoutMethods.code, is_active: merchantCashoutMethods.isActive },
  orderCols: { sort_order: merchantCashoutMethods.sortOrder },
  defaultOrder: { col: merchantCashoutMethods.sortOrder, asc: true },
});
const merchantCashoutMethodsHandler: TableHandler = async (ctx) => {
  if (ctx.body.op === "select") return merchantCashoutMethodsRead(ctx);
  if (ctx.body.op === "update") {
    if (!ctx.req.perms?.has("settings:manage")) throw new ForbiddenError("PERMISSION_DENIED");
    const codeW = ctx.body.where?.find((w) => w.col === "code" && w.op === "eq");
    if (!codeW) throw new BadRequestError("BAD_FILTER");
    const v = (ctx.body.values ?? {}) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    if (v.label !== undefined) patch.label = String(v.label);
    if (v.network !== undefined) patch.network = String(v.network);
    if (v.is_active !== undefined) patch.isActive = Boolean(v.is_active);
    if (v.min_amount !== undefined)
      patch.minAmount = v.min_amount == null ? null : String(v.min_amount);
    if (v.max_amount !== undefined)
      patch.maxAmount = v.max_amount == null ? null : String(v.max_amount);
    if (v.sort_order !== undefined) patch.sortOrder = Number(v.sort_order);
    if (Object.keys(patch).length === 0) throw new BadRequestError("NO_FIELDS");

    const code = String(codeW.val);
    const [before] = await db
      .select()
      .from(merchantCashoutMethods)
      .where(eq(merchantCashoutMethods.code, code))
      .limit(1);
    if (!before) throw new AppError(404, "CASHOUT_METHOD_NOT_FOUND");
    await db
      .update(merchantCashoutMethods)
      .set(patch)
      .where(eq(merchantCashoutMethods.code, code));
    await writeAudit({
      actorId: ctx.req.user!.id,
      action: "merchant_cashout_method.update",
      resourceType: "merchant_cashout_method",
      resourceId: code,
      before: snakeify(before),
      after: snakeify(patch),
      ip: clientIp(ctx.req),
    });
    return null;
  }
  throw new AppError(400, "UNSUPPORTED_OP");
};
const merchantCashoutSessionsHandler = genericReadHandler({
  table: merchantCashoutSessions,
  permit: hasPerm("merchants:view_full"),
  filterCols: {
    id: merchantCashoutSessions.id,
    merchant_id: merchantCashoutSessions.merchantId,
    status: merchantCashoutSessions.status,
  },
  orderCols: { created_at: merchantCashoutSessions.createdAt },
  defaultOrder: { col: merchantCashoutSessions.createdAt, asc: false },
});

const merchantUsersHandler = genericReadHandler({
  table: merchantUsers,
  permit: hasPerm("merchants:view_full", "merchants:view_masked"),
  filterCols: {
    id: merchantUsers.id,
    merchant_id: merchantUsers.merchantId,
    user_id: merchantUsers.userId,
    is_active: merchantUsers.isActive,
  },
  orderCols: { created_at: merchantUsers.createdAt, email: merchantUsers.email },
});

const merchantMethodsRead = genericReadHandler({
  table: merchantMethods,
  permit: hasPerm("merchants:view_full", "merchants:view_masked"),
  filterCols: {
    id: merchantMethods.id,
    merchant_id: merchantMethods.merchantId,
    kind: merchantMethods.kind,
    is_active: merchantMethods.isActive,
  },
  orderCols: { sort_order: merchantMethods.sortOrder, code: merchantMethods.code },
});

/**
 * Per-call mutation: `merchant_methods` rows are tied to a merchant_id and
 * have NOT NULL commission/fee columns. Nullable: min/max amount, per_tx_limit,
 * daily_limit. We strictly allow-list columns + audit every write.
 */
const MERCHANT_METHOD_FIELDS: Record<string, { key: string; coerce: ColCoercion; nullable: boolean }> = {
  merchant_id: { key: "merchantId", coerce: "text", nullable: false },
  code: { key: "code", coerce: "text", nullable: false },
  name: { key: "name", coerce: "text", nullable: false },
  kind: { key: "kind", coerce: "text", nullable: false },
  is_active: { key: "isActive", coerce: "bool", nullable: false },
  deposit_commission_pct: { key: "depositCommissionPct", coerce: "numeric", nullable: false },
  deposit_fixed_fee: { key: "depositFixedFee", coerce: "numeric", nullable: false },
  withdraw_commission_pct: { key: "withdrawCommissionPct", coerce: "numeric", nullable: false },
  withdraw_fixed_fee: { key: "withdrawFixedFee", coerce: "numeric", nullable: false },
  min_amount: { key: "minAmount", coerce: "numeric", nullable: true },
  max_amount: { key: "maxAmount", coerce: "numeric", nullable: true },
  per_tx_limit: { key: "perTxLimit", coerce: "numeric", nullable: true },
  daily_limit: { key: "dailyLimit", coerce: "numeric", nullable: true },
  sort_order: { key: "sortOrder", coerce: "numeric", nullable: false },
  config: { key: "config", coerce: "text", nullable: false },
};

function buildMethodPatch(values: Record<string, unknown>, { allowMissing }: { allowMissing: boolean }) {
  const patch: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(values)) {
    const spec = MERCHANT_METHOD_FIELDS[k];
    if (!spec) continue;
    if (val == null) {
      if (spec.nullable) patch[spec.key] = null;
      else if (allowMissing) continue; // skip; let DB default apply
      else patch[spec.key] = spec.coerce === "numeric" ? "0" : null;
    } else if (k === "sort_order") {
      patch[spec.key] = Number(val);
    } else if (k === "config") {
      patch[spec.key] = val as Record<string, unknown>;
    } else {
      patch[spec.key] = coerceValue(spec.coerce, val);
    }
  }
  return patch;
}

const merchantMethodsHandler: TableHandler = async (ctx) => {
  const { req, body } = ctx;
  if (body.op === "select") return merchantMethodsRead(ctx);
  if (!req.perms?.has("merchants:update")) throw new ForbiddenError("PERMISSION_DENIED");

  if (body.op === "insert") {
    const v = (body.values ?? {}) as Record<string, unknown>;
    if (!v.merchant_id || !v.code || !v.name || !v.kind)
      throw new BadRequestError("MISSING_FIELDS");
    const patch = buildMethodPatch(v, { allowMissing: true });
    const [row] = await db
      .insert(merchantMethods)
      .values(patch as never)
      .returning({ id: merchantMethods.id });
    await writeAudit({
      actorId: req.user!.id,
      action: "merchant_method.create",
      resourceType: "merchant_method",
      resourceId: row?.id ?? null,
      after: snakeify(patch),
      metadata: { merchant_id: String(v.merchant_id) },
      ip: clientIp(req),
    });
    return row ?? null;
  }

  if (body.op === "update") {
    const idW = body.where?.find((w) => w.col === "id" && w.op === "eq");
    if (!idW) throw new BadRequestError("BAD_FILTER");
    const v = (body.values ?? {}) as Record<string, unknown>;
    const patch = buildMethodPatch(v, { allowMissing: true });
    // never let the FK move to a different merchant via this path
    delete patch.merchantId;
    if (Object.keys(patch).length === 0) throw new BadRequestError("NO_FIELDS");
    const methodId = String(idW.val);
    const [before] = await db
      .select()
      .from(merchantMethods)
      .where(eq(merchantMethods.id, methodId))
      .limit(1);
    if (!before) throw new AppError(404, "METHOD_NOT_FOUND");
    await db.update(merchantMethods).set(patch).where(eq(merchantMethods.id, methodId));
    await writeAudit({
      actorId: req.user!.id,
      action: "merchant_method.update",
      resourceType: "merchant_method",
      resourceId: methodId,
      before: snakeify(before),
      after: snakeify(patch),
      metadata: { merchant_id: before.merchantId },
      ip: clientIp(req),
    });
    return null;
  }

  if (body.op === "delete") {
    const idW = body.where?.find((w) => w.col === "id" && w.op === "eq");
    if (!idW) throw new BadRequestError("BAD_FILTER");
    const methodId = String(idW.val);
    const [before] = await db
      .select()
      .from(merchantMethods)
      .where(eq(merchantMethods.id, methodId))
      .limit(1);
    if (!before) throw new AppError(404, "METHOD_NOT_FOUND");
    await db.delete(merchantMethods).where(eq(merchantMethods.id, methodId));
    await writeAudit({
      actorId: req.user!.id,
      action: "merchant_method.delete",
      resourceType: "merchant_method",
      resourceId: methodId,
      before: snakeify(before),
      metadata: { merchant_id: before.merchantId },
      ip: clientIp(req),
    });
    return null;
  }
  throw new AppError(400, "UNSUPPORTED_OP");
};

const merchantUserPermissionOverridesHandler = genericReadHandler({
  table: merchantUserPermissionOverrides,
  permit: hasPerm("merchants:view_full"),
  filterCols: {
    merchant_user_id: merchantUserPermissionOverrides.merchantUserId,
    permission_key: merchantUserPermissionOverrides.permissionKey,
  },
});

const merchantAffiliateLinksHandler = genericReadHandler({
  table: merchantAffiliateLinks,
  permit: hasPerm("affiliates:view", "affiliates:manage"),
  filterCols: {
    affiliate_id: merchantAffiliateLinks.affiliateId,
    merchant_id: merchantAffiliateLinks.merchantId,
    status: merchantAffiliateLinks.status,
  },
  orderCols: { created_at: merchantAffiliateLinks.createdAt },
});
// Subquery: ids of affiliate rows owned by this user (linked or auth).
const ownAffiliateIdsSql = (userId: string) =>
  sql`(SELECT id FROM merchant_affiliates WHERE linked_user_id = ${userId} OR auth_user_id = ${userId})`;

const merchantAffiliatePayoutsHandler = genericReadHandler({
  table: merchantAffiliatePayouts,
  permit: (req) =>
    hasPerm("affiliates:view", "affiliates:manage")(req) || !!req.user,
  filterCols: {
    affiliate_id: merchantAffiliatePayouts.affiliateId,
    status: merchantAffiliatePayouts.status,
  },
  orderCols: { created_at: merchantAffiliatePayouts.createdAt },
  defaultOrder: { col: merchantAffiliatePayouts.createdAt, asc: false },
  scopeRow: (req) =>
    canSeeAllFor("affiliates:view", "affiliates:manage")(req)
      ? null
      : sql`${merchantAffiliatePayouts.affiliateId} IN ${ownAffiliateIdsSql(req.user!.id)}`,
});
const merchantAffiliateLedgerHandler = genericReadHandler({
  table: merchantAffiliateLedger,
  permit: (req) =>
    hasPerm("affiliates:view", "affiliates:manage")(req) || !!req.user,
  filterCols: {
    affiliate_id: merchantAffiliateLedger.affiliateId,
    direction: merchantAffiliateLedger.direction,
  },
  orderCols: { created_at: merchantAffiliateLedger.createdAt },
  defaultOrder: { col: merchantAffiliateLedger.createdAt, asc: false },
  scopeRow: (req) =>
    canSeeAllFor("affiliates:view", "affiliates:manage")(req)
      ? null
      : sql`${merchantAffiliateLedger.affiliateId} IN ${ownAffiliateIdsSql(req.user!.id)}`,
});

const accountsHandler = genericReadHandler({
  table: accounts,
  permit: (req) =>
    hasPerm("members:view_full", "members:view_masked", "members.balance:view_full")(req) ||
    !!req.user,
  filterCols: { user_id: accounts.userId },
  scopeRow: (req) =>
    canSeeAllFor("members:view_full", "members:view_masked", "members.balance:view_full")(req)
      ? null
      : eq(accounts.userId, req.user!.id),
});

const notificationPreferencesHandler: TableHandler = async ({ req, body }) => {
  if (!req.user) throw new ForbiddenError("PERMISSION_DENIED");
  if (body.op === "select") {
    const rows = await db
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, req.user.id));
    if (body.maybeSingle || body.single) return rows[0] ? snakeify(rows[0]) : null;
    return rows.map((r) => snakeify<Record<string, unknown>>(r));
  }
  if (body.op === "update" || body.op === "insert") {
    const v = (body.values ?? {}) as Record<string, unknown>;
    const payload = {
      userId: req.user.id,
      emailEnabled: v.email_enabled !== false,
      pushEnabled: v.push_enabled !== false,
      smsEnabled: !!v.sms_enabled,
      categories: (v.categories ?? {}) as Record<string, boolean>,
      updatedAt: new Date(),
    };
    await db
      .insert(notificationPreferences)
      .values(payload)
      .onConflictDoUpdate({ target: notificationPreferences.userId, set: payload });
    return null;
  }
  throw new AppError(400, "UNSUPPORTED_OP");
};

const topupRequestsHandler = genericReadHandler({
  table: topupRequests,
  permit: hasPerm("transactions:view_full", "transactions:view_masked"),
  filterCols: {
    user_id: topupRequests.userId,
    merchant_id: topupRequests.merchantId,
    status: topupRequests.status,
  },
  orderCols: { created_at: topupRequests.createdAt },
  defaultOrder: { col: topupRequests.createdAt, asc: false },
});
const withdrawRequestsHandler = genericReadHandler({
  table: withdrawRequests,
  permit: hasPerm("transactions:view_full", "transactions:view_masked"),
  filterCols: { user_id: withdrawRequests.userId, merchant_id: withdrawRequests.merchantId, status: withdrawRequests.status },
  orderCols: { created_at: withdrawRequests.createdAt },
  defaultOrder: { col: withdrawRequests.createdAt, asc: false },
});

const topupSessionsHandler = genericReadHandler({
  table: topupSessions,
  permit: (req) => hasPerm("transactions:view_full", "merchants:view_full")(req) || !!req.user,
  filterCols: {
    id: topupSessions.id,
    user_id: topupSessions.userId,
    merchant_id: topupSessions.merchantId,
    status: topupSessions.status,
  },
  orderCols: { created_at: topupSessions.createdAt },
  defaultOrder: { col: topupSessions.createdAt, asc: false },
  scopeRow: (req) =>
    canSeeAllFor("transactions:view_full", "merchants:view_full")(req)
      ? null
      : eq(topupSessions.userId, req.user!.id),
});
const withdrawSessionsHandler = genericReadHandler({
  table: withdrawSessions,
  permit: (req) => hasPerm("transactions:view_full", "merchants:view_full")(req) || !!req.user,
  filterCols: {
    id: withdrawSessions.id,
    user_id: withdrawSessions.userId,
    merchant_id: withdrawSessions.merchantId,
    status: withdrawSessions.status,
  },
  orderCols: { created_at: withdrawSessions.createdAt },
  defaultOrder: { col: withdrawSessions.createdAt, asc: false },
  scopeRow: (req) =>
    canSeeAllFor("transactions:view_full", "merchants:view_full")(req)
      ? null
      : eq(withdrawSessions.userId, req.user!.id),
});

const providerLedgerHandler = genericReadHandler({
  table: providerLedger,
  permit: hasPerm("transactions:view_full", "reconciliation:view"),
  filterCols: {
    provider_id: providerLedger.providerId,
    transaction_id: providerLedger.transactionId,
    user_id: providerLedger.userId,
    direction: providerLedger.direction,
    status: providerLedger.status,
  },
  orderCols: { created_at: providerLedger.createdAt },
  defaultOrder: { col: providerLedger.createdAt, asc: false },
});
const paymentRoutingRulesHandler = genericReadHandler({
  table: paymentRoutingRules,
  permit: hasPerm("finance_integrations:view", "settings:view"),
  filterCols: {
    method_type: paymentRoutingRules.methodType,
    direction: paymentRoutingRules.direction,
    merchant_id: paymentRoutingRules.merchantId,
    is_active: paymentRoutingRules.isActive,
  },
});

const errorDiagnosticsHandler = genericReadHandler({
  table: errorDiagnostics,
  permit: hasPerm("system_logs:view"),
  filterCols: { user_id: errorDiagnostics.userId, surface: errorDiagnostics.surface, error_code: errorDiagnostics.errorCode },
  orderCols: { created_at: errorDiagnostics.createdAt },
  defaultOrder: { col: errorDiagnostics.createdAt, asc: false },
});
const eventOutboxHandler = genericReadHandler({
  table: eventOutbox,
  permit: hasPerm("system_logs:view"),
  filterCols: { user_id: eventOutbox.userId, status: eventOutbox.status, channel: eventOutbox.channel },
  orderCols: { scheduled_for: eventOutbox.scheduledFor, created_at: eventOutbox.createdAt },
  defaultOrder: { col: eventOutbox.createdAt, asc: false },
});
const userSpecialDaysHandler = genericReadHandler({
  table: userSpecialDays,
  permit: (req) => hasPerm("members:view_full")(req) || !!req.user,
  filterCols: { user_id: userSpecialDays.userId, kind: userSpecialDays.kind },
  scopeRow: (req) =>
    canSeeAllFor("members:view_full")(req)
      ? null
      : eq(userSpecialDays.userId, req.user!.id),
});

// ============================== Dispatch ==============================
const HANDLERS: Record<string, TableHandler> = {
  // RBAC / identity
  user_roles: userRolesHandler,
  bo_permissions: boPermsHandler,
  user_permission_overrides: userPermOverridesHandler,
  user_login_ips: userLoginIpsHandler,
  profiles: profilesHandler,
  accounts: accountsHandler,
  user_special_days: userSpecialDaysHandler,

  // Notifications / templates
  notifications: notificationsHandler,
  notification_preferences: notificationPreferencesHandler,
  mail_templates: mailTemplatesHandler,
  telegram_templates: telegramTemplatesHandler,
  event_outbox: eventOutboxHandler,
  help_articles: helpArticlesHandler,
  suggestions: suggestionsHandler,

  // Chat
  chat_threads: chatThreadsHandler,
  chat_messages: chatMessagesHandler,
  chat_attachments: chatAttachmentsHandler,
  chat_profile_change_requests: chatPcrHandler,
  chat_canned_responses: chatCannedHandler,
  chat_routing_rules: chatRoutingHandler,

  // Merchants
  merchants: merchantsHandler,
  merchant_users: merchantUsersHandler,
  merchant_methods: merchantMethodsHandler,
  merchant_applications: merchantApplicationsHandler,
  merchant_api_calls: merchantApiCallsHandler,
  merchant_settlement_log: merchantSettlementLogHandler,
  merchant_cash_pool_log: merchantCashPoolLogHandler,
  merchant_cashout_methods: merchantCashoutMethodsHandler,
  merchant_cashout_sessions: merchantCashoutSessionsHandler,
  merchant_user_permission_overrides: merchantUserPermissionOverridesHandler,

  // Affiliate
  merchant_affiliates: merchantAffiliatesHandler,
  merchant_affiliate_links: merchantAffiliateLinksHandler,
  merchant_affiliate_payouts: merchantAffiliatePayoutsHandler,
  merchant_affiliate_ledger: merchantAffiliateLedgerHandler,

  // Payments / routing
  payment_providers: paymentProvidersHandler,
  payment_method_types: paymentMethodTypesHandler,
  payment_routing_rules: paymentRoutingRulesHandler,
  provider_ledger: providerLedgerHandler,

  // Transactions / sessions
  transactions: transactionsHandler,
  topup_requests: topupRequestsHandler,
  topup_sessions: topupSessionsHandler,
  withdraw_requests: withdrawRequestsHandler,
  withdraw_sessions: withdrawSessionsHandler,

  // Loyalty / referrals / profit-share
  loyalty_tiers: loyaltyTiersHandler,
  loyalty_rules: loyaltyRulesHandler,
  loyalty_points_log: loyaltyPointsLogHandler,
  referrals: referralsHandler,
  referral_config: referralConfigHandler,
  referral_rewards_log: referralRewardsLogHandler,
  profit_share_campaigns: profitShareCampaignsHandler,
  profit_share_allocations: profitShareAllocationsHandler,

  // System
  settings: settingsHandler,
  system_logs: systemLogsHandler,
  audit_log: auditLogHandler,
  error_diagnostics: errorDiagnosticsHandler,
};

export const fromRouter = Router();
fromRouter.use(requireAuth, loadUserPerms);

fromRouter.post("/:table", async (req, res) => {
  const table = req.params.table!;
  const handler = HANDLERS[table];
  if (!handler) {
    logger.warn({ table }, "from: table not exposed");
    res.json({ data: null, error: { code: "TABLE_NOT_EXPOSED", message: table } });
    return;
  }
  try {
    const body = FromBody.parse(req.body ?? {});
    const data = await handler({ req, body });
    res.json({ data, error: null });
  } catch (err) {
    if (err instanceof AppError) {
      res.json({
        data: null,
        error: { code: err.errorCode, message: err.message, statusCode: err.statusCode },
      });
      return;
    }
    if (err instanceof z.ZodError) {
      res.json({
        data: null,
        error: { code: "BAD_BODY", message: "BAD_BODY", statusCode: 400 },
      });
      return;
    }
    logger.error({ err, table }, "from handler error");
    res.json({ data: null, error: { code: "INTERNAL", message: "internal error" } });
  }
});
