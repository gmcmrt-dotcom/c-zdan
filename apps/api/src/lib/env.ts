import "dotenv/config";
import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default("0.0.0.0"),

  DATABASE_URL: z.string().url(),

  JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET must be at least 32 chars"),
  JWT_REFRESH_SECRET: z.string().min(32, "JWT_REFRESH_SECRET must be at least 32 chars"),
  JWT_ACCESS_TTL_SEC: z.coerce.number().int().positive().default(60 * 15),
  // P2 — shortened from 30d to 14d for a money product. Existing sessions
  // longer than the new threshold are force-logged-out on next refresh; the
  // operator can override via env if a phased rollout is required.
  JWT_REFRESH_TTL_SEC: z.coerce.number().int().positive().default(60 * 60 * 24 * 14),

  // H1 — Must be 64 lowercase hex chars (32 bytes). The previous min(32)
  // would accept any ASCII string of that length; AES-256-GCM expects a
  // 32-byte raw key. Generating `openssl rand -hex 32` produces the right
  // shape. We also reject the all-zero placeholder to prevent dev-leakage.
  MFA_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, "MFA_ENCRYPTION_KEY must be exactly 64 hex chars (32 bytes)")
    .refine((s) => !/^0+$/.test(s), "MFA_ENCRYPTION_KEY cannot be all zeros"),

  STORAGE_ROOT: z.string().default("./storage"),
  STORAGE_SIGNING_SECRET: z.string().min(32),

  CORS_ORIGINS: z.string().default("http://localhost:8080"),

  MERCHANT_HMAC_PEPPER: z.string().min(16).optional(),
  MERCHANT_CASHOUT_CALLBACK_SECRET: z.string().min(16).optional(),

  // Optional integrations
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-3-5-sonnet-20241022"),
  TG_BOT_TOKEN: z.string().optional(),
  // K7 — VirusTotal env var removed (Q15 decision). Was always a noop in
  // this codebase; the env var existed but no service ever called it,
  // which gave a false impression that uploads were being scanned.
  // Production-grade malware scanning should run at the storage layer
  // (e.g. ClamAV sidecar on file write, S3 bucket + Lambda hook); see
  // `docs/DEPLOY_WORKFLOW.md` for the deployment-side integration notes.
  // The MIME magic-byte sniff in `storage.routes.ts` is a separate
  // defence and is still active.
  RESEND_API_KEY: z.string().optional(),
  NOTIFICATION_FROM_EMAIL: z.string().email().optional(),
  // N — SMTP transport (Q6 decision). Used by `lib/email.ts` when
  // RESEND_API_KEY is not set. All fields optional so the dev/test
  // environment can boot without email; sendEmail() returns a structured
  // skip if neither transport is configured.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  // SMTP_SECURE=true forces TLS-on-connect (typically port 465). Default
  // is STARTTLS upgrade (port 587).
  SMTP_SECURE: z.coerce.boolean().optional(),

  // Aninda
  ANINDA_API_BASE: z.string().url().optional(),
  ANINDA_KEY: z.string().optional(),
  ANINDA_PAYMENT_METHOD_ID: z.string().optional(),
  ANINDA_BANKA_PAYMENT_METHOD_ID: z.string().optional(),
  ANINDA_PAPARA_PAYMENT_METHOD_ID: z.string().optional(),
  ANINDA_DEFAULT_BANK_ID: z.string().optional(),

  MOCK_FNS_ENABLED: z
    .union([z.literal("true"), z.literal("false")])
    .default("false")
    .transform((v) => v === "true"),

  AFFILIATE_SYSTEM_ENABLED: z
    .union([z.literal("true"), z.literal("false")])
    .default("false")
    .transform((v) => v === "true"),

  // P0-18 — Disable referral payouts until anti-farming workers ship.
  // Today scan_referral_farming / scan_round_trip_farming are noops and the
  // qualify/reward pipeline is unimplemented; this flag is a hard gate so an
  // accidental implementation of payout code cannot silently start paying out.
  REFERRAL_PAYOUTS_ENABLED: z
    .union([z.literal("true"), z.literal("false")])
    .default("false")
    .transform((v) => v === "true"),
});

export type Env = z.infer<typeof EnvSchema>;

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("\n");
  // eslint-disable-next-line no-console
  console.error(`[env] Invalid configuration:\n${issues}`);
  throw new Error("Invalid environment configuration");
}

export const env: Env = parsed.data;
export const isProd = env.NODE_ENV === "production";
export const isDev = env.NODE_ENV === "development";
export const isTest = env.NODE_ENV === "test";

export const corsOrigins = env.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean);

// ---- Production hardening guards (P0-11, P0-15, P0-43, P0-50) ----
//
// Refuse to boot in production with dangerous defaults. The same checks were
// previously documented in deploy/env.production.template but never enforced;
// a misconfigured deploy would silently expose dev-only behavior.
if (isProd) {
  const fatalIssues: string[] = [];

  // P0-11 — Mock IBAN / mock provider flow in production is a real-money risk.
  if (env.MOCK_FNS_ENABLED) {
    fatalIssues.push(
      "MOCK_FNS_ENABLED must be false in production (returns fake IBANs from topup-init)",
    );
  }

  // P0-43 — Aninda webhook gate falls back to the literal string "admin" when
  // unset. In production the key must be explicitly set and non-empty.
  if (!env.ANINDA_KEY || env.ANINDA_KEY.length < 16) {
    // Only fatal if Aninda is actually configured (base URL set).
    if (env.ANINDA_API_BASE) {
      fatalIssues.push(
        "ANINDA_KEY must be set (>=16 chars) when ANINDA_API_BASE is configured",
      );
    }
  }

  // Weak/placeholder JWT/MFA/storage/pepper secrets are easy to miss.
  const looksWeak = (s: string | undefined): boolean =>
    !!s &&
    (/^change-?me/i.test(s) || /^0+$/.test(s) || /^test[-_]/i.test(s) || s.includes("AAAA"));
  for (const [name, val] of [
    ["JWT_ACCESS_SECRET", env.JWT_ACCESS_SECRET],
    ["JWT_REFRESH_SECRET", env.JWT_REFRESH_SECRET],
    ["MFA_ENCRYPTION_KEY", env.MFA_ENCRYPTION_KEY],
    ["STORAGE_SIGNING_SECRET", env.STORAGE_SIGNING_SECRET],
    ["MERCHANT_HMAC_PEPPER", env.MERCHANT_HMAC_PEPPER ?? ""],
    ["MERCHANT_CASHOUT_CALLBACK_SECRET", env.MERCHANT_CASHOUT_CALLBACK_SECRET ?? ""],
  ] as const) {
    if (val && looksWeak(val)) {
      fatalIssues.push(`${name} looks like a placeholder; rotate before going live`);
    }
  }

  // CORS_ORIGINS=* is never appropriate in production.
  if (corsOrigins.includes("*")) {
    fatalIssues.push("CORS_ORIGINS cannot include '*' in production");
  }

  if (fatalIssues.length > 0) {
    const msg = fatalIssues.map((s) => `  - ${s}`).join("\n");
    // eslint-disable-next-line no-console
    console.error(`[env] Refusing to start in production:\n${msg}`);
    throw new Error("Unsafe production configuration");
  }
}
