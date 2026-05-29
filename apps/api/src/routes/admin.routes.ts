import { Router } from "express";
import { z } from "zod";
import { loadUserPerms, requirePerm } from "../middleware/permission";
import { requireAuth, requireStaff, user } from "../middleware/auth";
import * as members from "../services/admin/members.service";
import * as merchants from "../services/admin/merchants.service";
import { adminCreateUser } from "../services/admin/users.service";
import { boAiAssistant } from "../services/bo-ai.service";
import { exportCashPoolHtml, exportSettlementHtml } from "../services/exports.service";
import {
  getLedgerIntegrityRun,
  listLedgerIntegrityRuns,
  runLedgerIntegrityChecks,
} from "../services/ledger-integrity.service";
import { clientIp } from "../lib/req-meta";

export const adminRouter = Router();
adminRouter.use(requireAuth, requireStaff(), loadUserPerms);

// ------------------- dashboard -------------------
adminRouter.get("/dashboard/stats", requirePerm("transactions", "view_full"), async (req, res, next) => {
  try {
    const q = z.object({ since: z.string().optional(), until: z.string().optional() }).parse(req.query);
    res.json(await members.dashboardStats(q.since, q.until));
  } catch (e) { next(e); }
});

// ------------------- members -------------------
adminRouter.get("/members", requirePerm("members", "view_masked"), async (req, res, next) => {
  try {
    const q = z
      .object({
        search: z.string().optional(),
        frozenFilter: z.enum(["all", "frozen", "active"]).optional(),
        kycFilter: z.enum(["all", "none", "pending", "verified", "rejected"]).optional(),
        createdFrom: z.string().optional(),
        createdTo: z.string().optional(),
        reservedOnly: z.coerce.boolean().optional(),
        sortBy: z.enum(["created_at", "member_no", "email"]).optional(),
        sortDir: z.enum(["asc", "desc"]).optional(),
        offset: z.coerce.number().int().nonnegative().optional(),
        limit: z.coerce.number().int().min(1).max(200).optional(),
      })
      .parse(req.query);
    // P1 — only callers with `members.pii:view_full` get email/phone in
    // clear; everyone else (members.pii:view_masked or no perm) gets the
    // masked DTO from the service.
    const viewFullPii = req.perms?.has("members.pii:view_full") ?? false;
    res.json(await members.listMembers({ ...q, viewFullPii }));
  } catch (e) { next(e); }
});

adminRouter.get("/members/summary", requirePerm("members", "view_masked"), async (req, res, next) => {
  try {
    res.json(await members.membersSummary({}));
  } catch (e) { next(e); }
});

adminRouter.post("/members/:id/freeze", requirePerm("members", "freeze"), async (req, res, next) => {
  try {
    const b = z.object({ frozen: z.boolean(), reason: z.string().optional() }).parse(req.body);
    res.json(
      await members.freezeMember({
        actorId: user(req).id,
        userId: req.params.id!,
        frozen: b.frozen,
        reason: b.reason ?? null,
        ip: clientIp(req),
      }),
    );
  } catch (e) { next(e); }
});

adminRouter.post("/members/:id/kyc", requirePerm("members", "kyc"), async (req, res, next) => {
  try {
    const b = z
      .object({
        status: z.enum(["none", "pending", "verified", "rejected"]),
        reason: z.string().optional(),
      })
      .parse(req.body);
    res.json(
      await members.setMemberKyc({
        actorId: user(req).id,
        userId: req.params.id!,
        status: b.status,
        reason: b.reason ?? null,
        ip: clientIp(req),
      }),
    );
  } catch (e) { next(e); }
});

adminRouter.patch("/members/:id/profile", requirePerm("members", "view_full"), async (req, res, next) => {
  try {
    const b = z
      .object({
        firstName: z.string().optional(),
        lastName: z.string().optional(),
        email: z.string().email().optional(),
        phone: z.string().nullable().optional(),
      })
      .parse(req.body);
    res.json(
      await members.updateMemberProfile({
        actorId: user(req).id,
        userId: req.params.id!,
        // P0-45 — only callers with bo_users:manage can edit a staff user.
        // Without this gate, any admin with members:view_full could rewrite
        // another admin's email and chain a password reset to take it over.
        canManageStaff: req.perms?.has("bo_users:manage") === true,
        ...b,
        ip: clientIp(req),
      }),
    );
  } catch (e) { next(e); }
});

adminRouter.post("/members/:id/balance/adjust", requirePerm("members.balance", "adjust"), async (req, res, next) => {
  try {
    const b = z.object({ amount: z.coerce.number(), reason: z.string().min(1) }).parse(req.body);
    res.json(
      await members.adjustBalance({
        actorId: user(req).id,
        userId: req.params.id!,
        amount: b.amount,
        reason: b.reason,
        ip: clientIp(req),
      }),
    );
  } catch (e) { next(e); }
});

adminRouter.post("/members/:id/points/award", requirePerm("loyalty", "manage"), async (req, res, next) => {
  try {
    const b = z.object({ points: z.coerce.number().int(), reason: z.string().min(1) }).parse(req.body);
    res.json(
      await members.awardPoints({
        actorId: user(req).id,
        userId: req.params.id!,
        points: b.points,
        reason: b.reason,
        ip: clientIp(req),
      }),
    );
  } catch (e) { next(e); }
});

adminRouter.post("/members/:id/tier", requirePerm("loyalty", "manage"), async (req, res, next) => {
  try {
    const b = z
      .object({ tierId: z.coerce.number().int().positive(), reason: z.string().min(1) })
      .parse(req.body);
    res.json(
      await members.setMemberTier({
        actorId: user(req).id,
        userId: req.params.id!,
        tierId: b.tierId,
        reason: b.reason,
        ip: clientIp(req),
      }),
    );
  } catch (e) { next(e); }
});

adminRouter.post("/members/:id/points/cancel-window", requirePerm("loyalty", "manage"), async (req, res, next) => {
  try {
    const b = z
      .object({
        windowStart: z.string(),
        windowEnd: z.string(),
        reason: z.string().min(1),
      })
      .parse(req.body);
    res.json(
      await members.cancelUserWindowPoints({
        actorId: user(req).id,
        userId: req.params.id!,
        ...b,
        ip: clientIp(req),
      }),
    );
  } catch (e) { next(e); }
});

adminRouter.get("/members/:id/login-history", requirePerm("members", "view_masked"), async (req, res, next) => {
  try {
    const q = z.object({ limit: z.coerce.number().int().min(1).max(200).optional() }).parse(req.query);
    res.json({ rows: await members.memberLoginHistory(req.params.id!, q.limit) });
  } catch (e) { next(e); }
});

// ------------------- merchants -------------------
adminRouter.get("/merchants", requirePerm("merchants", "view_full"), async (req, res, next) => {
  try {
    const q = z.object({ type: z.enum(["commerce", "finance"]).optional() }).parse(req.query);
    res.json({ rows: await merchants.listMerchants(q) });
  } catch (e) { next(e); }
});

adminRouter.get("/merchants/:id", requirePerm("merchants", "view_full"), async (req, res, next) => {
  try {
    res.json(await merchants.getMerchantDetail(req.params.id!));
  } catch (e) { next(e); }
});

adminRouter.get("/merchants/:id/children", requirePerm("merchants", "view_full"), async (req, res, next) => {
  try {
    res.json({ rows: await merchants.merchantChildren(req.params.id!) });
  } catch (e) { next(e); }
});

adminRouter.get("/merchants/:id/financial-summary", requirePerm("merchants", "view_full"), async (req, res, next) => {
  try {
    const q = z
      .object({ startDate: z.string(), endDate: z.string() })
      .parse(req.query);
    res.json(await merchants.getMerchantFinancialSummary({ merchantId: req.params.id!, ...q }));
  } catch (e) { next(e); }
});

adminRouter.post("/merchants", requirePerm("merchants", "create"), async (req, res, next) => {
  try {
    const b = z
      .object({
        name: z.string().min(1),
        type: z.enum(["commerce", "finance"]),
        commissionPct: z.coerce.number().min(0).max(100).optional(),
        fixedFee: z.coerce.number().min(0).optional(),
        notes: z.string().optional(),
      })
      .parse(req.body);
    res.status(201).json(
      await merchants.adminCreateMerchant({
        actorId: user(req).id,
        ...b,
        ip: clientIp(req),
      }),
    );
  } catch (e) { next(e); }
});

adminRouter.post("/merchants/:id/rotate-secret", requirePerm("merchants", "update"), async (req, res, next) => {
  try {
    res.json(
      await merchants.adminRotateMerchantSecret({
        actorId: user(req).id,
        merchantId: req.params.id!,
        ip: clientIp(req),
      }),
    );
  } catch (e) { next(e); }
});

adminRouter.post("/merchants/:id/commission", requirePerm("merchants", "update"), async (req, res, next) => {
  try {
    const b = z.object({ commissionPct: z.coerce.number(), fixedFee: z.coerce.number() }).parse(req.body);
    res.json(
      await merchants.setMerchantCommission({
        actorId: user(req).id,
        merchantId: req.params.id!,
        ...b,
        ip: clientIp(req),
      }),
    );
  } catch (e) { next(e); }
});

adminRouter.post("/merchants/:id/limits", requirePerm("merchants", "update"), async (req, res, next) => {
  try {
    const b = z
      .object({
        perTxLimit: z.coerce.number().nullable().optional(),
        dailyLimit: z.coerce.number().nullable().optional(),
        depositMin: z.coerce.number().nullable().optional(),
        depositMax: z.coerce.number().nullable().optional(),
        withdrawMin: z.coerce.number().nullable().optional(),
        withdrawMax: z.coerce.number().nullable().optional(),
      })
      .parse(req.body);
    res.json(
      await merchants.setMerchantLimits({
        actorId: user(req).id,
        merchantId: req.params.id!,
        ...b,
        ip: clientIp(req),
      }),
    );
  } catch (e) { next(e); }
});

adminRouter.post("/merchants/:id/credit-limit", requirePerm("merchants", "credit_limit"), async (req, res, next) => {
  try {
    const b = z.object({ newLimit: z.coerce.number(), reason: z.string().min(1) }).parse(req.body);
    res.json(
      await merchants.setCreditLimit({
        actorId: user(req).id,
        merchantId: req.params.id!,
        ...b,
        ip: clientIp(req),
      }),
    );
  } catch (e) { next(e); }
});

adminRouter.post("/merchants/:id/manual-settlement", requirePerm("merchants", "update"), async (req, res, next) => {
  try {
    const b = z.object({ amount: z.coerce.number(), notes: z.string().optional() }).parse(req.body);
    res.json(
      await merchants.recordManualSettlement({
        actorId: user(req).id,
        merchantId: req.params.id!,
        ...b,
        ip: clientIp(req),
      }),
    );
  } catch (e) { next(e); }
});

adminRouter.post("/merchants/:id/cash-pool", requirePerm("merchants.cash_pool", "adjust"), async (req, res, next) => {
  try {
    const b = z.object({ cashPool: z.coerce.number(), notes: z.string().optional() }).parse(req.body);
    res.json(
      await merchants.setCashPool({
        actorId: user(req).id,
        merchantId: req.params.id!,
        ...b,
        ip: clientIp(req),
      }),
    );
  } catch (e) { next(e); }
});

adminRouter.post("/merchants/:id/cash-pool/adjust", requirePerm("merchants.cash_pool", "adjust"), async (req, res, next) => {
  try {
    const b = z
      .object({
        amount: z.coerce.number(),
        reason: z.string().min(1),
        note: z.string().optional(),
        collectionFeePct: z.coerce.number().optional(),
        collectionFixedFee: z.coerce.number().optional(),
      })
      .parse(req.body);
    res.json(
      await merchants.adjustCashPool({
        actorId: user(req).id,
        merchantId: req.params.id!,
        ...b,
        ip: clientIp(req),
      }),
    );
  } catch (e) { next(e); }
});

// ------------------- merchant users -------------------
adminRouter.post("/merchants/:id/users", requirePerm("merchants", "update"), async (req, res, next) => {
  try {
    const b = z
      .object({
        email: z.string().email(),
        role: z.enum(["owner", "accountant", "read_only"]),
        fullName: z.string().optional(),
        phone: z.string().optional(),
      })
      .parse(req.body);
    res.json(
      await merchants.attachMerchantUser({
        actorId: user(req).id,
        merchantId: req.params.id!,
        ...b,
        ip: clientIp(req),
      }),
    );
  } catch (e) { next(e); }
});

adminRouter.delete("/merchant-users/:id", requirePerm("merchants", "update"), async (req, res, next) => {
  try {
    res.json(
      await merchants.detachMerchantUser({
        actorId: user(req).id,
        merchantUserId: req.params.id!,
        ip: clientIp(req),
      }),
    );
  } catch (e) { next(e); }
});

adminRouter.post("/merchant-users/:id/role", requirePerm("merchants", "update"), async (req, res, next) => {
  try {
    const b = z.object({ newRole: z.enum(["owner", "accountant", "read_only"]) }).parse(req.body);
    res.json(
      await merchants.changeMerchantUserRole({
        actorId: user(req).id,
        merchantUserId: req.params.id!,
        ...b,
        ip: clientIp(req),
      }),
    );
  } catch (e) { next(e); }
});

// ------------------- BO user provisioning -------------------
adminRouter.post("/users", requirePerm("bo_users", "manage_roles"), async (req, res, next) => {
  try {
    const b = z
      .object({
        scope: z.enum(["admin_bo", "merchant", "affiliate"]),
        email: z.string().email(),
        password: z.string().min(8),
        firstName: z.string().optional(),
        lastName: z.string().optional(),
        phone: z.string().optional(),
        targetMerchantId: z.string().uuid().optional(),
        roles: z.array(z.enum(["admin", "accounting", "support"])).optional(),
      })
      .parse(req.body);
    res.status(201).json(
      await adminCreateUser({
        actorId: user(req).id,
        ...b,
        ip: clientIp(req),
      }),
    );
  } catch (e) { next(e); }
});

// ------------------- finance integrations (Phase 10 implements deeper) -------------------
adminRouter.get("/finance-merchants", requirePerm("finance_integrations", "view"), async (_req, res, next) => {
  try {
    res.json({ rows: await merchants.listFinanceMerchants() });
  } catch (e) { next(e); }
});

// ------------------- BO AI assistant -------------------
// P1 — Gate behind dashboard:view so only staff who can already see the
// admin shell can invoke the assistant. Previously any staff role could call
// regardless of dashboard permission.
adminRouter.post("/ai-assistant", requirePerm("dashboard", "view"), async (req, res, next) => {
  try {
    const b = z.object({ question: z.string().min(1), pagePath: z.string().optional() }).parse(req.body);
    res.json(await boAiAssistant(b));
  } catch (e) { next(e); }
});

// ------------------- exports (return HTML) -------------------
adminRouter.post("/export/settlement", requirePerm("exports", "merchants:view_full"), async (req, res, next) => {
  try {
    const b = z
      .object({ merchantId: z.string().uuid(), startDate: z.string(), endDate: z.string() })
      .parse(req.body);
    const html = await exportSettlementHtml(b);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (e) { next(e); }
});

adminRouter.post("/export/cash-pool", requirePerm("exports", "merchants:view_full"), async (req, res, next) => {
  try {
    const b = z
      .object({ merchantId: z.string().uuid(), startDate: z.string(), endDate: z.string() })
      .parse(req.body);
    const html = await exportCashPoolHtml(b);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (e) { next(e); }
});

// ------------------- ledger integrity cross-check -------------------
adminRouter.post("/ledger-integrity/run", requirePerm("ledger_integrity", "run"), async (req, res, next) => {
  try {
    res.json(
      await runLedgerIntegrityChecks({
        triggeredBy: "manual",
        actorId: user(req).id,
        ip: clientIp(req),
        userAgent: req.get("user-agent") ?? null,
      }),
    );
  } catch (e) { next(e); }
});

adminRouter.get("/ledger-integrity/runs", requirePerm("reconciliation", "view"), async (req, res, next) => {
  try {
    const q = z
      .object({
        limit: z.coerce.number().int().min(1).max(100).optional(),
        offset: z.coerce.number().int().nonnegative().optional(),
      })
      .parse(req.query);
    res.json({ rows: await listLedgerIntegrityRuns(q.limit ?? 20, q.offset ?? 0) });
  } catch (e) { next(e); }
});

adminRouter.get("/ledger-integrity/runs/:id", requirePerm("reconciliation", "view"), async (req, res, next) => {
  try {
    const row = await getLedgerIntegrityRun(req.params.id!);
    if (!row) {
      res.status(404).json({ success: false, error_code: "NOT_FOUND" });
      return;
    }
    res.json(row);
  } catch (e) { next(e); }
});
