import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireStaff, user } from "../middleware/auth";
import { loadUserPerms, requirePerm } from "../middleware/permission";
import * as svc from "../services/chat.service";
import { clientIp } from "../lib/req-meta";

export const chatRouter = Router();
chatRouter.use(requireAuth);

chatRouter.post("/threads", async (req, res, next) => {
  try {
    const b = z
      .object({
        category: z.enum(["topup_issue", "withdraw_issue", "profile_update", "general"]),
        subject: z.string().min(1),
        body: z.string().min(1),
        relatedTxPublicNo: z.string().optional(),
      })
      .parse(req.body);
    res.status(201).json(await svc.chatCreateThread({ userId: user(req).id, ...b }));
  } catch (e) { next(e); }
});

chatRouter.post("/threads/:id/messages", async (req, res, next) => {
  try {
    const b = z
      .object({
        body: z.string().min(1),
        cannedResponseId: z.string().uuid().optional(),
      })
      .parse(req.body);
    res.json(
      await svc.chatPostMessage({
        threadId: req.params.id!,
        senderUserId: user(req).id,
        senderRole: "member",
        ...b,
      }),
    );
  } catch (e) { next(e); }
});

chatRouter.post("/messages/:id/feedback", async (req, res, next) => {
  try {
    const b = z.object({ score: z.coerce.number().int().min(-1).max(1) }).parse(req.body);
    res.json(await svc.chatSetMessageFeedback({ userId: user(req).id, messageId: req.params.id!, ...b }));
  } catch (e) { next(e); }
});

chatRouter.post("/threads/:id/attachments", async (req, res, next) => {
  try {
    const b = z
      .object({
        storagePath: z.string(),
        mimeType: z.string(),
        fileSize: z.coerce.number().int().positive(),
        fileName: z.string(),
      })
      .parse(req.body);
    res.status(201).json(
      await svc.chatRegisterAttachment({
        threadId: req.params.id!,
        uploaderUserId: user(req).id,
        ...b,
      }),
    );
  } catch (e) { next(e); }
});

chatRouter.post("/threads/:id/profile-change-request", async (req, res, next) => {
  try {
    // I3 — Member-facing PCR is restricted to `first_name` / `last_name`.
    // The UI (`ChatWidget.tsx`) only ever offers those two fields. Email and
    // phone go through the dedicated `/api/auth/profile-change-otp` flow
    // (OTP-gated). Accepting them here would let a malicious client open a
    // PCR for an email change without OTP and rely on a careless staff
    // approval to land it — bypassing the OTP cap entirely.
    const b = z
      .object({
        field: z.enum(["first_name", "last_name"]),
        newValue: z.string().min(1).max(80),
      })
      .parse(req.body);
    res.status(201).json(
      await svc.chatCreateProfileChangeRequest({
        threadId: req.params.id!,
        userId: user(req).id,
        ...b,
      }),
    );
  } catch (e) { next(e); }
});

chatRouter.post("/threads/:id/ai-reply", async (req, res, next) => {
  try {
    // P0-25 — verify ownership server-side so a stolen thread UUID can't be
    // used by any other authed account to trigger AI replies on someone else's
    // thread (which would leak their transcript bodies to Anthropic).
    res.json(
      await svc.chatAiReply({
        threadId: req.params.id!,
        requesterUserId: user(req).id,
      }),
    );
  } catch (e) { next(e); }
});

// ---------- staff ----------
//
// P1 — granular RBAC: claim/reply require chat:claim / chat:reply respectively;
// approve/reject PCR require chat:approve_pcr. The previous routes used only
// `requireStaff()` so any staff role could perform any chat action regardless
// of whether they were granted the specific permission.
chatRouter.post(
  "/staff/threads/:id/claim",
  requireStaff(),
  loadUserPerms,
  requirePerm("chat", "claim"),
  async (req, res, next) => {
    try {
      res.json(await svc.chatClaimThread({ threadId: req.params.id!, staffUserId: user(req).id }));
    } catch (e) { next(e); }
  },
);

chatRouter.post(
  "/staff/threads/:id/status",
  requireStaff(),
  loadUserPerms,
  requirePerm("chat", "reply"),
  async (req, res, next) => {
    try {
      const b = z
        .object({ status: z.enum(["open", "pending_staff", "pending_user", "resolved", "closed"]) })
        .parse(req.body);
      res.json(await svc.chatSetThreadStatus({ threadId: req.params.id!, status: b.status }));
    } catch (e) { next(e); }
  },
);

chatRouter.post(
  "/staff/threads/:id/messages",
  requireStaff(),
  loadUserPerms,
  requirePerm("chat", "reply"),
  async (req, res, next) => {
    try {
      const b = z
        .object({ body: z.string().min(1), cannedResponseId: z.string().uuid().optional() })
        .parse(req.body);
      res.json(
        await svc.chatPostMessage({
          threadId: req.params.id!,
          senderUserId: user(req).id,
          senderRole: "staff",
          ...b,
        }),
      );
    } catch (e) { next(e); }
  },
);

chatRouter.post(
  "/staff/pcr/:id/approve",
  requireStaff(),
  loadUserPerms,
  requirePerm("chat", "approve_pcr"),
  async (req, res, next) => {
    try {
      res.json(
        await svc.chatApprovePcr({
          requestId: req.params.id!,
          reviewerId: user(req).id,
          ip: clientIp(req),
          userAgent: req.get("user-agent") ?? null,
        }),
      );
    } catch (e) { next(e); }
  },
);
chatRouter.post(
  "/staff/pcr/:id/reject",
  requireStaff(),
  loadUserPerms,
  requirePerm("chat", "approve_pcr"),
  async (req, res, next) => {
    try {
      const b = z.object({ reason: z.string().min(1) }).parse(req.body);
      res.json(
        await svc.chatRejectPcr({
          requestId: req.params.id!,
          reviewerId: user(req).id,
          reason: b.reason,
          ip: clientIp(req),
          userAgent: req.get("user-agent") ?? null,
        }),
      );
    } catch (e) { next(e); }
  },
);

chatRouter.post(
  "/staff/threads/:id/tg-notify",
  requireStaff(),
  loadUserPerms,
  requirePerm("chat", "reply"),
  async (req, res, next) => {
    try {
      const b = z
        .object({ event: z.enum(["new_thread", "pending_staff", "pcr_pending"]).optional() })
        .parse(req.body ?? {});
      res.json(await svc.chatTgNotify({ threadId: req.params.id!, event: b.event }));
    } catch (e) { next(e); }
  },
);
