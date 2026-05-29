#!/usr/bin/env node
/**
 * Full-project smoke test. Hits every backend route surface end-to-end:
 *   - public health
 *   - auth (signup / login / refresh / me / mfa enroll / password / OTP)
 *   - member reads
 *   - wallet flows (Akış A preview + payment code create)
 *   - admin BO (dashboard, members, merchants, finance)
 *   - merchant BO (expected 403 unless merchant_users row exists)
 *   - chat
 *   - rpc shim (every supported RPC name)
 *   - fn shim (every supported edge fn name)
 *   - from shim (every allow-listed table)
 *   - public merchant-api (HMAC: charge + credit + bad sig + stale ts)
 *   - inbound webhooks (auth rejections)
 *   - storage signed-url
 *
 * Run:   node scripts/smoke-all.mjs           (against http://localhost:3000)
 *        BASE=http://localhost:3000 node scripts/smoke-all.mjs
 *
 * Exit code is the number of unexpected failures.
 */
import crypto from "node:crypto";
import { exec as execCb } from "node:child_process";
import { promisify } from "node:util";
import { authenticator } from "otplib";
const exec = promisify(execCb);

const BASE = process.env.BASE ?? "http://localhost:3000";

// P0-28 — Safety rail: this script performs ~170 destructive admin/member
// mutations against the API at BASE. If BASE points at anything other than
// localhost, refuse to run unless SMOKE_ALLOW_REMOTE=1 is set AND the
// operator typed the target host into SMOKE_CONFIRM_HOST. Without this
// guard a stray `BASE=https://prod.example.com node scripts/smoke-all.mjs`
// would nuke production using the committed default `Admin1234` password.
{
  let host = "localhost";
  try {
    host = new URL(BASE).hostname;
  } catch {
    console.error(`[smoke] BASE is not a valid URL: ${BASE}`);
    process.exit(2);
  }
  const isLocal = host === "localhost" || host === "127.0.0.1" || host === "::1";
  if (!isLocal) {
    const allow = process.env.SMOKE_ALLOW_REMOTE === "1" || process.env.SMOKE_ALLOW_REMOTE === "true";
    const confirmed = process.env.SMOKE_CONFIRM_HOST === host;
    if (!allow || !confirmed) {
      console.error(
        `\n[smoke] Refusing to target a non-localhost host (${host}). ` +
        `This script performs destructive mutations. To override, set BOTH:\n` +
        `  SMOKE_ALLOW_REMOTE=1\n` +
        `  SMOKE_CONFIRM_HOST=${host}\n` +
        `(and use --dry-run for read-only health checks.)\n`,
      );
      process.exit(2);
    }
  }
}

// Credentials come from env when available so local-only secrets never need
// to live in this committed file. Defaults match the dev bootstrap.
const ADMIN_EMAIL = process.env.SMOKE_ADMIN_EMAIL ?? "admin@wallet.local";
const ADMIN_PASS = process.env.SMOKE_ADMIN_PASS ?? "Admin1234";
const TEST_FIXTURE_PASS = process.env.TEST_FIXTURE_PASSWORD ?? "Test1234!";
const SMOKE_SIGNUP_PASS = "SmokeTest1234!";
const PG_PORT = process.env.SMOKE_PG_PORT ?? "5432";
const PG_HOST = process.env.SMOKE_PG_HOST ?? "localhost";
const PG = `PGPASSWORD=${process.env.SMOKE_PG_PASS ?? "wallet"} psql -h ${PG_HOST} -p ${PG_PORT} -U ${process.env.SMOKE_PG_USER ?? "wallet"} -d ${process.env.SMOKE_PG_DB ?? "wallet"} -tA -c`;

const FIXTURE_ACCOUNTS = {
  accounting: "accounting@wallet.local",
  support: "support@wallet.local",
  merchantOwner: "merchant.owner@wallet.local",
  merchantAccountant: "merchant.accountant@wallet.local",
  merchantReadonly: "merchant.readonly@wallet.local",
  merchantParent: "merchant.parent@wallet.local",
  merchantFinance: "merchant.finance@wallet.local",
  memberFrozen: "member.frozen@wallet.local",
};

const results = [];
const start = Date.now();

function color(c, s) {
  const codes = { red: 31, green: 32, yellow: 33, blue: 34, gray: 90, bold: 1 };
  return process.stdout.isTTY ? `\x1b[${codes[c] ?? 0}m${s}\x1b[0m` : s;
}

function previewBody(body) {
  if (body == null) return "";
  let s = typeof body === "string" ? body : JSON.stringify(body);
  return s.length > 180 ? s.slice(0, 180) + "…" : s;
}

async function call(name, method, path, opts = {}) {
  const url = path.startsWith("http") ? path : `${BASE}${path}`;
  const isForm = typeof FormData !== "undefined" && opts.body instanceof FormData;
  // Don't force a Content-Type when sending FormData — let fetch generate the
  // multipart boundary. JSON is the default everywhere else.
  const baseHeaders = isForm ? {} : { "Content-Type": "application/json" };
  const init = { method, headers: { ...baseHeaders, ...(opts.headers ?? {}) } };
  if (opts.body !== undefined) {
    init.body = isForm || opts.raw || typeof opts.body === "string"
      ? opts.body
      : JSON.stringify(opts.body);
  }
  const t0 = Date.now();
  let status = 0;
  let bodyText = "";
  let json = null;
  try {
    const res = await fetch(url, init);
    status = res.status;
    bodyText = await res.text();
    try { json = JSON.parse(bodyText); } catch { /* not json */ }
  } catch (err) {
    bodyText = `[network] ${err.message}`;
  }
  const ms = Date.now() - t0;
  const expect = opts.expect ?? ((s) => s >= 200 && s < 300);
  const ok = typeof expect === "function" ? expect(status, json) : expect === status;
  const verdict = ok ? "PASS" : "FAIL";
  // Auto-classify shim errors as WARN rather than FAIL
  const isShimGapErr =
    json && json.error && typeof json.error.code === "string" &&
    ["RPC_NOT_IMPLEMENTED", "FN_NOT_IMPLEMENTED", "TABLE_NOT_EXPOSED"].includes(json.error.code);
  const final = !ok && isShimGapErr ? "WARN" : verdict;
  results.push({ name, method, path, status, ms, verdict: final, code: extractCode(json), preview: previewBody(bodyText) });
  return { status, json, bodyText };
}

function extractCode(j) {
  if (!j) return "";
  if (j.error_code) return j.error_code;
  if (j.error && j.error.code) return j.error.code;
  return "";
}

function hmac(secret, msg) {
  return crypto.createHmac("sha256", secret).update(msg).digest("hex");
}

function sigHeaders(secret, body) {
  const ts = String(Math.floor(Date.now() / 1000));
  return {
    "x-merchant-timestamp": ts,
    "x-merchant-signature": hmac(secret, `${ts}:${body}`),
  };
}

async function ensurePgcrypto() {
  try {
    await exec(`${PG} "CREATE EXTENSION IF NOT EXISTS pgcrypto;"`);
  } catch {
    /* optional — digest() may already be available */
  }
}

async function fixtureLogin(label, email, password = TEST_FIXTURE_PASS) {
  const res = await call(`bo.login.${label}`, "POST", "/api/auth/login", {
    body: { email, password },
  });
  const token = res.json?.accessToken;
  return token ? { Authorization: `Bearer ${token}` } : null;
}

async function main() {
  console.log(color("blue", `Smoke against ${BASE}\n`));

  // ----------------------------- public -----------------------------
  await call("public.health", "GET", "/health");
  await call("public.readyz", "GET", "/readyz");

  // ----------------------------- auth ------------------------------
  const tempEmail = `smoke-${Date.now()}@example.com`;
  const signup = await call("auth.signup", "POST", "/api/auth/signup", {
    expect: 201,
    body: { email: tempEmail, password: SMOKE_SIGNUP_PASS, firstName: "smoke", lastName: "user" },
  });
  const tempAccess = signup.json?.accessToken;
  const tempRefresh = signup.json?.refreshToken;
  const tempUserId = signup.json?.userId;

  await call("auth.identifier-exists", "POST", "/api/auth/identifier-exists", {
    body: { email: tempEmail },
  });
  await call("auth.login.admin", "POST", "/api/auth/login", {
    body: { email: ADMIN_EMAIL, password: ADMIN_PASS },
  });
  const adminLogin = await call("auth.login.admin.2", "POST", "/api/auth/login", {
    body: { email: ADMIN_EMAIL, password: ADMIN_PASS },
  });
  const adminAccess = adminLogin.json?.accessToken;
  const adminRefresh = adminLogin.json?.refreshToken;
  const A = { Authorization: `Bearer ${adminAccess}` };

  // Fixture BO logins early — before rate-limit window fills up
  const FIX_ACC = await fixtureLogin("accounting", FIXTURE_ACCOUNTS.accounting);
  const FIX_SUP = await fixtureLogin("support", FIXTURE_ACCOUNTS.support);
  const FIX_MO = await fixtureLogin("merchant-owner", FIXTURE_ACCOUNTS.merchantOwner);
  const FIX_MA = await fixtureLogin("merchant-accountant", FIXTURE_ACCOUNTS.merchantAccountant);
  const FIX_MR = await fixtureLogin("merchant-readonly", FIXTURE_ACCOUNTS.merchantReadonly);
  const FIX_MP = await fixtureLogin("merchant-parent", FIXTURE_ACCOUNTS.merchantParent);
  const FIX_MF = await fixtureLogin("merchant-finance", FIXTURE_ACCOUNTS.merchantFinance);

  const T = { Authorization: `Bearer ${tempAccess}` };

  await call("auth.me.admin", "GET", "/api/auth/me", { headers: A });
  await call("auth.me.temp", "GET", "/api/auth/me", { headers: T });
  await call("auth.refresh", "POST", "/api/auth/refresh", {
    body: { refreshToken: tempRefresh },
  });
  await call("auth.record-login", "POST", "/api/auth/record-login", { headers: T });
  await call("auth.password-reset.req", "POST", "/api/auth/password/reset-request", {
    body: { email: tempEmail },
  });
  await call("auth.profile-change-otp.request", "POST", "/api/auth/profile-change-otp", {
    headers: T,
    body: { action: "request", changeType: "phone", newValue: "5551110000" },
  });
  const enroll = await call("auth.mfa.enroll", "POST", "/api/auth/mfa/enroll", {
    headers: T,
    body: { friendlyName: "smoke" },
  });
  if (enroll.json?.factorId && enroll.json?.secret) {
    const mfaCode = authenticator.generate(enroll.json.secret);
    await call("auth.mfa.unenroll", "POST", "/api/auth/mfa/unenroll", {
      headers: T,
      body: { factorId: enroll.json.factorId, code: mfaCode },
    });
  }

  await call("auth.logout.temp", "POST", "/api/auth/logout", {
    headers: T,
    body: { refreshToken: tempRefresh },
  });

  // ----------------------------- member -----------------------------
  await call("me.profile", "GET", "/api/me", { headers: A });
  await call("me.tx", "GET", "/api/me/transactions?limit=5", { headers: A });
  await call("me.loyalty", "GET", "/api/me/loyalty", { headers: A });
  await call("me.profit-share", "GET", "/api/me/profit-share", { headers: A });
  await call("me.referrals.link", "GET", "/api/me/referrals/link", { headers: A });
  await call("me.referrals.stats", "GET", "/api/me/referrals/stats", { headers: A });
  await call("me.referrals.list", "GET", "/api/me/referrals", { headers: A });
  await call("me.notifications", "GET", "/api/me/notifications", { headers: A });
  await call("me.notifications.unread", "GET", "/api/me/notifications/unread-count", { headers: A });
  await call("me.notifications.markall", "POST", "/api/me/notifications/mark-all-read", { headers: A });
  await call("me.methods.topup", "GET", "/api/me/method-types?direction=topup", { headers: A });
  await call("me.methods.withdraw", "GET", "/api/me/method-types?direction=withdraw", { headers: A });

  // ----------------------------- wallet (Akış A preview + code) -----
  // Admin doesn't have a balance, so preview will likely fail with INSUFFICIENT_FUNDS.
  await call("wallet.preview-spend.no-funds", "POST", "/api/wallet/payment-code/preview", {
    headers: A,
    expect: (s) => s === 422 || s === 200,
    body: { amount: 5 },
  });
  // Top up admin via SQL then retry
  await exec(`${PG} "UPDATE payment_codes SET status='cancelled' WHERE user_id=(SELECT id FROM users WHERE email='${ADMIN_EMAIL}') AND status='active';"`);
  await exec(`${PG} "UPDATE accounts SET balance=500 WHERE user_id=(SELECT id FROM users WHERE email='${ADMIN_EMAIL}');"`);
  await call("wallet.preview-spend.funded", "POST", "/api/wallet/payment-code/preview", {
    headers: A,
    body: { amount: 50 },
  });
  const pc = await call("wallet.payment-code.create", "POST", "/api/wallet/payment-code", {
    headers: A,
    expect: 201,
    body: { amount: 50, ttlSeconds: 600, customerName: "Admin User" },
  });
  const pcCode = pc.json?.code;
  const pcId = pc.json?.id;
  if (pcId) {
    await call("wallet.payment-code.cancel", "POST", `/api/wallet/payment-code/${pcId}/cancel`, {
      headers: A,
    });
  }

  await call("wallet.topup.pending", "GET", "/api/wallet/topup/pending", { headers: A });
  await call("wallet.aninda.tokens", "GET", "/api/wallet/aninda/tokens", { headers: A });

  // ----------------------------- admin -----------------------------
  await call("admin.dashboard.stats", "GET", "/api/admin/dashboard/stats", { headers: A });
  await call("admin.members.list", "GET", "/api/admin/members?limit=5", { headers: A });
  await call("admin.members.summary", "GET", "/api/admin/members/summary", { headers: A });
  await call("admin.members.login-history", "GET", `/api/admin/members/${tempUserId}/login-history`, { headers: A });
  await call("admin.merchants.list", "GET", "/api/admin/merchants", { headers: A });
  await call("admin.merchants.list.commerce", "GET", "/api/admin/merchants?type=commerce", { headers: A });
  await call("admin.merchants.list.finance", "GET", "/api/admin/merchants?type=finance", { headers: A });

  // Pick first merchant id if any exists
  const mlist = await call("admin.merchants.list.again", "GET", "/api/admin/merchants", { headers: A });
  const firstMerchant = mlist.json?.rows?.[0];
  if (firstMerchant) {
    await call("admin.merchants.detail", "GET", `/api/admin/merchants/${firstMerchant.id}`, { headers: A });
    await call("admin.merchants.children", "GET", `/api/admin/merchants/${firstMerchant.id}/children`, { headers: A });
    const since = "2024-01-01T00:00:00.000Z";
    const until = new Date().toISOString();
    await call(
      "admin.merchants.financial-summary",
      "GET",
      `/api/admin/merchants/${firstMerchant.id}/financial-summary?startDate=${since}&endDate=${until}`,
      { headers: A },
    );
  }
  await call("admin.finance-merchants", "GET", "/api/admin/finance-merchants", { headers: A });
  // Mutation: freeze + unfreeze a temp user (audit-logged)
  await call("admin.member.freeze", "POST", `/api/admin/members/${tempUserId}/freeze`, {
    headers: A,
    body: { frozen: true, reason: "smoke-test" },
  });
  await call("admin.member.unfreeze", "POST", `/api/admin/members/${tempUserId}/freeze`, {
    headers: A,
    body: { frozen: false, reason: "smoke-test undo" },
  });

  // ----------------------------- merchant BO (expect 403) -----------
  await call("merchant.self.no-merchant-row", "GET", "/api/merchant/self", {
    headers: A,
    expect: (s) => s === 403 || s === 200,
  });

  // ----------------------------- chat -----------------------------
  const thread = await call("chat.create-thread", "POST", "/api/chat/threads", {
    headers: A,
    expect: 201,
    body: {
      category: "general",
      subject: "smoke test thread",
      body: "hello from smoke",
    },
  });
  const threadId = thread.json?.threadId;
  if (threadId) {
    await call("chat.post-message", "POST", `/api/chat/threads/${threadId}/messages`, {
      headers: A,
      body: { body: "second message" },
    });
    await call("chat.ai-reply", "POST", `/api/chat/threads/${threadId}/ai-reply`, {
      headers: A,
    });
    await call("chat.staff.claim", "POST", `/api/chat/staff/threads/${threadId}/claim`, {
      headers: A,
    });
    await call("chat.staff.status", "POST", `/api/chat/staff/threads/${threadId}/status`, {
      headers: A,
      body: { status: "resolved" },
    });
  }

  // ----------------------------- rpc shim -----------------------------
  const RPCS = [
    ["my_permissions", {}],
    ["auth_merchant_id", {}],
    ["requires_mfa", { _user_id: tempUserId }],
    ["my_transactions", { _limit: 5 }],
    ["my_loyalty_summary", {}],
    ["my_profit_share_rewards", {}],
    ["get_my_referral_link", {}],
    ["get_my_referral_stats", {}],
    ["get_my_referrals", {}],
    ["list_active_topup_method_types", {}],
    ["list_active_withdraw_method_types", {}],
    ["preview_spend", { _amount: 25 }],
    ["get_pending_topup", {}],
    ["admin_dashboard_stats", {}],
    ["admin_members_summary", {}],
    ["admin_list_members", { _limit: 5, _frozen_filter: "all", _kyc_filter: "all", _reserved_only: false }],
    ["staff_list_finance_merchants", {}],
    ["merchant_self", {}],
    ["profile_identifier_exists", { _email: tempEmail }],
    ["log_error", {
      _surface: "frontend",
      _error_code: "SMOKE_TEST",
      _error_message: "intentional from smoke",
    }],
  ];
  for (const [name, body] of RPCS) {
    await call(`rpc.${name}`, "POST", `/api/rpc/${name}`, { headers: A, body });
  }

  // ----------------------------- fn shim -----------------------------
  const FNS = [
    ["aninda-kripto-tokens", {}],
    ["record-login-ip", {}],
    ["admin-finance-integration-test", { merchant_id: firstMerchant?.id ?? "00000000-0000-0000-0000-000000000000" }],
    ["admin-cash-pool-sync", { merchant_id: firstMerchant?.id ?? "00000000-0000-0000-0000-000000000000" }],
    ["bo-ai-assistant", { question: "ping", page_path: "/admin" }],
    ["chat-attachment-scan", { attachment_id: "00000000-0000-0000-0000-000000000000" }],
  ];
  for (const [name, body] of FNS) {
    await call(`fn.${name}`, "POST", `/api/fn/${name}`, { headers: A, body });
  }

  // ----------------------------- from shim ----------------------------
  const FROMS = [
    ["user_roles", { op: "select" }],
    ["bo_permissions", { op: "select" }],
    ["user_permission_overrides", { op: "select" }],
    ["profiles", { op: "select", maybeSingle: true, where: [{ col: "id", op: "eq", val: tempUserId }] }],
    ["notifications", { op: "select", limit: 5 }],
    ["chat_threads", { op: "select", head: true, count: "exact", where: [{ col: "status", op: "in", val: ["open", "pending_staff"] }] }],
    ["merchant_api_calls", { op: "select", limit: 5 }],
    ["system_logs", { op: "select", limit: 5 }],
    ["nonexistent_table", { op: "select" }], // expect WARN: TABLE_NOT_EXPOSED
  ];
  for (const [t, body] of FROMS) {
    await call(`from.${t}`, "POST", `/api/from/${t}`, { headers: A, body });
  }

  // ----------------------------- public merchant-api (HMAC) ------------
  // Ensure a known commerce merchant exists with predictable secret
  await ensurePgcrypto();
  const SIG_SECRET = `e2e_${Date.now()}`;
  await exec(`${PG} "
    INSERT INTO merchants(name, api_key, api_secret_hash, merchant_type, is_active, commission_pct, fixed_fee,
                         signing_secret, signing_secret_set_at, merchant_scope, balance, credit_limit)
    VALUES ('Smoke', 'tk_smoke', encode(digest('x','sha256'),'hex'), 'commerce', true, 1, 0,
            '${SIG_SECRET}', now(), 'standalone', 1000, 0)
    ON CONFLICT (api_key) DO UPDATE SET signing_secret='${SIG_SECRET}', signing_secret_set_at=now();
  "`);
  // Need a fresh payment code from admin (after balance refill above)
  const pc2 = await call("wallet.payment-code.fresh", "POST", "/api/wallet/payment-code", {
    headers: A,
    expect: 201,
    body: { amount: 25, ttlSeconds: 600, customerName: "Admin User" },
  });
  const charge2 = pc2.json?.code;
  if (charge2) {
    const body = JSON.stringify({ code: charge2, amount: 25, customer_name: "Admin User" });
    const runRef = `smoke-${Date.now()}`; // unique per run for idempotency cache
    await call("merchantapi.charge.success", "POST", "/merchant-api/charge", {
      headers: { "x-merchant-key": "tk_smoke", "x-merchant-ref": runRef, ...sigHeaders(SIG_SECRET, body) },
      body,
      raw: true,
    });
    // Idempotent replay
    await call("merchantapi.charge.replay", "POST", "/merchant-api/charge", {
      headers: { "x-merchant-key": "tk_smoke", "x-merchant-ref": runRef, ...sigHeaders(SIG_SECRET, body) },
      body,
      raw: true,
    });
  }
  // Bad signature → 401
  const badBody = JSON.stringify({ code: "00000000", amount: 1, customer_name: "x" });
  await call("merchantapi.charge.bad-sig", "POST", "/merchant-api/charge", {
    expect: 401,
    headers: {
      "x-merchant-key": "tk_smoke",
      "x-merchant-timestamp": String(Math.floor(Date.now() / 1000)),
      "x-merchant-signature": "0".repeat(64),
    },
    body: badBody,
    raw: true,
  });
  // Stale timestamp → 401
  await call("merchantapi.charge.stale-ts", "POST", "/merchant-api/charge", {
    expect: 401,
    headers: {
      "x-merchant-key": "tk_smoke",
      "x-merchant-timestamp": "1000",
      "x-merchant-signature": hmac(SIG_SECRET, `1000:${badBody}`),
    },
    body: badBody,
    raw: true,
  });

  // Akış B credit
  const memberNo = (await exec(`${PG} "SELECT member_no FROM profiles WHERE id=(SELECT id FROM users WHERE email='${ADMIN_EMAIL}');"`)).stdout.trim();
  if (memberNo) {
    const creditBody = JSON.stringify({ wallet_no: memberNo, customer_name: "Admin User", amount: 50 });
    await call("merchantapi.credit", "POST", "/merchant-api/credit", {
      headers: { "x-merchant-key": "tk_smoke", "x-merchant-ref": `smoke-cr-${Date.now()}`, ...sigHeaders(SIG_SECRET, creditBody) },
      body: creditBody,
      raw: true,
    });
  }

  // Deprecated withdraw endpoint
  await call("merchantapi.withdraw.deprecated", "POST", "/merchant-api/withdraw", {
    expect: 403,
    headers: { "x-merchant-key": "tk_smoke", ...sigHeaders(SIG_SECRET, "{}") },
    body: "{}",
    raw: true,
  });

  // ----------------------------- webhooks --------------------------
  await call("webhooks.aninda.deposit.bad-key", "POST", "/webhooks/aninda/deposit", {
    expect: 401,
    body: { Key: "wrong" },
  });
  await call("webhooks.merchant.cashout.no-sig", "POST", "/webhooks/merchant/cashout", {
    expect: (s) => s === 401 || s === 503,
    body: {},
  });

  // ----------------------------- storage --------------------------
  await call("storage.signed-url.gen", "GET", "/storage/chat-attachments/signed-url?path=test/x.png&ttlSeconds=60", {
    headers: A,
  });

  // =================================================================
  // EXTENDED COMBINATIONS
  // =================================================================

  // ========== auth: negative paths ==========
  await call("auth.signup.weak-pw", "POST", "/api/auth/signup", {
    expect: 400,
    body: { email: `weak-${Date.now()}@x.com`, password: "abc", firstName: "x", lastName: "y" },
  });
  await call("auth.signup.invalid-email", "POST", "/api/auth/signup", {
    expect: 400,
    body: { email: "not-an-email", password: "SmokeTest1234!", firstName: "x", lastName: "y" },
  });
  await call("auth.signup.dup-email", "POST", "/api/auth/signup", {
    expect: 409,
    body: { email: ADMIN_EMAIL, password: "SmokeTest1234!", firstName: "x", lastName: "y" },
  });
  await call("auth.signup.dup-phone", "POST", "/api/auth/signup", {
    expect: (s) => s === 201 || s === 409,
    body: {
      email: `phone-${Date.now()}@x.com`,
      password: "SmokeTest1234!",
      firstName: "x",
      lastName: "y",
      phone: "5550000001",
    },
  });
  await call("auth.signup.dup-phone.again", "POST", "/api/auth/signup", {
    expect: 409,
    body: {
      email: `phone-other-${Date.now()}@x.com`,
      password: "SmokeTest1234!",
      firstName: "x",
      lastName: "y",
      phone: "5550000001",
    },
  });
  await call("auth.login.bad-pw", "POST", "/api/auth/login", {
    expect: 401,
    body: { email: ADMIN_EMAIL, password: "wrong-password" },
  });
  await call("auth.login.nonexistent", "POST", "/api/auth/login", {
    expect: 401,
    body: { email: "nope@nowhere.com", password: "x" },
  });
  await call("auth.me.no-token", "GET", "/api/auth/me", { expect: 401, headers: {} });
  await call("auth.me.bad-token", "GET", "/api/auth/me", {
    expect: 401,
    headers: { Authorization: "Bearer junk-token" },
  });
  await call("auth.refresh.bad", "POST", "/api/auth/refresh", {
    expect: 401,
    body: { refreshToken: "junk" },
  });
  // Already-revoked refresh: use the one we logged out earlier
  await call("auth.refresh.revoked", "POST", "/api/auth/refresh", {
    expect: 401,
    body: { refreshToken: tempRefresh },
  });
  // MFA challenge with no factor enrolled
  await call("auth.mfa.challenge.no-factor", "POST", "/api/auth/mfa/challenge", {
    expect: 403,
    headers: A,
    body: { code: "000000" },
  });

  // ========== wallet money flow combinations (Akış A) ==========
  await call("wallet.preview.zero", "POST", "/api/wallet/payment-code/preview", {
    expect: 400,
    headers: A,
    body: { amount: 0 },
  });
  await call("wallet.preview.negative", "POST", "/api/wallet/payment-code/preview", {
    expect: 400,
    headers: A,
    body: { amount: -10 },
  });
  // Force a known balance + clear reserved so over/exact-balance preview is deterministic.
  // Reserved may be > 0 from earlier payment codes created in this run.
  await exec(`${PG} "UPDATE accounts SET balance=100, reserved_balance=0 WHERE user_id=(SELECT id FROM users WHERE email='${ADMIN_EMAIL}');"`);
  await call("wallet.preview.over-balance", "POST", "/api/wallet/payment-code/preview", {
    expect: 422,
    headers: A,
    body: { amount: 1000 },
  });
  await call("wallet.preview.exact-balance", "POST", "/api/wallet/payment-code/preview", {
    expect: 200,
    headers: A,
    body: { amount: 100 },
  });
  await call("wallet.code.ttl-too-short", "POST", "/api/wallet/payment-code", {
    expect: 400,
    headers: A,
    body: { amount: 5, ttlSeconds: 10, customerName: "Admin User" },
  });
  await call("wallet.code.ttl-too-long", "POST", "/api/wallet/payment-code", {
    expect: 400,
    headers: A,
    body: { amount: 5, ttlSeconds: 99999, customerName: "Admin User" },
  });

  // Re-fill balance; cancel stale payment codes so ref-conflict combos stay deterministic.
  await exec(`${PG} "UPDATE accounts SET balance=500 WHERE user_id=(SELECT id FROM users WHERE email='${ADMIN_EMAIL}');"`);
  await exec(`${PG} "UPDATE payment_codes SET status='cancelled' WHERE user_id=(SELECT id FROM users WHERE email='${ADMIN_EMAIL}') AND status='active';"`);

  // ========== merchant-api combinations (using tk_smoke from earlier section) ==========
  // CODE_USED: consume same code twice with different ref
  const pcReuse = await call("wallet.code.reuse-setup", "POST", "/api/wallet/payment-code", {
    expect: 201,
    headers: A,
    body: { amount: 15, ttlSeconds: 600, customerName: "Admin User" },
  });
  const reuseCode = pcReuse.json?.code;
  if (reuseCode) {
    const bodyOk = JSON.stringify({ code: reuseCode, amount: 15, customer_name: "Admin User" });
    await call("merchantapi.charge.first-use", "POST", "/merchant-api/charge", {
      headers: { "x-merchant-key": "tk_smoke", "x-merchant-ref": `rs1-${Date.now()}`, ...sigHeaders(SIG_SECRET, bodyOk) },
      body: bodyOk,
      raw: true,
    });
    await call("merchantapi.charge.code-used", "POST", "/merchant-api/charge", {
      expect: 409,
      headers: { "x-merchant-key": "tk_smoke", "x-merchant-ref": `rs2-${Date.now()}`, ...sigHeaders(SIG_SECRET, bodyOk) },
      body: bodyOk,
      raw: true,
    });
  }
  // NAME_MISMATCH
  const pcName = await call("wallet.code.name-mismatch-setup", "POST", "/api/wallet/payment-code", {
    expect: 201,
    headers: A,
    body: { amount: 10, ttlSeconds: 600, customerName: "Admin User" },
  });
  if (pcName.json?.code) {
    const bodyBad = JSON.stringify({ code: pcName.json.code, amount: 10, customer_name: "Wrong Person" });
    await call("merchantapi.charge.name-mismatch", "POST", "/merchant-api/charge", {
      expect: 422,
      headers: { "x-merchant-key": "tk_smoke", "x-merchant-ref": `nm-${Date.now()}`, ...sigHeaders(SIG_SECRET, bodyBad) },
      body: bodyBad,
      raw: true,
    });
  }
  // AMOUNT_MISMATCH
  const pcAmt = await call("wallet.code.amount-mismatch-setup", "POST", "/api/wallet/payment-code", {
    expect: 201,
    headers: A,
    body: { amount: 20, ttlSeconds: 600, customerName: "Admin User" },
  });
  if (pcAmt.json?.code) {
    const bodyBad = JSON.stringify({ code: pcAmt.json.code, amount: 99, customer_name: "Admin User" });
    await call("merchantapi.charge.amount-mismatch", "POST", "/merchant-api/charge", {
      expect: 422,
      headers: { "x-merchant-key": "tk_smoke", "x-merchant-ref": `am-${Date.now()}`, ...sigHeaders(SIG_SECRET, bodyBad) },
      body: bodyBad,
      raw: true,
    });
  }
  // REF_PAYLOAD_MISMATCH: reuse merchant_ref with different payload
  const refConflict = `rc-${Date.now()}`;
  const pcRef1 = await call("wallet.code.ref-conflict-1", "POST", "/api/wallet/payment-code", {
    expect: 201,
    headers: A,
    body: { amount: 8, ttlSeconds: 600, customerName: "Admin User" },
  });
  const pcRef2 = await call("wallet.code.ref-conflict-2", "POST", "/api/wallet/payment-code", {
    expect: 201,
    headers: A,
    body: { amount: 9, ttlSeconds: 600, customerName: "Admin User" },
  });
  if (pcRef1.json?.code && pcRef2.json?.code) {
    const b1 = JSON.stringify({ code: pcRef1.json.code, amount: 8, customer_name: "Admin User" });
    const b2 = JSON.stringify({ code: pcRef2.json.code, amount: 9, customer_name: "Admin User" });
    await call("merchantapi.charge.first-ref", "POST", "/merchant-api/charge", {
      headers: { "x-merchant-key": "tk_smoke", "x-merchant-ref": refConflict, ...sigHeaders(SIG_SECRET, b1) },
      body: b1,
      raw: true,
    });
    await call("merchantapi.charge.ref-conflict", "POST", "/merchant-api/charge", {
      expect: 409,
      headers: { "x-merchant-key": "tk_smoke", "x-merchant-ref": refConflict, ...sigHeaders(SIG_SECRET, b2) },
      body: b2,
      raw: true,
    });
  }
  // Missing fields → BAD_BODY
  const missingBody = JSON.stringify({ amount: 5 });
  await call("merchantapi.charge.bad-body", "POST", "/merchant-api/charge", {
    expect: 400,
    headers: { "x-merchant-key": "tk_smoke", "x-merchant-ref": `bb-${Date.now()}`, ...sigHeaders(SIG_SECRET, missingBody) },
    body: missingBody,
    raw: true,
  });
  // Bad JSON
  const garbage = "{not json";
  await call("merchantapi.charge.bad-json", "POST", "/merchant-api/charge", {
    expect: 400,
    headers: { "x-merchant-key": "tk_smoke", "x-merchant-ref": `bj-${Date.now()}`, ...sigHeaders(SIG_SECRET, garbage) },
    body: garbage,
    raw: true,
  });
  // Unknown API key
  const okBody = JSON.stringify({ code: "00000000", amount: 1, customer_name: "x" });
  await call("merchantapi.charge.invalid-key", "POST", "/merchant-api/charge", {
    expect: 401,
    headers: {
      "x-merchant-key": "tk_does_not_exist",
      "x-merchant-timestamp": String(Math.floor(Date.now() / 1000)),
      "x-merchant-signature": hmac("anything", `${Math.floor(Date.now() / 1000)}:${okBody}`),
    },
    body: okBody,
    raw: true,
  });
  // Akış B: NAME_MISMATCH
  const memberNo2 = (await exec(`${PG} "SELECT member_no FROM profiles WHERE id=(SELECT id FROM users WHERE email='${ADMIN_EMAIL}');"`)).stdout.trim();
  if (memberNo2) {
    const bodyNM = JSON.stringify({ wallet_no: memberNo2, customer_name: "Totally Wrong", amount: 5 });
    await call("merchantapi.credit.name-mismatch", "POST", "/merchant-api/credit", {
      expect: 422,
      headers: { "x-merchant-key": "tk_smoke", "x-merchant-ref": `cnm-${Date.now()}`, ...sigHeaders(SIG_SECRET, bodyNM) },
      body: bodyNM,
      raw: true,
    });
    // Akış B: MEMBER_NOT_FOUND
    const bodyMNF = JSON.stringify({ wallet_no: "99999999", customer_name: "Admin User", amount: 5 });
    await call("merchantapi.credit.member-not-found", "POST", "/merchant-api/credit", {
      expect: 404,
      headers: { "x-merchant-key": "tk_smoke", "x-merchant-ref": `cmnf-${Date.now()}`, ...sigHeaders(SIG_SECRET, bodyMNF) },
      body: bodyMNF,
      raw: true,
    });
    // Akış B: INSUFFICIENT_MERCHANT_BALANCE (huge amount > balance+credit)
    const bodyHuge = JSON.stringify({ wallet_no: memberNo2, customer_name: "Admin User", amount: 100000 });
    await call("merchantapi.credit.insufficient", "POST", "/merchant-api/credit", {
      expect: 422,
      headers: { "x-merchant-key": "tk_smoke", "x-merchant-ref": `cins-${Date.now()}`, ...sigHeaders(SIG_SECRET, bodyHuge) },
      body: bodyHuge,
      raw: true,
    });
  }

  // ========== admin: filter combos ==========
  await call("admin.members.filter.frozen", "GET", "/api/admin/members?frozenFilter=frozen&limit=5", { headers: A });
  await call("admin.members.filter.active", "GET", "/api/admin/members?frozenFilter=active&limit=5", { headers: A });
  await call("admin.members.filter.kyc.verified", "GET", "/api/admin/members?kycFilter=verified&limit=5", { headers: A });
  await call("admin.members.filter.search", "GET", `/api/admin/members?search=${encodeURIComponent(ADMIN_EMAIL.slice(0, 5))}&limit=5`, { headers: A });
  await call("admin.members.sort.email-asc", "GET", "/api/admin/members?sortBy=email&sortDir=asc&limit=5", { headers: A });
  await call("admin.members.sort.member_no", "GET", "/api/admin/members?sortBy=member_no&sortDir=desc&limit=5", { headers: A });
  // Mutations + audit log verification
  await call("admin.member.kyc.verified", "POST", `/api/admin/members/${tempUserId}/kyc`, {
    headers: A,
    body: { status: "verified", reason: "smoke" },
  });
  await call("admin.member.balance.credit", "POST", `/api/admin/members/${tempUserId}/balance/adjust`, {
    headers: A,
    body: { amount: 25, reason: "smoke credit" },
  });
  await call("admin.member.balance.debit", "POST", `/api/admin/members/${tempUserId}/balance/adjust`, {
    headers: A,
    body: { amount: -10, reason: "smoke debit" },
  });
  await call("admin.member.balance.zero-rejected", "POST", `/api/admin/members/${tempUserId}/balance/adjust`, {
    expect: 400,
    headers: A,
    body: { amount: 0, reason: "smoke" },
  });
  await call("admin.member.points.award", "POST", `/api/admin/members/${tempUserId}/points/award`, {
    headers: A,
    body: { points: 100, reason: "smoke points" },
  });
  // Merchant create + commission + limits + credit-limit
  const newMerch = await call("admin.merchant.create", "POST", "/api/admin/merchants", {
    expect: 201,
    headers: A,
    body: { name: `Smoke-${Date.now()}`, type: "commerce", commissionPct: 1.5 },
  });
  if (newMerch.json?.id) {
    const mid = newMerch.json.id;
    await call("admin.merchant.set-commission", "POST", `/api/admin/merchants/${mid}/commission`, {
      headers: A,
      body: { commissionPct: 2, fixedFee: 0 },
    });
    await call("admin.merchant.set-limits", "POST", `/api/admin/merchants/${mid}/limits`, {
      headers: A,
      body: { perTxLimit: 5000, dailyLimit: 50000, depositMin: 1, depositMax: 100000 },
    });
    await call("admin.merchant.credit-limit", "POST", `/api/admin/merchants/${mid}/credit-limit`, {
      headers: A,
      body: { newLimit: 1000, reason: "smoke" },
    });
    await call("admin.merchant.credit-limit.negative", "POST", `/api/admin/merchants/${mid}/credit-limit`, {
      expect: 400,
      headers: A,
      body: { newLimit: -1, reason: "smoke" },
    });
    await call("admin.merchant.manual-settlement", "POST", `/api/admin/merchants/${mid}/manual-settlement`, {
      headers: A,
      body: { amount: 100, notes: "smoke" },
    });
    await call("admin.merchant.rotate-secret", "POST", `/api/admin/merchants/${mid}/rotate-secret`, {
      headers: A,
    });
    await call("admin.merchant.attach-user", "POST", `/api/admin/merchants/${mid}/users`, {
      headers: A,
      body: { email: `m-user-${Date.now()}@x.com`, role: "accountant" },
    });
  }

  // ========== from shim: insert + delete CRUD ==========
  // user_roles: add support role to temp user, then remove
  await call("from.user_roles.insert", "POST", "/api/from/user_roles", {
    headers: A,
    body: { op: "insert", values: { user_id: tempUserId, role: "support" } },
  });
  await call("from.user_roles.select-temp", "POST", "/api/from/user_roles", {
    headers: A,
    body: { op: "select", where: [{ col: "user_id", op: "eq", val: tempUserId }] },
  });
  await call("from.user_roles.delete", "POST", "/api/from/user_roles", {
    headers: A,
    body: { op: "delete", where: [{ col: "user_id", op: "eq", val: tempUserId }, { col: "role", op: "eq", val: "support" }] },
  });
  // user_permission_overrides: insert deny + cleanup
  const ovIns = await call("from.user_permission_overrides.insert", "POST", "/api/from/user_permission_overrides", {
    headers: A,
    body: { op: "insert", values: { user_id: tempUserId, resource: "members", action: "freeze", granted: false, reason: "smoke" } },
  });
  if (ovIns.json?.data?.id) {
    await call("from.user_permission_overrides.delete", "POST", "/api/from/user_permission_overrides", {
      headers: A,
      body: { op: "delete", where: [{ col: "id", op: "eq", val: ovIns.json.data.id }] },
    });
  }

  // ========== RBAC negative: non-staff + restricted-role denials ==========
  // tempUserId currently has no role → all /api/admin/* must be 403 STAFF_REQUIRED
  await call("rbac.non-staff.admin-members", "GET", "/api/admin/members", {
    expect: 403,
    headers: T,
  });
  await call("rbac.non-staff.admin-dashboard", "GET", "/api/admin/dashboard/stats", {
    expect: 403,
    headers: T,
  });
  await call("rbac.non-staff.merchant-self", "GET", "/api/merchant/self", {
    expect: 403,
    headers: T,
  });
  // Grant temp user accounting role then try mutation it shouldn't have (freeze requires members:freeze)
  await exec(`${PG} "INSERT INTO user_roles(user_id, role) VALUES ('${tempUserId}', 'accounting') ON CONFLICT DO NOTHING;"`);
  const tempReloginR = await call("rbac.acc-login", "POST", "/api/auth/login", {
    body: { email: tempEmail, password: "SmokeTest1234!" },
  });
  const accAccess = tempReloginR.json?.accessToken;
  const ACC = { Authorization: `Bearer ${accAccess}` };
  if (accAccess) {
    await call("rbac.accounting.read-allowed", "GET", "/api/admin/members?limit=2", { headers: ACC });
    await call("rbac.accounting.freeze-denied", "POST", `/api/admin/members/${tempUserId}/freeze`, {
      expect: 403,
      headers: ACC,
      body: { frozen: true, reason: "should be blocked" },
    });
    await call("rbac.accounting.balance-adjust-denied", "POST", `/api/admin/members/${tempUserId}/balance/adjust`, {
      expect: 403,
      headers: ACC,
      body: { amount: 1, reason: "blocked" },
    });
    await call("rbac.accounting.create-merchant-denied", "POST", "/api/admin/merchants", {
      expect: 403,
      headers: ACC,
      body: { name: "x", type: "commerce" },
    });
  }

  // ========== storage round-trip ==========
  // Generate signed URL, then fetch the (non-existent) file → 404
  const signed = await call("storage.signed-url.generate", "GET", "/storage/chat-attachments/signed-url?path=test/notreal.png&ttlSeconds=60", {
    headers: A,
  });
  const signedUrl = signed.json?.signedUrl;
  if (signedUrl) {
    await call("storage.signed-url.fetch-404", "GET", signedUrl, {
      expect: 404,
      headers: A,
    });
  }
  // Upload a 1×1 PNG, sign + fetch
  const pngBytes = Buffer.from(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489000000017352474200aece1ce90000000d49444154789c6300010000000500010d0a2db4000000004945" +
    "4e44ae426082",
    "hex",
  );
  const form = new FormData();
  form.append("file", new Blob([pngBytes], { type: "image/png" }), "smoke.png");
  await call("storage.upload.png", "POST", `${BASE}/storage/chat-attachments?path=test/smoke-${Date.now()}.png`, {
    expect: (s) => s === 200 || s === 413,
    headers: { Authorization: `Bearer ${adminAccess}` },
    body: form,
    raw: true,
  });
  // Mime not allowed (text/plain)
  const formBad = new FormData();
  formBad.append("file", new Blob([Buffer.from("hi", "utf8")], { type: "text/plain" }), "x.txt");
  await call("storage.upload.mime-rejected", "POST", `${BASE}/storage/chat-attachments?path=test/no.txt`, {
    expect: (s) => s >= 400 && s < 500,
    headers: { Authorization: `Bearer ${adminAccess}` },
    body: formBad,
    raw: true,
  });
  // Unknown bucket
  await call("storage.upload.unknown-bucket", "POST", `${BASE}/storage/nope?path=test/x`, {
    expect: 404,
    headers: { Authorization: `Bearer ${adminAccess}` },
    body: form,
    raw: true,
  });

  // ========== misc: 404 + bad-json ==========
  await call("misc.404", "GET", "/api/this/does/not/exist", { expect: 404, headers: A });
  await call("misc.bad-json-body", "POST", "/api/auth/login", {
    expect: 400,
    headers: { "Content-Type": "application/json" },
    body: "not-json",
    raw: true,
  });

  // =================================================================
  // BACK OFFICE — fixture role matrix (requires npm run test:seed)
  // =================================================================

  if (FIX_ACC) {
    await call("bo.accounting.dashboard", "GET", "/api/admin/dashboard/stats", { headers: FIX_ACC });
    await call("bo.accounting.members", "GET", "/api/admin/members?limit=3", { headers: FIX_ACC });
    await call("bo.accounting.merchants-read", "GET", "/api/admin/merchants", { headers: FIX_ACC });
    await call("bo.accounting.merchant-create-denied", "POST", "/api/admin/merchants", {
      expect: 403,
      headers: FIX_ACC,
      body: { name: "blocked", type: "commerce" },
    });
    await call("bo.accounting.freeze-denied", "POST", `/api/admin/members/${tempUserId}/freeze`, {
      expect: 403,
      headers: FIX_ACC,
      body: { frozen: true, reason: "accounting should be blocked" },
    });
    await call("bo.accounting.from.transactions", "POST", "/api/from/transactions", {
      headers: FIX_ACC,
      body: { op: "select", limit: 5 },
    });
  }

  if (FIX_SUP) {
    await call("bo.support.dashboard", "GET", "/api/admin/dashboard/stats", { headers: FIX_SUP });
    await call("bo.support.members", "GET", "/api/admin/members?limit=3", { headers: FIX_SUP });
    await call("bo.support.merchants-denied", "GET", "/api/admin/merchants", {
      expect: 403,
      headers: FIX_SUP,
    });
    await call("bo.support.from.chat-pcr", "POST", "/api/from/chat_profile_change_requests", {
      headers: FIX_SUP,
      body: { op: "select", limit: 5 },
    });
  }

  if (FIX_MO) {
    await call("bo.merchant-owner.self", "GET", "/api/merchant/self", { headers: FIX_MO });
    await call("bo.merchant-owner.role", "GET", "/api/merchant/self/role", { headers: FIX_MO });
    await call("bo.merchant-owner.nav", "GET", "/api/merchant/self/nav", { headers: FIX_MO });
    await call("bo.merchant-owner.transactions", "GET", "/api/merchant/self/transactions?limit=5", { headers: FIX_MO });
    await call("bo.merchant-owner.settlement", "GET", "/api/merchant/self/settlement?limit=5", { headers: FIX_MO });
    await call("bo.merchant-owner.api-calls", "GET", "/api/merchant/self/api-calls?limit=5", { headers: FIX_MO });
    await call("bo.merchant-owner.users", "GET", "/api/merchant/users", { headers: FIX_MO });
    await call("bo.merchant-owner.settings-patch", "PATCH", "/api/merchant/self/settings", {
      headers: FIX_MO,
      body: { webhookUrl: "https://example.com/smoke-webhook" },
    });
    await call("bo.merchant-owner.invite", "POST", "/api/merchant/users/invite", {
      expect: (s) => s === 201 || s === 409,
      headers: FIX_MO,
      body: {
        email: `smoke-invite-${Date.now()}@wallet.local`,
        role: "read_only",
        fullName: "Smoke Invite",
      },
    });
    await call("bo.merchant-owner.cashout-request", "POST", "/api/fn/merchant-cashout-request", {
      expect: (s, j) => s === 200 && j?.error?.code === "CASHOUT_DISABLED",
      headers: FIX_MO,
      body: {
        merchant_id: "e5000001-0000-4000-8000-000000000001",
        method_code: "usdt_trc20",
        amount: 10,
        payout_address: "TSmokeFixtureAddress00000000001",
      },
    });
  }

  if (FIX_MP) {
    await call("bo.merchant-parent.self", "GET", "/api/merchant/self", { headers: FIX_MP });
    await call("bo.merchant-parent.children", "GET", "/api/merchant/self/children", { headers: FIX_MP });
    await call("bo.merchant-parent.settlement", "GET", "/api/merchant/self/settlement?limit=5", {
      headers: FIX_MP,
    });
  }

  if (FIX_MF) {
    await call("bo.merchant-finance.self", "GET", "/api/merchant/self", { headers: FIX_MF });
    await call("bo.merchant-finance.settlement", "GET", "/api/merchant/self/settlement?limit=5", {
      headers: FIX_MF,
      expect: (s, j) => s === 200 && (j?.ledger === "cash_pool" || Array.isArray(j?.rows)),
    });
    await call("bo.merchant-finance.api-calls", "GET", "/api/merchant/self/api-calls?limit=5", {
      headers: FIX_MF,
    });
    await call("bo.merchant-finance.settings-patch", "PATCH", "/api/merchant/self/settings", {
      headers: FIX_MF,
      body: { webhookUrl: "https://example.com/smoke-finance-webhook" },
    });
  }

  if (FIX_MA) {
    await call("bo.merchant-accountant.self", "GET", "/api/merchant/self", { headers: FIX_MA });
    await call("bo.merchant-accountant.transactions", "GET", "/api/merchant/self/transactions?limit=3", { headers: FIX_MA });
    await call("bo.merchant-accountant.settings-denied", "PATCH", "/api/merchant/self/settings", {
      expect: 403,
      headers: FIX_MA,
      body: { webhookUrl: "https://example.com/blocked" },
    });
  }

  if (FIX_MR) {
    await call("bo.merchant-readonly.self", "GET", "/api/merchant/self", { headers: FIX_MR });
    await call("bo.merchant-readonly.settings-denied", "PATCH", "/api/merchant/self/settings", {
      expect: 403,
      headers: FIX_MR,
      body: { webhookUrl: "https://example.com/blocked-readonly" },
    });
    await call("bo.merchant-readonly.invite-denied", "POST", "/api/merchant/users/invite", {
      expect: 403,
      headers: FIX_MR,
      body: { email: `blocked-${Date.now()}@wallet.local`, role: "read_only" },
    });
  }

  // Admin gaps — transactions / PCR / method-types / onboarding (from + rpc)
  await call("bo.admin.from.transactions", "POST", "/api/from/transactions", {
    headers: A,
    body: { op: "select", limit: 10, order: { col: "created_at", asc: false } },
  });
  await call("bo.admin.from.chat-pcr", "POST", "/api/from/chat_profile_change_requests", {
    headers: A,
    body: { op: "select", limit: 5 },
  });
  await call("bo.admin.from.method-types", "POST", "/api/from/payment_method_types", {
    headers: A,
    body: { op: "select", limit: 20 },
  });
  await call("bo.admin.from.onboarding", "POST", "/api/from/merchant_applications", {
    headers: A,
    body: { op: "select", limit: 10 },
  });
  const mtList = await call("bo.admin.rpc.method-types-list", "POST", "/api/rpc/list_active_topup_method_types", {
    headers: A,
    body: {},
  });
  const firstMt = Array.isArray(mtList.json) ? mtList.json[0]?.code : mtList.json?.rows?.[0]?.code;
  if (firstMt) {
    await call("bo.admin.rpc.method-type-toggle", "POST", "/api/rpc/admin_set_method_type_enabled", {
      headers: A,
      body: { _code: firstMt, _enabled: true },
    });
  }
  await call("bo.admin.chat.pcr-reject-missing", "POST", "/api/chat/staff/pcr/00000000-0000-4000-8000-000000000099/reject", {
    expect: (s) => s === 404 || s === 400,
    headers: A,
    body: { reason: "smoke missing pcr" },
  });
  await call("bo.admin.permissions-page", "POST", "/api/from/bo_permissions", {
    headers: A,
    body: { op: "select", limit: 50 },
  });
  await call("bo.admin.export.settlement", "POST", "/api/admin/export/settlement", {
    expect: (s) => s === 200 || s === 404,
    headers: A,
    body: {
      merchantId: firstMerchant?.id ?? "00000000-0000-4000-8000-000000000001",
      startDate: "2024-01-01T00:00:00.000Z",
      endDate: new Date().toISOString(),
    },
  });

  // ----------------------------- summary ---------------------------
  printReport();
}

function printReport() {
  const pass = results.filter((r) => r.verdict === "PASS");
  const warn = results.filter((r) => r.verdict === "WARN");
  const fail = results.filter((r) => r.verdict === "FAIL");
  const W = process.stdout.isTTY ? process.stdout.columns ?? 120 : 200;
  // Group output
  const nameW = Math.max(...results.map((r) => r.name.length), 10);
  const pathW = Math.min(48, Math.max(...results.map((r) => r.path.length)));
  console.log("\n" + color("bold", "Results"));
  console.log("-".repeat(Math.min(W, 130)));
  for (const r of results) {
    const verdict =
      r.verdict === "PASS"
        ? color("green", "PASS")
        : r.verdict === "WARN"
        ? color("yellow", "WARN")
        : color("red", "FAIL");
    const code = r.code ? color("gray", ` [${r.code}]`) : "";
    const path = r.path.length > pathW ? r.path.slice(0, pathW - 1) + "…" : r.path;
    console.log(
      `${verdict}  ${r.method.padEnd(5)} ${path.padEnd(pathW)} ${color("gray", String(r.status).padStart(3))} ${color("gray", `${String(r.ms).padStart(4)}ms`)}  ${r.name}${code}`,
    );
  }
  console.log("-".repeat(Math.min(W, 130)));
  console.log(
    `Total: ${results.length}  ${color("green", `PASS ${pass.length}`)}  ${color("yellow", `WARN ${warn.length}`)}  ${color("red", `FAIL ${fail.length}`)}  in ${Date.now() - start}ms`,
  );

  if (fail.length) {
    console.log("\n" + color("red", "Failures (first 200 chars of response body):"));
    for (const r of fail) {
      console.log(color("red", `  ✘ ${r.name}  ${r.method} ${r.path}  (${r.status})`));
      console.log(`     ${r.preview}`);
    }
  }
  if (warn.length) {
    console.log("\n" + color("yellow", "Warnings (shim gaps / unimplemented):"));
    for (const r of warn) {
      console.log(`  ${color("yellow", "•")} ${r.name}  ${r.code}`);
    }
  }
  process.exit(fail.length);
}

main().catch((err) => {
  console.error(color("red", "Smoke runner crashed: " + (err.stack ?? err.message)));
  process.exit(1);
});
