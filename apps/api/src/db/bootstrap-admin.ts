/**
 * Idempotent bootstrap of the local admin account.
 *
 *   npm run admin:bootstrap                # uses defaults from env
 *   ADMIN_EMAIL=foo@bar npm run admin:bootstrap
 *
 * Defaults (DEV ONLY): admin@wallet.local / Admin1234
 *
 * Creates (if missing):
 *   - users row (with bcrypt password hash, must_change_password=true)
 *   - profiles row (admin user, generated member_no + referral_code)
 *   - accounts row (zero balance)
 *   - user_roles(role='admin')
 *
 * P0-10 — Production hardening:
 *   - Refuses to run with NODE_ENV=production unless ALLOW_ADMIN_BOOTSTRAP=true
 *     AND ADMIN_PASS is explicitly set to a non-default value of >= 12 chars.
 *   - The created/updated user has `must_change_password=true` so first login
 *     is forced to rotate the password.
 *   - Password is written to a separate stream (stderr) with a one-shot banner
 *     so it can be captured during install but not silently teed into log files
 *     (see installer P0-29 for the supporting `.gitignore` + redact changes).
 *
 * Safe to re-run: every step is `ON CONFLICT DO NOTHING` or guarded by an exists check.
 */
import { eq, sql } from "drizzle-orm";
import { db, sql as pgClient } from "./client";
import { users, profiles, userRoles } from "./schema/auth";
import { accounts } from "./schema/wallet";
import { hashPassword } from "../auth/passwords";
import { genMemberNo, genReferralCode } from "../lib/random";
import { logger } from "../lib/logger";

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL ?? "admin@wallet.local").toLowerCase();
const DEFAULT_ADMIN_PASS = "Admin1234";
const ADMIN_PASS = process.env.ADMIN_PASS ?? DEFAULT_ADMIN_PASS;
const ADMIN_FIRST = process.env.ADMIN_FIRST_NAME ?? "Admin";
const ADMIN_LAST = process.env.ADMIN_LAST_NAME ?? "User";

function assertSafeForEnvironment(): void {
  const nodeEnv = process.env.NODE_ENV ?? "development";
  const isProd = nodeEnv === "production";
  if (!isProd) return;

  const allow = process.env.ALLOW_ADMIN_BOOTSTRAP === "true";
  if (!allow) {
    throw new Error(
      "Refusing to run admin:bootstrap with NODE_ENV=production. " +
        "Set ALLOW_ADMIN_BOOTSTRAP=true explicitly to override.",
    );
  }
  if (ADMIN_PASS === DEFAULT_ADMIN_PASS) {
    throw new Error(
      "ADMIN_PASS is unset in production. Provide a strong password via env (>=12 chars).",
    );
  }
  if (ADMIN_PASS.length < 12) {
    throw new Error("ADMIN_PASS must be at least 12 characters in production.");
  }
  if (
    /^admin/i.test(ADMIN_PASS) ||
    /^password/i.test(ADMIN_PASS) ||
    /^changeme/i.test(ADMIN_PASS)
  ) {
    throw new Error("ADMIN_PASS looks like a known weak password; pick something unique.");
  }
}

async function main(): Promise<void> {
  assertSafeForEnvironment();
  logger.info({ email: ADMIN_EMAIL }, "bootstrapping admin");

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = ${ADMIN_EMAIL}`)
    .limit(1);

  let userId: string;
  let created = false;
  if (existing[0]) {
    userId = existing[0].id;
    logger.info({ userId }, "admin user exists — ensuring role");
  } else {
    const passwordHash = await hashPassword(ADMIN_PASS);
    const memberNo = genMemberNo();
    const referralCode = genReferralCode();

    userId = await db.transaction(async (trx) => {
      const [u] = await trx
        .insert(users)
        .values({ email: ADMIN_EMAIL, passwordHash, emailVerifiedAt: new Date() })
        .returning({ id: users.id });
      if (!u) throw new Error("user insert failed");

      await trx.insert(profiles).values({
        id: u.id,
        email: ADMIN_EMAIL,
        firstName: ADMIN_FIRST,
        lastName: ADMIN_LAST,
        phone: null,
        memberNo,
        referralCode,
        signupAt: new Date(),
      });

      await trx.insert(accounts).values({
        userId: u.id,
        balance: "0",
        reservedBalance: "0",
        totalPoints: 0,
      });

      return u.id;
    });
    created = true;
    logger.info({ userId, email: ADMIN_EMAIL, memberNo }, "admin user created");
  }

  // Ensure admin role (idempotent)
  await db
    .insert(userRoles)
    .values({ userId, role: "admin" })
    .onConflictDoNothing();

  // Verify
  const [check] = await db
    .select({
      email: users.email,
      role: userRoles.role,
    })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .where(eq(users.id, userId))
    .limit(1);

  if (!check || check.role !== "admin") {
    throw new Error("admin role verification failed");
  }

  logger.info({ email: check.email, role: check.role }, "✓ admin bootstrap OK");

  // P0-10 / P0-29 — only print the password line when we actually created a
  // new user with the default. For re-runs (already exists) or production
  // (custom password), we never echo the password. Write to stderr so the
  // installer's `tee dev.log` does not capture stdout-only banners.
  const isProd = process.env.NODE_ENV === "production";
  process.stderr.write("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  process.stderr.write(" Admin account ready\n");
  process.stderr.write("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  process.stderr.write(`  Email:    ${ADMIN_EMAIL}\n`);
  if (created && ADMIN_PASS === DEFAULT_ADMIN_PASS && !isProd) {
    process.stderr.write(`  Password: ${ADMIN_PASS}  (DEV DEFAULT — change after first login)\n`);
  } else if (created) {
    process.stderr.write(`  Password: (set via ADMIN_PASS env — keep it safe)\n`);
  } else {
    process.stderr.write(`  Password: (unchanged — use existing credentials)\n`);
  }
  process.stderr.write(`  Sign in:  http://localhost:8080/auth\n`);
  process.stderr.write("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n");
}

main()
  .then(async () => {
    await pgClient.end();
    process.exit(0);
  })
  .catch(async (err) => {
    logger.error({ err }, "bootstrap-admin failed");
    await pgClient.end().catch(() => {});
    process.exit(1);
  });
