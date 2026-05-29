/**
 * Server-side payload redaction for persisted audit / API-call rows.
 *
 * Used by:
 *   - `services/admin/audit.ts::writeAudit` — masks PII in `before`/`after`
 *   - `lib/merchant-hmac.ts::persistCall` — masks PII in `request_body`
 *
 * The pino logger has its own redact path (`lib/logger.ts`) for the
 * structured log stream; this helper is for the DB columns we keep
 * indefinitely as part of the audit trail. Even with strict access control,
 * PII at rest is a real GDPR + breach-impact concern, and the admin BO UI
 * shows these payloads directly.
 *
 * Redaction policy (low-risk, reversible only with the original event):
 *   - Email values: keep first 2 chars of local + domain → `ad***@x.com`
 *   - Phone values: keep first 3 + last 2 digits → `905***45`
 *   - IBAN values: keep first 4 + last 4 chars → `TR12****1234`
 *   - Password / OTP / token / secret / cvv keys: full mask → `***`
 *   - Auth headers nested in metadata: full mask
 *
 * Keys matched case-insensitively. Values matched only when the value is a
 * string (objects/arrays are recursed). The redactor never mutates the
 * caller's object — it returns a deep clone.
 */

type Json = unknown;

const FULL_MASK = "***";

const FULL_MASK_KEYS = new Set([
  "password",
  "password_hash",
  "passwordhash",
  "otp",
  "code",
  "totp",
  "totp_secret",
  "secret",
  "secret_encrypted",
  "secretencrypted",
  "api_secret",
  "api_secret_hash",
  "apisecret",
  "signing_secret",
  "signingsecret",
  "signing_secret_encrypted",
  "signingsecretencrypted",
  "access_token",
  "accesstoken",
  "refresh_token",
  "refreshtoken",
  "authorization",
  "auth",
  "x-merchant-secret",
  "x-api-secret",
  "cvv",
  "cvc",
  "card_number",
  "cardnumber",
  "pan",
  "checksum",
  "hmac",
]);

const EMAIL_KEYS = new Set(["email", "user_email", "useremail"]);
const PHONE_KEYS = new Set(["phone", "phone_number", "phonenumber", "tel", "mobile"]);
const IBAN_KEYS = new Set(["iban", "iban_holder", "ibanholder", "payout_address", "payoutaddress"]);

function maskEmail(s: string): string {
  const at = s.indexOf("@");
  if (at <= 0) return FULL_MASK;
  const local = s.slice(0, at);
  const domain = s.slice(at + 1);
  if (local.length <= 2) return `${local[0] ?? "*"}***@${domain}`;
  return `${local.slice(0, 2)}***@${domain}`;
}

function maskPhone(s: string): string {
  const trimmed = s.replace(/\s+/g, "");
  if (trimmed.length <= 4) return "***" + trimmed.slice(-2);
  return trimmed.slice(0, 3) + "***" + trimmed.slice(-2);
}

function maskIban(s: string): string {
  const t = s.replace(/\s+/g, "");
  if (t.length <= 8) return FULL_MASK;
  return t.slice(0, 4) + "****" + t.slice(-4);
}

function lower(s: string): string {
  return s.toLowerCase();
}

/**
 * Recursively mask sensitive fields in a JSON value. The output is a deep
 * clone; the input is never mutated.
 */
export function redactForStorage(value: Json): Json {
  return walk(value, 0);
}

const MAX_DEPTH = 40;

function walk(value: Json, depth: number): Json {
  if (depth > MAX_DEPTH) return FULL_MASK;
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map((v) => walk(v, depth + 1));
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(obj)) {
      const lk = lower(k);
      const v = obj[k];
      if (FULL_MASK_KEYS.has(lk)) {
        out[k] = v === null || v === undefined ? v : FULL_MASK;
        continue;
      }
      if (typeof v === "string") {
        if (EMAIL_KEYS.has(lk)) { out[k] = maskEmail(v); continue; }
        if (PHONE_KEYS.has(lk)) { out[k] = maskPhone(v); continue; }
        if (IBAN_KEYS.has(lk))  { out[k] = maskIban(v);  continue; }
      }
      out[k] = walk(v, depth + 1);
    }
    return out;
  }
  return value;
}
