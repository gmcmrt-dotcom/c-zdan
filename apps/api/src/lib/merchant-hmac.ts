/**
 * HMAC verification + idempotency for public merchant REST API.
 *
 * Port of supabase/functions/_shared/merchant-auth.ts. Behavior preserved:
 *  - Headers: x-merchant-key, x-merchant-timestamp, x-merchant-signature,
 *             x-merchant-ref (optional)
 *  - Signature: HMAC_SHA256_HEX(signing_secret, timestamp + ":" + raw body)
 *  - Timestamp window: ±5 min (STALE_TIMESTAMP)
 *  - Constant-time compare + length check before compare
 *  - Commerce child merchants use parent's signing_secret
 *  - Audit log to merchant_api_calls on every response
 *  - Idempotency: dedupe by (merchant_id, endpoint, merchant_ref) for 7 days;
 *    same ref + different payload → REF_PAYLOAD_MISMATCH
 *
 * Usage pattern:
 *   router.post("/charge", merchantHmac("merchant-charge"), async (req,res,next)=>{
 *     // req.merchantCtx is populated
 *     const body = req.merchantCtx.body;
 *     ...
 *     await req.merchantCtx.respond(200, { success:true, ... });
 *   })
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { addDays } from "date-fns";
import { and, eq, sql } from "drizzle-orm";
import { db, tx } from "../db/client";
import { merchantApiCalls, merchantIdempotency, merchants } from "../db/schema";
import { hmacSha256Hex, sha256Hex, constantTimeEqual } from "./random";
import { clientIp } from "./req-meta";
import { logger } from "./logger";
import { resolveMerchantSigningSecret } from "./crypto";
import { redactForStorage } from "./redact";

const TIMESTAMP_WINDOW_SEC = 5 * 60;
const HMAC_SIG_LEN = 64;
const HMAC_SIG_RE = /^[0-9a-f]{64}$/;
const IDEM_TTL_DAYS = 7;

export interface MerchantContext {
  merchant: {
    id: string;
    name: string;
    is_active: boolean;
    merchant_type: "finance" | "commerce";
    balance: number;
    credit_limit: number;
    merchant_scope: "standalone" | "parent" | "child";
    parent_merchant_id: string | null;
    external_sub_merchant_ref: string | null;
    per_tx_limit: number | null;
    daily_limit: number | null;
  };
  body: unknown;
  bodyText: string;
  requestHash: string;
  merchantRef: string | null;
  ip: string | null;
  /** Send a successful (or 4xx) response — also handles audit + idempotency persist. */
  respond: (
    statusCode: number,
    body: Record<string, unknown>,
    errorCode?: string | null,
  ) => Promise<void>;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      merchantCtx?: MerchantContext;
    }
  }
}

interface BuildResponseOpts {
  merchantId: string | null;
  endpoint: string;
  method: string;
  ip: string | null;
  requestBody: unknown;
  responseBody: Record<string, unknown>;
  statusCode: number;
  errorCode: string | null;
  latencyMs: number;
  merchantRef: string | null;
  requestHash: string | null;
  cacheResponse: boolean;
}

async function persistCall(opts: BuildResponseOpts & { claimedIdempotency?: boolean }): Promise<void> {
  try {
    // P1 — Mask PII in the persisted bodies. The wire `request_hash` is
    // unchanged (it's already computed over the raw body for HMAC), so
    // idempotency dedupe still works; the human-readable jsonb columns are
    // what we redact. Same redactor for the response body so any error
    // dump or echoed customerName/iban that the handler returns gets
    // masked too.
    const redactedReq = redactForStorage(opts.requestBody ?? null);
    const redactedRes = redactForStorage(opts.responseBody ?? null);
    await db.insert(merchantApiCalls).values({
      merchantId: opts.merchantId,
      endpoint: opts.endpoint,
      method: opts.method,
      ip: opts.ip,
      requestBody: redactedReq as never,
      responseBody: redactedRes as never,
      statusCode: opts.statusCode,
      errorCode: opts.errorCode,
      latencyMs: opts.latencyMs,
      merchantRef: opts.merchantRef,
      requestHash: opts.requestHash,
    });
    // P0-3 — Claim-before-execute idempotency.
    //
    // The middleware now inserts a placeholder row (statusCode=0, empty body)
    // BEFORE the handler runs. Here we either:
    //   - UPDATE that placeholder with the real response (if we claimed it), or
    //   - INSERT a fresh cache entry the old way (if no merchant_ref / no claim).
    //
    // Updating the placeholder finalises the cache so subsequent retries see
    // the cached result; if we instead inserted, the ON CONFLICT would silently
    // drop because the placeholder row already occupies the (merchant_id,
    // endpoint, merchant_ref) unique slot.
    if (
      opts.merchantId &&
      opts.merchantRef &&
      opts.requestHash
    ) {
      // H4 — Cache 4xx (client-error) responses too. Previously only
      // success-bracket responses (`cacheable=true`, computed by the
      // handler) were stored, and 4xx tore down the placeholder. That left
      // a retry-after-validation-error window where a fixed retry could
      // re-execute the business handler — and if the original 4xx
      // happened AFTER a partial money write (rare, but possible on
      // post-commit response failures), the retry would double-execute.
      // We now persist the exact same status + body the caller saw, with
      // a short TTL (1 day) so the cached error isn't permanent — the
      // merchant integration can rotate merchant_ref after a deploy.
      const ERR_CACHE_TTL_DAYS = 1;
      const isClientError = opts.statusCode >= 400 && opts.statusCode < 500;
      const cacheable = opts.cacheResponse;
      const cacheErrorBody = isClientError;

      if (opts.claimedIdempotency) {
        if (cacheable) {
          await db
            .update(merchantIdempotency)
            .set({
              statusCode: opts.statusCode,
              responseBody: opts.responseBody as never,
            })
            .where(
              and(
                eq(merchantIdempotency.merchantId, opts.merchantId),
                eq(merchantIdempotency.endpoint, opts.endpoint),
                eq(merchantIdempotency.merchantRef, opts.merchantRef),
              ),
            );
        } else if (cacheErrorBody) {
          // 4xx — overwrite the placeholder with the actual error response so
          // a retry returns the exact same body, but with a shorter TTL so
          // the merchant can fix the input and re-submit with a NEW ref.
          await db
            .update(merchantIdempotency)
            .set({
              statusCode: opts.statusCode,
              responseBody: opts.responseBody as never,
              expiresAt: addDays(new Date(), ERR_CACHE_TTL_DAYS),
            })
            .where(
              and(
                eq(merchantIdempotency.merchantId, opts.merchantId),
                eq(merchantIdempotency.endpoint, opts.endpoint),
                eq(merchantIdempotency.merchantRef, opts.merchantRef),
              ),
            );
        } else {
          // 5xx — clear the placeholder so an operator-side retry can run
          // again. We can't tell whether the handler committed before
          // throwing; safe default is to not block retries.
          await db
            .delete(merchantIdempotency)
            .where(
              and(
                eq(merchantIdempotency.merchantId, opts.merchantId),
                eq(merchantIdempotency.endpoint, opts.endpoint),
                eq(merchantIdempotency.merchantRef, opts.merchantRef),
              ),
            );
        }
      } else if (cacheable || cacheErrorBody) {
        await db
          .insert(merchantIdempotency)
          .values({
            merchantId: opts.merchantId,
            endpoint: opts.endpoint,
            merchantRef: opts.merchantRef,
            requestHash: opts.requestHash,
            statusCode: opts.statusCode,
            responseBody: opts.responseBody as never,
            expiresAt: addDays(new Date(), cacheable ? IDEM_TTL_DAYS : ERR_CACHE_TTL_DAYS),
          })
          .onConflictDoNothing();
      }
    }
  } catch (err) {
    logger.warn({ err, endpoint: opts.endpoint }, "merchant_api_calls insert failed");
  }
}

/**
 * Try to atomically reserve the (merchant_id, endpoint, merchant_ref) slot
 * with a placeholder row. Returns:
 *   - "claimed": we own this request; proceed with the handler.
 *   - { kind: "completed", row }: another request already finalised this ref.
 *   - { kind: "in_progress" }: another request is mid-flight; caller should
 *     return a 409 telling the merchant to retry shortly.
 */
async function claimIdempotencySlot(
  merchantId: string,
  endpoint: string,
  merchantRef: string,
  requestHash: string,
): Promise<
  | { kind: "claimed" }
  | { kind: "completed"; row: { statusCode: number; responseBody: unknown; requestHash: string } }
  | { kind: "in_progress" }
> {
  // First, attempt to insert a placeholder row. statusCode=0 marks it as
  // "pending"; the ON CONFLICT clause guarantees we never overwrite a row
  // that another caller has already claimed (or completed).
  const inserted = await db
    .insert(merchantIdempotency)
    .values({
      merchantId,
      endpoint,
      merchantRef,
      requestHash,
      statusCode: 0,
      responseBody: {} as never,
      expiresAt: addDays(new Date(), IDEM_TTL_DAYS),
    })
    .onConflictDoNothing()
    .returning({ id: merchantIdempotency.id });
  if (inserted.length > 0) return { kind: "claimed" };

  // Lost the race — fetch the existing row to decide between completed-replay
  // and in-progress-409.
  const [hit] = await db
    .select({
      statusCode: merchantIdempotency.statusCode,
      responseBody: merchantIdempotency.responseBody,
      requestHash: merchantIdempotency.requestHash,
    })
    .from(merchantIdempotency)
    .where(
      and(
        eq(merchantIdempotency.merchantId, merchantId),
        eq(merchantIdempotency.endpoint, endpoint),
        eq(merchantIdempotency.merchantRef, merchantRef),
      ),
    )
    .limit(1);
  if (!hit) {
    // Vanishingly rare: row was deleted between insert-conflict and select
    // (e.g. by another error-path delete). Treat as in_progress to be safe.
    return { kind: "in_progress" };
  }
  if (hit.statusCode === 0) return { kind: "in_progress" };
  return {
    kind: "completed",
    row: {
      statusCode: hit.statusCode,
      responseBody: hit.responseBody as unknown,
      requestHash: hit.requestHash,
    },
  };
}

/**
 * Express middleware factory. Verifies HMAC and populates req.merchantCtx.
 * `endpoint` is the name persisted in merchant_api_calls / merchant_idempotency.
 *
 * NOTE: this middleware MUST be mounted BEFORE express.json() on the route
 * tree, because HMAC is computed over the raw request body. The Phase 5b
 * router uses express.raw() for that reason.
 */
export function merchantHmac(endpoint: string, opts?: { allowLegacy?: boolean }): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const startedAt = Date.now();
    const ip = clientIp(req);

    const sendError = async (
      status: number,
      errorCode: string,
      merchantId: string | null,
      requestBody: unknown,
      idem?: { merchantRef?: string | null; requestHash?: string | null },
    ) => {
      const body = { success: false, error_code: errorCode };
      await persistCall({
        merchantId,
        endpoint,
        method: req.method,
        ip,
        requestBody,
        responseBody: body,
        statusCode: status,
        errorCode,
        latencyMs: Date.now() - startedAt,
        merchantRef: idem?.merchantRef ?? null,
        requestHash: idem?.requestHash ?? null,
        cacheResponse: false,
      });
      res.status(status).json(body);
    };

    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    if (req.method !== "POST") {
      await sendError(405, "METHOD", null, null);
      return;
    }

    const apiKey = (req.headers["x-merchant-key"] as string) ?? (req.headers["x-api-key"] as string);
    const ts = req.headers["x-merchant-timestamp"] as string | undefined;
    const sig = req.headers["x-merchant-signature"] as string | undefined;
    const merchantRef = (req.headers["x-merchant-ref"] as string | undefined) ?? null;
    const legacySecret = req.headers["x-api-secret"] as string | undefined;

    if (!apiKey) {
      await sendError(401, "INVALID_KEY", null, null);
      return;
    }

    const [m] = await db
      .select()
      .from(merchants)
      .where(eq(merchants.apiKey, apiKey))
      .limit(1);
    if (!m) {
      await sendError(401, "INVALID_KEY", null, null);
      return;
    }
    if (!m.isActive) {
      await sendError(403, "MERCHANT_INACTIVE", m.id, null);
      return;
    }

    // P0-12 — prefer the encrypted signing secret column; fall back to the
    // plaintext column during the staged migration.
    let signingSecret = resolveMerchantSigningSecret(m.signingSecretEncrypted, m.signingSecret);
    let legacySecretHash = m.apiSecretHash;

    if (m.merchantScope === "child") {
      if (!m.parentMerchantId) {
        await sendError(500, "PARENT_MERCHANT_NOT_FOUND", m.id, null);
        return;
      }
      const [parent] = await db
        .select({
          id: merchants.id,
          isActive: merchants.isActive,
          signingSecret: merchants.signingSecret,
          signingSecretEncrypted: merchants.signingSecretEncrypted,
          apiSecretHash: merchants.apiSecretHash,
        })
        .from(merchants)
        .where(eq(merchants.id, m.parentMerchantId))
        .limit(1);
      if (!parent) {
        await sendError(500, "PARENT_MERCHANT_NOT_FOUND", m.id, null);
        return;
      }
      if (!parent.isActive) {
        await sendError(403, "PARENT_MERCHANT_INACTIVE", m.id, null);
        return;
      }
      signingSecret = resolveMerchantSigningSecret(
        parent.signingSecretEncrypted,
        parent.signingSecret,
      );
      legacySecretHash = parent.apiSecretHash;
    }

    // Raw body is in req.body (a Buffer) thanks to express.raw() upstream.
    const raw: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
    const bodyText = raw.toString("utf8");
    let parsedBody: unknown = null;
    if (bodyText.length > 0) {
      try {
        parsedBody = JSON.parse(bodyText);
      } catch {
        await sendError(400, "BAD_JSON", m.id, bodyText.slice(0, 500));
        return;
      }
    }
    const requestHash = sha256Hex(bodyText);

    // === Path 1: HMAC ===
    let authOk = false;
    if (sig && ts) {
      if (!signingSecret) {
        await sendError(500, "MERCHANT_NOT_PROVISIONED", m.id, parsedBody);
        return;
      }
      const sigLower = sig.toLowerCase();
      if (sigLower.length !== HMAC_SIG_LEN || !HMAC_SIG_RE.test(sigLower)) {
        await sendError(401, "BAD_SIGNATURE", m.id, parsedBody);
        return;
      }
      const tsNum = Number(ts);
      if (!Number.isFinite(tsNum)) {
        await sendError(401, "BAD_TIMESTAMP", m.id, parsedBody);
        return;
      }
      const nowSec = Math.floor(Date.now() / 1000);
      if (Math.abs(nowSec - tsNum) > TIMESTAMP_WINDOW_SEC) {
        await sendError(401, "STALE_TIMESTAMP", m.id, parsedBody);
        return;
      }
      const expected = hmacSha256Hex(signingSecret, `${ts}:${bodyText}`);
      if (!constantTimeEqual(expected, sigLower)) {
        await sendError(401, "BAD_SIGNATURE", m.id, parsedBody);
        return;
      }
      authOk = true;
    }

    // === Path 2: legacy x-api-secret ===
    if (!authOk && opts?.allowLegacy && legacySecret) {
      if (constantTimeEqual(sha256Hex(legacySecret), legacySecretHash)) {
        authOk = true;
      }
    }

    if (!authOk) {
      await sendError(401, "BAD_SIGNATURE", m.id, parsedBody);
      return;
    }

    // IP whitelist
    if (m.ipWhitelist && m.ipWhitelist.length > 0) {
      if (!ip || !m.ipWhitelist.includes(ip)) {
        await sendError(403, "IP_NOT_ALLOWED", m.id, parsedBody);
        return;
      }
    }

    // P0-3 — Idempotency: claim-before-execute.
    //
    // The previous flow was check-then-act: a SELECT for an existing row,
    // then run the handler, then INSERT the cache row. Two concurrent
    // identical requests could both pass the SELECT and both execute the
    // money-moving handler before either INSERT finished.
    //
    // New flow:
    //   1. Atomically INSERT a placeholder for (merchant_id, endpoint, ref).
    //      ON CONFLICT DO NOTHING returns "claimed" only to one request.
    //   2. If we lost the race AND the existing row is completed, serve the
    //      cached response (existing behaviour, but now with no execution).
    //   3. If we lost AND the existing row is still pending (placeholder),
    //      return 409 CONCURRENT_REQUEST so the merchant can retry shortly
    //      instead of getting a duplicate execution.
    let claimedIdempotency = false;
    if (merchantRef) {
      const slot = await claimIdempotencySlot(m.id, endpoint, merchantRef, requestHash);
      if (slot.kind === "in_progress") {
        await sendError(409, "CONCURRENT_REQUEST", m.id, parsedBody, {
          merchantRef,
          requestHash,
        });
        return;
      }
      if (slot.kind === "completed") {
        const hit = slot.row;
        if (hit.requestHash !== requestHash) {
          await sendError(409, "REF_PAYLOAD_MISMATCH", m.id, parsedBody, {
            merchantRef,
            requestHash,
          });
          return;
        }
        // serve cached
        await persistCall({
          merchantId: m.id,
          endpoint,
          method: req.method,
          ip,
          requestBody: parsedBody,
          responseBody: hit.responseBody as Record<string, unknown>,
          statusCode: hit.statusCode,
          errorCode: "IDEMPOTENT_REPLAY",
          latencyMs: Date.now() - startedAt,
          merchantRef,
          requestHash,
          cacheResponse: false,
        });
        res.status(hit.statusCode).json(hit.responseBody);
        return;
      }
      // Newly claimed — fall through to the handler.
      claimedIdempotency = true;
    }

    req.merchantCtx = {
      merchant: {
        id: m.id,
        name: m.name,
        is_active: m.isActive,
        merchant_type: m.merchantType,
        balance: Number(m.balance),
        credit_limit: Number(m.creditLimit),
        merchant_scope: m.merchantScope as "standalone" | "parent" | "child",
        parent_merchant_id: m.parentMerchantId,
        external_sub_merchant_ref: m.externalSubMerchantRef,
        per_tx_limit: m.perTxLimit == null ? null : Number(m.perTxLimit),
        daily_limit: m.dailyLimit == null ? null : Number(m.dailyLimit),
      },
      body: parsedBody,
      bodyText,
      requestHash,
      merchantRef,
      ip,
      respond: async (status, body, errorCode = null) => {
        await persistCall({
          merchantId: m.id,
          endpoint,
          method: req.method,
          ip,
          requestBody: parsedBody,
          responseBody: body,
          statusCode: status,
          errorCode,
          latencyMs: Date.now() - startedAt,
          merchantRef,
          requestHash,
          cacheResponse: merchantRef != null && errorCode == null && status < 500,
          claimedIdempotency,
        });
        res.status(status).json(body);
      },
    };

    next();
  };
}
