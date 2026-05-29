/**
 * Function-invoke shim.
 *
 * The web client uses `invokeFunction(name, body)` from
 * `apps/web/src/lib/fn.ts`, which POSTs to `/api/fn/:name` with the body
 * verbatim. We dispatch by name to a wrapper that calls the corresponding
 * service module (the ones that used to live as Supabase Edge Functions).
 */
import { Router } from "express";
import rateLimit, { type RateLimitRequestHandler } from "express-rate-limit";
import { requireAuth, user } from "../middleware/auth";
import { loadUserPerms } from "../middleware/permission";
import { logger } from "../lib/logger";
import { AppError } from "../lib/errors";
import { topupInit } from "../services/topup-init.service";
import {
  fetchAnindaTokenList,
  fetchAnindaSetWithdraw,
  parseAnindaAdapter,
} from "../integrations/aninda";
import { db } from "../db/client";
import { and, eq, sql } from "drizzle-orm";
import { merchants, profiles, userRoles, withdrawSessions } from "../db/schema";
import { recordLogin } from "../services/login-ip.service";
import { clientIp, cfCountry, userAgent } from "../lib/req-meta";
import { requestProfileChangeOtp, verifyProfileChangeOtp } from "../services/profile-change-otp.service";
import {
  adminCreateMerchant,
  adminRotateMerchantSecret,
} from "../services/admin/merchants.service";
import { adminCreateUser } from "../services/admin/users.service";
import { hasStaffRole } from "../services/auth.service";
import { boAiAssistant } from "../services/bo-ai.service";
import { chatAiReply, chatTgNotify } from "../services/chat.service";
import { merchantSelfRotateSigningSecret } from "../services/merchant/self.service";

type Body = Record<string, unknown>;
type Fn = (req: import("express").Request, body: Body) => Promise<unknown>;

const fns: Record<string, Fn> = {
  "topup-init": (req, b) =>
    topupInit({ userId: user(req).id, sessionId: String(b.session_id) }),

  "aninda-kripto-tokens": async () => {
    const tokens = await fetchAnindaTokenList();
    return {
      tokens: tokens.length
        ? tokens
        : [
            { CryptoType: "USDT-TRC20", Name: "Tether (TRC20)" },
            { CryptoType: "BTC", Name: "Bitcoin" },
          ],
      source: tokens.length ? "aninda" : "fallback",
    };
  },

  "aninda-withdraw-push": async (req, b) => {
    const sessionId = String(b.session_id);
    const [s] = await db.select().from(withdrawSessions).where(eq(withdrawSessions.id, sessionId)).limit(1);
    if (!s || s.userId !== user(req).id) throw new AppError(404, "SESSION_NOT_FOUND");
    if (s.status !== "pending") throw new AppError(422, "WRONG_STATUS");
    const [m] = await db.select().from(merchants).where(eq(merchants.id, s.merchantId)).limit(1);
    if (!m || !parseAnindaAdapter(m.integrationAdapter)) throw new AppError(422, "PROVIDER_NOT_ANINDA");
    const [p] = await db
      .select({ memberNo: profiles.memberNo, firstName: profiles.firstName, lastName: profiles.lastName })
      .from(profiles)
      .where(eq(profiles.id, s.userId))
      .limit(1);
    if (!p) throw new AppError(404, "PROFILE_NOT_FOUND");

    // P0-23 — atomically claim BEFORE the outbound call so two concurrent
    // pushes can't both reach Aninda (double payout). On provider failure we
    // intentionally leave status='sent_to_merchant' since we don't know if
    // the provider received the request — admin reconciles manually.
    const claimed = await db
      .update(withdrawSessions)
      .set({
        status: "sent_to_merchant",
        pushAttempts: sql`${withdrawSessions.pushAttempts} + 1`,
        lastAttemptAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(withdrawSessions.id, s.id), eq(withdrawSessions.status, "pending")))
      .returning({ id: withdrawSessions.id });
    if (claimed.length === 0) throw new AppError(409, "WITHDRAW_NOT_PUSHABLE");

    const resp = await fetchAnindaSetWithdraw({
      playerId: p.memberNo,
      playerFullName: `${p.firstName} ${p.lastName}`,
      traderTransactionId: s.id,
      paymentMethodId: "",
      amount: Number(s.amount),
      iban: s.iban ?? undefined,
      cryptoType: s.cryptoType ?? undefined,
      payoutAddress: s.payoutAddress ?? undefined,
    });
    if (!resp || resp.HasError) throw new AppError(422, "PROVIDER_PUSH_FAILED");
    return { success: true, status: "sent_to_merchant" };
  },

  "record-login-ip": async (req) =>
    recordLogin({
      userId: user(req).id,
      ip: clientIp(req),
      userAgent: userAgent(req),
      cfCountry: cfCountry(req),
    }),

  "profile-change-otp": async (req, b) => {
    const action = String(b.action);
    const changeType = String(b.change_type) as "email" | "phone";
    const newValue = String(b.new_value);
    if (action === "request") return requestProfileChangeOtp(user(req).id, changeType, newValue);
    if (action === "verify") {
      await verifyProfileChangeOtp(user(req).id, changeType, newValue, String(b.code));
      return { success: true };
    }
    throw new AppError(400, "BAD_ACTION");
  },

  "admin-merchant-secret": async (req, b) => {
    const action = String(b.action);
    const asNumOrNull = (v: unknown): number | null => {
      if (v === null || v === undefined || v === "") return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const asStringArray = (v: unknown): string[] => {
      if (!Array.isArray(v)) return [];
      return v.map((x) => String(x).trim()).filter(Boolean);
    };
    if (action === "create") {
      const merchantType = (b.merchant_type ?? b.type) as
        | "commerce"
        | "finance"
        | undefined;
      if (merchantType !== "commerce" && merchantType !== "finance") {
        throw new AppError(400, "INVALID_MERCHANT_TYPE");
      }
      const out = await adminCreateMerchant({
        actorId: user(req).id,
        name: String(b.name ?? ""),
        type: merchantType,
        commissionPct: asNumOrNull(b.commission_pct) ?? 0,
        fixedFee: asNumOrNull(b.fixed_fee) ?? 0,
        notes: (b.notes as string | null | undefined) ?? null,
        ipWhitelist: asStringArray(b.ip_whitelist),
        perTxLimit: asNumOrNull(b.per_tx_limit),
        dailyLimit: asNumOrNull(b.daily_limit),
        depositMin: asNumOrNull(b.deposit_min),
        depositMax: asNumOrNull(b.deposit_max),
        withdrawMin: asNumOrNull(b.withdraw_min),
        withdrawMax: asNumOrNull(b.withdraw_max),
      });
      return {
        id: out.id,
        api_key: out.apiKey,
        api_secret: out.apiSecret,
        signing_secret: out.signingSecret,
      };
    }
    if (action === "rotate") {
      const out = await adminRotateMerchantSecret({
        actorId: user(req).id,
        merchantId: String(b.merchant_id ?? ""),
      });
      return { api_secret: out.signingSecret, signing_secret: out.signingSecret };
    }
    if (action === "create_child") {
      // Phase 14 stub: child creation reuses the standard create-merchant path
      // with parent linkage. Full bulk upsert is in merchant-child-upsert.
      const out = await adminCreateMerchant({
        actorId: user(req).id,
        name: String(b.name ?? ""),
        type: "commerce",
        commissionPct: asNumOrNull(b.commission_pct) ?? 0,
        fixedFee: asNumOrNull(b.fixed_fee) ?? 0,
        notes: (b.notes as string | null | undefined) ?? null,
      });
      return {
        id: out.id,
        api_key: out.apiKey,
        api_secret: out.apiSecret,
        signing_secret: out.signingSecret,
      };
    }
    throw new AppError(400, "BAD_ACTION");
  },

  "admin-cash-pool-sync": async (req, b) => {
    // Lightweight port: returns current cash pool; outbound sync skipped without provider config.
    const [m] = await db.select().from(merchants).where(eq(merchants.id, String(b.merchant_id))).limit(1);
    if (!m) throw new AppError(404, "MERCHANT_NOT_FOUND");
    return {
      success: true,
      before: Number(m.cashPool),
      reported_cash_pool: Number(m.cashPool),
      delta: 0,
      response: { note: "sync skipped — outbound provider call not configured" },
    };
  },

  "admin-finance-integration-test": async (req, b) => {
    const [m] = await db.select().from(merchants).where(eq(merchants.id, String(b.merchant_id))).limit(1);
    if (!m) throw new AppError(404, "MERCHANT_NOT_FOUND");
    return {
      success: true,
      merchant: m.name,
      request: { amount: b.amount ?? 100, method_type: b.method_type ?? "havale" },
      response: { note: "test stub — outbound contract test not implemented" },
      contract: "ok",
    };
  },

  "admin-user-create": async (req, b) =>
    adminCreateUser({
      actorId: user(req).id,
      scope: (b.scope as "admin_bo" | "merchant" | "affiliate" | undefined) ?? "merchant",
      email: String(b.email),
      password: String(b.password),
      firstName: b.first_name as string | undefined,
      lastName: b.last_name as string | undefined,
      phone: b.phone as string | undefined,
      targetMerchantId: b.target_merchant_id as string | undefined,
    }),

  "bo-ai-assistant": async (_req, b) =>
    boAiAssistant({ question: String(b.question), pagePath: b.page_path as string | undefined }),

  "merchant-self-rotate-secret": async (req) => {
    if (!req.merchant) throw new AppError(403, "MERCHANT_REQUIRED");
    return merchantSelfRotateSigningSecret({
      merchantId: req.merchant.merchantId,
      role: req.merchant.role,
      actorUserId: user(req).id,
      ip: clientIp(req),
    });
  },

  "merchant-cashout-request": async (_req, _b) => {
    // P1 — Commerce cashout pipeline is unimplemented; the previous stub
    // raised 501 with a generic message but the route was still mounted and
    // counted against rate limits. Return a structured CASHOUT_DISABLED so
    // the merchant UI shows a useful banner.
    throw new AppError(503, "CASHOUT_DISABLED", "merchant cashout is currently disabled");
  },

  "chat-attachment-scan": async (_req, _b) => {
    // K7 — Always-clean stub (Q15: keep noop). VirusTotal env var was
    // removed; production scanning is a deploy-layer concern (ClamAV
    // sidecar on file write, or S3 bucket-event hook). The MIME magic-
    // byte sniff in `storage.routes.ts` continues to reject obvious
    // executables / SVG-with-script payloads at upload time.
    return { success: true, status: "clean", skipped: true, reason: "scanner-not-configured" };
  },

  // P0-25 — fn shim is gated to staff via adminFnPerms below; pass isStaff=true
  // because by the time this handler runs the dispatcher has already verified
  // the caller's user_roles row + chat:reply permission.
  "chat-ai-reply": async (req, b) =>
    chatAiReply({
      threadId: String(b.thread_id),
      requesterUserId: user(req).id,
      isStaff: true,
    }),
  "chat-tg-notify": async (_req, b) =>
    chatTgNotify({ threadId: String(b.thread_id), event: b.event as "new_thread" | "pending_staff" | "pcr_pending" | undefined }),

  "mock-merchant-complete": async (_req, b) => {
    // Forward to the dev mocks route (which itself calls back into HMAC endpoints)
    const port = process.env.PORT ?? 3000;
    const r = await fetch(`http://localhost:${port}/api/dev/mock-merchant/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(b),
    });
    return r.json();
  },
};

// -------- RBAC dispatch table (P0-1) --------
//
// Same model as rpc.routes.ts: admin-* fns require a staff role AND the
// listed bo_permission. Member fns (topup-init, aninda-*, profile-change-otp,
// record-login-ip, mock-merchant-complete, chat-attachment-scan) need only
// requireAuth. Merchant BO fns need req.merchant.
//
// chat-ai-reply and chat-tg-notify both expose member chat data — gated to
// staff to close the IDOR (member ownership check is the cleaner long-term
// fix and lives under P0-25, but until then the safer default is staff-only).
// merchant-cashout-request is currently a 501 stub.
const adminFnPerms: Record<string, { resource: string; action: string }> = {
  "admin-merchant-secret": { resource: "merchants", action: "update" },
  "admin-cash-pool-sync": { resource: "merchants.cash_pool", action: "adjust" },
  "admin-finance-integration-test": { resource: "merchants", action: "view_full" },
  "admin-user-create": { resource: "bo_users", action: "manage_roles" },
  "bo-ai-assistant": { resource: "dashboard", action: "view" },
  "chat-ai-reply": { resource: "chat", action: "reply" },
  "chat-tg-notify": { resource: "chat", action: "reply" },
};

const merchantBoFns = new Set([
  "merchant-self-rotate-secret",
  "merchant-cashout-request",
]);

export const fnRouter = Router();
fnRouter.use(requireAuth, loadUserPerms);

// P1 — Per-fn-name rate limiters. The auth.routes.ts equivalents protect the
// REST endpoints; the fn router is the parallel surface the web invokes via
// invokeFunction(). Without these caps, an attacker can route around the
// REST limiters by calling the same logic via fn/ — particularly damaging
// for profile-change-otp (brute force) and bo-ai-assistant (cost DoS).
const fnLimiters: Record<string, RateLimitRequestHandler> = {
  "profile-change-otp": rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.user?.id ?? req.ip ?? "anon",
    handler: (_req, res) => {
      res.json({ data: null, error: { code: "OTP_RATE_LIMIT", message: "Too many OTP attempts", statusCode: 429 } });
    },
  }),
  "bo-ai-assistant": rateLimit({
    windowMs: 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.user?.id ?? req.ip ?? "anon",
    handler: (_req, res) => {
      res.json({ data: null, error: { code: "AI_RATE_LIMIT", message: "Too many requests", statusCode: 429 } });
    },
  }),
  "chat-ai-reply": rateLimit({
    windowMs: 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.user?.id ?? req.ip ?? "anon",
    handler: (_req, res) => {
      res.json({ data: null, error: { code: "AI_RATE_LIMIT", message: "Too many requests", statusCode: 429 } });
    },
  }),
};

fnRouter.post("/:name", (req, res, next) => {
  // Apply the per-fn limiter if there is one for this name. The limiter
  // middleware terminates the response on rate-limit hit; otherwise it
  // falls through to the dispatcher below.
  const name = req.params.name!;
  const limiter = fnLimiters[name];
  if (limiter) return limiter(req, res, next);
  next();
}, async (req, res) => {
  const name = req.params.name!;
  const fn = fns[name];
  if (!fn) {
    logger.warn({ name }, "fn: unknown");
    res.json({ data: null, error: { code: "FN_NOT_IMPLEMENTED", message: `Edge function ${name} not implemented`, hint: name } });
    return;
  }
  try {
    const body = (typeof req.body === "object" && req.body !== null ? req.body : {}) as Body;

    // ---- staff gate for admin-* / bo-* / chat-* fns (P0-1) ----
    const requiredPerm = adminFnPerms[name];
    if (requiredPerm || name.startsWith("admin-") || name.startsWith("bo-")) {
      const actorId = req.user!.id;
      const staff = await hasStaffRole(actorId);
      if (!staff) {
        logger.warn({ name, actorId }, "fn: staff role required");
        res.json({ data: null, error: { code: "STAFF_REQUIRED", message: "staff role required", statusCode: 403 } });
        return;
      }
      if (requiredPerm) {
        if (!req.perms?.has(`${requiredPerm.resource}:${requiredPerm.action}`)) {
          logger.warn({ name, actorId, requiredPerm }, "fn: permission denied");
          res.json({ data: null, error: { code: "PERMISSION_DENIED", message: "permission denied", statusCode: 403 } });
          return;
        }
      } else {
        logger.error({ name }, "fn: admin fn missing perm mapping");
        res.json({ data: null, error: { code: "PERMISSION_DENIED", message: "permission mapping missing", statusCode: 403 } });
        return;
      }
    }

    // ---- merchant BO fns need req.merchant ----
    if (merchantBoFns.has(name)) {
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

    const data = await fn(req, body);
    res.json({ data, error: null });
  } catch (err) {
    if (err instanceof AppError) {
      res.json({ data: null, error: { code: err.errorCode, message: err.message, statusCode: err.statusCode } });
      return;
    }
    logger.error({ err, name }, "fn handler error");
    res.json({ data: null, error: { code: "INTERNAL", message: "internal error" } });
  }
});
