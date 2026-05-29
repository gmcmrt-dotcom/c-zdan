import { z } from "zod";

export const LedgerIntegritySeverity = z.enum(["critical", "error", "warning", "info"]);
export type LedgerIntegritySeverity = z.infer<typeof LedgerIntegritySeverity>;

export const LedgerIntegrityFinding = z.object({
  id: z.string(),
  checkId: z.string(),
  name: z.string(),
  severity: LedgerIntegritySeverity,
  message: z.string(),
  expected: z.union([z.string(), z.number(), z.null()]).optional(),
  actual: z.union([z.string(), z.number(), z.null()]).optional(),
  delta: z.union([z.string(), z.number(), z.null()]).optional(),
  entityRefs: z.record(z.union([z.string(), z.number(), z.null()])).optional(),
});
export type LedgerIntegrityFinding = z.infer<typeof LedgerIntegrityFinding>;

export const LedgerIntegritySummary = z.object({
  checksRun: z.number().int(),
  passed: z.number().int(),
  failed: z.number().int(),
  bySeverity: z.object({
    critical: z.number().int(),
    error: z.number().int(),
    warning: z.number().int(),
    info: z.number().int(),
  }),
});
export type LedgerIntegritySummary = z.infer<typeof LedgerIntegritySummary>;

export const LedgerIntegrityRunListItem = z.object({
  id: z.string().uuid(),
  triggeredBy: z.string(),
  actorId: z.string().uuid().nullable(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  status: z.string(),
  ok: z.boolean(),
  checkCount: z.number().int(),
  findingCount: z.number().int(),
  errorCount: z.number().int(),
  warningCount: z.number().int(),
  criticalCount: z.number().int(),
  durationMs: z.number().int().nullable(),
});
export type LedgerIntegrityRunListItem = z.infer<typeof LedgerIntegrityRunListItem>;

export const LedgerIntegrityRunDetail = LedgerIntegrityRunListItem.extend({
  summary: LedgerIntegritySummary,
  findings: z.array(LedgerIntegrityFinding),
  error: z.string().nullable(),
});
export type LedgerIntegrityRunDetail = z.infer<typeof LedgerIntegrityRunDetail>;

export const LedgerIntegrityRunResult = z.object({
  runId: z.string().uuid(),
  ok: z.boolean(),
  summary: LedgerIntegritySummary,
  findings: z.array(LedgerIntegrityFinding),
  durationMs: z.number().int(),
});
export type LedgerIntegrityRunResult = z.infer<typeof LedgerIntegrityRunResult>;
