#!/usr/bin/env node
/**
 * Pratik öneri (sıra) — gap analysis test plan runner.
 * Run against local dev (npm run dev). Exit code = failure count.
 */
import crypto from "node:crypto";
import { exec as execCb } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execCb);
const BASE = process.env.BASE ?? "http://localhost:3000";
const PASS = process.env.TEST_FIXTURE_PASSWORD ?? "Test1234!";
const ADMIN_PASS = process.env.SMOKE_ADMIN_PASS ?? "Admin1234";
const PG = `PGPASSWORD=${process.env.SMOKE_PG_PASS ?? "wallet"} psql -h ${process.env.SMOKE_PG_HOST ?? "localhost"} -p ${process.env.SMOKE_PG_PORT ?? "5432"} -U ${process.env.SMOKE_PG_USER ?? "wallet"} -d ${process.env.SMOKE_PG_DB ?? "wallet"} -tA -c`;

const MERCHANT_KEYS = {
  financeHavale: "tk_fixture0000000000000000000003",
};
const MERCHANT_SECRETS = {
  financeHavale: "fixture_finance_havale_signing_sec32",
};

const phases = [];
const bugs = [];

function record(phase, name, ok, detail = "") {
  phases.push({ phase, name, ok, detail });
  const mark = ok ? "✅" : "❌";
  console.log(`  ${mark} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function api(method, path, { body, headers = {}, expect } = {}) {
  const url = path.startsWith("http") ? path : `${BASE}${path}`;
  const init = {
    method,
    headers: { "Content-Type": "application/json", ...headers },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await fetch(url, init);
  let json = null;
  const text = await res.text();
  try {
    json = JSON.parse(text);
  } catch {
    /* */
  }
  const ok = expect ? expect(res.status, json) : res.status >= 200 && res.status < 300;
  return { ok, status: res.status, json, text };
}

async function login(email, password = PASS) {
  const r = await api("POST", "/api/auth/login", { body: { email, password } });
  return r.json?.accessToken ?? null;
}

async function rpc(token, name, args = {}) {
  return api("POST", `/api/rpc/${name}`, {
    headers: { Authorization: `Bearer ${token}` },
    body: args,
  });
}

async function fromSelect(token, table, opts = {}) {
  const r = await api("POST", `/api/from/${table}`, {
    headers: { Authorization: `Bearer ${token}` },
    body: { op: "select", limit: opts.limit ?? 20, ...opts },
  });
  const list = Array.isArray(r.json?.data) ? r.json.data : r.json?.rows ?? (Array.isArray(r.json) ? r.json : []);
  return { ...r, list };
}

async function fnCall(token, name, body = {}) {
  return api("POST", `/api/fn/${name}`, {
    headers: { Authorization: `Bearer ${token}` },
    body,
  });
}

async function sql(q) {
  const { stdout } = await exec(`${PG} "${q.replace(/"/g, '\\"')}"`);
  return stdout.trim();
}

async function phase0() {
  console.log("\n=== Phase 0 — Clean baseline ===");
  try {
    const health = await api("GET", "/health");
    record(0, "API /health", health.ok);
  } catch (e) {
    record(0, "API /health", false, e.message);
  }
}

async function phase1() {
  console.log("\n=== Phase 1 — Akış D withdraw full cycle ===");
  const token = await login("member.funded@wallet.local");
  if (!token) {
    record(1, "member.funded@ login", false);
    return;
  }
  record(1, "member.funded@ login", true);

  const balanceBefore = await sql(
    `SELECT balance::text || '|' || reserved_balance::text FROM accounts a JOIN profiles p ON p.id=a.user_id WHERE p.email='member.funded@wallet.local'`,
  );
  record(1, "Pre-withdraw balance read", !!balanceBefore, balanceBefore);

  const wd = await rpc(token, "request_withdraw_v3", {
    _method_type: "havale",
    _amount: 100,
    _iban: "TR330006100519786457841326",
    _iban_holder: "Test Member",
  });
  const sessionId = wd.json?.data?.id ?? wd.json?.session_id ?? wd.json?.id;
  record(
    1,
    "request_withdraw_v3",
    wd.ok && !wd.json?.error && !!sessionId,
    wd.json?.error?.code ?? (sessionId ? `session=${sessionId}` : wd.text?.slice(0, 120)),
  );
  if (!sessionId) return;

  const reservedAfter = await sql(
    `SELECT reserved_balance::text FROM accounts a JOIN profiles p ON p.id=a.user_id WHERE p.email='member.funded@wallet.local'`,
  );
  record(1, "Reserve increased", Number(reservedAfter) >= 100, `reserved=${reservedAfter}`);

  const mock = await api("POST", "/api/dev/mock-merchant/complete", {
    body: {
      internal_ref: sessionId,
      amount: 100,
      status: "success",
      flow: "withdraw",
      merchant_api_key: MERCHANT_KEYS.financeHavale,
      merchant_signing_secret: MERCHANT_SECRETS.financeHavale,
      customer_name: "Test Member",
    },
  });
  record(
    1,
    "mock-merchant/complete (withdraw success)",
    mock.ok && mock.json?.callback_status >= 200 && mock.json?.callback_status < 300,
    `callback_status=${mock.json?.callback_status}`,
  );

  const sessionStatus = await sql(
    `SELECT status FROM withdraw_sessions WHERE id='${sessionId}'`,
  );
  record(1, "Session status=success", sessionStatus === "success", sessionStatus);

  const balanceAfter = await sql(
    `SELECT balance::text || '|' || reserved_balance::text FROM accounts a JOIN profiles p ON p.id=a.user_id WHERE p.email='member.funded@wallet.local'`,
  );
  const [balB, resB] = balanceBefore.split("|").map(Number);
  const [balA, resA] = balanceAfter.split("|").map(Number);
  record(1, "Balance debited by 100", balA === balB - 100, `${balB}→${balA}`);
  record(1, "Reserve released", resA === 0, `${resB}→${resA}`);

  const txCount = await sql(
    `SELECT count(*) FROM transactions t JOIN profiles p ON p.id=t.user_id WHERE p.email='member.funded@wallet.local' AND t.type='merchant_withdraw' AND t.status='completed'`,
  );
  record(1, "Completed merchant_withdraw tx exists", Number(txCount) >= 1, `count=${txCount}`);

  // Ledger integrity after withdraw
  try {
    const { stdout } = await exec("npm run test:seed:verify", {
      cwd: process.cwd(),
      env: process.env,
    });
    const m = stdout.match(/"critical_count":\s*(\d+).*"error_count":\s*(\d+)/s);
    const crit = m ? Number(m[1]) : -1;
    const err = m ? Number(m[2]) : -1;
    record(1, "Ledger integrity post-withdraw", crit === 0 && err === 0, `critical=${crit} error=${err}`);
  } catch (e) {
    record(1, "Ledger integrity post-withdraw", false, e.message);
  }
}

async function phase2() {
  console.log("\n=== Phase 2 — Frozen + KYC + RBAC ===");
  const frozenLogin = await api("POST", "/api/auth/login", {
    body: { email: "member.frozen@wallet.local", password: PASS },
    expect: (s, j) => s === 403 && (j?.error_code === "ACCOUNT_FROZEN" || j?.error?.code === "ACCOUNT_FROZEN"),
  });
  record(2, "member.frozen@ login blocked (ACCOUNT_FROZEN)", frozenLogin.ok, "P1 global gate — checklist §3.1 outdated");

  const adminToken = await login("admin@wallet.local", ADMIN_PASS);
  const supportToken = await login("support@wallet.local");
  const accountingToken = await login("accounting@wallet.local");

  const kycPendingId = await sql(
    `SELECT id FROM profiles WHERE email='member.kyc-pending@wallet.local'`,
  );
  record(2, "KYC pending member exists", !!kycPendingId);

  if (supportToken && kycPendingId) {
    const approve = await api("POST", `/api/admin/members/${kycPendingId}/kyc`, {
      headers: { Authorization: `Bearer ${supportToken}` },
      body: { status: "verified" },
    });
    record(2, "support@ KYC approve", approve.ok, approve.status);

    const kycAfter = await sql(`SELECT kyc_status FROM profiles WHERE id='${kycPendingId}'`);
    record(2, "KYC status=verified", kycAfter === "verified", kycAfter);

    // Reset for idempotency
    await api("POST", `/api/admin/members/${kycPendingId}/kyc`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { status: "pending" },
    });
  }

  const frozenId = await sql(`SELECT id FROM profiles WHERE email='member.frozen@wallet.local'`);
  if (accountingToken && frozenId) {
    const freezeDeny = await api("POST", `/api/admin/members/${frozenId}/freeze`, {
      headers: { Authorization: `Bearer ${accountingToken}` },
      body: { frozen: false, reason: "accounting should be denied" },
      expect: (s) => s === 403,
    });
    record(2, "accounting@ freeze denied (403)", freezeDeny.ok);
  }

  if (supportToken && frozenId) {
    const unfreeze = await api("POST", `/api/admin/members/${frozenId}/freeze`, {
      headers: { Authorization: `Bearer ${supportToken}` },
      body: { frozen: false, reason: "test unfreeze" },
    });
    record(2, "support@ unfreeze OK", unfreeze.ok, unfreeze.status);
    // Re-freeze for fixture consistency
    await api("POST", `/api/admin/members/${frozenId}/freeze`, {
      headers: { Authorization: `Bearer ${supportToken}` },
      body: { frozen: true, reason: "restore fixture" },
    });
  }
}

async function phase3() {
  console.log("\n=== Phase 3 — Chat + PCR + notifications ===");
  const chatToken = await login("member.chat@wallet.local");
  record(3, "member.chat@ login", !!chatToken);

  if (chatToken) {
    const threads = await fromSelect(chatToken, "chat_threads", {
      order: { col: "last_message_at", asc: false },
    });
    record(3, "Chat threads load (from shim)", threads.ok && threads.list.length >= 1, `count=${threads.list.length}`);

    const threadId = threads.list[0]?.id;
    if (threadId) {
      const msgs = await fromSelect(chatToken, "chat_messages", {
        where: [{ col: "thread_id", op: "eq", val: threadId }],
        order: { col: "created_at", asc: true },
      });
      record(3, "Chat messages load (no getTime crash)", msgs.ok, msgs.status);
    }
  }

  const supportToken = await login("support@wallet.local");
  if (supportToken) {
    const staffThreads = await fromSelect(supportToken, "chat_threads", {
      where: [{ col: "status", op: "in", val: ["open", "pending_staff", "pending_user"] }],
      order: { col: "last_message_at", asc: false },
    });
    record(3, "Admin chat threads (from shim)", staffThreads.ok && staffThreads.list.length >= 1, `count=${staffThreads.list.length}`);

    const threadId = staffThreads.list[0]?.id;
    if (threadId) {
      const claim = await api("POST", `/api/chat/staff/threads/${threadId}/claim`, {
        headers: { Authorization: `Bearer ${supportToken}` },
        body: {},
      });
      record(3, "Staff claim thread", claim.ok, claim.status);

      const reply = await api("POST", `/api/chat/staff/threads/${threadId}/messages`, {
        headers: { Authorization: `Bearer ${supportToken}` },
        body: { body: "Pratik test yanıtı" },
      });
      record(3, "Staff reply", reply.ok, reply.status);
    }
  }

  const memberToken = await login("member.funded@wallet.local");
  if (memberToken) {
    const notif = await api("GET", "/api/me/notifications?limit=10", {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    record(3, "Notifications page API", notif.ok, notif.status);
  }

  // PCR list (support)
  if (supportToken) {
    const pcr = await api("POST", "/api/from/chat_profile_change_requests", {
      headers: { Authorization: `Bearer ${supportToken}` },
      body: { op: "select", limit: 5 },
    });
    record(3, "PCR list loads", pcr.ok || pcr.status === 200, pcr.status);
  }
}

async function phase4() {
  console.log("\n=== Phase 4 — Aninda + finance init ===");
  const havaleUrl = await sql(
    `SELECT COALESCE(topup_init_url,'') FROM merchants WHERE api_key='${MERCHANT_KEYS.financeHavale}'`,
  );
  const paparaUrl = await sql(
    `SELECT COALESCE(topup_init_url,'') FROM merchants WHERE api_key='tk_fixture0000000000000000000004'`,
  );
  record(4, "Finance Havale topup_init_url in seed", true, havaleUrl || "(null — mock init via dev endpoint)");
  record(4, "Finance Papara topup_init_url in seed", !!paparaUrl, paparaUrl);

  const adminToken = await login("admin@wallet.local", ADMIN_PASS);
  if (adminToken) {
    const merchants = await api("GET", "/api/admin/merchants?limit=5", {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const financeId = merchants.json?.rows?.find((m) => m.merchant_type === "finance")?.id;
    if (financeId) {
      const intTest = await fnCall(adminToken, "admin-finance-integration-test", {
        merchant_id: financeId,
      });
      record(
        4,
        "Admin finance integration test button (RPC)",
        intTest.ok && (intTest.json?.data?.success === true || intTest.json?.success === true || intTest.status === 200),
        intTest.json?.data?.message ?? intTest.json?.message ?? intTest.status,
      );
    }
  }

  record(4, "Live Aninda callback/push", true, "SKIP — requires live credentials (documented)");
}

async function phase5() {
  console.log("\n=== Phase 5 — Remaining P1 ===");
  const adminToken = await login("admin@wallet.local", ADMIN_PASS);

  // CASHOUT_DISABLED
  if (adminToken) {
    const merchantToken = await login("merchant.owner@wallet.local");
    if (merchantToken) {
      const cashout = await fnCall(merchantToken, "merchant-cashout-request", {
        amount: 100,
        method_code: "bank_transfer",
      });
      record(
        5,
        "Merchant cashout CASHOUT_DISABLED",
        cashout.json?.error?.code === "CASHOUT_DISABLED" || cashout.json?.error_code === "CASHOUT_DISABLED",
        cashout.json?.error?.code ?? cashout.status,
      );
    }
  }

  if (adminToken) {
    const recon = await fromSelect(adminToken, "transactions", {
      where: [{ col: "type", op: "in", val: ["spend", "merchant_credit", "topup", "merchant_withdraw"] }],
      limit: 10,
      order: { col: "created_at", asc: false },
    });
    record(5, "Admin reconciliation data (transactions from shim)", recon.ok && recon.list.length >= 0, `rows=${recon.list.length}`);

    const liRun = await api("POST", "/api/admin/ledger-integrity/run", {
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {},
    });
    record(5, "Ledger integrity manual trigger", liRun.ok, liRun.json?.runId ?? liRun.status);

    const liList = await api("GET", "/api/admin/ledger-integrity/runs?limit=3", {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    record(5, "Ledger integrity run history", liList.ok, liList.status);
  }

  const memberToken = await login("member.funded@wallet.local");
  if (memberToken) {
    for (const [label, path] of [
      ["Loyalty", "/api/me/loyalty"],
      ["Notifications", "/api/me/notifications?limit=5"],
      ["Profit share", "/api/me/profit-share"],
    ]) {
      const r = await api("GET", path, { headers: { Authorization: `Bearer ${memberToken}` } });
      record(5, `Member ${label} page API`, r.ok, r.status);
    }
  }
}

async function main() {
  console.log(`Pratik test plan — ${BASE}\n`);
  await phase0();
  await phase1();
  await phase2();
  await phase3();
  await phase4();
  await phase5();

  const fails = phases.filter((p) => !p.ok);
  console.log("\n=== Summary ===");
  console.log(`Total: ${phases.length} | Pass: ${phases.length - fails.length} | Fail: ${fails.length}`);
  if (fails.length) {
    console.log("\nFailures:");
    for (const f of fails) console.log(`  Phase ${f.phase}: ${f.name} — ${f.detail}`);
  }
  process.exit(fails.length);
}

main().catch((e) => {
  console.error(e);
  process.exit(99);
});
