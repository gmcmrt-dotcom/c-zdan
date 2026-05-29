/**
 * K6 — AI cost tracking + soft alert at 80% of daily budget (Q8).
 *
 * Pricing snapshot (USD per 1M tokens; update as Anthropic publishes new SKUs):
 *
 *   claude-3-5-sonnet-20241022 : $3.00 in / $15.00 out
 *   claude-3-5-haiku           : $0.80 in / $4.00 out
 *   claude-3-opus              : $15.00 in / $75.00 out
 *
 * Default budget = $50/day; override via `AI_DAILY_BUDGET_USD`. Alert at
 * 80% (so ops gets a heads-up before the cap matters). The cap itself is
 * a SOFT alert per Q8 — we do NOT auto-pause AI; ops decides whether to
 * unset `ANTHROPIC_API_KEY` (graceful degrade — askAnthropic returns null)
 * or raise the budget.
 */
import { sql } from "drizzle-orm";
import { db } from "../db/client";
import { aiCostLog } from "../db/schema";
import { logger } from "../lib/logger";

const DEFAULT_BUDGET_USD = 50;
const ALERT_THRESHOLD_PCT = 80;

interface PricePer1M {
  input: number;
  output: number;
}
const PRICES: Record<string, PricePer1M> = {
  // Snapshot 2026-05-28. Update when Anthropic ships new SKUs.
  "claude-3-5-sonnet-20241022": { input: 3.0, output: 15.0 },
  "claude-3-5-sonnet-latest":   { input: 3.0, output: 15.0 },
  "claude-3-5-haiku-20241022":  { input: 0.8, output: 4.0 },
  "claude-3-5-haiku-latest":    { input: 0.8, output: 4.0 },
  "claude-3-opus-20240229":     { input: 15.0, output: 75.0 },
};
// Conservative fallback for unknown SKUs — treat as Sonnet rates so unknown
// models don't silently under-bill.
const FALLBACK_PRICE: PricePer1M = { input: 3.0, output: 15.0 };

function priceCents(model: string, inputTokens: number, outputTokens: number): number {
  const p = PRICES[model] ?? FALLBACK_PRICE;
  const usd = (inputTokens / 1_000_000) * p.input + (outputTokens / 1_000_000) * p.output;
  return Math.round(usd * 100);
}

export interface AiCallUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  caller?: string | null;
  userId?: string | null;
}

export async function recordAiCall(opts: AiCallUsage): Promise<void> {
  try {
    const cost = priceCents(opts.model, opts.inputTokens, opts.outputTokens);
    await db.insert(aiCostLog).values({
      model: opts.model,
      caller: opts.caller ?? null,
      inputTokens: opts.inputTokens,
      outputTokens: opts.outputTokens,
      costCents: cost,
      userId: opts.userId ?? null,
    });
  } catch (err) {
    // Never let cost-bookkeeping failure break the upstream AI call.
    logger.warn({ err }, "ai_cost_log insert failed");
  }
}

export interface DailyBudgetStatus {
  budget_cents: number;
  spent_cents: number;
  spent_pct: number;
  threshold_pct: number;
  alert: boolean;
  day: string;
}

export async function checkDailyBudget(): Promise<DailyBudgetStatus> {
  const budgetUsd = Number(process.env.AI_DAILY_BUDGET_USD ?? DEFAULT_BUDGET_USD);
  const budgetCents = Math.round(budgetUsd * 100);
  const [row] = await db.execute<{ day: string; spent_cents: string | number }>(sql`
    SELECT current_date::text AS day,
           COALESCE(sum(cost_cents), 0) AS spent_cents
      FROM ai_cost_log
     WHERE day = current_date
  `);
  const spent = Number(row?.spent_cents ?? 0);
  const pct = budgetCents > 0 ? (spent / budgetCents) * 100 : 0;
  const alert = pct >= ALERT_THRESHOLD_PCT;
  return {
    budget_cents: budgetCents,
    spent_cents: spent,
    spent_pct: Math.round(pct * 10) / 10,
    threshold_pct: ALERT_THRESHOLD_PCT,
    alert,
    day: row?.day ?? new Date().toISOString().slice(0, 10),
  };
}

/**
 * Cron entry point — called by the scheduler hourly. Emits a `logger.error`
 * (which the deploy's log forwarder converts to a Telegram/email alert)
 * when daily spend crosses 80% of the configured budget. Idempotent in the
 * sense that the warning fires every hour the threshold remains crossed;
 * downstream alerting can dedupe.
 */
export async function alertIfDailyBudgetCrossed(): Promise<DailyBudgetStatus> {
  const status = await checkDailyBudget();
  if (status.alert) {
    logger.error(
      {
        spent_cents: status.spent_cents,
        budget_cents: status.budget_cents,
        spent_pct: status.spent_pct,
        threshold_pct: status.threshold_pct,
        day: status.day,
      },
      `[AI_BUDGET_SOFT_ALERT] daily AI spend crossed ${status.threshold_pct}% threshold`,
    );
  }
  return status;
}
