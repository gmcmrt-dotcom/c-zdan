/**
 * Outbox dispatcher — drains event_outbox and sends via Resend (email) /
 * Telegram (chat) / a stub for SMS.
 *
 * Returns counters. Idempotency: rows are claimed via `UPDATE … RETURNING`
 * with a status flip in a single statement so a parallel worker can't grab
 * the same row.
 *
 * H3 — Retry policy:
 *   - On send failure, the row goes back to `pending` with `scheduled_for`
 *     set to `now() + backoff(attempts)` until `attempts >= MAX_ATTEMPTS`.
 *     After that the row stays in `failed` and ops have to inspect it.
 *   - A separate sweeper reclaims `sending` rows older than the stall
 *     threshold (the previous worker crashed mid-send). Without the
 *     sweeper a crash left the row in `sending` forever.
 */
import { sql } from "drizzle-orm";
import { sendEmail as sendEmailViaTransport } from "../lib/email";
import { db } from "../db/client";
import { env } from "../lib/env";
import { logger } from "../lib/logger";

const BATCH_SIZE = 50;
const MAX_ATTEMPTS = 6; // ~exponential ≈ 1m, 2m, 4m, 8m, 16m, 32m = ~1hr total
const STALL_RECLAIM_MINUTES = 5;

function backoffSeconds(attempts: number): number {
  // Capped exponential — 60s × 2^(attempts-1), max 30 min.
  const base = 60 * Math.pow(2, Math.max(0, attempts - 1));
  return Math.min(base, 30 * 60);
}

// N — Email transport (Q6). Delegates to lib/email.ts which picks SMTP
// first, Resend second, or returns a structured EMAIL_NOT_CONFIGURED
// skip if neither is set. Never throws.
async function sendEmail(to: string, subject: string, html: string) {
  return sendEmailViaTransport({ to, subject, html });
}

export interface DispatchResult {
  total: number;
  sent: number;
  failed: number;
  skipped: number;
}

interface OutboxRow extends Record<string, unknown> {
  id: string;
  channel: string;
  template_key: string;
  to_address: string | null;
  payload: Record<string, unknown>;
  attempts: number;
}

/**
 * Mark a row as retryable: bump back to `pending` with `scheduled_for`
 * pushed into the future by `backoff(attempts)`. After `MAX_ATTEMPTS`
 * we give up and leave it in `failed`.
 */
async function markRetryOrFailed(id: string, attempts: number, lastError: string): Promise<"retry" | "failed"> {
  if (attempts >= MAX_ATTEMPTS) {
    await db.execute(sql`UPDATE event_outbox SET status='failed', last_error=${lastError} WHERE id = ${id}`);
    return "failed";
  }
  const delay = backoffSeconds(attempts);
  await db.execute(sql`
    UPDATE event_outbox
    SET status = 'pending',
        last_error = ${lastError},
        scheduled_for = now() + (${delay}::text || ' seconds')::interval
    WHERE id = ${id}
  `);
  return "retry";
}

/**
 * H3 — Reclaim rows stuck in `sending` past the stall threshold. A worker
 * that crashed mid-send leaves the row there forever; this puts it back
 * into the retry queue. Cheap one-liner, run at the start of every tick.
 */
async function reclaimStalledSendingRows(): Promise<number> {
  const r = await db.execute<{ id: string }>(sql`
    UPDATE event_outbox
    SET status = 'pending', last_error = 'reclaimed_stalled_sending'
    WHERE status = 'sending'
      AND updated_at < now() - (${STALL_RECLAIM_MINUTES}::text || ' minutes')::interval
    RETURNING id
  `);
  const list = r as unknown as Array<{ id: string }>;
  if (list.length > 0) logger.warn({ count: list.length }, "reclaimed stalled outbox 'sending' rows");
  return list.length;
}

export async function runDispatcher(): Promise<DispatchResult> {
  await reclaimStalledSendingRows();

  const claimed = await db.execute<OutboxRow>(sql`
    UPDATE event_outbox
    SET status = 'sending', attempts = attempts + 1, updated_at = now()
    WHERE id IN (
      SELECT id FROM event_outbox
      WHERE status = 'pending' AND scheduled_for <= now()
      ORDER BY scheduled_for
      LIMIT ${BATCH_SIZE}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, channel, template_key, to_address, payload, attempts
  `);
  const rows = claimed as unknown as OutboxRow[];

  const out: DispatchResult = { total: rows.length, sent: 0, failed: 0, skipped: 0 };

  for (const r of rows) {
    try {
      if (r.channel === "email") {
        if (!r.to_address) {
          out.skipped++;
          await db.execute(sql`UPDATE event_outbox SET status='skipped', sent_at=now(), last_error='NO_RECIPIENT' WHERE id = ${r.id}`);
          continue;
        }
        const subject = String(r.payload.subject ?? "Wallet notification");
        const html = String(r.payload.html ?? r.payload.text ?? "");
        const result = await sendEmail(r.to_address, subject, html);
        if (result.ok) {
          out.sent++;
          await db.execute(sql`UPDATE event_outbox SET status='sent', sent_at=now() WHERE id = ${r.id}`);
        } else {
          // H3 — transient failures now retry with exponential backoff.
          const outcome = await markRetryOrFailed(r.id, r.attempts, result.error);
          if (outcome === "failed") out.failed++; else out.sent--; // count retried as still-in-flight (not failed yet)
        }
      } else if (r.channel === "telegram") {
        // H3 — telegram channel: currently the chat.service writes Telegram
        // notifications synchronously via tgSendMessage. Outbox-routed
        // telegram rows are deferred; mark skipped with structured reason.
        out.skipped++;
        await db.execute(sql`UPDATE event_outbox SET status='skipped', sent_at=now(), last_error='TELEGRAM_VIA_DIRECT_PATH' WHERE id = ${r.id}`);
      } else if (r.channel === "sms") {
        out.skipped++;
        await db.execute(sql`UPDATE event_outbox SET status='skipped', sent_at=now(), last_error='SMS_DISABLED' WHERE id = ${r.id}`);
      } else {
        out.skipped++;
        await db.execute(sql`UPDATE event_outbox SET status='skipped', sent_at=now(), last_error='UNKNOWN_CHANNEL' WHERE id = ${r.id}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // H3 — unexpected exception also retries with backoff (transient
      // network / DB blip).
      const outcome = await markRetryOrFailed(r.id, r.attempts, msg);
      if (outcome === "failed") out.failed++;
    }
  }
  if (out.total > 0) logger.info(out, "dispatcher tick");
  return out;
}
