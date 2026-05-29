import type { Database } from "../../db/client";
import { db } from "../../db/client";
import { auditLog } from "../../db/schema";
import { redactForStorage } from "../../lib/redact";

export interface AuditEntry {
  actorId: string;
  action: string;
  resourceType?: string;
  resourceId?: string | null;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
  ip?: string | null;
  /** J1 — Pass `req.get("user-agent")` so the audit row can be
   *  forensically linked to a specific session in `user_login_ips`. */
  userAgent?: string | null;
  /** J1 — Optional transaction handle so the audit write participates
   *  in the same SQL transaction as the mutation it describes. Without
   *  this, an admin mutation can succeed AND the audit insert can fail
   *  (e.g. DB blip) leaving an un-logged change. With it, ROLLBACK
   *  cleans up both atomically. */
  trx?: Database;
}

const MAX_USER_AGENT = 512;

export async function writeAudit(entry: AuditEntry): Promise<void> {
  // P1 — Persisted audit rows are GDPR-relevant PII at rest. The BO UI
  // renders `before` / `after` / `metadata` verbatim; masking at write
  // time means even an authorised admin viewing the row can't accidentally
  // see (or screenshot) raw email/phone/IBAN/token values. The DB column
  // stays the same shape so downstream consumers don't break.
  const target = entry.trx ?? db;
  const userAgent = entry.userAgent
    ? entry.userAgent.slice(0, MAX_USER_AGENT)
    : null;
  await target.insert(auditLog).values({
    actorId: entry.actorId,
    action: entry.action,
    resourceType: entry.resourceType ?? null,
    resourceId: entry.resourceId ?? null,
    before: redactForStorage(entry.before ?? null) as never,
    after: redactForStorage(entry.after ?? null) as never,
    metadata: redactForStorage(entry.metadata ?? {}) as Record<string, unknown>,
    ip: entry.ip ?? null,
    userAgent,
  });
}
