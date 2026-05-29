import { dbSelect, type WhereCondition } from "@/lib/db";
import { fetchPointsForTxs } from "@/lib/points";
import type { AdminMerchantPicker } from "@/contexts/AdminReferenceDataContext";

export const TX_PAGE_SIZE = 100;
export const TX_EXPORT_MAX = 10_000;

export type AdminTx = {
  id: string;
  public_no: string | null;
  merchant_ref: string | null;
  external_tx_id: string | null;
  merchant_note: string | null;
  user_id: string;
  type: string;
  amount: number;
  fee: number;
  status: string;
  description: string | null;
  created_at: string;
  reference_id: string | null;
  metadata?: Record<string, unknown>;
  points?: number;
  profile?: { first_name: string; last_name: string; email: string } | null;
};

export type AdminTxFilters = {
  types: string[];
  statuses: string[];
  dateFrom: string;
  dateTo: string;
  merchantId: string;
  amountMin: string;
  amountMax: string;
  search: string;
  merchants: AdminMerchantPicker[];
  canViewFull: boolean;
};

const FLOW_TYPES = new Set(["spend", "merchant_credit", "topup", "merchant_withdraw"]);

export function postedAmount(tx: AdminTx): number | null {
  const raw = tx.metadata?.settlement_change ?? tx.metadata?.cash_pool_change ?? tx.metadata?.merchant_net_amount;
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function merchantLabel(tx: AdminTx, merchants: AdminMerchantPicker[]): string {
  const mid = tx.metadata?.merchant_id as string | undefined;
  if (!mid) return "—";
  const m = merchants.find((x) => x.id === mid);
  if (!m) return "—";
  const prefix = m.merchant_scope === "child" ? "Bayi: " : m.merchant_scope === "parent" ? "Ana: " : "";
  return `${prefix}${m.name}`;
}

export function reconciliationUrl(tx: AdminTx): string | null {
  if (!FLOW_TYPES.has(tx.type)) return null;
  const mid = tx.metadata?.merchant_id as string | undefined;
  const day = tx.created_at.slice(0, 10);
  const params = new URLSearchParams({ from: day, to: day });
  if (tx.public_no) params.set("public_no", tx.public_no);
  if (mid) params.set("merchant_id", mid);
  return `/admin/reconciliation?${params.toString()}`;
}

function escapeIlike(term: string): string {
  return term.replace(/[%_\\]/g, (c) => `\\${c}`);
}

interface BuiltQuery {
  where: WhereCondition[];
  or: string[];
  limit: number;
}

function applyMerchantFilter(where: WhereCondition[], merchantId: string, merchants: AdminMerchantPicker[]) {
  if (!merchantId) return;
  const selected = merchants.find((m) => m.id === merchantId);
  const childIds =
    selected?.merchant_scope === "parent"
      ? merchants.filter((m) => m.parent_merchant_id === merchantId).map((m) => m.id)
      : [];
  const ids = childIds.length > 0 ? childIds : [merchantId];
  where.push({ col: "metadata->>merchant_id", op: "in", val: ids });
}

async function applySearchFilter(out: { or: string[] }, term: string, canViewFull: boolean) {
  const esc = escapeIlike(term);
  out.or.push(`public_no.ilike.%${esc}%`, `description.ilike.%${esc}%`);
  if (canViewFull) {
    out.or.push(`merchant_ref.ilike.%${esc}%`, `external_tx_id.ilike.%${esc}%`);
  }
  if (term.length >= 2) {
    const profOr = canViewFull
      ? `email.ilike.%${esc}%,first_name.ilike.%${esc}%,last_name.ilike.%${esc}%`
      : `first_name.ilike.%${esc}%,last_name.ilike.%${esc}%`;
    const profs = await dbSelect<{ id: string }>("profiles", {
      cols: "id",
      or: [profOr],
      limit: 80,
    }).catch(() => [] as { id: string }[]);
    if (profs.length > 0) {
      out.or.push(`user_id.in.(${profs.map((p) => p.id).join(",")})`);
    }
  }
}

async function buildBaseQuery(filters: AdminTxFilters, limit: number, cursor: string | null): Promise<BuiltQuery> {
  const where: WhereCondition[] = [];
  const or: string[] = [];
  if (cursor) where.push({ col: "created_at", op: "lt", val: cursor });
  if (filters.types.length > 0) where.push({ col: "type", op: "in", val: filters.types });
  if (filters.statuses.length > 0) where.push({ col: "status", op: "in", val: filters.statuses });
  if (filters.dateFrom) where.push({ col: "created_at", op: "gte", val: new Date(filters.dateFrom).toISOString() });
  if (filters.dateTo) {
    const d = new Date(filters.dateTo);
    d.setHours(23, 59, 59, 999);
    where.push({ col: "created_at", op: "lte", val: d.toISOString() });
  }
  if (filters.amountMin) where.push({ col: "amount", op: "gte", val: Number(filters.amountMin) });
  if (filters.amountMax) where.push({ col: "amount", op: "lte", val: Number(filters.amountMax) });
  applyMerchantFilter(where, filters.merchantId, filters.merchants);
  if (filters.search) {
    await applySearchFilter({ or }, filters.search, filters.canViewFull);
  }
  return { where, or, limit };
}

async function runTransactionQuery(q: BuiltQuery): Promise<AdminTx[]> {
  return dbSelect<AdminTx>("transactions", {
    cols: "id,public_no,merchant_ref,external_tx_id,merchant_note,user_id,type,amount,fee,status,description,created_at,reference_id,metadata",
    where: q.where,
    or: q.or.length ? q.or : undefined,
    order: { col: "created_at", asc: false },
    limit: q.limit,
  });
}

export async function enrichTransactions(rows: AdminTx[]): Promise<AdminTx[]> {
  const ids = Array.from(new Set(rows.map((row) => row.user_id)));
  const profs = ids.length
    ? await dbSelect<{ id: string; first_name: string; last_name: string; email: string }>("profiles", {
        cols: "id, first_name, last_name, email",
        where: [{ col: "id", op: "in", val: ids }],
      }).catch(() => [])
    : [];
  const pm = new Map(profs.map((p) => [p.id, p]));
  const pointsMap = await fetchPointsForTxs(rows);
  return rows.map((row) => ({
    ...row,
    profile: pm.get(row.user_id) ?? null,
    points: pointsMap.get(row.id),
  }));
}

export async function fetchTransactionPage(
  filters: AdminTxFilters,
  cursor: string | null,
): Promise<{ rows: AdminTx[]; error: Error | null }> {
  try {
    const q = await buildBaseQuery(filters, TX_PAGE_SIZE, cursor);
    const rows = await runTransactionQuery(q);
    const enriched = await enrichTransactions(rows);
    return { rows: enriched, error: null };
  } catch (err) {
    return { rows: [], error: err instanceof Error ? err : new Error(String(err)) };
  }
}

export async function fetchAllTransactionsForExport(
  filters: AdminTxFilters,
  maxRows = TX_EXPORT_MAX,
): Promise<{ rows: AdminTx[]; truncated: boolean; error: Error | null }> {
  const all: AdminTx[] = [];
  let cursor: string | null = null;
  let truncated = false;

  try {
    while (all.length < maxRows) {
      const limit = Math.min(TX_PAGE_SIZE, maxRows - all.length);
      const q = await buildBaseQuery(filters, limit, cursor);
      const batch = await runTransactionQuery(q);
      if (batch.length === 0) break;
      all.push(...batch);
      cursor = batch[batch.length - 1].created_at;
      if (batch.length < limit) break;
      if (all.length >= maxRows) {
        truncated = true;
        break;
      }
    }
  } catch (err) {
    return { rows: all, truncated, error: err instanceof Error ? err : new Error(String(err)) };
  }

  const enriched = await enrichTransactions(all);
  return { rows: enriched, truncated, error: null };
}

export function txToCsvRow(
  row: AdminTx,
  merchants: AdminMerchantPicker[],
  canViewFull: boolean,
  maskName: (n: string) => string,
): string {
  const memberName = `${row.profile?.first_name ?? ""} ${row.profile?.last_name ?? ""}`.trim();
  const base = [
    new Date(row.created_at).toISOString(),
    row.public_no ?? "",
    ...(canViewFull ? [row.merchant_ref ?? "", row.external_tx_id ?? ""] : []),
    `"${canViewFull ? memberName : maskName(memberName)}"`,
    ...(canViewFull ? [row.profile?.email ?? ""] : []),
    `"${merchantLabel(row, merchants).replace(/"/g, "''")}"`,
    row.type,
    row.amount,
    row.fee,
    postedAmount(row) ?? "",
    row.status,
    `"${(row.description ?? "").replace(/"/g, "''")}"`,
  ];
  return base.join(",");
}

export function downloadCsv(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
