/**
 * Outbound HMAC calls to finance merchants.
 *
 * Used by:
 *  - topup-init   → POST merchant.topup_init_url
 *  - cash-pool-sync → POST merchant.cash_pool_api_url
 *
 * P0-8 — SSRF guard.
 *
 * Both `topup_init_url` and `cash_pool_api_url` are merchant-managed strings
 * stored in the `merchants` table (and editable by any admin with
 * `merchants:update`, plus historically by any authed user via the from-shim
 * before P0-1). Without server-side URL validation, a malicious or
 * mis-configured value could turn the API into a request forwarder to
 * `http://169.254.169.254` (cloud metadata), `http://127.0.0.1:3000/api/admin/…`
 * (self-pivot — though P0-1 closes that), `file://etc/passwd`, or `gopher://…`.
 *
 * The guard:
 *   - requires the URL to be `https://` (or `http://` for localhost when
 *     OUTBOUND_ALLOW_HTTP=true in dev)
 *   - blocks RFC1918, link-local, loopback, broadcast, and the AWS metadata
 *     169.254.169.254 specifically
 *   - rejects non-DNS hostnames (IP-literal in production) unless the
 *     destination is on an explicit allow-list via env
 *   - disables redirect-following so the server cannot be bounced from a
 *     "good" host to an internal one mid-fetch
 */
import { lookup as dnsLookup } from "node:dns/promises";
import { hmacSha256Hex } from "../lib/random";
import { logger } from "../lib/logger";
import { env, isDev, isTest } from "../lib/env";

export interface OutboundCallOpts {
  url: string;
  body: Record<string, unknown>;
  signingSecret: string;
  timeoutMs?: number;
}

export interface OutboundResult<T = unknown> {
  ok: boolean;
  status: number;
  json: T | null;
  durationMs: number;
  error?: string;
}

const ALLOW_HTTP = process.env.OUTBOUND_ALLOW_HTTP === "true" || isDev || isTest;

// Hosts the operator has explicitly whitelisted (comma-separated). When set,
// outbound POSTs may only go to these exact hostnames. Use this when running
// against a known finance-provider domain list.
const ALLOWED_HOSTS = (process.env.OUTBOUND_ALLOWED_HOSTS ?? "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

function isPrivateAddress(ip: string): boolean {
  // IPv4
  if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
    const parts = ip.split(".").map(Number);
    const [a, b] = parts;
    if (a === undefined || b === undefined) return true;
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 127) return true; // loopback
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 169 && b === 254) return true; // link-local + metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
    if (a === 192 && b === 168) return true; // 192.168/16
    if (a >= 224) return true; // multicast + reserved
    return false;
  }
  // IPv6 — block loopback, link-local, ULA. `::ffff:` IPv4-mapped recurses.
  const v6 = ip.toLowerCase();
  if (v6 === "::1" || v6 === "::") return true;
  if (v6.startsWith("fe80:")) return true; // link-local
  if (v6.startsWith("fc") || v6.startsWith("fd")) return true; // ULA fc00::/7
  if (v6.startsWith("ff")) return true; // multicast
  if (v6.startsWith("::ffff:")) {
    const v4 = v6.slice("::ffff:".length);
    return isPrivateAddress(v4);
  }
  return false;
}

/**
 * Throws if `urlStr` is not safe to fetch outbound. Resolves hostname to its
 * IP(s) and rejects if any resolution is a private/loopback/metadata address.
 */
async function assertSafeUrl(urlStr: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    throw new Error("OUTBOUND_BAD_URL");
  }
  if (parsed.protocol === "http:" && !ALLOW_HTTP) {
    throw new Error("OUTBOUND_REQUIRES_HTTPS");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("OUTBOUND_BAD_PROTOCOL");
  }
  const host = parsed.hostname.toLowerCase();
  if (ALLOWED_HOSTS.length > 0 && !ALLOWED_HOSTS.includes(host)) {
    throw new Error("OUTBOUND_HOST_NOT_ALLOWED");
  }
  // Reject IP-literal hostnames; force DNS-resolved hostnames so DNS rebinding
  // isn't trivially exploitable from a config bypass.
  const looksLikeIp = /^[\d.]+$/.test(host) || host.includes(":");
  if (looksLikeIp) {
    if (isPrivateAddress(host)) throw new Error("OUTBOUND_PRIVATE_HOST");
    if (!ALLOW_HTTP) throw new Error("OUTBOUND_IP_LITERAL");
  } else {
    // Resolve and reject every private address. The fetch below uses the same
    // hostname (not the IP), so DNS-rebinding could still flip the answer
    // between resolve and fetch — for true safety we'd need a `lookup` hook
    // on the agent. For now this is a strong best-effort.
    try {
      const addrs = await dnsLookup(host, { all: true });
      for (const a of addrs) {
        if (isPrivateAddress(a.address)) throw new Error("OUTBOUND_PRIVATE_HOST");
      }
    } catch (e) {
      if ((e as Error).message?.startsWith("OUTBOUND_")) throw e;
      throw new Error("OUTBOUND_DNS_FAILED");
    }
  }
  return parsed;
}

export async function postMerchantHmac<T = unknown>(opts: OutboundCallOpts): Promise<OutboundResult<T>> {
  const ts = Math.floor(Date.now() / 1000).toString();
  const bodyStr = JSON.stringify(opts.body);
  const sig = hmacSha256Hex(opts.signingSecret, `${ts}:${bodyStr}`);
  const started = Date.now();

  let safeUrl: URL;
  try {
    safeUrl = await assertSafeUrl(opts.url);
  } catch (err) {
    const reason = err instanceof Error ? err.message : "OUTBOUND_BAD_URL";
    logger.warn({ url: opts.url, reason }, "merchant-outbound: rejected by SSRF guard");
    return { ok: false, status: 0, json: null, durationMs: 0, error: reason };
  }

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 10_000);
  try {
    const res = await fetch(safeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-merchant-timestamp": ts,
        "x-merchant-signature": sig,
      },
      body: bodyStr,
      signal: ctrl.signal,
      // Don't auto-follow redirects — a 302 to http://169.254.169.254 would
      // otherwise bypass our pre-flight host check.
      redirect: "manual",
    });
    const ct = res.headers.get("content-type") ?? "";
    const json = ct.includes("application/json") ? ((await res.json().catch(() => null)) as T | null) : null;
    return { ok: res.ok, status: res.status, json, durationMs: Date.now() - started };
  } catch (err) {
    logger.warn({ err, url: opts.url }, "outbound merchant call failed");
    return {
      ok: false,
      status: 0,
      json: null,
      durationMs: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(t);
  }
}

// Silence unused-var lint while keeping the import slot for future env wiring.
void env;
