/**
 * Inbound webhooks from external providers.
 *
 * Aninda routes auth via MD5 checksum over PascalCase body fields + the
 * merchant's signing_secret. Merchant-cashout callback uses a dedicated HMAC
 * secret (env MERCHANT_CASHOUT_CALLBACK_SECRET) shared with the cashout
 * provider — different from the per-merchant signing_secret.
 */
import { Router, raw } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { merchantApiCalls, merchants, topupSessions, withdrawSessions } from "../db/schema";
import { verifyDepositChecksum, anindaKeyMatches } from "../integrations/aninda";
import { finalizeTopupCallback } from "../services/topup.service";
import { finalizeWithdrawCallback } from "../services/withdraw.service";
import { hmacSha256Hex, constantTimeEqual } from "../lib/random";
import { env } from "../lib/env";
import { logger } from "../lib/logger";
import { clientIp } from "../lib/req-meta";

export const webhooksRouter = Router();
webhooksRouter.use(raw({ type: "application/json", limit: "1mb" }));

// ----------------- Aninda deposit callback -----------------
webhooksRouter.post("/aninda/deposit", async (req, res) => {
  const startedAt = Date.now();
  const ip = clientIp(req);
  const bodyText = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
  let body: Record<string, string | undefined> = {};
  try {
    body = JSON.parse(bodyText) as Record<string, string | undefined>;
  } catch {
    res.status(400).json({ HasError: true, Description: "BAD_JSON", Data: "", ID: 400 });
    return;
  }

  const respond = async (
    status: number,
    payload: { HasError: boolean; Description: string; Data: unknown; ID: number },
    merchantId: string | null,
    errorCode: string | null = null,
  ) => {
    try {
      await db.insert(merchantApiCalls).values({
        merchantId,
        endpoint: "aninda-deposit-callback",
        method: "POST",
        ip,
        requestBody: body as never,
        responseBody: payload as never,
        statusCode: status,
        errorCode,
        latencyMs: Date.now() - startedAt,
      });
    } catch (err) {
      // J3 — Surface persist failures so an audit-table outage doesn't
      // silently break the forensic trail. We still serve the response
      // (we owe Aninda the ACK) but log loudly so the operator knows the
      // audit row was missed and can backfill from logs if needed.
      logger.error({ err, merchantId, statusCode: status }, "aninda deposit callback audit insert failed");
    }
    res.status(status).json(payload);
  };

  if (!anindaKeyMatches(body.Key ?? "")) {
    await respond(401, { HasError: true, Description: "INVALID_KEY", Data: "", ID: 401 }, null, "INVALID_KEY");
    return;
  }

  // Find merchant by TraderTransactionID → topup_sessions.id
  //
  // I1 — Webhook session-existence oracle.
  //
  // The original shape returned `404 SESSION_NOT_FOUND` when the
  // TraderTransactionID didn't match a row, but `401 BAD_CHECKSUM` only
  // when the row existed AND the checksum failed. An attacker who can
  // post to this endpoint (it's public — the merchant calls it) can
  // iterate UUIDs to enumerate which sessions exist. We now collapse
  // both into the same `401 BAD_CHECKSUM` response: an unknown session
  // looks identical to a known session with a wrong checksum. The
  // server-side log still records the distinction for forensics.
  const sessionId = String(body.TraderTransactionID ?? "");
  if (!sessionId) {
    await respond(400, { HasError: true, Description: "MISSING_REF", Data: "", ID: 400 }, null, "MISSING_REF");
    return;
  }
  const [s] = await db.select().from(topupSessions).where(eq(topupSessions.id, sessionId)).limit(1);
  if (!s) {
    logger.debug({ sessionId }, "aninda deposit webhook: unknown session (responding BAD_CHECKSUM)");
    await respond(401, { HasError: true, Description: "BAD_CHECKSUM", Data: "", ID: 401 }, null, "BAD_CHECKSUM");
    return;
  }
  const [m] = await db.select({ signingSecret: merchants.signingSecret }).from(merchants).where(eq(merchants.id, s.merchantId)).limit(1);
  if (!m?.signingSecret) {
    // Same oracle protection: don't tell the attacker the session exists
    // but the merchant is misconfigured.
    logger.error({ merchantId: s.merchantId }, "aninda deposit webhook: merchant not provisioned");
    await respond(401, { HasError: true, Description: "BAD_CHECKSUM", Data: "", ID: 401 }, s.merchantId, "MERCHANT_NOT_PROVISIONED");
    return;
  }
  if (!verifyDepositChecksum(body, m.signingSecret)) {
    await respond(401, { HasError: true, Description: "BAD_CHECKSUM", Data: "", ID: 401 }, s.merchantId, "BAD_CHECKSUM");
    return;
  }

  const status = String(body.Status ?? "").toLowerCase();
  const amount = Number(body.Amount ?? 0);
  try {
    const out = await finalizeTopupCallback({
      merchantId: s.merchantId,
      internalRef: sessionId,
      merchantRef: String(body.PaymentTransactionID ?? sessionId),
      amount,
      status: status === "success" || status === "ok" || status === "approved" ? "success" : "failed",
      customerName: body.PlayerFullName ?? null,
      paymentMethodDetail: body.PaymentName ?? null,
      externalTxId: body.PaymentTransactionID ?? null,
      failureReason: body.Description ?? null,
    });
    await respond(200, { HasError: false, Description: "OK", Data: out, ID: 200 }, s.merchantId);
  } catch (err) {
    logger.error({ err }, "aninda deposit finalize failed");
    await respond(500, { HasError: true, Description: "INTERNAL", Data: "", ID: 500 }, s.merchantId, "INTERNAL");
  }
});

// ----------------- Aninda withdraw callback -----------------
// H4 — Parity with the deposit-callback above: every response is now
// persisted to `merchant_api_calls` so forensics can replay both sides
// of the withdraw flow. The audit is local-only; no provider contact.
webhooksRouter.post("/aninda/withdraw", async (req, res) => {
  const startedAt = Date.now();
  const ip = clientIp(req);
  const bodyText = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
  let body: Record<string, string | undefined> = {};
  try {
    body = JSON.parse(bodyText) as Record<string, string | undefined>;
  } catch {
    // No merchant ID yet — log with merchantId=null.
    try {
      await db.insert(merchantApiCalls).values({
        merchantId: null,
        endpoint: "aninda-withdraw-callback",
        method: "POST",
        ip,
        requestBody: { raw: bodyText.slice(0, 1024) } as never,
        responseBody: { HasError: true, Description: "BAD_JSON" } as never,
        statusCode: 400,
        errorCode: "BAD_JSON",
        latencyMs: Date.now() - startedAt,
      });
    } catch (err) {
      logger.error({ err }, "aninda withdraw callback BAD_JSON audit insert failed");
    }
    res.status(400).json({ HasError: true, Description: "BAD_JSON", Data: "", ID: 400 });
    return;
  }

  const respond = async (
    status: number,
    payload: { HasError: boolean; Description: string; Data: unknown; ID: number },
    merchantId: string | null,
    errorCode: string | null = null,
  ) => {
    try {
      await db.insert(merchantApiCalls).values({
        merchantId,
        endpoint: "aninda-withdraw-callback",
        method: "POST",
        ip,
        requestBody: body as never,
        responseBody: payload as never,
        statusCode: status,
        errorCode,
        latencyMs: Date.now() - startedAt,
      });
    } catch (err) {
      // J3 — Surface audit failures (was swallowed).
      logger.error({ err, merchantId, statusCode: status }, "aninda withdraw callback audit insert failed");
    }
    res.status(status).json(payload);
  };

  if (!anindaKeyMatches(body.Key ?? "")) {
    await respond(401, { HasError: true, Description: "INVALID_KEY", Data: "", ID: 401 }, null, "INVALID_KEY");
    return;
  }

  const sessionId = String(body.TraderTransactionID ?? "");
  if (!sessionId) {
    await respond(400, { HasError: true, Description: "MISSING_REF", Data: "", ID: 400 }, null, "MISSING_REF");
    return;
  }
  const [s] = await db.select().from(withdrawSessions).where(eq(withdrawSessions.id, sessionId)).limit(1);
  if (!s) {
    // I1 — Same oracle-protection as the deposit webhook above: respond
    // with BAD_CHECKSUM so the caller cannot enumerate session UUIDs.
    logger.debug({ sessionId }, "aninda withdraw webhook: unknown session (responding BAD_CHECKSUM)");
    await respond(401, { HasError: true, Description: "BAD_CHECKSUM", Data: "", ID: 401 }, null, "BAD_CHECKSUM");
    return;
  }
  const [m] = await db.select({ signingSecret: merchants.signingSecret }).from(merchants).where(eq(merchants.id, s.merchantId)).limit(1);
  if (!m?.signingSecret || !verifyDepositChecksum(body, m.signingSecret)) {
    await respond(401, { HasError: true, Description: "BAD_CHECKSUM", Data: "", ID: 401 }, s.merchantId, "BAD_CHECKSUM");
    return;
  }
  const status = String(body.Status ?? "").toLowerCase();
  try {
    const out = await finalizeWithdrawCallback({
      merchantId: s.merchantId,
      internalRef: sessionId,
      merchantRef: String(body.PaymentTransactionID ?? sessionId),
      status: status === "success" || status === "ok" || status === "approved" ? "success" : "failed",
      externalTxId: body.PaymentTransactionID ?? null,
      failureReason: body.Description ?? null,
    });
    await respond(200, { HasError: false, Description: "OK", Data: out, ID: 200 }, s.merchantId);
  } catch (err) {
    logger.error({ err }, "aninda withdraw finalize failed");
    await respond(500, { HasError: true, Description: "INTERNAL", Data: "", ID: 500 }, s.merchantId, "INTERNAL");
  }
});

// ----------------- Merchant cashout provider callback (Phase 5 stub) -----------------
//
// P0-27 — Enforce a ±5 min timestamp window AND constant-time signature
// comparison so a leaked CALLBACK_SECRET cannot be replayed indefinitely.
// Aligned with merchant-hmac.ts TIMESTAMP_WINDOW_SEC = 300.
const CASHOUT_TIMESTAMP_WINDOW_SEC = 300;

webhooksRouter.post("/merchant/cashout", async (req, res) => {
  if (!env.MERCHANT_CASHOUT_CALLBACK_SECRET) {
    res.status(503).json({ success: false, error_code: "CASHOUT_SECRET_MISSING" });
    return;
  }
  const ts = req.headers["x-cashout-timestamp"] as string | undefined;
  const sig = req.headers["x-cashout-signature"] as string | undefined;
  if (!ts || !sig) {
    res.status(401).json({ success: false, error_code: "MISSING_SIG" });
    return;
  }
  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum)) {
    res.status(401).json({ success: false, error_code: "BAD_TIMESTAMP" });
    return;
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - tsNum) > CASHOUT_TIMESTAMP_WINDOW_SEC) {
    res.status(401).json({ success: false, error_code: "STALE_TIMESTAMP" });
    return;
  }
  const raw = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
  const expected = hmacSha256Hex(env.MERCHANT_CASHOUT_CALLBACK_SECRET, `${ts}:${raw}`);
  if (!constantTimeEqual(expected, sig.toLowerCase())) {
    res.status(401).json({ success: false, error_code: "BAD_SIG" });
    return;
  }
  let body: Record<string, unknown> = {};
  try {
    body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    res.status(400).json({ success: false, error_code: "BAD_JSON" });
    return;
  }
  const statusRaw = String(body.status ?? body.Status ?? "").toLowerCase();
  const status = statusRaw === "success" || statusRaw === "ok" || statusRaw === "approved" ? "success" : "failed";
  try {
    const { finalizeMerchantCashoutCallback } = await import("../services/merchant-cashout.service");
    const out = await finalizeMerchantCashoutCallback({
      publicNo: body.public_no ? String(body.public_no) : undefined,
      merchantRef: body.merchant_ref ? String(body.merchant_ref) : undefined,
      status,
      externalTxId: body.external_tx_id ? String(body.external_tx_id) : null,
      failureReason: body.failure_reason ? String(body.failure_reason) : null,
    });
    res.status(200).json({ ...out, success: true });
  } catch (err) {
    logger.error({ err }, "merchant cashout callback failed");
    res.status(500).json({ success: false, error_code: "INTERNAL" });
  }
});
