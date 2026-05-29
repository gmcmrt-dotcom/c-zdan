/**
 * Public TX ID generator (hard rule §14).
 *
 * Format: `<PREFIX>-YYYYMMDD-NNNNNN`
 *   - PREFIX: tx-type-derived single letter (X for unknown)
 *   - YYYYMMDD: UTC date
 *   - NNNNNN: 6-digit daily sequence, zero-padded, per-prefix
 *
 * Allocation strategy: a dedicated `public_no_counters` table with one row
 * per (prefix, day). Allocation is a single
 * `INSERT … ON CONFLICT (prefix, yyyymmdd) DO UPDATE SET next = next + 1
 *  RETURNING next - 1` — atomic against concurrent allocators on the same
 * (prefix, day) row, idempotent on retries inside the caller's transaction.
 * (Earlier comments described a `SELECT FOR UPDATE → UPDATE` pattern; that
 * was never the actual implementation. The upsert is cheaper and avoids
 * the read-then-write race window.)
 *
 * Hard rule §14: every new tx_type must be mapped here. Default 'X' lets the
 * caller proceed but logs a warning so it's caught in code review/tests.
 */
import { sql } from "drizzle-orm";
import { tx, type Database } from "../db/client";
import { logger } from "./logger";

type TxTypeLike =
  | "topup"
  | "spend"
  | "refund"
  | "adjustment"
  | "bonus"
  | "merchant_deposit"
  | "merchant_withdraw"
  | "merchant_credit"
  | "referral_bonus"
  | "affiliate_commission"
  | "affiliate_payout"
  | "profit_share";

type SessionPrefix = "T" | "W" | "MC" | "CHT";

const TYPE_PREFIX: Record<TxTypeLike, string> = {
  topup: "T",
  spend: "P",
  refund: "X",
  adjustment: "X",
  bonus: "B",
  merchant_deposit: "X",
  merchant_withdraw: "W",
  merchant_credit: "C",
  referral_bonus: "R",
  affiliate_commission: "AC",
  affiliate_payout: "A",
  profit_share: "PS",
};

export function txTypeToPrefix(type: string): string {
  const p = (TYPE_PREFIX as Record<string, string | undefined>)[type];
  if (!p) {
    logger.warn({ type }, "txTypeToPrefix: unknown type, using X");
    return "X";
  }
  return p;
}

function todayUtcYmd(): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

/**
 * Atomically allocate the next public_no for a given prefix.
 * MUST be called inside a transaction (caller decides scope).
 */
export async function allocPublicNo(
  trx: Database,
  prefix: string | SessionPrefix,
  ymd = todayUtcYmd(),
): Promise<string> {
  // Try update first
  const updated = await trx.execute<{ next: number }>(sql`
    INSERT INTO public_no_counters (prefix, yyyymmdd, next, updated_at)
    VALUES (${prefix}, ${ymd}, 2, now())
    ON CONFLICT (prefix, yyyymmdd)
    DO UPDATE SET next = public_no_counters.next + 1, updated_at = now()
    RETURNING next - 1 AS next
  `);
  const row = (updated as unknown as Array<{ next: number }>)[0];
  if (!row) throw new Error("public_no_counter: no row returned");
  const seq = String(row.next).padStart(6, "0");
  return `${prefix}-${ymd}-${seq}`;
}

/** Same but creates its own transaction. */
export function allocPublicNoStandalone(prefix: string): Promise<string> {
  return tx((trx) => allocPublicNo(trx, prefix));
}

export function makeTxPublicNo(trx: Database, txType: string): Promise<string> {
  return allocPublicNo(trx, txTypeToPrefix(txType));
}
