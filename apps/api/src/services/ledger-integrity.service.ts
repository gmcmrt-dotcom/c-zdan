/**
 * Ledger integrity cross-checks — comprehensive accounting invariant scanner.
 */
import { desc, eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import { auditLog, ledgerIntegrityRuns } from "../db/schema";
import { redactForStorage } from "../lib/redact";
import { logger } from "../lib/logger";

export type LedgerIntegritySeverity = "critical" | "error" | "warning" | "info";

export interface LedgerIntegrityFinding {
  id: string;
  checkId: string;
  name: string;
  severity: LedgerIntegritySeverity;
  message: string;
  expected?: string | number | null;
  actual?: string | number | null;
  delta?: string | number | null;
  entityRefs?: Record<string, string | number | null>;
}

export interface LedgerIntegritySummary {
  checksRun: number;
  passed: number;
  failed: number;
  bySeverity: {
    critical: number;
    error: number;
    warning: number;
    info: number;
  };
}

export interface LedgerIntegrityRunResult {
  runId: string;
  ok: boolean;
  summary: LedgerIntegritySummary;
  findings: LedgerIntegrityFinding[];
  durationMs: number;
}

const FINDING_CAP = 50;
const FLOW_LOOKBACK_DAYS = 90;

const MEMBER_TX_DELTA = sql<string>`
  CASE t.type
    WHEN 'topup' THEN t.amount::numeric
    WHEN 'spend' THEN -t.amount::numeric
    WHEN 'merchant_credit' THEN t.amount::numeric
    WHEN 'merchant_withdraw' THEN -t.amount::numeric
    WHEN 'bonus' THEN t.amount::numeric
    WHEN 'referral_bonus' THEN t.amount::numeric
    WHEN 'affiliate_commission' THEN t.amount::numeric
    WHEN 'affiliate_payout' THEN t.amount::numeric
    WHEN 'profit_share' THEN t.amount::numeric
    WHEN 'merchant_deposit' THEN t.amount::numeric
    WHEN 'adjustment' THEN
      CASE WHEN COALESCE(t.metadata->>'direction', 'credit') = 'debit'
        THEN -t.amount::numeric
        ELSE t.amount::numeric
      END
    WHEN 'refund' THEN t.amount::numeric
    ELSE 0::numeric
  END
`;

const EXPECTED_SETTLEMENT = sql<string>`
  CASE t.type
    WHEN 'spend' THEN (t.amount::numeric - t.fee::numeric)
    WHEN 'merchant_credit' THEN -(t.amount::numeric + t.fee::numeric)
    ELSE NULL::numeric
  END
`;

const EXPECTED_CASH_POOL = sql<string>`
  CASE t.type
    WHEN 'topup' THEN (t.amount::numeric - t.fee::numeric)
    WHEN 'merchant_withdraw' THEN -(t.amount::numeric - t.fee::numeric)
    ELSE NULL::numeric
  END
`;

interface CheckDef {
  id: string;
  name: string;
  severity: LedgerIntegritySeverity;
  run: () => Promise<LedgerIntegrityFinding[]>;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function mkFinding(
  check: Pick<CheckDef, "id" | "name" | "severity">,
  idx: number,
  message: string,
  extra?: Partial<LedgerIntegrityFinding>,
): LedgerIntegrityFinding {
  return {
    id: `${check.id}:${idx}`,
    checkId: check.id,
    name: check.name,
    severity: check.severity,
    message,
    ...extra,
  };
}

async function queryRows<T extends Record<string, unknown>>(q: ReturnType<typeof sql>): Promise<T[]> {
  return (await db.execute(q)) as unknown as T[];
}

const CHECKS: CheckDef[] = [
  {
    id: "member_balance_vs_tx_sum",
    name: "Üye bakiyesi = işlem toplamı",
    severity: "critical",
    run: async () => {
      const rows = await queryRows<{ user_id: string; balance: string; tx_sum: string; delta: string }>(sql`
        SELECT a.user_id,
               a.balance::text AS balance,
               COALESCE(SUM(${MEMBER_TX_DELTA}), 0)::text AS tx_sum,
               (a.balance - COALESCE(SUM(${MEMBER_TX_DELTA}), 0))::text AS delta
        FROM accounts a
        LEFT JOIN transactions t ON t.user_id = a.user_id AND t.status = 'completed'
        GROUP BY a.user_id, a.balance
        HAVING ABS(a.balance - COALESCE(SUM(${MEMBER_TX_DELTA}), 0)) >= 0.01
        ORDER BY ABS(a.balance - COALESCE(SUM(${MEMBER_TX_DELTA}), 0)) DESC
        LIMIT ${FINDING_CAP}
      `);
      return rows.map((r, i) =>
        mkFinding(CHECKS[0]!, i, "Üye bakiyesi işlem toplamıyla uyuşmuyor", {
          expected: r.tx_sum,
          actual: r.balance,
          delta: r.delta,
          entityRefs: { userId: r.user_id },
        }),
      );
    },
  },
  {
    id: "member_reserved_vs_active_codes",
    name: "Rezerve bakiye = aktif ödeme kodları",
    severity: "critical",
    run: async () => {
      const rows = await queryRows<{ user_id: string; reserved: string; code_sum: string; delta: string }>(sql`
        SELECT a.user_id,
               a.reserved_balance::text AS reserved,
               COALESCE(SUM(pc.amount), 0)::text AS code_sum,
               (a.reserved_balance - COALESCE(SUM(pc.amount), 0))::text AS delta
        FROM accounts a
        LEFT JOIN payment_codes pc ON pc.user_id = a.user_id AND pc.status = 'active'
        GROUP BY a.user_id, a.reserved_balance
        HAVING ABS(a.reserved_balance - COALESCE(SUM(pc.amount), 0)) >= 0.01
        LIMIT ${FINDING_CAP}
      `);
      return rows.map((r, i) =>
        mkFinding(CHECKS[1]!, i, "Rezerve bakiye aktif kod tutarıyla uyuşmuyor", {
          expected: r.code_sum,
          actual: r.reserved,
          delta: r.delta,
          entityRefs: { userId: r.user_id },
        }),
      );
    },
  },
  {
    id: "merchant_settlement_balance_vs_log",
    name: "Merchant settlement bakiyesi = son log",
    severity: "critical",
    run: async () => {
      const rows = await queryRows<{ merchant_id: string; name: string; balance: string; log_balance: string; delta: string }>(sql`
        SELECT m.id AS merchant_id, m.name, m.balance::text AS balance,
               COALESCE((SELECT l.balance_after::text FROM merchant_settlement_log l
                         WHERE l.merchant_id = m.id ORDER BY l.id DESC LIMIT 1), '0') AS log_balance,
               (m.balance - COALESCE((SELECT l.balance_after FROM merchant_settlement_log l
                                      WHERE l.merchant_id = m.id ORDER BY l.id DESC LIMIT 1), 0))::text AS delta
        FROM merchants m
        WHERE ABS(m.balance - COALESCE((SELECT l.balance_after FROM merchant_settlement_log l
                                        WHERE l.merchant_id = m.id ORDER BY l.id DESC LIMIT 1), 0)) >= 0.01
        LIMIT ${FINDING_CAP}
      `);
      return rows.map((r, i) =>
        mkFinding(CHECKS[2]!, i, "Settlement bakiyesi son log satırıyla uyuşmuyor", {
          expected: r.log_balance,
          actual: r.balance,
          delta: r.delta,
          entityRefs: { merchantId: r.merchant_id, merchantName: r.name },
        }),
      );
    },
  },
  {
    id: "merchant_cash_pool_vs_log",
    name: "Finance cash_pool = son log",
    severity: "critical",
    run: async () => {
      const rows = await queryRows<{ merchant_id: string; name: string; cash_pool: string; log_balance: string; delta: string }>(sql`
        SELECT m.id AS merchant_id, m.name, m.cash_pool::text AS cash_pool,
               COALESCE((SELECT l.balance_after::text FROM merchant_cash_pool_log l
                         WHERE l.merchant_id = m.id ORDER BY l.id DESC LIMIT 1), '0') AS log_balance,
               (m.cash_pool - COALESCE((SELECT l.balance_after FROM merchant_cash_pool_log l
                                        WHERE l.merchant_id = m.id ORDER BY l.id DESC LIMIT 1), 0))::text AS delta
        FROM merchants m
        WHERE m.merchant_type = 'finance'
          AND ABS(m.cash_pool - COALESCE((SELECT l.balance_after FROM merchant_cash_pool_log l
                                          WHERE l.merchant_id = m.id ORDER BY l.id DESC LIMIT 1), 0)) >= 0.01
        LIMIT ${FINDING_CAP}
      `);
      return rows.map((r, i) =>
        mkFinding(CHECKS[3]!, i, "Cash pool son log satırıyla uyuşmuyor", {
          expected: r.log_balance,
          actual: r.cash_pool,
          delta: r.delta,
          entityRefs: { merchantId: r.merchant_id, merchantName: r.name },
        }),
      );
    },
  },
  {
    id: "settlement_log_chain",
    name: "Settlement log zincir bütünlüğü",
    severity: "error",
    run: async () => {
      const rows = await queryRows<{ log_id: string; merchant_id: string; balance_before: string; change_amount: string; balance_after: string }>(sql`
        SELECT id::text AS log_id, merchant_id::text AS merchant_id,
               balance_before::text, change_amount::text, balance_after::text
        FROM merchant_settlement_log
        WHERE ABS((balance_before + change_amount) - balance_after) >= 0.01
        ORDER BY id DESC LIMIT ${FINDING_CAP}
      `);
      return rows.map((r, i) =>
        mkFinding(CHECKS[4]!, i, "Settlement log: before + change ≠ after", {
          expected: String(num(r.balance_before) + num(r.change_amount)),
          actual: r.balance_after,
          entityRefs: { logId: r.log_id, merchantId: r.merchant_id },
        }),
      );
    },
  },
  {
    id: "cash_pool_log_chain",
    name: "Cash pool log zincir bütünlüğü",
    severity: "error",
    run: async () => {
      const rows = await queryRows<{ log_id: string; merchant_id: string; balance_before: string; change_amount: string; balance_after: string }>(sql`
        SELECT id::text AS log_id, merchant_id::text AS merchant_id,
               balance_before::text, change_amount::text, balance_after::text
        FROM merchant_cash_pool_log
        WHERE ABS((balance_before + change_amount) - balance_after) >= 0.01
        ORDER BY id DESC LIMIT ${FINDING_CAP}
      `);
      return rows.map((r, i) =>
        mkFinding(CHECKS[5]!, i, "Cash pool log: before + change ≠ after", {
          expected: String(num(r.balance_before) + num(r.change_amount)),
          actual: r.balance_after,
          entityRefs: { logId: r.log_id, merchantId: r.merchant_id },
        }),
      );
    },
  },
  {
    id: "flow_spend_settlement_posting",
    name: "Akış A — spend ↔ settlement",
    severity: "error",
    run: async () => {
      const rows = await queryRows<{ tx_id: string; public_no: string; expected: string; actual: string | null; merchant_id: string | null }>(sql`
        SELECT t.id::text AS tx_id, t.public_no, ${EXPECTED_SETTLEMENT}::text AS expected,
               sl.change_amount::text AS actual, t.metadata->>'merchant_id' AS merchant_id
        FROM transactions t
        LEFT JOIN merchant_settlement_log sl ON sl.reference_id = t.id AND sl.reference_type = 'transaction'
        WHERE t.status = 'completed' AND t.type = 'spend'
          AND t.created_at >= now() - (${FLOW_LOOKBACK_DAYS}::text || ' days')::interval
          AND (sl.id IS NULL OR ABS(sl.change_amount - ${EXPECTED_SETTLEMENT}) >= 0.01)
        ORDER BY t.created_at DESC LIMIT ${FINDING_CAP}
      `);
      return rows.map((r, i) =>
        mkFinding(CHECKS[6]!, i, "Spend işlemi settlement kaydıyla uyuşmuyor", {
          expected: r.expected,
          actual: r.actual,
          entityRefs: { transactionId: r.tx_id, publicNo: r.public_no, merchantId: r.merchant_id },
        }),
      );
    },
  },
  {
    id: "flow_credit_settlement_posting",
    name: "Akış B — merchant_credit ↔ settlement",
    severity: "error",
    run: async () => {
      const rows = await queryRows<{ tx_id: string; public_no: string; expected: string; actual: string | null; merchant_id: string | null }>(sql`
        SELECT t.id::text AS tx_id, t.public_no, ${EXPECTED_SETTLEMENT}::text AS expected,
               sl.change_amount::text AS actual, t.metadata->>'merchant_id' AS merchant_id
        FROM transactions t
        LEFT JOIN merchant_settlement_log sl
          ON (sl.reference_id = t.id AND sl.reference_type = 'transaction')
          OR (t.merchant_ref IS NOT NULL AND sl.notes LIKE 'ref:' || t.merchant_ref || '%')
        WHERE t.status = 'completed' AND t.type = 'merchant_credit'
          AND t.created_at >= now() - (${FLOW_LOOKBACK_DAYS}::text || ' days')::interval
          AND (sl.id IS NULL OR ABS(sl.change_amount - ${EXPECTED_SETTLEMENT}) >= 0.01)
        ORDER BY t.created_at DESC LIMIT ${FINDING_CAP}
      `);
      return rows.map((r, i) =>
        mkFinding(CHECKS[7]!, i, "Merchant credit settlement kaydıyla uyuşmuyor", {
          expected: r.expected,
          actual: r.actual,
          entityRefs: { transactionId: r.tx_id, publicNo: r.public_no, merchantId: r.merchant_id },
        }),
      );
    },
  },
  {
    id: "flow_topup_cash_pool_posting",
    name: "Akış C — topup ↔ cash_pool",
    severity: "error",
    run: async () => {
      const rows = await queryRows<{ tx_id: string; public_no: string; expected: string; actual: string | null; merchant_id: string | null }>(sql`
        SELECT t.id::text AS tx_id, t.public_no, ${EXPECTED_CASH_POOL}::text AS expected,
               cpl.change_amount::text AS actual, t.metadata->>'merchant_id' AS merchant_id
        FROM transactions t
        LEFT JOIN topup_sessions ts ON ts.id = t.reference_id
        LEFT JOIN merchant_cash_pool_log cpl
          ON cpl.reference_id = COALESCE(ts.id, t.reference_id)
             AND cpl.reference_type IN ('topup_session', 'transaction')
        WHERE t.status = 'completed' AND t.type = 'topup'
          AND t.created_at >= now() - (${FLOW_LOOKBACK_DAYS}::text || ' days')::interval
          AND (cpl.id IS NULL OR ABS(cpl.change_amount - ${EXPECTED_CASH_POOL}) >= 0.01)
        ORDER BY t.created_at DESC LIMIT ${FINDING_CAP}
      `);
      return rows.map((r, i) =>
        mkFinding(CHECKS[8]!, i, "Topup cash_pool kaydıyla uyuşmuyor", {
          expected: r.expected,
          actual: r.actual,
          entityRefs: { transactionId: r.tx_id, publicNo: r.public_no, merchantId: r.merchant_id },
        }),
      );
    },
  },
  {
    id: "flow_withdraw_cash_pool_posting",
    name: "Akış D — withdraw ↔ merchant kaydı",
    severity: "error",
    run: async () => {
      const rows = await queryRows<{ tx_id: string; public_no: string; expected: string; cash_pool_actual: string | null; merchant_id: string | null }>(sql`
        SELECT t.id::text AS tx_id, t.public_no, ${EXPECTED_CASH_POOL}::text AS expected,
               cpl.change_amount::text AS cash_pool_actual,
               t.metadata->>'merchant_id' AS merchant_id
        FROM transactions t
        LEFT JOIN withdraw_sessions ws ON ws.id = t.reference_id OR ws.transaction_id = t.id
        LEFT JOIN merchant_cash_pool_log cpl
          ON (cpl.reference_id = COALESCE(ws.id, t.reference_id) AND cpl.reference_type = 'withdraw_session')
          OR (cpl.reference_id = t.id AND cpl.reference_type = 'transaction')
        WHERE t.status = 'completed' AND t.type = 'merchant_withdraw'
          AND t.created_at >= now() - (${FLOW_LOOKBACK_DAYS}::text || ' days')::interval
          AND (cpl.id IS NULL OR ABS(cpl.change_amount - ${EXPECTED_CASH_POOL}) >= 0.01)
        ORDER BY t.created_at DESC LIMIT ${FINDING_CAP}
      `);
      return rows.map((r, i) =>
        mkFinding(CHECKS[9]!, i, "Withdraw merchant kaydıyla uyuşmuyor", {
          expected: r.expected,
          actual: r.cash_pool_actual,
          entityRefs: { transactionId: r.tx_id, publicNo: r.public_no, merchantId: r.merchant_id },
        }),
      );
    },
  },
  {
    id: "tx_balance_after_chain",
    name: "İşlem balance_after zinciri",
    severity: "warning",
    run: async () => {
      const rows = await queryRows<{ tx_id: string; public_no: string; user_id: string; balance_after: string; expected_after: string }>(sql`
        WITH ordered AS (
          SELECT t.id, t.public_no, t.user_id, t.balance_after, t.created_at,
                 SUM(${MEMBER_TX_DELTA}) OVER (
                   PARTITION BY t.user_id ORDER BY t.created_at, t.id
                   ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                 ) AS running_sum
          FROM transactions t
          WHERE t.status = 'completed' AND t.balance_after IS NOT NULL
        )
        SELECT id::text AS tx_id, public_no, user_id::text AS user_id,
               balance_after::text, running_sum::text AS expected_after
        FROM ordered
        WHERE ABS(balance_after - running_sum) >= 0.01
        ORDER BY created_at DESC LIMIT ${FINDING_CAP}
      `);
      return rows.map((r, i) =>
        mkFinding(CHECKS[10]!, i, "balance_after kümülatif işlem toplamıyla uyuşmuyor", {
          expected: r.expected_after,
          actual: r.balance_after,
          entityRefs: { transactionId: r.tx_id, publicNo: r.public_no, userId: r.user_id },
        }),
      );
    },
  },
  {
    id: "stale_open_topup_sessions",
    name: "Süresi geçmiş açık topup oturumu",
    severity: "warning",
    run: async () => {
      const rows = await queryRows<{ session_id: string; public_no: string; status: string }>(sql`
        SELECT id::text AS session_id, public_no, status FROM topup_sessions
        WHERE status IN ('pending','awaiting_member_action','member_confirmed','redirected')
          AND expires_at < now()
        LIMIT ${FINDING_CAP}
      `);
      return rows.map((r, i) =>
        mkFinding(CHECKS[11]!, i, "Süresi geçmiş topup oturumu hâlâ açık", {
          entityRefs: { sessionId: r.session_id, publicNo: r.public_no, status: r.status },
        }),
      );
    },
  },
  {
    id: "stale_open_withdraw_sessions",
    name: "Süresi geçmiş açık withdraw oturumu",
    severity: "warning",
    run: async () => {
      const rows = await queryRows<{ session_id: string; public_no: string; status: string }>(sql`
        SELECT id::text AS session_id, public_no, status FROM withdraw_sessions
        WHERE status IN ('pending','sent_to_merchant') AND expires_at < now()
        LIMIT ${FINDING_CAP}
      `);
      return rows.map((r, i) =>
        mkFinding(CHECKS[12]!, i, "Süresi geçmiş withdraw oturumu hâlâ açık", {
          entityRefs: { sessionId: r.session_id, publicNo: r.public_no, status: r.status },
        }),
      );
    },
  },
  {
    id: "orphan_settlement_log_refs",
    name: "Yetim settlement log referansı",
    severity: "warning",
    run: async () => {
      const rows = await queryRows<{ log_id: string; merchant_id: string; reference_id: string }>(sql`
        SELECT l.id::text AS log_id, l.merchant_id::text AS merchant_id, l.reference_id::text AS reference_id
        FROM merchant_settlement_log l
        WHERE l.reference_type = 'transaction' AND l.reference_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM transactions t WHERE t.id = l.reference_id)
        LIMIT ${FINDING_CAP}
      `);
      return rows.map((r, i) =>
        mkFinding(CHECKS[13]!, i, "Settlement log silinmiş işleme referans veriyor", {
          entityRefs: { logId: r.log_id, merchantId: r.merchant_id, referenceId: r.reference_id },
        }),
      );
    },
  },
  {
    id: "duplicate_completed_merchant_ref",
    name: "Yinelenen merchant_ref (tamamlanmış)",
    severity: "error",
    run: async () => {
      const rows = await queryRows<{ merchant_ref: string; cnt: number; merchant_id: string | null }>(sql`
        SELECT t.merchant_ref, count(*)::int AS cnt, max(t.metadata->>'merchant_id') AS merchant_id
        FROM transactions t
        WHERE t.status = 'completed' AND t.merchant_ref IS NOT NULL
          AND t.type IN ('merchant_credit','topup','merchant_withdraw')
        GROUP BY t.merchant_ref HAVING count(*) > 1
        LIMIT ${FINDING_CAP}
      `);
      return rows.map((r, i) =>
        mkFinding(CHECKS[14]!, i, "Aynı merchant_ref birden fazla tamamlanmış işlemde", {
          expected: 1,
          actual: r.cnt,
          entityRefs: { merchantRef: r.merchant_ref, merchantId: r.merchant_id },
        }),
      );
    },
  },
  {
    id: "merchant_credit_limit_breach",
    name: "Merchant kredi limiti ihlali",
    severity: "critical",
    run: async () => {
      const rows = await queryRows<{ merchant_id: string; name: string; balance: string; credit_limit: string }>(sql`
        SELECT id::text AS merchant_id, name, balance::text, credit_limit::text
        FROM merchants WHERE balance < -credit_limit LIMIT ${FINDING_CAP}
      `);
      return rows.map((r, i) =>
        mkFinding(CHECKS[15]!, i, "Merchant bakiyesi kredi limitinin altında", {
          actual: r.balance,
          expected: `>= -${r.credit_limit}`,
          entityRefs: { merchantId: r.merchant_id, merchantName: r.name },
        }),
      );
    },
  },
  {
    id: "merchant_cashout_reserve_vs_sessions",
    name: "Cashout rezervi ↔ açık oturumlar",
    severity: "warning",
    run: async () => {
      const rows = await queryRows<{ merchant_id: string; name: string; reserved: string; session_sum: string; delta: string }>(sql`
        SELECT m.id::text AS merchant_id, m.name,
               m.cashout_reserved_amount::text AS reserved,
               COALESCE(SUM(s.amount + s.fee), 0)::text AS session_sum,
               (m.cashout_reserved_amount - COALESCE(SUM(s.amount + s.fee), 0))::text AS delta
        FROM merchants m
        LEFT JOIN merchant_cashout_sessions s ON s.merchant_id = m.id AND s.status IN ('pending','sent_to_provider')
        WHERE m.merchant_type = 'commerce'
        GROUP BY m.id, m.name, m.cashout_reserved_amount
        HAVING ABS(m.cashout_reserved_amount - COALESCE(SUM(s.amount + s.fee), 0)) >= 0.01
        LIMIT ${FINDING_CAP}
      `);
      return rows.map((r, i) =>
        mkFinding(CHECKS[16]!, i, "Cashout rezervi açık oturum toplamıyla uyuşmuyor", {
          expected: r.session_sum,
          actual: r.reserved,
          delta: r.delta,
          entityRefs: { merchantId: r.merchant_id, merchantName: r.name },
        }),
      );
    },
  },
  {
    id: "global_platform_balance_snapshot",
    name: "Platform bakiye özeti",
    severity: "info",
    run: async () => {
      const rows = await queryRows<{ total_member_balance: string; tx_derived_member_total: string; delta: string }>(sql`
        SELECT
          (SELECT COALESCE(sum(balance),0)::text FROM accounts) AS total_member_balance,
          (SELECT COALESCE(sum(${MEMBER_TX_DELTA}),0)::text FROM transactions t WHERE t.status = 'completed') AS tx_derived_member_total,
          ((SELECT COALESCE(sum(balance),0) FROM accounts)
           - (SELECT COALESCE(sum(${MEMBER_TX_DELTA}),0) FROM transactions t WHERE t.status = 'completed'))::text AS delta
      `);
      const r = rows[0];
      if (!r || Math.abs(num(r.delta)) < 0.01) return [];
      return [
        mkFinding(CHECKS[17]!, 0, "Global üye bakiye toplamı işlem türevli toplamdan farklı", {
          expected: r.tx_derived_member_total,
          actual: r.total_member_balance,
          delta: r.delta,
        }),
      ];
    },
  },
  {
    id: "active_payment_code_tier_snapshot",
    name: "Aktif kod tier snapshot eksik",
    severity: "warning",
    run: async () => {
      const rows = await queryRows<{ code_id: string; code: string; user_id: string }>(sql`
        SELECT id::text AS code_id, code, user_id::text AS user_id FROM payment_codes
        WHERE status = 'active' AND reserved_at_tier_id IS NULL LIMIT ${FINDING_CAP}
      `);
      return rows.map((r, i) =>
        mkFinding(CHECKS[18]!, i, "Aktif ödeme kodunda tier snapshot yok", {
          entityRefs: { codeId: r.code_id, code: r.code, userId: r.user_id },
        }),
      );
    },
  },
  {
    id: "completed_tx_missing_public_no",
    name: "public_no eksik işlem",
    severity: "error",
    run: async () => {
      const rows = await queryRows<{ tx_id: string; type: string }>(sql`
        SELECT id::text AS tx_id, type::text AS type FROM transactions
        WHERE status = 'completed' AND (public_no IS NULL OR btrim(public_no) = '')
        LIMIT ${FINDING_CAP}
      `);
      return rows.map((r, i) =>
        mkFinding(CHECKS[19]!, i, "Tamamlanmış işlemde public_no eksik", {
          entityRefs: { transactionId: r.tx_id, type: r.type },
        }),
      );
    },
  },
];

function buildSummary(findings: LedgerIntegrityFinding[]): LedgerIntegritySummary {
  const bySeverity = { critical: 0, error: 0, warning: 0, info: 0 };
  for (const f of findings) bySeverity[f.severity] += 1;
  const failedChecks = new Set(findings.map((f) => f.checkId)).size;
  return {
    checksRun: CHECKS.length,
    passed: CHECKS.length - failedChecks,
    failed: failedChecks,
    bySeverity,
  };
}

export interface RunLedgerIntegrityOpts {
  triggeredBy: "cron" | "manual";
  actorId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

export async function runLedgerIntegrityChecks(opts: RunLedgerIntegrityOpts): Promise<LedgerIntegrityRunResult> {
  const started = Date.now();
  const [runRow] = await db
    .insert(ledgerIntegrityRuns)
    .values({ triggeredBy: opts.triggeredBy, actorId: opts.actorId ?? null, status: "running" })
    .returning({ id: ledgerIntegrityRuns.id });
  if (!runRow) throw new Error("ledger_integrity run insert failed");

  try {
    const findings: LedgerIntegrityFinding[] = [];
    for (const check of CHECKS) {
      try {
        findings.push(...(await check.run()));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error({ err, checkId: check.id }, "ledger integrity check failed");
        findings.push(mkFinding(check, 0, `Kontrol çalıştırılamadı: ${msg}`, { severity: "error" }));
      }
    }

    const summary = buildSummary(findings);
    const ok = summary.bySeverity.critical === 0 && summary.bySeverity.error === 0;
    const durationMs = Date.now() - started;

    await db
      .update(ledgerIntegrityRuns)
      .set({
        finishedAt: new Date(),
        status: ok ? "ok" : "ok_with_findings",
        ok,
        checkCount: CHECKS.length,
        findingCount: findings.length,
        criticalCount: summary.bySeverity.critical,
        errorCount: summary.bySeverity.error,
        warningCount: summary.bySeverity.warning,
        summary: summary as never,
        findings: findings as never,
        durationMs,
      })
      .where(eq(ledgerIntegrityRuns.id, runRow.id));

    await db.insert(auditLog).values({
      actorId: opts.actorId ?? null,
      action: opts.triggeredBy === "cron" ? "ledger_integrity.run_cron" : "ledger_integrity.run_manual",
      resourceType: "ledger_integrity_run",
      resourceId: runRow.id,
      after: redactForStorage({ ok, summary, durationMs }) as never,
      metadata: redactForStorage({ triggeredBy: opts.triggeredBy }) as Record<string, unknown>,
      ip: opts.ip ?? null,
      userAgent: opts.userAgent?.slice(0, 512) ?? null,
    });

    if (!ok) {
      logger.warn(
        { runId: runRow.id, critical: summary.bySeverity.critical, error: summary.bySeverity.error },
        "ledger integrity cross-check found discrepancies",
      );
    }

    return { runId: runRow.id, ok, summary, findings, durationMs };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db
      .update(ledgerIntegrityRuns)
      .set({ finishedAt: new Date(), status: "failed", ok: false, error: msg, durationMs: Date.now() - started })
      .where(eq(ledgerIntegrityRuns.id, runRow.id));
    throw err;
  }
}

export async function listLedgerIntegrityRuns(limit = 20, offset = 0) {
  const rows = await db
    .select({
      id: ledgerIntegrityRuns.id,
      triggeredBy: ledgerIntegrityRuns.triggeredBy,
      actorId: ledgerIntegrityRuns.actorId,
      startedAt: ledgerIntegrityRuns.startedAt,
      finishedAt: ledgerIntegrityRuns.finishedAt,
      status: ledgerIntegrityRuns.status,
      ok: ledgerIntegrityRuns.ok,
      checkCount: ledgerIntegrityRuns.checkCount,
      findingCount: ledgerIntegrityRuns.findingCount,
      errorCount: ledgerIntegrityRuns.errorCount,
      warningCount: ledgerIntegrityRuns.warningCount,
      criticalCount: ledgerIntegrityRuns.criticalCount,
      durationMs: ledgerIntegrityRuns.durationMs,
    })
    .from(ledgerIntegrityRuns)
    .orderBy(desc(ledgerIntegrityRuns.startedAt))
    .limit(limit)
    .offset(offset);
  return rows.map((r) => ({
    ...r,
    startedAt: r.startedAt.toISOString(),
    finishedAt: r.finishedAt?.toISOString() ?? null,
  }));
}

export async function getLedgerIntegrityRun(id: string) {
  const [row] = await db.select().from(ledgerIntegrityRuns).where(eq(ledgerIntegrityRuns.id, id)).limit(1);
  if (!row) return null;
  return {
    id: row.id,
    triggeredBy: row.triggeredBy,
    actorId: row.actorId,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
    status: row.status,
    ok: row.ok,
    checkCount: row.checkCount,
    findingCount: row.findingCount,
    errorCount: row.errorCount,
    warningCount: row.warningCount,
    criticalCount: row.criticalCount,
    durationMs: row.durationMs,
    summary: row.summary as unknown as LedgerIntegritySummary,
    findings: row.findings as unknown as LedgerIntegrityFinding[],
    error: row.error,
  };
}

export async function getLatestLedgerIntegrityRun() {
  const rows = await listLedgerIntegrityRuns(1, 0);
  return rows[0] ?? null;
}

export const LEDGER_INTEGRITY_CHECK_CATALOG = CHECKS.map((c) => ({
  id: c.id,
  name: c.name,
  severity: c.severity,
}));
