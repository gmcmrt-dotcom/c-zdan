/**
 * Tiny fetch wrapper for the new Express API.
 *
 * Token storage contract (O.2 — Q3 Option A):
 *  - access + refresh tokens live in HttpOnly cookies set by the server
 *    (`access_token`, `refresh_token`). They are NEVER readable from JS
 *    so an XSS bug can't exfiltrate them.
 *  - The `csrf_token` cookie is JS-readable; every state-changing
 *    request echoes it in the `X-CSRF-Token` header.
 *  - `aal` is still kept in localStorage as a UI hint (so RequireAal can
 *    pre-route before the server replies); the SERVER is the source of
 *    truth and rejects mismatches.
 *  - All `fetch` calls use `credentials: "include"` so the cookies ride.
 *  - 401 triggers one refresh attempt, then logout if still failing.
 *
 * The old `wallet.accessToken` / `wallet.refreshToken` localStorage keys
 * are read on first load for ONE MIGRATION RELEASE only — if found, we
 * trigger a `/auth/refresh` to convert them to cookies and then purge.
 */

const API_BASE = import.meta.env.VITE_API_BASE_URL || "/api";
const LS_AAL = "wallet.aal";
// O.2-fix — Non-token "yes, a session exists" hint. Set whenever the server
// has just minted cookies; cleared on logout / refresh failure. Lets the FE
// (route guards, useAuth.loadMe) decide whether to call /auth/me without
// peeking at the HttpOnly cookie value. The value is intentionally a
// constant "1" — it carries no auth material.
const LS_SESSION_PRESENT = "wallet.session-present";
// Migration-only keys; removed on first cookie-aware request.
const LEGACY_LS_ACCESS = "wallet.accessToken";
const LEGACY_LS_REFRESH = "wallet.refreshToken";
const CSRF_COOKIE = "csrf_token";

function readCookie(name: string): string | null {
  const m = document.cookie.match(new RegExp(`(?:^|; )${name.replace(/[$()*+./?[\\\]^{|}-]/g, "\\$&")}=([^;]*)`));
  return m ? decodeURIComponent(m[1]!) : null;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message?: string,
    readonly details?: unknown,
  ) {
    super(message || code);
  }
}

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: string;
  refreshExpiresAt: string;
  aal: "aal1" | "aal2";
}

// O.2 — Tokens live in HttpOnly cookies. These getters are kept for
// back-compat but always return null in the new shape; the migration
// path below converts any legacy localStorage tokens to cookies.
export function getAccessToken(): string | null {
  return localStorage.getItem(LEGACY_LS_ACCESS); // migration-only; cleared on first refresh
}
export function getRefreshToken(): string | null {
  return localStorage.getItem(LEGACY_LS_REFRESH);
}
export function getAal(): "aal1" | "aal2" | null {
  const v = localStorage.getItem(LS_AAL);
  return v === "aal1" || v === "aal2" ? v : null;
}

/**
 * O.2-fix — Is there reason to believe the server has set us auth cookies?
 *
 * Returns true when the hint is present (set on a successful login/refresh)
 * OR when a legacy access token is still in localStorage (one-release
 * migration window). The HttpOnly cookie itself is NOT readable from JS, so
 * this hint is what `useAuth.loadMe()` checks before calling `/auth/me`.
 *
 * This is NOT a token and carries no auth material — guards must still call
 * `/auth/me` to confirm and never short-circuit auth based on the hint alone.
 */
export function hasSessionHint(): boolean {
  return localStorage.getItem(LS_SESSION_PRESENT) === "1" || getAccessToken() != null;
}

export function setTokens(t: Tokens | null) {
  if (!t) {
    localStorage.removeItem(LEGACY_LS_ACCESS);
    localStorage.removeItem(LEGACY_LS_REFRESH);
    localStorage.removeItem(LS_AAL);
    // O.2-fix — clearing tokens also clears the "session exists" hint so
    // route guards on other tabs immediately treat the user as anonymous.
    localStorage.removeItem(LS_SESSION_PRESENT);
  } else {
    // O.2 — Don't write the tokens to localStorage anymore. The server
    // set them as HttpOnly cookies; we only persist the aal hint.
    localStorage.removeItem(LEGACY_LS_ACCESS);
    localStorage.removeItem(LEGACY_LS_REFRESH);
    localStorage.setItem(LS_AAL, t.aal);
    // O.2-fix — record a non-token "session exists" flag so useAuth and
    // cross-tab listeners can decide to fetch /auth/me without reading
    // the HttpOnly cookie.
    localStorage.setItem(LS_SESSION_PRESENT, "1");
  }
  window.dispatchEvent(new Event("wallet.auth-changed"));
}

let refreshInFlight: Promise<Tokens | null> | null = null;

/**
 * P1 — Multi-tab refresh single-flight via `navigator.locks`.
 *
 * Without a cross-tab lock, two tabs both seeing a 401 would each POST
 * `/auth/refresh` with the same refresh token; the server rotates on the
 * first call, the second one fails — and the server's refresh-reuse
 * detection then BURNS the whole session family. The user gets logged out
 * of every tab unexpectedly.
 *
 * `navigator.locks.request(name, async () => ...)` is supported in all
 * modern browsers. The first tab that asks for the lock proceeds; the
 * others wait until the lock-holder finishes, then re-read the just-rotated
 * tokens from localStorage and use those instead of refreshing again.
 *
 * Fallback for browsers without locks (Safari < 15.4, headless test envs):
 * skip the cross-tab dance and rely on the in-tab `refreshInFlight` guard.
 */
const REFRESH_LOCK = "wallet.auth.refresh";

// O.2 — Cookie-based refresh. We POST with credentials:"include" so the
// browser sends the `refresh_token` cookie automatically; the server's
// response Set-Cookie rotates both. If we still have legacy localStorage
// tokens (first load after migration release), pass `refreshToken` in
// the body too so the server can convert them.
async function performRefresh(): Promise<Tokens | null> {
  try {
    const legacy = localStorage.getItem(LEGACY_LS_REFRESH);
    const csrf = readCookie(CSRF_COOKIE);
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (csrf) headers["X-CSRF-Token"] = csrf;
    const res = await fetchWithRetry(`${API_BASE}/auth/refresh`, {
      method: "POST",
      credentials: "include",
      headers,
      body: legacy ? JSON.stringify({ refreshToken: legacy }) : "{}",
    });
    if (!res.ok) return null;
    const tokens = (await res.json()) as Tokens;
    setTokens(tokens); // clears legacy keys + stores aal hint
    return tokens;
  } catch {
    return null;
  }
}

async function refreshOnce(): Promise<Tokens | null> {
  if (refreshInFlight) return refreshInFlight;

  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  if (!locks?.request) {
    refreshInFlight = performRefresh().finally(() => { refreshInFlight = null; });
    return refreshInFlight;
  }

  refreshInFlight = (async () => {
    try {
      return await locks.request(REFRESH_LOCK, async () => performRefresh());
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

export interface ApiOptions extends Omit<RequestInit, "body" | "headers"> {
  body?: unknown;
  headers?: Record<string, string>;
  /** Set true to skip Authorization header injection (e.g. login/signup). */
  anonymous?: boolean;
  /** Skip the auto-refresh-on-401 retry. */
  noRetry?: boolean;
}

async function fetchWithRetry(url: string, init: RequestInit, retries = 2): Promise<Response> {
  // In dev, `tsx watch` restarts the API on save, leaving the Vite proxy
  // momentarily unable to reach localhost:3000. Retry a few times with
  // backoff so the UI never sees a flake.
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fetch(url, init);
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      // `TypeError: Failed to fetch` (Chrome/Firefox), `NetworkError`, `fetch failed` (Node),
      // or anything containing ECONNREFUSED → assume the API is reloading.
      const isTransient = /Failed to fetch|NetworkError|fetch failed|ECONNREFUSED/i.test(msg);
      if (!isTransient || attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, 300 * (attempt + 1))); // 300ms, 600ms
    }
  }
  throw lastErr;
}

export async function api<T = unknown>(path: string, opts: ApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(opts.headers ?? {}),
  };
  if (!opts.anonymous) {
    // O.2 — Cookies carry the access token automatically; we no longer
    // set an Authorization header. Back-compat: if a legacy localStorage
    // token still exists (migration release only), send it via header so
    // the server validates AND the cookies get refreshed on next /auth/refresh.
    const legacy = localStorage.getItem(LEGACY_LS_ACCESS);
    if (legacy) headers.Authorization = `Bearer ${legacy}`;
  }
  // O.3 — CSRF echo for state-changing methods.
  const method = (opts.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
    const csrf = readCookie(CSRF_COOKIE);
    if (csrf) headers["X-CSRF-Token"] = csrf;
  }
  const init: RequestInit = {
    ...opts,
    headers,
    // O.2 — Cookies must ride on every same-origin call. CORS for cross-
    // origin is gated by Access-Control-Allow-Credentials on the server.
    credentials: "include",
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  };
  const url = path.startsWith("http") ? path : `${API_BASE}${path}`;
  let res = await fetchWithRetry(url, init);
  if (res.status === 401 && !opts.anonymous && !opts.noRetry) {
    const refreshed = await refreshOnce();
    if (refreshed) {
      // O.2 — After refresh, the cookies are updated; just retry. No
      // Authorization header needed.
      delete headers.Authorization;
      res = await fetchWithRetry(url, { ...init, headers });
    }
    if (res.status === 401 && !opts.noRetry) {
      setTokens(null);
      window.dispatchEvent(new Event("wallet.auth-cleared"));
    }
  }
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get("content-type") ?? "";
  const isJson = ct.includes("application/json");
  const body = isJson ? await res.json().catch(() => null) : await res.text().catch(() => null);
  if (!res.ok) {
    const code =
      isJson && body && typeof body === "object" && "error_code" in body
        ? String((body as Record<string, unknown>).error_code)
        : `HTTP_${res.status}`;
    const message =
      isJson && body && typeof body === "object" && "message" in body
        ? String((body as Record<string, unknown>).message)
        : `Request failed (${res.status})`;
    throw new ApiError(res.status, code, message, body);
  }
  return body as T;
}

/** Convenience helpers. */
export const apiGet = <T = unknown>(p: string, o: ApiOptions = {}) =>
  api<T>(p, { ...o, method: "GET" });
export const apiPost = <T = unknown>(p: string, body?: unknown, o: ApiOptions = {}) =>
  api<T>(p, { ...o, method: "POST", body });
export const apiPut = <T = unknown>(p: string, body?: unknown, o: ApiOptions = {}) =>
  api<T>(p, { ...o, method: "PUT", body });
export const apiPatch = <T = unknown>(p: string, body?: unknown, o: ApiOptions = {}) =>
  api<T>(p, { ...o, method: "PATCH", body });
export const apiDelete = <T = unknown>(p: string, o: ApiOptions = {}) =>
  api<T>(p, { ...o, method: "DELETE" });
