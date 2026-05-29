import { Router } from "express";
import { z } from "zod";
import { requireAuth, user } from "../middleware/auth";
import * as svc from "../services/member.service";

export const meRouter = Router();
meRouter.use(requireAuth);

meRouter.get("/", async (req, res, next) => {
  try {
    res.json({ profile: await svc.myProfile(user(req).id) });
  } catch (e) { next(e); }
});

meRouter.get("/transactions", async (req, res, next) => {
  try {
    const q = z
      .object({
        limit: z.coerce.number().int().min(1).max(200).optional(),
        offset: z.coerce.number().int().nonnegative().optional(),
        type: z.string().optional(),
      })
      .parse(req.query);
    res.json(await svc.myTransactions(user(req).id, q));
  } catch (e) { next(e); }
});

meRouter.get("/loyalty", async (req, res, next) => {
  try {
    res.json(await svc.myLoyaltySummary(user(req).id));
  } catch (e) { next(e); }
});

meRouter.get("/profit-share", async (req, res, next) => {
  try {
    res.json({ rows: await svc.myProfitShareRewards(user(req).id) });
  } catch (e) { next(e); }
});

meRouter.get("/referrals/link", async (req, res, next) => {
  try {
    res.json(await svc.myReferralLink(user(req).id));
  } catch (e) { next(e); }
});
meRouter.get("/referrals/stats", async (req, res, next) => {
  try {
    res.json(await svc.myReferralStats(user(req).id));
  } catch (e) { next(e); }
});
meRouter.get("/referrals", async (req, res, next) => {
  try {
    res.json({ rows: await svc.myReferrals(user(req).id) });
  } catch (e) { next(e); }
});

meRouter.get("/notifications", async (req, res, next) => {
  try {
    const q = z.object({ limit: z.coerce.number().int().min(1).max(200).optional() }).parse(req.query);
    res.json({ rows: await svc.myNotifications(user(req).id, q.limit) });
  } catch (e) { next(e); }
});
meRouter.get("/notifications/unread-count", async (req, res, next) => {
  try {
    res.json({ count: await svc.myUnreadCount(user(req).id) });
  } catch (e) { next(e); }
});
meRouter.post("/notifications/mark-all-read", async (req, res, next) => {
  try {
    await svc.markAllNotificationsRead(user(req).id);
    res.json({ success: true });
  } catch (e) { next(e); }
});

// Reference data — method types (public-ish; restrict to authed users)
meRouter.get("/method-types", async (req, res, next) => {
  try {
    const dir = (z.enum(["topup", "withdraw", "both"]).optional().parse(req.query.direction) ??
      "both") as "topup" | "withdraw" | "both";
    res.json({ rows: await svc.listMethodTypes(dir) });
  } catch (e) { next(e); }
});
