#!/usr/bin/env node
/**
 * Quick admin BO permission smoke — run after db:reset (+ optional test:seed).
 * Usage: node scripts/verify-admin-perms.mjs
 */
import dotenv from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "..", "apps/api/.env") });

const BASE = process.env.BASE ?? "http://localhost:3000";
const ADMIN_EMAIL = process.env.SMOKE_ADMIN_EMAIL ?? "admin@wallet.local";
const ADMIN_PASS = process.env.SMOKE_ADMIN_PASS ?? "Admin1234";

function readCsrf(setCookieHeader) {
  if (!setCookieHeader) return null;
  const parts = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
  for (const line of parts) {
    const m = /csrf_token=([^;]+)/.exec(line);
    if (m) return decodeURIComponent(m[1]);
  }
  return null;
}

async function login(email, password) {
  const jar = new Map();
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const csrf = readCsrf(r.headers.getSetCookie?.() ?? r.headers.get("set-cookie"));
  for (const c of r.headers.getSetCookie?.() ?? []) {
    const m = /^([^=]+)=([^;]*)/.exec(c);
    if (m) jar.set(m[1], m[2]);
  }
  const j = await r.json();
  if (!r.ok) throw new Error(`login ${email}: ${j.error_code ?? r.status}`);
  return { jar, csrf };
}

function cookieHeader(jar) {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function from(session, table, body) {
  const r = await fetch(`${BASE}/api/from/${table}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookieHeader(session.jar),
      ...(session.csrf ? { "X-CSRF-Token": session.csrf } : {}),
    },
    body: JSON.stringify(body),
  });
  return r.json();
}

async function rpc(session, name, args = {}) {
  const r = await fetch(`${BASE}/api/rpc/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookieHeader(session.jar),
      ...(session.csrf ? { "X-CSRF-Token": session.csrf } : {}),
    },
    body: JSON.stringify(args),
  });
  return r.json();
}

async function main() {
  const session = await login(ADMIN_EMAIL, ADMIN_PASS);
  const meRes = await fetch(`${BASE}/api/auth/me`, {
    headers: { Cookie: cookieHeader(session.jar) },
  });
  const me = await meRes.json();
  const roles = me.memberships?.roles ?? [];
  const permCount = me.permissions?.length ?? 0;
  const hasProfitShareView = me.permissions?.some(
    (p) => p.resource === "profit_share" && p.action === "view",
  );
  console.log(
    `[verify-admin-perms] ${ADMIN_EMAIL} roles=${roles.join(",")} perms=${permCount} profit_share:view=${hasProfitShareView}`,
  );
  if (!roles.includes("admin")) {
    console.error("  ❌ admin role missing — run: npm run admin:bootstrap");
    process.exit(1);
  }

  const checks = [
    ["from loyalty_tiers", () => from(session, "loyalty_tiers", { op: "select", limit: 3 })],
    ["from profit_share_campaigns", () =>
      from(session, "profit_share_campaigns", { op: "select", limit: 3 })],
    ["rpc admin_list_profit_share_campaigns", () => rpc(session, "admin_list_profit_share_campaigns", {})],
    ["rpc admin_list_members", () => rpc(session, "admin_list_members", { _limit: 5, _offset: 0 })],
  ];

  let failed = 0;
  for (const [label, fn] of checks) {
    const res = await fn();
    const code = res.error?.code ?? res.error?.error_code;
    const ok = !code;
    if (!ok) failed++;
    console.log(`  ${ok ? "✅" : "❌"} ${label}${code ? ` — ${code}` : ""}`);
  }
  process.exit(failed);
}

main().catch((err) => {
  console.error("[verify-admin-perms] FAILED:", err.message ?? err);
  process.exit(1);
});
