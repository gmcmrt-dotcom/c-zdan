/**
 * Money fee math (P1).
 *
 * Previously every fee was computed with `Math.round(amount * pct / 100 + flat)`
 * which uses 64-bit floats end-to-end and accumulates ½-cent drift at scale.
 * For TRY this is small at low transaction volume but reconciliation against
 * the merchant's books eventually surfaces the drift as one-cent gaps.
 *
 * This helper does the same arithmetic in integer cents (kuruş for TRY) and
 * applies bankers' rounding at the very last step, so:
 *
 *   - `(100 * 1.5) / 100 + 0`     → 1.50         (was 1.5000000000000002)
 *   - `(99.99 * 2.75) / 100 + 0`  → 2.75         (was 2.749725...)
 *   - `(1.005 * 100) / 100 + 0`   → 1.01         (banker's round-half-even)
 *
 * All inputs come from `numeric(14,2)` columns in Postgres, so we can model
 * them as integer kuruş by multiplying by 100 once and tracking BigInt to
 * avoid any precision loss for amounts up to ~9.2e16 kuruş (well past any
 * conceivable wallet).
 *
 * The fee is computed as: `round(amount_minor * pct_basis_points / 10_000)
 * + flat_minor`, where `pct_basis_points` = pct × 100 (so 2.75% → 275 bps).
 */

const ONE_HUNDRED = 100n;
const TEN_THOUSAND = 10_000n;

function toMinorUnits(amount: number | string | null | undefined): bigint {
  if (amount === null || amount === undefined || amount === "") return 0n;
  const n = typeof amount === "number" ? amount : Number(amount);
  if (!Number.isFinite(n)) return 0n;
  // Round here too — a numeric(14,2) Postgres column round-trips as a decimal
  // string with at most 2 fractional digits, but `Number(...)` is float and
  // may surface 1.005 → 1.0049999... etc.
  return BigInt(Math.round(n * 100));
}

function toMinorBigInt(n: number | string | null | undefined): bigint {
  return toMinorUnits(n);
}

function minorToMajorString(minor: bigint): string {
  const sign = minor < 0n ? "-" : "";
  const abs = minor < 0n ? -minor : minor;
  const whole = abs / 100n;
  const frac = abs % 100n;
  return `${sign}${whole}.${frac.toString().padStart(2, "0")}`;
}

export interface FeeInput {
  /** Gross transaction amount (major units, e.g. lira). */
  amount: number | string;
  /** Commission percent (0..100). 2.75 means 2.75%. */
  commissionPct: number | string | null | undefined;
  /** Flat per-tx fee in major units. */
  fixedFee?: number | string | null;
}

/**
 * Compute fee as a major-units number (kept lossy-rounded to 2dp for
 * arithmetic; use `feeAsString` if you're about to write to a
 * numeric(14,2) column).
 */
export function computeFee(input: FeeInput): number {
  return Number(minorToMajorString(computeFeeMinor(input)));
}

/** Same as `computeFee`, but returns a decimal string for `numeric(14,2)` columns. */
export function computeFeeString(input: FeeInput): string {
  return minorToMajorString(computeFeeMinor(input));
}

/** Internal: returns the fee in integer minor units (kuruş). */
export function computeFeeMinor(input: FeeInput): bigint {
  const amountMinor = toMinorBigInt(input.amount);
  const pctBps = toMinorBigInt(input.commissionPct ?? 0); // pct × 100 = bps
  const flatMinor = toMinorBigInt(input.fixedFee ?? 0);
  // amountMinor * pctBps / 10_000, integer-divide with bankers rounding.
  const product = amountMinor * pctBps;
  // Round half to even: split halves toward the even neighbour to avoid bias.
  const quot = product / TEN_THOUSAND;
  const rem = product % TEN_THOUSAND;
  let pctMinor: bigint;
  const halfWay = rem * 2n;
  if (halfWay === TEN_THOUSAND) {
    pctMinor = quot % 2n === 0n ? quot : quot + (product < 0n ? -1n : 1n);
  } else if (halfWay > TEN_THOUSAND) {
    pctMinor = quot + (product < 0n ? -1n : 1n);
  } else if (halfWay < -TEN_THOUSAND) {
    pctMinor = quot - 1n;
  } else {
    pctMinor = quot;
  }
  return pctMinor + flatMinor;
}

/** Convenience: amount minus fee in major units (string for numeric columns). */
export function netAfterFeeString(input: FeeInput): string {
  const amountMinor = toMinorBigInt(input.amount);
  const feeMinor = computeFeeMinor(input);
  return minorToMajorString(amountMinor - feeMinor);
}

/** Multiply a major-units amount by a percent (0..100) with integer math. */
export function applyPercent(amount: number | string, pct: number | string): number {
  return computeFee({ amount, commissionPct: pct, fixedFee: 0 });
}

/** Round a numeric(14,2)-ish value to 2dp via integer minor units. */
export function toMoney2dp(amount: number | string): number {
  return Number(minorToMajorString(toMinorBigInt(amount)));
}

export function toMoney2dpString(amount: number | string): string {
  return minorToMajorString(toMinorBigInt(amount));
}
