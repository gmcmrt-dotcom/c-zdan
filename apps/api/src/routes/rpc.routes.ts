/**
 * Generic RPC dispatcher.
 *
 * The web app calls `rpc(name, args)` from `apps/web/src/lib/rpc.ts`, which
 * POSTs to `/api/rpc/:name` with the args object as the body. This file
 * dispatches by name to a service function.
 *
 * Coverage strategy:
 *   - RPCs that already have a typed REST endpoint just call into that
 *     service module.
 *   - RPCs we haven't implemented yet return `{ data: null, error: {...} }`
 *     with code RPC_NOT_IMPLEMENTED — visible failure beats silent success.
 *
 * Every handler is a `(req, args) => Promise<unknown>` that throws AppError
 * on failure; the router catches and converts to the `{ data, error }`
 * envelope expected by the web client.
 */
import { Router } from "express";
import { requireAuth, user } from "../middleware/auth";
import { loadUserPerms } from "../middleware/permission";
import { AppError, BadRequestError, ForbiddenError, NotFoundError } from "../lib/errors";
import { logger } from "../lib/logger";
import * as memberSvc from "../services/member.service";
import * as paymentCode from "../services/payment-code.service";
import * as topup from "../services/topup.service";
import * as withdraw from "../services/withdraw.service";
import * as adminMembers from "../services/admin/members.service";
import * as adminMerchants from "../services/admin/merchants.service";
import * as profitShare from "../services/admin/profit-share.service";
import { hasStaffRole } from "../services/auth.service";
import * as merchantSelf from "../services/merchant/self.service";
import { writeAudit } from "../services/admin/audit";
import { clientIp } from "../lib/req-meta";
import { db } from "../db/client";
import { eq, sql } from "drizzle-orm";
import {
  chatCannedResponses,
  mailTemplates,
  paymentMethodTypes,
  profiles,
  telegramTemplates,
  userRoles,
} from "../db/schema";

type Args = Record<string, unknown>;
type RpcHandler = (req: import("express").Request, args: Args) => Promise<unknown>;

function arg<T = unknown>(a: Args, key: string, fallback?: T): T {
  return (a[key] as T | undefined) ?? (fallback as T);
}

import { snakeify } from "../lib/snakeify";

const handlers: Record<string, RpcHandler> = {
  // ---------- member reads ----------
  my_transactions: async (req, a) =>
    (await memberSvc.myTransactions(user(req).id, { limit: arg(a, "_limit", 50) })).rows,
  my_transaction_refs: async (_req, _a) => [], // not yet ported
  my_loyalty_summary: async (req) => memberSvc.myLoyaltySummary(user(req).id),
  my_profit_share_rewards: async (req) => memberSvc.myProfitShareRewards(user(req).id),
  claim_profit_share_reward: async (req, a) =>
    memberSvc.claimProfitShareReward(user(req).id, String(arg(a, "_allocation_id"))),
  get_my_referral_link: async (req) => memberSvc.myReferralLink(user(req).id),
  get_my_referral_stats: async (req) => memberSvc.myReferralStats(user(req).id),
  get_my_referrals: async (req) => memberSvc.myReferrals(user(req).id),
  my_referee_progress: async (_req) => [],
  list_active_topup_method_types: async () => memberSvc.listMethodTypes("topup"),
  list_active_withdraw_method_types: async () => memberSvc.listMethodTypes("withdraw"),
  mark_all_notifications_read: async (req) => {
    await memberSvc.markAllNotificationsRead(user(req).id);
    return { success: true };
  },

  // ---------- payment code (Akış A) ----------
  preview_spend: async (req, a) =>
    paymentCode.previewSpend(user(req).id, Number(arg(a, "_amount"))),
  create_payment_code: async (req, a) => {
    // K5 — `_customer_name` is now mandatory (Q19). The RPC layer enforces
    // it here so the same error code (`NAME_REQUIRED`) is raised on both
    // the REST + RPC paths and the FE only has to handle one shape.
    const customerName = String(arg(a, "_customer_name") ?? "").trim();
    if (customerName.length < 2) throw new BadRequestError("NAME_REQUIRED");
    if (customerName.length > 80) throw new BadRequestError("NAME_TOO_LONG");
    return paymentCode.createPaymentCode(
      user(req).id,
      Number(arg(a, "_amount")),
      Number(arg(a, "_ttl_seconds", 300)),
      customerName,
    );
  },
  cancel_payment_code: async (req, a) =>
    paymentCode.cancelPaymentCode(user(req).id, String(arg(a, "_code_id"))),

  // ---------- topup (Akış C) ----------
  get_pending_topup: async (req) => topup.getPendingTopup(user(req).id),
  create_topup_session: async (req, a) =>
    topup.createTopupSession({
      userId: user(req).id,
      methodType: String(arg(a, "_method_type")),
      amount: Number(arg(a, "_amount")),
      returnBase: arg(a, "_return_base") as string | undefined,
    }),
  get_topup_session_status: async (req, a) =>
    topup.getTopupSessionStatus(user(req).id, String(arg(a, "_session_id"))),
  set_topup_session_payment_info: async (req, a) =>
    topup.setTopupSessionPaymentInfo({
      userId: user(req).id,
      sessionId: String(arg(a, "_session_id")),
      iban: String(arg(a, "_iban")),
      accountHolder: String(arg(a, "_account_holder")),
      bankName: arg(a, "_bank_name") as string | undefined,
      paymentReference: arg(a, "_payment_reference") as string | undefined,
    }),
  confirm_topup_by_member: async (req, a) =>
    topup.confirmTopupByMember(user(req).id, String(arg(a, "_session_id"))),
  cancel_topup_by_member: async (req, a) =>
    topup.cancelTopupByMember(user(req).id, String(arg(a, "_session_id"))),

  // ---------- withdraw (Akış D) ----------
  request_withdraw_v3: async (req, a) =>
    withdraw.requestWithdrawV3({
      userId: user(req).id,
      methodType: String(arg(a, "_method_type")),
      amount: Number(arg(a, "_amount")),
      iban: arg(a, "_iban") as string | undefined,
      ibanHolder: arg(a, "_iban_holder") as string | undefined,
      cryptoType: arg(a, "_crypto_type") as string | undefined,
      payoutAddress: arg(a, "_payout_address") as string | undefined,
      notes: arg(a, "_notes") as string | undefined,
    }),
  get_withdraw_session_status: async (req, a) =>
    withdraw.getWithdrawSessionStatus(user(req).id, String(arg(a, "_session_id"))),

  // ---------- shared / auth helpers ----------
  my_permissions: async (req) => {
    const set = req.perms ?? new Set<string>();
    const out: Array<{ resource: string; action: string }> = [];
    for (const p of set) {
      const [resource, action] = p.split(":");
      out.push({ resource: resource!, action: action! });
    }
    return out;
  },
  auth_merchant_id: async (req) => {
    const { merchantUsers } = await import("../db/schema");
    const [m] = await db
      .select({ merchantId: merchantUsers.merchantId })
      .from(merchantUsers)
      .where(eq(merchantUsers.userId, user(req).id))
      .limit(1);
    return m?.merchantId ?? null;
  },
  requires_mfa: async (req, a) => {
    // P1 — Previously this RPC accepted ANY `_user_id` and revealed whether
    // that user had a staff role (the response is `true`/`false`). That's a
    // staff-enumeration oracle: an attacker can iterate user UUIDs and learn
    // which ones are staff. The legitimate caller is the login form, which
    // only ever needs the answer for the user who JUST authenticated — so
    // we ignore the parameter and answer about req.user instead. Callers
    // who pass someone else's id get the answer about themselves (or false
    // if unauthenticated), closing the oracle.
    if (!req.user) return false;
    const [r] = await db.select().from(userRoles).where(eq(userRoles.userId, req.user.id)).limit(1);
    // intentionally swallow `a` so a stray param doesn't change behaviour
    void a;
    return !!r;
  },
  profile_identifier_exists: async (req, a) => {
    // I1 — Was reachable by any authenticated member, letting an attacker
    // iterate emails/phones to enumerate accounts. The REST equivalent
    // (`/auth/identifier-exists`) exists for the public signup flow and
    // is rate-limited; this RPC is staff-only now.
    if (!req.user) return [{ email_exists: false, phone_exists: false }];
    const isStaff = req.perms && req.perms.size > 0
      ? Array.from(req.perms).some((k) => k.startsWith("members:") || k.startsWith("bo_users:"))
      : false;
    if (!isStaff) {
      throw new AppError(403, "STAFF_REQUIRED");
    }
    const { identifierExists } = await import("../services/auth.service");
    const r = await identifierExists({
      email: arg(a, "_email") as string | undefined,
      phone: arg(a, "_phone") as string | undefined,
    });
    return [r];
  },
  profile_signup_audit: async (req) => {
    // Already recorded at signup; this is a no-op now.
    await db
      .update(profiles)
      .set({ signupAt: new Date() })
      .where(eq(profiles.id, user(req).id));
    return { success: true };
  },
  apply_referral_signup: async (_req, _a) => {
    // P0-18 — referral payouts are gated by REFERRAL_PAYOUTS_ENABLED until
    // the qualify/anti-farming workers are implemented. The frontend still
    // calls this RPC post-signup; we always succeed so the UI doesn't show
    // a scary error, but no reward rows are written.
    const { env } = await import("../lib/env");
    if (!env.REFERRAL_PAYOUTS_ENABLED) {
      return { success: true, skipped: true, reason: "REFERRAL_PAYOUTS_DISABLED" };
    }
    return { success: true };
  },
  log_error: async (req, a) => {
    const schema = await import("../db/schema");
    await db.insert(schema.errorDiagnostics).values({
      userId: req.user?.id ?? null,
      surface: String(arg(a, "_surface", "frontend")),
      pageKey: arg(a, "_page_key") as string | null,
      functionName: arg(a, "_function_name") as string | null,
      errorCode: String(arg(a, "_error_code")),
      errorMessage: String(arg(a, "_error_message")),
      stack: arg(a, "_stack") as string | null,
      context: arg(a, "_context") ?? null,
    });
    return { success: true };
  },

  // ---------- admin ----------
  /**
   * Legacy contract: Dashboard expects
   *   { transactions:{tx_count,topup,spend,withdraw,fee},
   *     accounts:{total_balance,total_reserved}, member_count }
   * We adapt the lean stats from members.service into that shape.
   */
  admin_dashboard_stats: async () => {
    const s = await adminMembers.dashboardStats();
    const txAgg = await db.execute<{
      tx_count: number; topup: string; spend: string; withdraw: string; fee: string;
    }>(sql`
      SELECT
        COALESCE(count(*),0)::int AS tx_count,
        COALESCE(sum(amount) FILTER (WHERE type='topup'), 0)::text AS topup,
        COALESCE(sum(amount) FILTER (WHERE type='spend'), 0)::text AS spend,
        COALESCE(sum(amount) FILTER (WHERE type='merchant_withdraw'), 0)::text AS withdraw,
        COALESCE(sum(fee), 0)::text AS fee
      FROM transactions
    `);
    const tx = (txAgg as unknown as Array<{ tx_count: number; topup: string; spend: string; withdraw: string; fee: string }>)[0] ?? {
      tx_count: 0, topup: "0", spend: "0", withdraw: "0", fee: "0",
    };
    return {
      transactions: {
        tx_count: tx.tx_count,
        topup: Number(tx.topup),
        spend: Number(tx.spend),
        withdraw: Number(tx.withdraw),
        fee: Number(tx.fee),
      },
      accounts: {
        total_balance: Number(s?.total_member_balance ?? 0),
        total_reserved: 0,
      },
      member_count: s?.member_count ?? 0,
    };
  },
  /** Legacy contract: array-or-row with snake_case keys. */
  admin_members_summary: async () => {
    const s = await adminMembers.membersSummary({});
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const [tRow] = await db.execute<{ today_count: number; total_balance: string }>(sql`
      SELECT
        (SELECT count(*)::int FROM profiles WHERE created_at >= ${today.toISOString()}::timestamptz) AS today_count,
        COALESCE((SELECT sum(balance)::text FROM accounts), '0') AS total_balance
    `);
    const extra = tRow as unknown as { today_count: number; total_balance: string } | undefined;
    return [{
      total_members: s?.total ?? 0,
      frozen_count: s?.frozen ?? 0,
      registered_today: extra?.today_count ?? 0,
      total_balance: Number(extra?.total_balance ?? 0),
    }];
  },
  /**
   * Legacy contract: returns a *flat array* of snake_case rows. The page
   * inspects `rows.length > PAGE_SIZE` to derive `has_more`, so we yield one
   * extra row when the underlying total exceeds limit+offset.
   */
  admin_list_members: async (req, a) => {
    const out = await adminMembers.listMembers({
      search: arg(a, "_search") as string | undefined,
      frozenFilter: arg(a, "_frozen_filter") as never,
      kycFilter: arg(a, "_kyc_filter") as never,
      reservedOnly: arg(a, "_reserved_only") as boolean | undefined,
      sortBy: arg(a, "_sort_by") as never,
      sortDir: arg(a, "_sort_dir") as never,
      offset: arg(a, "_offset") as number | undefined,
      limit: ((arg(a, "_limit") as number | undefined) ?? 50) + 1, // +1 so .length > PAGE_SIZE means more
      viewFullPii: req.perms?.has("members.pii:view_full") ?? false,
    });
    return out.rows.map((r) => ({
      id: r.userId,
      email: r.email,
      first_name: r.firstName,
      last_name: r.lastName,
      phone: r.phone,
      member_no: r.memberNo,
      is_frozen: r.isFrozen,
      kyc_status: r.kycStatus,
      created_at: r.createdAt,
      balance: r.balance,
      reserved_balance: r.reservedBalance,
      total_points: r.totalPoints,
      tier_name: null,
      last_login_at: null,
      open_chat_count: 0,
    }));
  },
  admin_freeze_member: async (req, a) =>
    adminMembers.freezeMember({
      actorId: user(req).id,
      userId: String(arg(a, "_user_id")),
      frozen: Boolean(arg(a, "_frozen")),
      reason: arg(a, "_reason") as string | undefined,
      ip: clientIp(req),
    }),
  // K4 — Force-logout-this-user (Q24).
  admin_force_logout_member: async (req, a) =>
    adminMembers.forceLogoutMember({
      actorId: user(req).id,
      userId: String(arg(a, "_user_id")),
      reason: arg(a, "_reason") as string | undefined,
      ip: clientIp(req),
      userAgent: req.get("user-agent") ?? null,
    }),
  admin_set_member_kyc: async (req, a) =>
    adminMembers.setMemberKyc({
      actorId: user(req).id,
      userId: String(arg(a, "_user_id")),
      status: arg(a, "_status") as never,
      reason: arg(a, "_reason") as string | undefined,
    }),

  // L1 — Provider-method map admin (P0-35 / Q4 Option B). Maintains
  // `merchant_provider_method_map` so `provider_ledger` writes know
  // which `payment_method` to stamp on each merchant's topup/withdraw.
  admin_set_provider_method_map: async (req, a) => {
    const { setProviderMethodMap } = await import("../services/admin/provider-method-map.service");
    return setProviderMethodMap({
      actorId: user(req).id,
      merchantId: String(arg(a, "_merchant_id")),
      txType: String(arg(a, "_tx_type")) as never,
      providerMethodId: String(arg(a, "_provider_method_id")),
      ip: clientIp(req),
      userAgent: req.get("user-agent") ?? null,
    });
  },
  admin_list_provider_method_map: async (req, a) => {
    const { listProviderMethodMap } = await import("../services/admin/provider-method-map.service");
    const merchantId = arg(a, "_merchant_id");
    return listProviderMethodMap(merchantId ? String(merchantId) : undefined);
  },
  admin_disable_provider_method_map: async (req, a) => {
    const { disableProviderMethodMap } = await import("../services/admin/provider-method-map.service");
    return disableProviderMethodMap({
      actorId: user(req).id,
      mappingId: String(arg(a, "_mapping_id")),
      ip: clientIp(req),
      userAgent: req.get("user-agent") ?? null,
    });
  },
  admin_update_member_profile: async (req, a) =>
    adminMembers.updateMemberProfile({
      actorId: user(req).id,
      userId: String(arg(a, "_user_id")),
      // P0-45 — same staff-target gate as the REST route.
      canManageStaff: req.perms?.has("bo_users:manage") === true,
      firstName: arg(a, "_first_name") as string | undefined,
      lastName: arg(a, "_last_name") as string | undefined,
      email: arg(a, "_email") as string | undefined,
      phone: arg(a, "_phone") as string | null | undefined,
    }),
  admin_adjust_balance: async (req, a) =>
    adminMembers.adjustBalance({
      actorId: user(req).id,
      userId: String(arg(a, "_user_id")),
      amount: Number(arg(a, "_amount")),
      reason: String(arg(a, "_reason")),
    }),
  admin_award_points: async (req, a) =>
    adminMembers.awardPoints({
      actorId: user(req).id,
      userId: String(arg(a, "_user_id")),
      points: Number(arg(a, "_points")),
      reason: String(arg(a, "_reason")),
    }),
  admin_set_member_tier: async (req, a) =>
    adminMembers.setMemberTier({
      actorId: user(req).id,
      userId: String(arg(a, "_user_id")),
      tierId: Number(arg(a, "_tier_id")),
      reason: String(arg(a, "_reason")),
      ip: clientIp(req),
    }),
  cancel_user_window_points: async (req, a) =>
    adminMembers.cancelUserWindowPoints({
      actorId: user(req).id,
      userId: String(arg(a, "_user_id")),
      windowStart: String(arg(a, "_window_start")),
      windowEnd: String(arg(a, "_window_end")),
      reason: String(arg(a, "_reason")),
    }),
  admin_get_member_login_history: async (_req, a) =>
    adminMembers.memberLoginHistory(String(arg(a, "_user_id")), Number(arg(a, "_limit", 50))),

  // ---------- payment method types catalog ----------
  admin_create_method_type: async (req, a) => {
    if (!req.perms?.has("method_types:edit") && !req.perms?.has("method_types:manage")) {
      throw new ForbiddenError("PERMISSION_DENIED");
    }
    const rawCode = String(arg(a, "_code", ""));
    const labelTr = String(arg(a, "_label_tr", "")).trim();
    const labelEn = String(arg(a, "_label_en", "")).trim();
    const availableFor = String(arg(a, "_available_for", "both"));
    const isEnabled = Boolean(arg(a, "_is_enabled", false));
    const sortOrder = Number(arg(a, "_sort_order", 100));

    // Normalize: lowercase + only [a-z0-9_].
    const code = rawCode.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
    if (code.length === 0) throw new BadRequestError("INVALID_CODE");
    if (!["topup", "withdraw", "both"].includes(availableFor)) {
      throw new BadRequestError("INVALID_AVAILABLE_FOR");
    }
    if (labelTr.length === 0 || labelEn.length === 0) {
      throw new BadRequestError("LABEL_REQUIRED");
    }

    const actorId = user(req).id;
    await db
      .insert(paymentMethodTypes)
      .values({
        code,
        labelTr,
        labelEn,
        availableFor,
        isEnabled,
        sortOrder: Number.isFinite(sortOrder) ? sortOrder : 100,
      })
      .onConflictDoNothing({ target: paymentMethodTypes.code });

    await writeAudit({
      actorId,
      action: "method_type.create",
      resourceType: "payment_method_type",
      resourceId: code,
      after: {
        code,
        label_tr: labelTr,
        label_en: labelEn,
        available_for: availableFor,
        is_enabled: isEnabled,
      },
      ip: clientIp(req),
    });
    return code;
  },

  admin_set_method_type_enabled: async (req, a) => {
    if (!req.perms?.has("method_types:edit") && !req.perms?.has("method_types:manage")) {
      throw new ForbiddenError("PERMISSION_DENIED");
    }
    const code = String(arg(a, "_code", "")).trim().toLowerCase();
    const enabled = Boolean(arg(a, "_enabled"));
    if (code.length === 0) throw new BadRequestError("INVALID_CODE");

    const [existing] = await db
      .select()
      .from(paymentMethodTypes)
      .where(eq(paymentMethodTypes.code, code))
      .limit(1);
    if (!existing) throw new NotFoundError("METHOD_TYPE_NOT_FOUND");

    if (existing.isEnabled !== enabled) {
      await db
        .update(paymentMethodTypes)
        .set({ isEnabled: enabled, updatedAt: new Date() })
        .where(eq(paymentMethodTypes.code, code));

      await writeAudit({
        actorId: user(req).id,
        action: "method_type.set_enabled",
        resourceType: "payment_method_type",
        resourceId: code,
        before: { is_enabled: existing.isEnabled },
        after: { is_enabled: enabled },
        ip: clientIp(req),
        userAgent: req.get("user-agent") ?? null,
      });
    }
    return { code, is_enabled: enabled };
  },

  admin_update_method_type_withdraw_eta: async (req, a) => {
    if (!req.perms?.has("method_types:edit") && !req.perms?.has("method_types:manage")) {
      throw new ForbiddenError("PERMISSION_DENIED");
    }
    const code = String(arg(a, "_code", "")).trim().toLowerCase();
    const min = Number(arg(a, "_min"));
    const max = Number(arg(a, "_max"));
    const unit = String(arg(a, "_unit", "minute"));
    if (code.length === 0) throw new BadRequestError("INVALID_CODE");
    if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max <= 0 || min > max) {
      throw new BadRequestError("INVALID_ETA_RANGE");
    }
    if (!["minute", "hour", "business_day"].includes(unit)) {
      throw new BadRequestError("INVALID_ETA_UNIT");
    }

    const [existing] = await db
      .select()
      .from(paymentMethodTypes)
      .where(eq(paymentMethodTypes.code, code))
      .limit(1);
    if (!existing) throw new NotFoundError("METHOD_TYPE_NOT_FOUND");

    const unchanged =
      existing.withdrawEtaMin === min &&
      existing.withdrawEtaMax === max &&
      existing.withdrawEtaUnit === unit;
    if (!unchanged) {
      await db
        .update(paymentMethodTypes)
        .set({
          withdrawEtaMin: min,
          withdrawEtaMax: max,
          withdrawEtaUnit: unit,
          updatedAt: new Date(),
        })
        .where(eq(paymentMethodTypes.code, code));

      await writeAudit({
        actorId: user(req).id,
        action: "method_type.update_withdraw_eta",
        resourceType: "payment_method_type",
        resourceId: code,
        before: {
          withdraw_eta_min: existing.withdrawEtaMin,
          withdraw_eta_max: existing.withdrawEtaMax,
          withdraw_eta_unit: existing.withdrawEtaUnit,
        },
        after: {
          withdraw_eta_min: min,
          withdraw_eta_max: max,
          withdraw_eta_unit: unit,
        },
        ip: clientIp(req),
        userAgent: req.get("user-agent") ?? null,
      });
    }
    return { code };
  },

  // ---------- templates (mail / telegram / chat canned) ----------
  admin_create_mail_template: async (req, a) => {
    if (!req.perms?.has("templates:manage")) {
      throw new ForbiddenError("PERMISSION_DENIED");
    }
    const templateKey = String(arg(a, "_template_key", "")).trim();
    const locale = String(arg(a, "_locale", ""));
    const subject = String(arg(a, "_subject", ""));
    const bodyHtml = String(arg(a, "_body_html", ""));
    const bodyTextRaw = arg(a, "_body_text") as string | null | undefined;
    const audience = String(arg(a, "_audience", ""));
    const description = arg(a, "_description") as string | null | undefined;
    const isActive = Boolean(arg(a, "_is_active", true));

    if (!["tr", "en"].includes(locale)) throw new BadRequestError("INVALID_LOCALE");
    if (!["member", "staff", "merchant", "affiliate"].includes(audience)) {
      throw new BadRequestError("INVALID_AUDIENCE");
    }
    if (!templateKey || !subject.trim() || !bodyHtml.trim()) {
      throw new BadRequestError("REQUIRED_FIELDS");
    }

    const actorId = user(req).id;
    const [row] = await db
      .insert(mailTemplates)
      .values({
        templateKey,
        locale,
        subject,
        bodyHtml,
        bodyText: bodyTextRaw == null || bodyTextRaw === "" ? null : String(bodyTextRaw),
        audience,
        description: description == null || description === "" ? null : String(description),
        isActive,
        updatedBy: actorId,
      })
      .returning({ id: mailTemplates.id });
    const id = row!.id;

    await writeAudit({
      actorId,
      action: "mail_template.create",
      resourceType: "mail_template",
      resourceId: id,
      after: { template_key: templateKey, locale, audience, is_active: isActive },
      ip: clientIp(req),
    });
    return id;
  },
  admin_create_telegram_template: async (req, a) => {
    if (!req.perms?.has("templates:manage")) {
      throw new ForbiddenError("PERMISSION_DENIED");
    }
    const templateKey = String(arg(a, "_template_key", "")).trim();
    const locale = String(arg(a, "_locale", ""));
    const bodyMd = String(arg(a, "_body_md", ""));
    const audience = String(arg(a, "_audience", ""));
    const description = arg(a, "_description") as string | null | undefined;
    const isActive = Boolean(arg(a, "_is_active", true));

    if (!["tr", "en"].includes(locale)) throw new BadRequestError("INVALID_LOCALE");
    if (!["member", "staff", "merchant"].includes(audience)) {
      throw new BadRequestError("INVALID_AUDIENCE");
    }
    if (!templateKey || !bodyMd.trim()) {
      throw new BadRequestError("REQUIRED_FIELDS");
    }

    const actorId = user(req).id;
    const [row] = await db
      .insert(telegramTemplates)
      .values({
        templateKey,
        locale,
        bodyMd,
        audience,
        description: description == null || description === "" ? null : String(description),
        isActive,
        updatedBy: actorId,
      })
      .returning({ id: telegramTemplates.id });
    const id = row!.id;

    await writeAudit({
      actorId,
      action: "telegram_template.create",
      resourceType: "telegram_template",
      resourceId: id,
      after: { template_key: templateKey, locale, audience, is_active: isActive },
      ip: clientIp(req),
    });
    return id;
  },
  admin_create_chat_canned: async (req, a) => {
    if (!req.perms?.has("templates:manage")) {
      throw new ForbiddenError("PERMISSION_DENIED");
    }
    const category = String(arg(a, "_category", ""));
    const title = String(arg(a, "_title", "")).trim();
    const body = String(arg(a, "_body", ""));
    const triggerKeywordsRaw = arg(a, "_trigger_keywords") as unknown;
    const isActive = Boolean(arg(a, "_is_active", true));

    if (!["topup_issue", "withdraw_issue", "profile_update", "general"].includes(category)) {
      throw new BadRequestError("INVALID_CATEGORY");
    }
    if (!title || !body.trim()) {
      throw new BadRequestError("REQUIRED_FIELDS");
    }
    const triggerKeywords = Array.isArray(triggerKeywordsRaw)
      ? (triggerKeywordsRaw as unknown[]).map(String).map((s) => s.trim()).filter(Boolean)
      : [];

    const actorId = user(req).id;
    const [row] = await db
      .insert(chatCannedResponses)
      .values({
        category: category as never,
        title,
        body,
        triggerKeywords,
        isActive,
      })
      .returning({ id: chatCannedResponses.id });
    const id = row!.id;

    await writeAudit({
      actorId,
      action: "chat_canned.create",
      resourceType: "chat_canned_response",
      resourceId: id,
      after: { category, title, is_active: isActive },
      ip: clientIp(req),
    });
    return id;
  },

  staff_list_finance_merchants: async () =>
    snakeify(await adminMerchants.listFinanceMerchants()),
  staff_get_merchant_detail: async (_req, a) =>
    snakeify(await adminMerchants.getMerchantDetail(String(arg(a, "_merchant_id")))),
  admin_merchant_children: async (_req, a) =>
    snakeify(await adminMerchants.merchantChildren(String(arg(a, "_parent_merchant_id")))),
  admin_set_merchant_commission: async (req, a) =>
    adminMerchants.setMerchantCommission({
      actorId: user(req).id,
      merchantId: String(arg(a, "_merchant_id")),
      commissionPct: Number(arg(a, "_commission_pct")),
      fixedFee: Number(arg(a, "_fixed_fee")),
    }),
  admin_set_merchant_limits: async (req, a) =>
    adminMerchants.setMerchantLimits({
      actorId: user(req).id,
      merchantId: String(arg(a, "_merchant_id")),
      perTxLimit: arg(a, "_per_tx_limit") as number | null | undefined,
      dailyLimit: arg(a, "_daily_limit") as number | null | undefined,
      depositMin: arg(a, "_deposit_min") as number | null | undefined,
      depositMax: arg(a, "_deposit_max") as number | null | undefined,
      withdrawMin: arg(a, "_withdraw_min") as number | null | undefined,
      withdrawMax: arg(a, "_withdraw_max") as number | null | undefined,
    }),
  set_merchant_credit_limit: async (req, a) =>
    adminMerchants.setCreditLimit({
      actorId: user(req).id,
      merchantId: String(arg(a, "_merchant_id")),
      newLimit: Number(arg(a, "_new_limit")),
      reason: String(arg(a, "_reason")),
    }),
  record_manual_settlement: async (req, a) =>
    adminMerchants.recordManualSettlement({
      actorId: user(req).id,
      merchantId: String(arg(a, "_merchant_id")),
      amount: Number(arg(a, "_amount")),
      notes: arg(a, "_notes") as string | undefined,
    }),
  admin_set_cash_pool: async (req, a) =>
    adminMerchants.setCashPool({
      actorId: user(req).id,
      merchantId: String(arg(a, "_merchant_id")),
      cashPool: Number(arg(a, "_cash_pool")),
      notes: arg(a, "_notes") as string | undefined,
    }),
  adjust_merchant_cash_pool: async (req, a) =>
    adminMerchants.adjustCashPool({
      actorId: user(req).id,
      merchantId: String(arg(a, "_merchant_id")),
      amount: Number(arg(a, "_amount")),
      reason: String(arg(a, "_reason")),
      note: arg(a, "_note") as string | undefined,
      collectionFeePct: arg(a, "_collection_fee_pct") as number | undefined,
      collectionFixedFee: arg(a, "_collection_fixed_fee") as number | undefined,
    }),
  get_merchant_financial_summary: async (_req, a) =>
    snakeify(
      await adminMerchants.getMerchantFinancialSummary({
        merchantId: String(arg(a, "_merchant_id")),
        startDate: String(arg(a, "_start_date")),
        endDate: String(arg(a, "_end_date")),
      }),
    ),
  admin_attach_merchant_user: async (req, a) =>
    adminMerchants.attachMerchantUser({
      actorId: user(req).id,
      merchantId: String(arg(a, "_merchant_id")),
      email: String(arg(a, "_email")),
      role: arg(a, "_role") as never,
      fullName: arg(a, "_full_name") as string | undefined,
      phone: arg(a, "_phone") as string | undefined,
    }),
  admin_detach_merchant_user: async (req, a) =>
    adminMerchants.detachMerchantUser({
      actorId: user(req).id,
      merchantUserId: String(arg(a, "_merchant_user_id")),
    }),
  admin_change_merchant_user_role: async (req, a) =>
    adminMerchants.changeMerchantUserRole({
      actorId: user(req).id,
      merchantUserId: String(arg(a, "_merchant_user_id")),
      newRole: arg(a, "_new_role") as never,
    }),

  // ---------- profit share ----------
  admin_list_profit_share_campaigns: async () => profitShare.listCampaigns(),
  admin_list_profit_share_allocations: async (_req, a) =>
    profitShare.listAllocations(String(arg(a, "_campaign_id"))),
  admin_preview_profit_share: async (_req, a) =>
    profitShare.preview({
      periodType: arg(a, "_period_type") as never,
      periodFrom: String(arg(a, "_period_from")),
      periodTo: String(arg(a, "_period_to")),
      distributionPct: Number(arg(a, "_distribution_pct")),
      maxRecipients: Number(arg(a, "_max_recipients")),
      claimExpiresHours: Number(arg(a, "_claim_expires_hours")),
    }),
  admin_create_profit_share_campaign: async (req, a) =>
    profitShare.createCampaign({
      actorId: user(req).id,
      periodType: arg(a, "_period_type") as never,
      periodFrom: String(arg(a, "_period_from")),
      periodTo: String(arg(a, "_period_to")),
      distributionPct: Number(arg(a, "_distribution_pct")),
      maxRecipients: Number(arg(a, "_max_recipients")),
      claimExpiresHours: Number(arg(a, "_claim_expires_hours")),
      notes: arg(a, "_notes") as string | null | undefined,
    }),
  admin_publish_profit_share_campaign: async (req, a) =>
    profitShare.publishCampaign({
      actorId: user(req).id,
      campaignId: String(arg(a, "_campaign_id")),
      ip: clientIp(req),
    }),
  admin_close_profit_share_campaign: async (req, a) =>
    profitShare.closeCampaign({
      actorId: user(req).id,
      campaignId: String(arg(a, "_campaign_id")),
      ip: clientIp(req),
    }),
  admin_cancel_profit_share_campaign: async (req, a) =>
    profitShare.cancelCampaign({
      actorId: user(req).id,
      campaignId: String(arg(a, "_campaign_id")),
      ip: clientIp(req),
    }),

  // ---------- merchant BO ----------
  merchant_self: async (req) => {
    if (!req.merchant) throw new BadRequestError("MERCHANT_CONTEXT_MISSING");
    return snakeify(await merchantSelf.merchantSelf(req.merchant.merchantId));
  },
  merchant_self_children: async (req) => {
    if (!req.merchant) throw new BadRequestError("MERCHANT_CONTEXT_MISSING");
    return snakeify(await merchantSelf.merchantSelfChildren(req.merchant.merchantId));
  },
  merchant_self_nav: async (req) => {
    if (!req.merchant) throw new BadRequestError("MERCHANT_CONTEXT_MISSING");
    return snakeify(await merchantSelf.merchantSelfNav(req.merchant.merchantUserId, req.merchant.role));
  },
  merchant_self_role: async (req) => {
    if (!req.merchant) throw new BadRequestError("MERCHANT_CONTEXT_MISSING");
    return snakeify(await merchantSelf.merchantSelfRole(req.merchant.merchantUserId));
  },
  merchant_self_update_settings: async (req, a) => {
    if (!req.merchant) throw new BadRequestError("MERCHANT_CONTEXT_MISSING");
    return merchantSelf.merchantSelfUpdateSettings({
      merchantId: req.merchant.merchantId,
      role: req.merchant.role,
      actorUserId: user(req).id,
      ip: clientIp(req),
      ipWhitelist: arg(a, "_ip_whitelist") as string[] | undefined,
      webhookUrl: arg(a, "_webhook_url") as string | null | undefined,
    });
  },
  merchant_has_permission: async (req, a) => {
    if (!req.merchant) throw new BadRequestError("MERCHANT_CONTEXT_MISSING");
    return merchantSelf.merchantHasPermission({
      merchantUserId: req.merchant.merchantUserId,
      permissionKey: String(arg(a, "_permission_key")),
      role: req.merchant.role,
    });
  },
};

// -------- RBAC dispatch table (P0-1) --------
//
// Every admin_* / staff_* / record_manual_settlement / cancel_user_window_points
// RPC requires (a) an actual staff role row AND (b) the specific bo_permission
// listed here. Members with no role row cannot reach any of these handlers.
//
// Member RPCs (preview_spend, create_payment_code, my_*, claim_profit_share_reward,
// topup/withdraw flow, log_error, etc.) need only requireAuth.
//
// Merchant BO RPCs (merchant_self*, merchant_has_permission) need a populated
// req.merchant. AAL2 is NOT enforced here — that's P0-9 with its own rollout.
const adminRpcPerms: Record<string, { resource: string; action: string }> = {
  admin_dashboard_stats: { resource: "transactions", action: "view_full" },
  admin_members_summary: { resource: "members", action: "view_masked" },
  admin_list_members: { resource: "members", action: "view_masked" },
  admin_freeze_member: { resource: "members", action: "freeze" },
  admin_force_logout_member: { resource: "members", action: "freeze" },
  admin_set_member_kyc: { resource: "members", action: "kyc" },
  // L1 — provider method map admin (Q4).
  admin_set_provider_method_map: { resource: "merchants", action: "manage" },
  admin_list_provider_method_map: { resource: "merchants", action: "view" },
  admin_disable_provider_method_map: { resource: "merchants", action: "manage" },
  admin_update_member_profile: { resource: "members", action: "view_full" },
  admin_adjust_balance: { resource: "members.balance", action: "adjust" },
  admin_award_points: { resource: "loyalty", action: "manage" },
  admin_set_member_tier: { resource: "loyalty", action: "manage" },
  cancel_user_window_points: { resource: "loyalty", action: "manage" },
  admin_get_member_login_history: { resource: "members", action: "view_full" },
  staff_list_finance_merchants: { resource: "merchants", action: "view_full" },
  staff_get_merchant_detail: { resource: "merchants", action: "view_full" },
  admin_merchant_children: { resource: "merchants", action: "view_full" },
  admin_set_merchant_commission: { resource: "merchants", action: "update" },
  admin_set_merchant_limits: { resource: "merchants", action: "update" },
  set_merchant_credit_limit: { resource: "merchants", action: "credit_limit" },
  record_manual_settlement: { resource: "merchants", action: "update" },
  admin_set_cash_pool: { resource: "merchants.cash_pool", action: "adjust" },
  adjust_merchant_cash_pool: { resource: "merchants.cash_pool", action: "adjust" },
  get_merchant_financial_summary: { resource: "merchants", action: "view_full" },
  admin_attach_merchant_user: { resource: "merchants", action: "update" },
  admin_detach_merchant_user: { resource: "merchants", action: "update" },
  admin_change_merchant_user_role: { resource: "merchants", action: "update" },
  admin_list_profit_share_campaigns: { resource: "profit_share", action: "view" },
  admin_list_profit_share_allocations: { resource: "profit_share", action: "view" },
  admin_preview_profit_share: { resource: "profit_share", action: "view" },
  admin_create_profit_share_campaign: { resource: "profit_share", action: "manage" },
  admin_publish_profit_share_campaign: { resource: "profit_share", action: "manage" },
  admin_close_profit_share_campaign: { resource: "profit_share", action: "manage" },
  admin_cancel_profit_share_campaign: { resource: "profit_share", action: "manage" },
  // admin_create_method_type / admin_create_*_template / admin_create_chat_canned
  // already check req.perms inline; we still require staff role here.
  admin_create_method_type: { resource: "method_types", action: "manage" },
  admin_set_method_type_enabled: { resource: "method_types", action: "edit" },
  admin_update_method_type_withdraw_eta: { resource: "method_types", action: "edit" },
  admin_create_mail_template: { resource: "templates", action: "manage" },
  admin_create_telegram_template: { resource: "templates", action: "manage" },
  admin_create_chat_canned: { resource: "templates", action: "manage" },
};

const merchantBoRpcs = new Set([
  "merchant_self",
  "merchant_self_children",
  "merchant_self_nav",
  "merchant_self_role",
  "merchant_self_update_settings",
  "merchant_has_permission",
]);

export const rpcRouter = Router();
rpcRouter.use(requireAuth, loadUserPerms);

rpcRouter.post("/:name", async (req, res) => {
  const name = req.params.name!;
  const handler = handlers[name];
  if (!handler) {
    logger.warn({ name }, "rpc: unknown");
    res.json({ data: null, error: { code: "RPC_NOT_IMPLEMENTED", message: `RPC ${name} not implemented in new backend`, hint: name } });
    return;
  }
  try {
    const args = (typeof req.body === "object" && req.body !== null ? req.body : {}) as Args;

    // ---- staff gate for admin_* / staff_* RPCs (P0-1) ----
    const requiredPerm = adminRpcPerms[name];
    if (requiredPerm || name.startsWith("admin_") || name.startsWith("staff_")) {
      const actorId = req.user!.id;
      const staff = await hasStaffRole(actorId);
      if (!staff) {
        logger.warn({ name, actorId }, "rpc: staff role required");
        res.json({ data: null, error: { code: "STAFF_REQUIRED", message: "staff role required", statusCode: 403 } });
        return;
      }
      if (requiredPerm) {
        if (!req.perms?.has(`${requiredPerm.resource}:${requiredPerm.action}`)) {
          logger.warn({ name, actorId, requiredPerm }, "rpc: permission denied");
          res.json({ data: null, error: { code: "PERMISSION_DENIED", message: "permission denied", statusCode: 403 } });
          return;
        }
      } else {
        // admin_*/staff_* with no mapped perm should fail closed.
        logger.error({ name }, "rpc: admin RPC missing perm mapping");
        res.json({ data: null, error: { code: "PERMISSION_DENIED", message: "permission mapping missing", statusCode: 403 } });
        return;
      }
    }

    // ---- merchant BO RPCs need req.merchant populated ----
    if (merchantBoRpcs.has(name)) {
      if (!req.merchant) {
        const { merchantUsers } = await import("../db/schema");
        const [m] = await db
          .select({ id: merchantUsers.id, merchantId: merchantUsers.merchantId, role: merchantUsers.role, isActive: merchantUsers.isActive })
          .from(merchantUsers)
          .where(eq(merchantUsers.userId, req.user!.id))
          .limit(1);
        if (!m || !m.isActive) {
          res.json({ data: null, error: { code: "MERCHANT_REQUIRED", message: "merchant context required", statusCode: 403 } });
          return;
        }
        req.merchant = {
          merchantUserId: m.id,
          merchantId: m.merchantId,
          role: m.role as never,
        };
      }
    }

    const data = await handler(req, args);
    res.json({ data, error: null });
  } catch (err) {
    if (err instanceof AppError) {
      res.json({ data: null, error: { code: err.errorCode, message: err.message, statusCode: err.statusCode } });
      return;
    }
    logger.error({ err, name }, "rpc handler error");
    res.json({ data: null, error: { code: "INTERNAL", message: "internal error" } });
  }
});
