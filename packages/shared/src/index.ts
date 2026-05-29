// Shared zod DTOs + inferred types. Frontend imports type-only via top-level
// namespaces; backend uses the runtime schemas for validation.

import { z } from "zod";

export * as auth from "./dto/auth";
export * as common from "./dto/common";
export * as member from "./dto/member";
export * as wallet from "./dto/wallet";
export * as ledgerIntegrity from "./dto/ledger-integrity";
export * as admin from "./dto/admin";

export const SuccessEnvelope = z.object({ success: z.literal(true) });
export type SuccessEnvelope = z.infer<typeof SuccessEnvelope>;

export const ErrorEnvelope = z.object({
  success: z.literal(false),
  error_code: z.string(),
  message: z.string().optional(),
  details: z.unknown().optional(),
});
export type ErrorEnvelope = z.infer<typeof ErrorEnvelope>;
