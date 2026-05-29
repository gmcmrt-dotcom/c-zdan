import {
  boolean,
  index,
  inet,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { appRole, kycStatus } from "./_enums";

/**
 * Single identity table — replaces Supabase auth.users.
 * Every other table referencing a "user_id" FKs to users.id here.
 */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    isActive: boolean("is_active").notNull().default(true),
    // P1 — Account lockout. After N failed logins, set `lockedUntil` so the
    // next attempt is rejected even with the correct password. Both columns
    // are reset on a successful login. See migration 0004.
    failedLoginCount: integer("failed_login_count").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_email_unique_lower").on(sql`lower(${t.email})`)],
);

export const profiles = pgTable(
  "profiles",
  {
    id: uuid("id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    phone: text("phone"),
    kycStatus: kycStatus("kyc_status").notNull().default("none"),
    isFrozen: boolean("is_frozen").notNull().default(false),
    memberNo: text("member_no").notNull(),
    referralCode: text("referral_code"),
    signupIp: inet("signup_ip"),
    signupUa: text("signup_ua"),
    signupAt: timestamp("signup_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("profiles_member_no_unique").on(t.memberNo),
    uniqueIndex("profiles_email_unique_lower").on(sql`lower(${t.email})`),
    uniqueIndex("profiles_referral_code_unique").on(t.referralCode).where(sql`${t.referralCode} IS NOT NULL`),
    uniqueIndex("profiles_phone_unique").on(t.phone).where(sql`${t.phone} IS NOT NULL`),
  ],
);

export const userRoles = pgTable(
  "user_roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: appRole("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("user_roles_user_role_unique").on(t.userId, t.role)],
);

/**
 * K3 — MFA backup codes (Q11). One-time codes accepted at the MFA
 * challenge step as a fallback for a lost device. Generated at
 * enroll-verify (8 codes, shown ONCE), stored only as sha256 hashes,
 * consumed by setting `consumed_at`. Regenerate API drops all unused.
 */
export const userMfaBackupCodes = pgTable(
  "user_mfa_backup_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("user_mfa_backup_codes_user_idx").on(t.userId).where(sql`${t.consumedAt} IS NULL`),
    uniqueIndex("user_mfa_backup_codes_user_hash_unique").on(t.userId, t.codeHash),
  ],
);

export const userLoginIps = pgTable(
  "user_login_ips",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(), // intentionally no FK (kept loose like Supabase)
    ipAddress: inet("ip_address").notNull(),
    userAgent: text("user_agent"),
    // K1-r — Geo enrichment via LOCAL geoip-lite (offline MaxMind
    // GeoLite2 country/region/city DB). Zero outbound network calls;
    // no PII leaves the host. `region` is rarely populated for non-US
    // blocks; `city` is populated when the IP is in a known city block.
    // All nullable.
    country: text("country"),
    countryCode: text("country_code"),
    city: text("city"),
    region: text("region"),
    deviceType: text("device_type"),
    browser: text("browser"),
    browserVersion: text("browser_version"),
    os: text("os"),
    osVersion: text("os_version"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("user_login_ips_user_created_idx").on(t.userId, t.createdAt.desc())],
);

export const profileChangeOtps = pgTable("profile_change_otps", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  changeType: text("change_type").notNull(), // 'email' | 'phone'
  newValue: text("new_value").notNull(),
  codeHash: text("code_hash").notNull(),
  attempts: integer("attempts").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const userSpecialDays = pgTable("user_special_days", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  month: smallint("month").notNull(),
  day: smallint("day").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** TOTP MFA factors — replaces Supabase auth MFA tables. */
export const userMfaFactors = pgTable(
  "user_mfa_factors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    friendlyName: text("friendly_name").notNull(),
    secretEncrypted: text("secret_encrypted").notNull(), // AES-256-GCM(MFA_ENCRYPTION_KEY)
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    // P1 — TOTP replay protection. Stores the last TOTP step (Unix seconds /
    // 30) that successfully validated against this factor. The challenge
    // verifier refuses any code that resolves to a step <= this value, so a
    // captured-and-replayed 30-second code is single-use even within its
    // validity window. See migration 0004.
    lastUsedStep: integer("last_used_step"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("user_mfa_factors_user_idx").on(t.userId)],
);

/** Refresh-token store (rotating). */
export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    aal: text("aal").notNull().default("aal1"),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ip: inet("ip"),
    userAgent: text("user_agent"),
  },
  (t) => [
    uniqueIndex("refresh_tokens_hash_unique").on(t.tokenHash),
    index("refresh_tokens_user_idx").on(t.userId),
  ],
);

/** Password-reset tokens (single-use, short TTL). */
export const passwordResetTokens = pgTable(
  "password_reset_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    ip: inet("ip"),
  },
  (t) => [uniqueIndex("password_reset_tokens_hash_unique").on(t.tokenHash)],
);

/** Email-verification tokens. */
export const emailVerificationTokens = pgTable(
  "email_verification_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    email: text("email").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("email_verification_tokens_hash_unique").on(t.tokenHash)],
);
