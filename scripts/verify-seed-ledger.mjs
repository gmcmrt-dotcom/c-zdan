#!/usr/bin/env node
/**
 * Runs ledger integrity checks against the current DATABASE_URL.
 * Intended after `npm run db:migrate && npm run db:seed && npm run test:seed`
 * and BEFORE `node scripts/smoke-all.mjs` (smoke adds non-ledger-safe data).
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../apps/api/.env") });

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL missing — expected in apps/api/.env");
  process.exit(1);
}

const { runLedgerIntegrityChecks } = await import(
  "../apps/api/src/services/ledger-integrity.service.ts"
);
const { sql: pg } = await import("../apps/api/src/db/client.ts");

try {
  const result = await runLedgerIntegrityChecks({ triggeredBy: "manual" });
  const { critical, error, warning, info } = result.summary.bySeverity;

  console.log(
    JSON.stringify(
      {
        ok: result.ok,
        runId: result.runId,
        durationMs: result.durationMs,
        critical_count: critical,
        error_count: error,
        warning_count: warning,
        info_count: info,
        finding_count: result.findings.length,
      },
      null,
      2,
    ),
  );

  if (!result.ok) {
    const bad = result.findings.filter((f) => f.severity === "critical" || f.severity === "error");
    console.error("\nCritical/error findings (first 20):");
    for (const f of bad.slice(0, 20)) {
      console.error(`- [${f.checkId}] ${f.message}`, f.entityRefs ?? "");
    }
    process.exit(1);
  }
} finally {
  await pg.end();
}
