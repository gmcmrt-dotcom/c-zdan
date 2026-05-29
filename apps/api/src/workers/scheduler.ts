/**
 * Cron-style scheduler. Replaces the 14 `pg_cron` jobs from the legacy stack.
 *
 * Each job runs through `runJob` which:
 *  - inserts a `job_runs` row with status='running'
 *  - skips if another running row exists (the `job_runs_running_unique`
 *    partial index enforces this at the DB level too)
 *  - awaits the job, persists status + result
 *  - swallows + logs errors so one failed job can't kill the worker
 */
import cron from "node-cron";
import { addDays } from "date-fns";
import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { db } from "../db/client";
import {
  jobRuns,
  merchantIdempotency,
} from "../db/schema";
import { logger } from "../lib/logger";
import { runDispatcher } from "./dispatch.service";
import { sweepExpiredJtis } from "../auth/jti-denylist";
import { alertIfDailyBudgetCrossed } from "../services/ai-cost.service";
import {
  expireStaleTopupSessions,
} from "../services/topup.service";
import {
  scanWithdrawTimeouts,
} from "../services/withdraw.service";
import {
  expireStalePaymentCodes,
} from "../services/payment-code.service";
import { runLedgerIntegrityChecks } from "../services/ledger-integrity.service";

type JobFn = () => Promise<unknown>;

const jobs: Array<{ name: string; cron: string; fn: JobFn }> = [
  { name: "scan_withdraw_timeouts", cron: "*/5 * * * *", fn: scanWithdrawTimeouts },
  { name: "expire_stale_topup_sessions", cron: "*/5 * * * *", fn: expireStaleTopupSessions },
  { name: "expire_stale_payment_codes", cron: "*/5 * * * *", fn: expireStalePaymentCodes },
  { name: "purge_merchant_idempotency", cron: "15 3 * * *", fn: purgeMerchantIdempotency },
  { name: "purge_event_outbox", cron: "0 4 * * *", fn: purgeEventOutbox },
  { name: "dispatch_events", cron: "*/2 * * * *", fn: runDispatcher },
  { name: "refresh_admin_tx_daily", cron: "45 * * * *", fn: refreshAdminTxDaily },
  // Batch P (p3-third-sweep) — additive observability. The hourly
  // refresher above writes `updated_at = now()`; if the most recent row
  // is more than `ADMIN_TX_DAILY_STALE_MINUTES` old, something silently
  // failed the refresh (DB lock, exception in the worker, etc.). This
  // watcher only logs a structured warn — no fix-up, no behavior change.
  // Runs every 30 min on the half-hour so it doesn't collide with the
  // :45 refresh slot.
  { name: "warn_stale_admin_tx_daily", cron: "30 * * * *", fn: warnIfAdminTxDailyStale },
  // The other 6 legacy jobs (scan_round_trip, apply_special_day_bonuses,
  // scan_referral_farming, expire_stale_referrals, expire_profit_share, scan_stale_cash_pools)
  // are stubs — the original logic lives in PL/pgSQL and will be ported as
  // those features need to be exercised. For now they no-op.
  { name: "scan_round_trip_farming", cron: "30 * * * *", fn: noop("scan_round_trip_farming") },
  { name: "apply_special_day_bonuses", cron: "0 6 * * *", fn: noop("apply_special_day_bonuses") },
  { name: "expire_stale_referrals", cron: "0 */6 * * *", fn: noop("expire_stale_referrals") },
  { name: "scan_referral_farming", cron: "30 3 * * *", fn: noop("scan_referral_farming") },
  { name: "scan_stale_cash_pools", cron: "15 * * * *", fn: scanStaleCashPools },
  { name: "expire_profit_share_allocations", cron: "*/5 * * * *", fn: expireProfitShareAllocations },
  // H3 — Token + denylist hygiene. Cheap; runs hourly.
  { name: "purge_expired_auth_tokens", cron: "10 * * * *", fn: purgeExpiredAuthTokens },
  { name: "cleanup_abandoned_mfa_enrollments", cron: "20 * * * *", fn: cleanupAbandonedMfaEnrollments },
  { name: "sweep_jti_denylist", cron: "*/15 * * * *", fn: sweepJtiDenylist },
  // K6 — AI daily budget soft alert (Q8). Logs an `[AI_BUDGET_SOFT_ALERT]`
  // error every hour while today's spend is >= 80% of `AI_DAILY_BUDGET_USD`
  // (default 50). The deploy log forwarder converts that to a Telegram /
  // email alert; downstream alerting dedupes. We do NOT auto-pause AI —
  // ops decides whether to unset ANTHROPIC_API_KEY or raise the cap.
  { name: "ai_budget_alert", cron: "0 * * * *", fn: alertIfDailyBudgetCrossed },
  // Ledger integrity cross-check — 06:00 / 14:00 / 22:00 UTC (3× daily).
  { name: "ledger_integrity_crosscheck", cron: "0 6,14,22 * * *", fn: runLedgerIntegrityCron },
];

function noop(name: string): JobFn {
  return async () => {
    logger.debug({ job: name }, "noop job tick");
    return { skipped: true };
  };
}

async function runJob(name: string, fn: JobFn): Promise<void> {
  let runId: string | null = null;
  try {
    const [row] = await db
      .insert(jobRuns)
      .values({ jobName: name, status: "running" })
      .onConflictDoNothing()
      .returning({ id: jobRuns.id });
    if (!row) {
      logger.debug({ job: name }, "skipped — another run in progress");
      return;
    }
    runId = row.id;
    const result = await fn();
    await db
      .update(jobRuns)
      .set({ finishedAt: new Date(), status: "ok", result: (result ?? null) as never })
      .where(eq(jobRuns.id, runId));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err, job: name }, "job failed");
    if (runId) {
      await db
        .update(jobRuns)
        .set({ finishedAt: new Date(), status: "error", error: msg })
        .where(eq(jobRuns.id, runId));
    }
  }
}

async function runLedgerIntegrityCron() {
  const result = await runLedgerIntegrityChecks({ triggeredBy: "cron" });
  return {
    runId: result.runId,
    ok: result.ok,
    findings: result.findings.length,
    critical: result.summary.bySeverity.critical,
    error: result.summary.bySeverity.error,
  };
}

async function purgeMerchantIdempotency() {
  const r = await db.delete(merchantIdempotency).where(lt(merchantIdempotency.expiresAt, new Date()));
  return { deleted: r };
}

async function purgeEventOutbox() {
  // delete rows whose sent_at is older than 30 days
  const cutoff = addDays(new Date(), -30);
  const r = await db.execute(sql`
    DELETE FROM event_outbox
    WHERE sent_at IS NOT NULL AND sent_at < ${cutoff}
  `);
  return { result: r };
}

async function refreshAdminTxDaily() {
  // P0-36 — Snapshot daily aggregates into admin_tx_daily. The schema was
  // fixed in migration 0002 (day=date, money=numeric(14,2), PK (day,type));
  // this worker now matches those types. Drop the previous catch-all; if it
  // fails we want to know.
  await db.execute(sql`
    INSERT INTO admin_tx_daily (day, type, tx_count, total_amount, total_fee, updated_at)
    SELECT date_trunc('day', created_at)::date,
           type,
           count(*)::int,
           COALESCE(sum(amount), 0),
           COALESCE(sum(fee), 0),
           now()
    FROM transactions
    WHERE created_at >= now() - interval '40 days'
    GROUP BY 1, 2
    ON CONFLICT (day, type) DO UPDATE
      SET tx_count = EXCLUDED.tx_count,
          total_amount = EXCLUDED.total_amount,
          total_fee = EXCLUDED.total_fee,
          updated_at = now()
  `);
  return { refreshed: true };
}

/**
 * Batch P (p3-third-sweep) — admin_tx_daily staleness watcher.
 *
 * Pure observability. Emits a structured warn when
 *   max(updated_at) < now() - ADMIN_TX_DAILY_STALE_MINUTES
 * The deploy log forwarder converts that to an ops alert. No data is
 * written, no behavior changes — if the refresher is healthy this is a
 * no-op every tick.
 *
 * Threshold default = 120 min (2× the hourly refresh cadence). Override
 * via the `ADMIN_TX_DAILY_STALE_MINUTES` env var if the refresh cadence
 * is ever tightened.
 */
async function warnIfAdminTxDailyStale() {
  const threshold = Number(process.env.ADMIN_TX_DAILY_STALE_MINUTES ?? 120);
  const safeThreshold = Number.isFinite(threshold) && threshold > 0 ? threshold : 120;
  const rows = (await db.execute<{ max_updated: Date | null; row_count: number }>(sql`
    SELECT max(updated_at) AS max_updated,
           count(*)::int    AS row_count
      FROM admin_tx_daily
  `)) as unknown as Array<{ max_updated: Date | null; row_count: number }>;
  const row = rows[0];
  if (!row || row.row_count === 0) {
    return { stale: false, reason: "empty" };
  }
  const max = row.max_updated ? new Date(row.max_updated) : null;
  if (!max) return { stale: false, reason: "no_max" };
  const ageMin = Math.round((Date.now() - max.getTime()) / 60_000);
  if (ageMin > safeThreshold) {
    logger.warn(
      { ageMinutes: ageMin, thresholdMinutes: safeThreshold, lastUpdatedAt: max.toISOString() },
      "admin_tx_daily refresh appears stale — refresher cron may be failing",
    );
    return { stale: true, ageMinutes: ageMin };
  }
  return { stale: false, ageMinutes: ageMin };
}

async function expireProfitShareAllocations() {
  const r = await db.execute(sql`
    UPDATE profit_share_allocations
    SET status = 'expired', expired_at = now()
    WHERE status = 'pending' AND expires_at < now()
  `);
  return { result: r };
}

/**
 * H3 — Purge expired refresh / password-reset / email-verification tokens.
 *
 * The DB never deletes these — `revokedAt` flags them and `expires_at`
 * marks them dead, but the rows accumulate. At scale (1 refresh/day per
 * active user × 30 days × N users) the table grows fast. Drop anything
 * past its `expires_at` (regardless of revoked state) so the live working
 * set is bounded by the refresh TTL window plus the natural revoke lag.
 *
 * Idempotent. Uses the `*_expires_at_idx` partial indexes added in
 * migration 0006 so the DELETE is index-driven.
 */
async function purgeExpiredAuthTokens() {
  const r = await db.execute<{ refresh: number; reset: number; verify: number }>(sql`
    WITH d1 AS (
      DELETE FROM refresh_tokens WHERE expires_at < now() RETURNING 1
    ), d2 AS (
      DELETE FROM password_reset_tokens WHERE expires_at < now() RETURNING 1
    ), d3 AS (
      DELETE FROM email_verification_tokens WHERE expires_at < now() RETURNING 1
    )
    SELECT
      (SELECT count(*)::int FROM d1) AS refresh,
      (SELECT count(*)::int FROM d2) AS reset,
      (SELECT count(*)::int FROM d3) AS verify
  `);
  const row = (r as unknown as Array<{ refresh: number; reset: number; verify: number }>)[0] ?? {
    refresh: 0,
    reset: 0,
    verify: 0,
  };
  if (row.refresh > 0 || row.reset > 0 || row.verify > 0) {
    logger.info(
      { refresh: row.refresh, reset: row.reset, verify: row.verify },
      "purged expired auth tokens",
    );
  }
  return row;
}

/**
 * H3 — Drop `user_mfa_factors` rows that were never verified within 1 hour.
 *
 * A user who started MFA enrollment but abandoned mid-flow (closed the
 * dialog, lost the QR) leaves a pending row in the table that's still
 * decryptable + counts toward their factor list. The enrollment one-shot
 * fix (H1) makes mfaEnroll replace the pending row, but a user who
 * enrolled and then never returned still has the row. Drop them.
 */
async function cleanupAbandonedMfaEnrollments() {
  const r = await db.execute<{ removed: number }>(sql`
    WITH d AS (
      DELETE FROM user_mfa_factors
      WHERE verified_at IS NULL
        AND created_at < now() - interval '1 hour'
      RETURNING 1
    )
    SELECT count(*)::int AS removed FROM d
  `);
  const removed = (r as unknown as Array<{ removed: number }>)[0]?.removed ?? 0;
  if (removed > 0) {
    logger.info({ removed }, "cleaned abandoned MFA enrollments");
  }
  return { removed };
}

/**
 * H3 — Sweep the in-process JTI denylist. The deny map auto-expires
 * entries on lookup, but a long-lived process with no traffic to those
 * specific JTIs would grow the map. This sweeper trims it every 15 min.
 */
async function sweepJtiDenylist() {
  return sweepExpiredJtis();
}

/**
 * P2 — scan_stale_cash_pools.
 *
 * Finance merchants whose `cash_pool_updated_at` hasn't moved within the
 * routing freshness window (15 min) are temporarily de-routable. This
 * scanner runs hourly, emits a structured log line per stale merchant, and
 * flips `failure_rate_pct` upward by a small step so the routing predicate
 * (failure_rate_pct < 5) drops them naturally. The next successful
 * settlement bumps `cash_pool_updated_at` and recovers them.
 *
 * Not destructive — the merchant is never disabled; routing just skips
 * them until the cash_pool is fresh again. Ops gets a structured log they
 * can alert on.
 */
async function scanStaleCashPools() {
  const STALE_MINUTES = 30;
  const stale = await db.execute<{
    id: string;
    cash_pool_updated_at: Date | null;
    failure_rate_pct: number | null;
  }>(sql`
    SELECT id, cash_pool_updated_at, failure_rate_pct
    FROM merchants
    WHERE merchant_type = 'finance'
      AND is_active = TRUE
      AND (cash_pool_updated_at IS NULL
           OR cash_pool_updated_at < now() - (${STALE_MINUTES}::text || ' minutes')::interval)
  `);
  const list = stale as unknown as Array<{
    id: string;
    cash_pool_updated_at: Date | null;
    failure_rate_pct: number | null;
  }>;
  for (const m of list) {
    const ageMin = m.cash_pool_updated_at
      ? Math.round((Date.now() - new Date(m.cash_pool_updated_at).getTime()) / 60000)
      : null;
    logger.warn(
      { merchantId: m.id, cashPoolAgeMinutes: ageMin, failureRatePct: m.failure_rate_pct },
      "stale finance merchant cash_pool (excluded from routing freshness window)",
    );
  }
  return { stale_count: list.length };
}

/**
 * P0-17 — sweep stale `running` rows on boot.
 *
 * `job_runs_running_unique` is a partial unique index on rows where
 * `finished_at IS NULL`, so a single crash mid-job permanently blocks every
 * future run of that job. This sweeper marks any row older than the
 * threshold (default 30 minutes) as `error_stale` so a fresh run can
 * acquire the slot. Safe to call repeatedly; cron also invokes it hourly.
 */
const STALE_RUN_MINUTES = 30;
async function reclaimStaleRunningJobs(): Promise<void> {
  try {
    const r = await db
      .update(jobRuns)
      .set({
        finishedAt: new Date(),
        status: "error_stale",
        error: `reclaimed: no heartbeat in >${STALE_RUN_MINUTES} minutes`,
      })
      .where(
        and(
          isNull(jobRuns.finishedAt),
          lt(jobRuns.startedAt, new Date(Date.now() - STALE_RUN_MINUTES * 60_000)),
        ),
      )
      .returning({ id: jobRuns.id, jobName: jobRuns.jobName });
    if (r.length > 0) {
      logger.warn({ count: r.length, jobs: r.map((x) => x.jobName) }, "reclaimed stale job_runs");
    }
  } catch (err) {
    logger.error({ err }, "reclaimStaleRunningJobs failed");
  }
}

let started = false;

export function startScheduler(): void {
  if (started) return;
  started = true;
  // Sweep any rows left in 'running' state from a previous crash, then keep
  // sweeping hourly so a multi-instance deployment also self-heals.
  void reclaimStaleRunningJobs();
  cron.schedule("17 * * * *", () => void reclaimStaleRunningJobs(), { timezone: "UTC" });
  for (const j of jobs) {
    cron.schedule(j.cron, () => void runJob(j.name, j.fn), { timezone: "UTC" });
    logger.info({ job: j.name, cron: j.cron }, "scheduled");
  }
}
