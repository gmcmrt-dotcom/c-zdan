/**
 * Akış A end-to-end test — signup → topup balance via SQL → create payment
 * code → merchant-charge with HMAC → verify balance + tx + idempotent replay.
 *
 * Requires:
 *   - Postgres 16 up on localhost:5433 (native install — Homebrew on macOS or apt postgresql-16 on Linux)
 *   - apps/api/.env populated (DATABASE_URL, JWT secrets, MERCHANT_HMAC_PEPPER…)
 *   - migrations + seed applied
 *
 * Run with: npx vitest run
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createHmac, randomBytes } from "node:crypto";
import { buildApp } from "../app";
import { db, sql as pg } from "../db/client";
import { sql } from "drizzle-orm";

const app = buildApp();

const SIGNING = `e2e_${randomBytes(8).toString("hex")}`;
const MERCHANT_API_KEY = `e2e_mk_${randomBytes(8).toString("hex")}`;
let merchantId = "";
let accessToken = "";
let userId = "";

beforeAll(async () => {
  // Ensure pgcrypto extension for digest()
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
  // Insert test merchant
  const rows = await db.execute<{ id: string }>(sql`
    INSERT INTO merchants(name, api_key, api_secret_hash, merchant_type, is_active,
      commission_pct, fixed_fee, signing_secret, signing_secret_set_at, merchant_scope)
    VALUES ('e2e', ${MERCHANT_API_KEY}, encode(digest('unused','sha256'),'hex'),
            'commerce', true, 2.5, 0, ${SIGNING}, now(), 'standalone')
    RETURNING id
  `);
  merchantId = (rows as unknown as Array<{ id: string }>)[0]!.id;

  // Signup a member
  const email = `e2e-${Date.now()}@example.com`;
  const res = await request(app)
    .post("/api/auth/signup")
    .send({ email, password: "Password1", firstName: "e2e", lastName: "user" });
  expect(res.status).toBe(201);
  accessToken = res.body.accessToken;
  userId = res.body.userId;

  // Give the member balance
  await db.execute(sql`UPDATE accounts SET balance=500 WHERE user_id=${userId}`);
});

afterAll(async () => {
  await db.execute(sql`DELETE FROM merchants WHERE id=${merchantId}`);
  await pg.end();
});

function sign(ts: string, body: string): string {
  return createHmac("sha256", SIGNING).update(`${ts}:${body}`).digest("hex");
}

describe("Akış A — payment code + merchant-charge", () => {
  let code = "";

  it("creates a payment code", async () => {
    const res = await request(app)
      .post("/api/wallet/payment-code")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ amount: 50, ttlSeconds: 600, customerName: "E2E User" });
    expect(res.status).toBe(201);
    expect(res.body.code).toMatch(/^\d{8}$/);
    code = res.body.code;
  });

  it("consumes via merchant-charge HMAC", async () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const body = JSON.stringify({ code, amount: 50, customer_name: "E2E User" });
    const res = await request(app)
      .post("/merchant-api/charge")
      .set("x-merchant-key", MERCHANT_API_KEY)
      .set("x-merchant-timestamp", ts)
      .set("x-merchant-signature", sign(ts, body))
      .set("x-merchant-ref", "e2e-order-1")
      .set("Content-Type", "application/json")
      .send(body);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.wallet_tx_no).toMatch(/^P-\d{8}-\d{6}$/);
  });

  it("is idempotent on replay", async () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const body = JSON.stringify({ code, amount: 50, customer_name: "E2E User" });
    const res = await request(app)
      .post("/merchant-api/charge")
      .set("x-merchant-key", MERCHANT_API_KEY)
      .set("x-merchant-timestamp", ts)
      .set("x-merchant-signature", sign(ts, body))
      .set("x-merchant-ref", "e2e-order-1") // same ref
      .set("Content-Type", "application/json")
      .send(body);
    expect(res.body.success).toBe(true);
    expect(res.body.wallet_tx_no).toMatch(/^P-\d{8}-\d{6}$/);
  });

  it("rejects bad signature", async () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const body = JSON.stringify({ code: "00000000", amount: 1, customer_name: "x" });
    const res = await request(app)
      .post("/merchant-api/charge")
      .set("x-merchant-key", MERCHANT_API_KEY)
      .set("x-merchant-timestamp", ts)
      .set("x-merchant-signature", "0".repeat(64))
      .set("Content-Type", "application/json")
      .send(body);
    expect(res.status).toBe(401);
    expect(res.body.error_code).toBe("BAD_SIGNATURE");
  });

  it("debits the member balance", async () => {
    const me = await request(app)
      .get("/api/me")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(me.body.profile.balance).toBe(450);
  });
});
