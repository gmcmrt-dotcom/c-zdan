import pino from "pino";
import { env, isDev } from "./env";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (isDev ? "debug" : "info"),
  base: { env: env.NODE_ENV },
  redact: {
    // P1 — extend the redact list beyond authn headers to cover any PII or
    // secret we might accidentally log via `logger.info({ user })` or via the
    // pino-http auto-serialiser. Keep a single source of truth here so we
    // don't have to remember every call site.
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      'req.headers["x-merchant-signature"]',
      'req.headers["x-cron-secret"]',
      'req.headers["x-api-secret"]',
      'req.headers["x-merchant-key"]',
      'req.headers["x-cashout-signature"]',
      'res.headers["set-cookie"]',
      "*.password",
      "*.password_hash",
      "*.secret",
      "*.api_secret",
      "*.api_secret_hash",
      "*.signing_secret",
      "*.signing_secret_encrypted",
      "*.refreshToken",
      "*.refresh_token",
      "*.accessToken",
      "*.access_token",
      "*.iban",
      "*.payout_address",
      "*.phone",
      "*.totp_secret",
      "*.secret_encrypted",
      // J3 — Additional outbound + geo-lookup body redactions.
      // The Anthropic / Telegram outbound bodies carry user-typed chat
      // transcripts; the ipapi.co response carries the same IP we're
      // already redacting in audit_log. Belt + braces.
      "*.anthropic_body",
      "*.telegram_body",
      "*.ipapi_body",
      "*.geo",
      "*.country",
      "*.country_code",
      "*.city",
      "*.region",
      "*.user_agent",
      "*.userAgent",
      "*.email",
      "*.first_name",
      "*.last_name",
      "*.firstName",
      "*.lastName",
      "*.identity_number",
      "*.identityNumber",
      "*.tax_id",
      "*.taxId",
      "*.aninda_key",
      "*.ANINDA_KEY",
      // Token-like values
      "*.token",
      "*.token_hash",
      "*.tokenHash",
      "*.jti",
      "*.otp",
      "*.otp_code",
      "*.mfa_code",
    ],
    censor: "[redacted]",
  },
  transport: isDev
    ? { target: "pino-pretty", options: { colorize: true, translateTime: "SYS:HH:MM:ss" } }
    : undefined,
});
