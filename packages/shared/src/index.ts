// Shared zod DTOs + inferred types. Frontend imports type-only via top-level
// namespaces; backend uses the runtime schemas for validation.

import { z } from "zod";

export * as auth from "./dto/auth";
export * as common from "./dto/common";
export * as member from "./dto/member";
export * as wallet from "./dto/wallet";
export * as ledgerIntegrity from "./dto/ledger-integrity";

export const SuccessEnvelope = z.object({ success: z.literal(true) });
export type SuccessEnvelope = z.infer<typeof SuccessEnvelope>;

export const ErrorEnvelope = z.object({
  success: z.literal(false),
  error_code: z.string(),
  message: z.string().optional(),
  details: z.unknown().optional(),
});
export type ErrorEnvelope = z.infer<typeof ErrorEnvelope>;

// P2 — Money columns are `numeric(14, 2)` in Postgres → max value
// 999_999_999_999.99 with at most 2 decimal places. Enforce both bounds in
// the shared DTO so backend routes inherit the rule via the schemas they
// derive from MoneyAmount (no more per-route `z.coerce.number().positive()`
// that quietly accepts 1e20).
const MAX_MONEY = 999_999_999_999.99;
export const MoneyAmount = z
  .union([z.number(), z.string()])
  .pipe(z.coerce.number())
  .refine((n) => Number.isFinite(n) && n >= 0, "amount must be non-negative")
  .refine((n) => n <= MAX_MONEY, "amount exceeds maximum")
  .refine(
    (n) => Math.round(n * 100) === n * 100,
    "amount must have at most 2 decimal places",
  );
export type MoneyAmount = z.infer<typeof MoneyAmount>;
