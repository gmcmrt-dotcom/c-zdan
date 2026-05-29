import express, { type Express } from "express";
import helmet from "helmet";
import cors from "cors";
import compression from "compression";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import { csrfProtect } from "./middleware/csrf";
import { corsOrigins } from "./lib/env";
// env / isProd re-imported below alongside dev mocks
import { logger } from "./lib/logger";
import { errorHandler, notFound } from "./middleware/error";
import { authRouter } from "./routes/auth.routes";
import { meRouter } from "./routes/me.routes";
import { walletRouter } from "./routes/wallet.routes";
import { merchantPublicRouter } from "./routes/merchant-public.routes";
import { adminRouter } from "./routes/admin.routes";
import { merchantRouter } from "./routes/merchant.routes";
import { storageRouter } from "./routes/storage.routes";
import { webhooksRouter } from "./routes/webhooks.routes";
import { chatRouter } from "./routes/chat.routes";
import { devMocksRouter } from "./routes/dev-mocks.routes";
import { rpcRouter } from "./routes/rpc.routes";
import { fnRouter } from "./routes/fn.routes";
import { fromRouter } from "./routes/from.routes";
import { env, isProd } from "./lib/env";

/**
 * Iterative JSON depth check (no recursion → safe even on hostile input).
 * Counts the deepest nested object/array path; primitives are depth 0.
 */
function jsonDepth(value: unknown, maxToTrack = 40): number {
  if (value === null || typeof value !== "object") return 0;
  let max = 0;
  const stack: Array<[unknown, number]> = [[value, 1]];
  while (stack.length > 0) {
    const frame = stack.pop()!;
    const [node, d] = frame;
    if (d > max) max = d;
    if (max > maxToTrack) return max; // short-circuit; caller will reject
    if (node && typeof node === "object") {
      if (Array.isArray(node)) {
        for (const c of node) stack.push([c, d + 1]);
      } else {
        for (const k of Object.keys(node as Record<string, unknown>)) {
          stack.push([(node as Record<string, unknown>)[k], d + 1]);
        }
      }
    }
  }
  return max;
}

export function buildApp(): Express {
  const app = express();
  app.disable("x-powered-by");

  // P0-44 — Trust only a known number of proxy hops, NOT every X-Forwarded-For
  // value the client may send. With the previous `true` setting an attacker
  // hitting the API directly (or via an extra forwarder) could spoof their
  // source IP and pass the per-merchant IP allow-list, poison `user_login_ips`,
  // and skew future rate-limit keys.
  //
  // Defaults below assume the documented deploy topology (nginx → wallet-api
  // on loopback) so we trust exactly one hop. Override via env if the API
  // sits behind two reverse proxies (e.g. CloudFront → nginx → API).
  //
  // I4 docs note: this MUST be set correctly for `req.ip`, all rate-limit
  // keys, the per-merchant IP allow-list, and `user_login_ips` to record
  // the real client IP. If you expose the API on a routable interface
  // without a reverse proxy in front, set `TRUST_PROXY=false` to disable
  // XFF entirely (otherwise every caller can spoof their source IP).
  // Production checklist:
  //   - behind one nginx: leave default ("1")
  //   - behind CDN → nginx: `TRUST_PROXY=2`
  //   - direct exposure (no LB): `TRUST_PROXY=false`
  const trustProxy = process.env.TRUST_PROXY ?? (isProd ? "1" : "loopback");
  // Express understands numeric strings, "loopback", IP lists, and "false".
  app.set("trust proxy", trustProxy === "false" ? false : trustProxy);

  // P2 — Helmet baseline + CSP tuned for the Vite SPA.
  //
  //   - default-src 'self'         — same-origin only by default
  //   - script-src 'self'          — no inline scripts (Vite emits modules)
  //   - style-src 'self' 'unsafe-inline' — Tailwind utility classes inject
  //                                  style tags at dev time; safe to allow
  //                                  inline styles (not inline scripts).
  //   - img-src 'self' data: blob: — QR codes (`qrcode` → data: URL) +
  //                                  attachment previews (`blob:`).
  //   - connect-src 'self' ws: wss: — Socket.IO uses same-origin upgrade.
  //   - font-src 'self' https://fonts.gstatic.com
  //   - frame-ancestors 'none'     — disallow embedding our pages in
  //                                  iframes (clickjacking).
  //   - upgrade-insecure-requests  — force https when behind TLS.
  app.use(
    helmet({
      crossOriginResourcePolicy: false,
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          "default-src": ["'self'"],
          "script-src": ["'self'"],
          "script-src-attr": ["'none'"],
          "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
          "img-src": ["'self'", "data:", "blob:"],
          "font-src": ["'self'", "data:", "https://fonts.gstatic.com"],
          "connect-src": ["'self'", "ws:", "wss:"],
          "frame-ancestors": ["'none'"],
          "object-src": ["'none'"],
          "base-uri": ["'self'"],
          "form-action": ["'self'"],
          "upgrade-insecure-requests": [],
        },
      },
    }),
  );
  app.use(
    cors({
      origin: (origin, cb) => {
        // P1 (fourth sweep) — In production, reject empty Origin (sandboxed
        // iframes, some attack tools) and any wildcard. Dev keeps the loose
        // behaviour so `curl` / mobile dev can still reach the API.
        if (!origin) {
          if (isProd) return cb(null, false);
          return cb(null, true);
        }
        if (corsOrigins.includes("*")) {
          if (isProd) return cb(null, false);
          return cb(null, true);
        }
        if (corsOrigins.includes(origin)) return cb(null, true);
        // Returning `false` produces a 200-with-no-CORS-headers (browser
        // blocks it). Throwing here was previously surfacing as a 500 in logs.
        return cb(null, false);
      },
      credentials: true,
    }),
  );
  app.use(compression());
  app.use(pinoHttp({ logger }));

  // Public merchant API + provider webhooks use HMAC/checksum over RAW body —
  // mount them BEFORE the global json() middleware.
  app.use("/merchant-api", merchantPublicRouter);
  app.use("/webhooks", webhooksRouter);

  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true, limit: "1mb" }));
  // O.2 — Cookie parser for HttpOnly auth cookies (Q3 Option A).
  app.use(cookieParser());
  // O.3 — CSRF middleware for state-changing routes. Skipped for HMAC-
  // protected endpoints (merchant-api, webhooks, already-mounted above)
  // and for the auth-bootstrap endpoints (login, signup, refresh, logout)
  // which set the cookies themselves.
  app.use(csrfProtect);

  // P2 — Reject JSON payloads nested deeper than `MAX_JSON_DEPTH`. The body
  // parser only enforces total bytes; nothing currently protects against a
  // pathological `{"a":{"a":{ … 10000 levels … }}}` payload that ties up the
  // event loop in V8 recursion. A 32-level cap is well past any legitimate
  // wallet/merchant payload (real ones are 1–3 levels deep).
  const MAX_JSON_DEPTH = 32;
  app.use((req, res, next) => {
    if (req.body && typeof req.body === "object") {
      const depth = jsonDepth(req.body);
      if (depth > MAX_JSON_DEPTH) {
        return res.status(400).json({
          success: false,
          error_code: "PAYLOAD_TOO_DEEP",
          message: `JSON nesting exceeds ${MAX_JSON_DEPTH} levels`,
        });
      }
    }
    next();
  });

  app.get("/health", (_req, res) => {
    // P1 — Cheap liveness check (process is up). Does NOT ping the DB.
    res.json({ ok: true, ts: new Date().toISOString() });
  });

  // P1 — Readiness: tries a single DB ping so a load balancer can drop the
  // node when Postgres is unreachable. Lazy-import to keep `/health`
  // dependency-free for k8s liveness probes.
  app.get("/readyz", async (_req, res) => {
    try {
      const { sql: pg } = await import("./db/client");
      await pg`SELECT 1`;
      res.json({ ok: true, ts: new Date().toISOString() });
    } catch (err) {
      res.status(503).json({
        ok: false,
        ts: new Date().toISOString(),
        reason: err instanceof Error ? err.message : "DB_UNAVAILABLE",
      });
    }
  });

  // P3 — Removed the `GET /api` version disclosure endpoint. It returned
  // `{ name: "wallet-api", version: "0.0.0" }` which lets a scanner fingerprint
  // the build and look up known-vulnerable revisions. `/health` + `/readyz`
  // are the supported liveness/readiness probes.

  // P2 — Minimal Prometheus-compatible /metrics endpoint. Bind-token gated
  // so the metrics aren't scraped by anyone with HTTP reach to the API; the
  // ops scrape job sets `METRICS_TOKEN` and the prom config uses the same
  // value in a Bearer header. If unset, the endpoint is not mounted at all.
  if (process.env.METRICS_TOKEN) {
    const metricsToken = process.env.METRICS_TOKEN;
    app.get("/metrics", async (req, res) => {
      const hdr = req.headers.authorization;
      const tok = hdr?.startsWith("Bearer ") ? hdr.slice(7) : null;
      if (!tok || tok !== metricsToken) {
        res.status(401).type("text/plain").send("unauthorized");
        return;
      }
      const lines: string[] = [];
      lines.push("# HELP wallet_process_uptime_seconds Seconds since process start.");
      lines.push("# TYPE wallet_process_uptime_seconds gauge");
      lines.push(`wallet_process_uptime_seconds ${process.uptime().toFixed(3)}`);
      const mem = process.memoryUsage();
      lines.push("# HELP wallet_process_memory_bytes Resident set / heap usage.");
      lines.push("# TYPE wallet_process_memory_bytes gauge");
      lines.push(`wallet_process_memory_bytes{kind="rss"} ${mem.rss}`);
      lines.push(`wallet_process_memory_bytes{kind="heap_used"} ${mem.heapUsed}`);
      lines.push(`wallet_process_memory_bytes{kind="heap_total"} ${mem.heapTotal}`);
      try {
        const { sql: pg } = await import("./db/client");
        const dbRows = await pg<{ n: number }[]>`
          SELECT
            (SELECT count(*) FROM profiles)::int                                     AS members_total,
            (SELECT count(*) FROM merchants WHERE is_active)::int                    AS merchants_active,
            (SELECT count(*) FROM topup_sessions WHERE status IN ('pending','awaiting_member_action','member_confirmed','redirected'))::int AS topups_open,
            (SELECT count(*) FROM withdraw_sessions WHERE status IN ('pending','sent_to_merchant'))::int AS withdraws_open
        `.then((r) => r as unknown as Array<{ members_total: number; merchants_active: number; topups_open: number; withdraws_open: number }>);
        const r = dbRows[0];
        if (r) {
          lines.push("# HELP wallet_members_total Total profile rows.");
          lines.push("# TYPE wallet_members_total gauge");
          lines.push(`wallet_members_total ${r.members_total}`);
          lines.push("# HELP wallet_merchants_active Active merchants.");
          lines.push("# TYPE wallet_merchants_active gauge");
          lines.push(`wallet_merchants_active ${r.merchants_active}`);
          lines.push("# HELP wallet_sessions_open Open topup/withdraw sessions.");
          lines.push("# TYPE wallet_sessions_open gauge");
          lines.push(`wallet_sessions_open{kind="topup"} ${r.topups_open}`);
          lines.push(`wallet_sessions_open{kind="withdraw"} ${r.withdraws_open}`);
        }
      } catch {
        // metrics endpoint never errors — best-effort gauges only.
      }
      res.type("text/plain; version=0.0.4").send(lines.join("\n") + "\n");
    });
  }

  app.use("/api/auth", authRouter);
  app.use("/api/me", meRouter);
  app.use("/api/wallet", walletRouter);
  app.use("/api/admin", adminRouter);
  app.use("/api/merchant", merchantRouter);
  app.use("/api/chat", chatRouter);
  app.use("/api/rpc", rpcRouter);
  app.use("/api/fn", fnRouter);
  app.use("/api/from", fromRouter);
  app.use("/storage", storageRouter);

  // Dev-only mock merchant endpoints (gated by NODE_ENV + MOCK_FNS_ENABLED).
  if (!isProd && env.MOCK_FNS_ENABLED) {
    app.use("/api/dev", devMocksRouter);
    logger.warn("dev: mock merchant endpoints enabled at /api/dev");
  }

  // Phase 14+: affiliate router (low priority while flag is off).

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
