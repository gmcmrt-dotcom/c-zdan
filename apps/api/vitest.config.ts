import { defineConfig } from "vitest/config";

// I4 — Guard rail: vitest writes + deletes test fixtures against `DATABASE_URL`.
// Running it against a production-shaped URL (anything that doesn't look
// like a local/CI test database) wipes real data. Refuse to start unless
// the URL clearly points at a test target.
//
// Heuristics: must be one of
//   - postgres://*@localhost*
//   - postgres://*@127.0.0.1*
//   - postgres://*@::1*
// OR have `wallet_test` / `walletci` in the database name OR carry the
// explicit opt-in env `VITEST_ALLOW_DB_URL=yes`.
const url = process.env.DATABASE_URL ?? "";
const allowed =
  process.env.VITEST_ALLOW_DB_URL === "yes" ||
  /@(localhost|127\.0\.0\.1|\[::1\]|::1)[:/]/i.test(url) ||
  /\/wallet_test\b/i.test(url) ||
  /\/walletci\b/i.test(url);

if (url && !allowed) {
  // Fail loudly at config-time so no test code runs.
  throw new Error(
    `[vitest] Refusing to start with DATABASE_URL=${url.replace(/:[^:@]+@/, ":***@")}. ` +
      "Use a localhost target, name the DB `wallet_test`, or set VITEST_ALLOW_DB_URL=yes.",
  );
}

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    testTimeout: 30_000,
    fileParallel: false,
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
});
