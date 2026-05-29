import { z } from "zod";

export const Uuid = z.string().uuid();
export const Money = z.number().or(z.string()).pipe(z.coerce.number());

// P2 — Money columns are `numeric(14, 2)` in Postgres → max value
// 999_999_999_999.99 with at most 2 decimal places.
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
export const IsoDate = z.string().datetime({ offset: true });

export const Pagination = z.object({
  offset: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type Pagination = z.infer<typeof Pagination>;

export const SuccessOnly = z.object({ success: z.literal(true) });
