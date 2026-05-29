/**
 * Dev-only mock merchant endpoints. Gated by:
 *   - NODE_ENV !== 'production'
 *   - env.MOCK_FNS_ENABLED === true
 *
 * In production this whole router is not mounted (see app.ts).
 */
import { Router } from "express";
import { z } from "zod";
import { hmacSha256Hex } from "../lib/random";
import { ForbiddenError } from "../lib/errors";

export const devMocksRouter = Router();

devMocksRouter.use((_req, _res, next) => {
  next();
});

devMocksRouter.post("/mock-merchant/init", async (req, res, next) => {
  try {
    const b = z
      .object({
        internal_ref: z.string(),
        amount: z.coerce.number().positive(),
        customer_name: z.string().optional(),
        return_url: z.string().optional(),
        callback_url: z.string().optional(),
      })
      .parse(req.body);
    res.json({
      success: true,
      merchant_session_id: `mock_${Date.now()}`,
      iban: "TR12 0006 4000 0011 2345 6789 01",
      account_holder: "Mock Merchant A.S.",
      bank_name: "İş Bankası",
      payment_reference: `MOCK-${b.internal_ref}`,
    });
  } catch (e) { next(e); }
});

devMocksRouter.post("/mock-merchant/complete", async (req, res, next) => {
  try {
    const b = z
      .object({
        internal_ref: z.string().uuid(),
        amount: z.coerce.number().positive(),
        status: z.enum(["success", "failed"]),
        flow: z.enum(["topup", "withdraw"]),
        merchant_api_key: z.string(),
        merchant_signing_secret: z.string(),
        customer_name: z.string().optional(),
      })
      .parse(req.body);
    const path = b.flow === "topup" ? "/merchant-api/topup-callback" : "/merchant-api/withdraw-callback";
    const bodyObj =
      b.flow === "topup"
        ? {
            internal_ref: b.internal_ref,
            merchant_ref: `MOCK-${Date.now()}`,
            amount: b.amount,
            status: b.status,
            customer_name: b.customer_name ?? "Mock Customer",
            external_tx_id: `ext_${Date.now()}`,
          }
        : {
            internal_ref: b.internal_ref,
            merchant_ref: `MOCK-${Date.now()}`,
            status: b.status,
            external_tx_id: `ext_${Date.now()}`,
          };
    const bodyStr = JSON.stringify(bodyObj);
    const ts = Math.floor(Date.now() / 1000).toString();
    const sig = hmacSha256Hex(b.merchant_signing_secret, `${ts}:${bodyStr}`);

    const r = await fetch(`http://localhost:${process.env.PORT ?? 3000}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-merchant-key": b.merchant_api_key,
        "x-merchant-timestamp": ts,
        "x-merchant-signature": sig,
        "x-merchant-ref": `mock-${Date.now()}`,
      },
      body: bodyStr,
    });
    const callbackResponse = await r.json().catch(() => null);
    res.json({
      success: true,
      callback_status: r.status,
      callback_response: callbackResponse,
      merchant_ref: bodyObj.merchant_ref,
    });
  } catch (e) { next(e); }
});
