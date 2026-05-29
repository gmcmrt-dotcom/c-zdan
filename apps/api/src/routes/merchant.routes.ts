/**
 * Merchant BO (portal) endpoints. All require an authenticated user with an
 * active merchant_users row → req.merchant.merchantId.
 *
 * Note: this is the AUTHENTICATED merchant *portal*. The PUBLIC merchant API
 * (HMAC charge/credit/callbacks) lives in /merchant-api/* (Phase 5b).
 *
 * Audit policy (J5 doc).
 *
 * Every state-changing route here MUST call `writeAudit` from the service
 * layer (NOT inline) so that an audit failure rolls back the mutation
 * inside the same SQL transaction (see `writeAudit({ trx })` shape).
 * The audit row carries `actorId` (the merchant user), `ip` (from
 * `clientIp(req)`), and `userAgent` (from `req.get("user-agent")`) so
 * a finance review can reconstruct who hit "rotate signing secret" or
 * "update settlement IBAN" and from where.
 *
 * Read-only routes (GET) do NOT audit by policy — those reads are
 * captured by the merchant_api_calls + access-log layer instead.
 */
import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireMerchant, user } from "../middleware/auth";
import * as svc from "../services/merchant/self.service";
import { logger } from "../lib/logger";
import { clientIp } from "../lib/req-meta";

export const merchantRouter = Router();
merchantRouter.use(requireAuth, requireMerchant);

function ctx(req: Express.Request) {
  if (!req.merchant) throw new Error("merchant ctx missing");
  return req.merchant;
}

merchantRouter.get("/self", async (req, res, next) => {
  try {
    res.json(await svc.merchantSelf(ctx(req).merchantId));
  } catch (e) { next(e); }
});

merchantRouter.get("/self/role", async (req, res, next) => {
  try {
    res.json(await svc.merchantSelfRole(ctx(req).merchantUserId));
  } catch (e) { next(e); }
});

merchantRouter.get("/self/nav", async (req, res, next) => {
  try {
    res.json(await svc.merchantSelfNav(ctx(req).merchantUserId, ctx(req).role));
  } catch (e) { next(e); }
});

merchantRouter.get("/self/children", async (req, res, next) => {
  try {
    res.json({ rows: await svc.merchantSelfChildren(ctx(req).merchantId) });
  } catch (e) { next(e); }
});

merchantRouter.patch("/self/settings", async (req, res, next) => {
  try {
    const b = z
      .object({
        ipWhitelist: z.array(z.string()).optional(),
        webhookUrl: z.string().nullable().optional(),
      })
      .parse(req.body);
    res.json(await svc.merchantSelfUpdateSettings({
      merchantId: ctx(req).merchantId,
      role: ctx(req).role,
      actorUserId: user(req).id,
      ip: clientIp(req),
      ...b,
    }));
  } catch (e) { next(e); }
});

merchantRouter.post("/self/rotate-secret", async (req, res, next) => {
  try {
    res.json(
      await svc.merchantSelfRotateSigningSecret({
        merchantId: ctx(req).merchantId,
        role: ctx(req).role,
        actorUserId: user(req).id,
        ip: clientIp(req),
      }),
    );
  } catch (e) { next(e); }
});

function parseMerchantScopeQuery(query: Record<string, unknown>) {
  const q = z
    .object({
      limit: z.coerce.number().int().min(1).max(200).optional(),
      offset: z.coerce.number().int().nonnegative().optional(),
      merchantId: z.string().uuid().optional(),
      merchantIds: z.string().optional(),
    })
    .parse(query);
  const filterMerchantIds = q.merchantIds
    ? q.merchantIds.split(",").map((s) => s.trim()).filter(Boolean)
    : undefined;
  return {
    limit: q.limit,
    offset: q.offset,
    filterMerchantId: q.merchantId,
    filterMerchantIds,
  };
}

merchantRouter.get("/self/settlement", async (req, res, next) => {
  try {
    const scope = parseMerchantScopeQuery(req.query as Record<string, unknown>);
    res.json(await svc.merchantSelfSettlement({ merchantId: ctx(req).merchantId, ...scope }));
  } catch (e) { next(e); }
});

merchantRouter.get("/self/api-calls", async (req, res, next) => {
  try {
    const scope = parseMerchantScopeQuery(req.query as Record<string, unknown>);
    res.json(await svc.merchantSelfApiCalls({ merchantId: ctx(req).merchantId, ...scope }));
  } catch (e) { next(e); }
});

merchantRouter.get("/self/cashout-sessions", async (req, res, next) => {
  try {
    const q = z
      .object({
        limit: z.coerce.number().int().min(1).max(200).optional(),
        merchantId: z.string().uuid().optional(),
      })
      .parse(req.query);
    res.json(
      await svc.merchantSelfCashoutSessions({
        merchantId: ctx(req).merchantId,
        targetMerchantId: q.merchantId,
        limit: q.limit,
      }),
    );
  } catch (e) { next(e); }
});

merchantRouter.get("/self/transactions", async (req, res, next) => {
  try {
    const scope = parseMerchantScopeQuery(req.query as Record<string, unknown>);
    res.json(await svc.merchantSelfTransactions({ merchantId: ctx(req).merchantId, ...scope }));
  } catch (e) { next(e); }
});

// ---- users management ----
merchantRouter.get("/users", async (req, res, next) => {
  try {
    res.json({ rows: await svc.merchantListUsers(ctx(req).merchantId) });
  } catch (e) { next(e); }
});

merchantRouter.post("/users/invite", async (req, res, next) => {
  try {
    const b = z
      .object({
        email: z.string().email(),
        role: z.enum(["owner", "accountant", "read_only"]),
        fullName: z.string().optional(),
      })
      .parse(req.body);
    res.status(201).json(
      await svc.merchantInviteUser({
        merchantId: ctx(req).merchantId,
        invokerRole: ctx(req).role,
        ...b,
      }),
    );
  } catch (e) { next(e); }
});

merchantRouter.post("/users/:id/role", async (req, res, next) => {
  try {
    const b = z.object({ newRole: z.enum(["owner", "accountant", "read_only"]) }).parse(req.body);
    res.json(
      await svc.merchantSetUserRole({
        merchantId: ctx(req).merchantId,
        invokerRole: ctx(req).role,
        targetMerchantUserId: req.params.id!,
        newRole: b.newRole,
      }),
    );
  } catch (e) { next(e); }
});

merchantRouter.post("/users/:id/active", async (req, res, next) => {
  try {
    const b = z.object({ active: z.boolean() }).parse(req.body);
    res.json(
      await svc.merchantSetUserActive({
        merchantId: ctx(req).merchantId,
        invokerRole: ctx(req).role,
        targetMerchantUserId: req.params.id!,
        active: b.active,
      }),
    );
  } catch (e) { next(e); }
});

merchantRouter.post("/users/:id/permission", async (req, res, next) => {
  try {
    const b = z
      .object({ permissionKey: z.string(), isAllowed: z.boolean() })
      .parse(req.body);
    res.json(
      await svc.merchantSetUserPermission({
        merchantId: ctx(req).merchantId,
        invokerRole: ctx(req).role,
        invokerUserId: req.user!.id,
        targetMerchantUserId: req.params.id!,
        ...b,
      }),
    );
  } catch (e) { next(e); }
});

merchantRouter.get("/permission/check", async (req, res, next) => {
  try {
    const q = z.object({ key: z.string() }).parse(req.query);
    res.json(
      await svc.merchantHasPermission({
        merchantUserId: ctx(req).merchantUserId,
        permissionKey: q.key,
        role: ctx(req).role,
      }),
    );
  } catch (e) { next(e); }
});
