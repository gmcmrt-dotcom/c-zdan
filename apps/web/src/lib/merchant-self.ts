import { apiGet } from "./api";

type LedgerRow = {
  id: number;
  merchantId?: string;
  changeAmount: number;
  balanceBefore: number;
  balanceAfter: number;
  reason: string;
  referenceType?: string | null;
  referenceId?: string | null;
  notes?: string | null;
  createdAt: string;
};

type SettlementResponse = {
  ledger: "settlement" | "cash_pool";
  rows: LedgerRow[];
};

type ApiCallsResponse = {
  rows: Array<{
    id: string;
    merchantId?: string | null;
    endpoint: string;
    method: string;
    statusCode: number | null;
    errorCode: string | null;
    latencyMs: number | null;
    merchantRef: string | null;
    ip: string | null;
    createdAt: string;
  }>;
};

type TransactionsResponse = {
  rows: Array<{
    id: string;
    publicNo: string;
    type: string;
    amount: number;
    fee: number;
    merchantRef: string | null;
    createdAt: string;
  }>;
};

type CashoutSessionsResponse = {
  rows: Array<{
    id: string;
    publicNo: string;
    merchantId: string;
    methodCode: string;
    amount: number;
    fee: number;
    status: string;
    payoutAddress: string | null;
    createdAt: string;
  }>;
};

function scopeQuery(selectedMerchantId: string, childIds: string[]): string {
  if (selectedMerchantId !== "all") return `merchantId=${selectedMerchantId}`;
  if (childIds.length > 0) return `merchantIds=${childIds.join(",")}`;
  return "";
}

export function mapLedgerRows(rows: LedgerRow[]) {
  return rows.map((r) => ({
    id: r.id,
    merchant_id: r.merchantId,
    change_amount: r.changeAmount,
    balance_before: r.balanceBefore,
    balance_after: r.balanceAfter,
    reason: r.reason,
    reference_type: r.referenceType,
    reference_id: r.referenceId,
    notes: r.notes,
    created_at: r.createdAt,
  }));
}

export async function fetchMerchantSettlement(
  selectedMerchantId: string,
  childIds: string[],
  limit = 200,
) {
  const scope = scopeQuery(selectedMerchantId, childIds);
  const q = scope ? `?limit=${limit}&${scope}` : `?limit=${limit}`;
  const res = await apiGet<SettlementResponse>(`/merchant/self/settlement${q}`);
  return { ledger: res.ledger, rows: mapLedgerRows(res.rows) };
}

export async function fetchMerchantApiCalls(
  selectedMerchantId: string,
  childIds: string[],
  limit = 200,
) {
  const scope = scopeQuery(selectedMerchantId, childIds);
  const q = scope ? `?limit=${limit}&${scope}` : `?limit=${limit}`;
  const res = await apiGet<ApiCallsResponse>(`/merchant/self/api-calls${q}`);
  return res.rows.map((r) => ({
    id: r.id,
    merchant_id: r.merchantId,
    endpoint: r.endpoint,
    method: r.method,
    status_code: r.statusCode,
    error_code: r.errorCode,
    latency_ms: r.latencyMs,
    ip: r.ip,
    created_at: r.createdAt,
  }));
}

export async function fetchMerchantTransactions(
  selectedMerchantId: string,
  childIds: string[],
  limit = 200,
) {
  const scope = scopeQuery(selectedMerchantId, childIds);
  const q = scope ? `?limit=${limit}&${scope}` : `?limit=${limit}`;
  const res = await apiGet<TransactionsResponse>(`/merchant/self/transactions${q}`);
  return res.rows.map((r) => ({
    id: r.id,
    public_no: r.publicNo,
    type: r.type,
    amount: r.amount,
    fee: r.fee,
    merchant_ref: r.merchantRef,
    created_at: r.createdAt,
    merchant_posted_amount: r.type === "spend" ? r.amount - r.fee : null,
  }));
}

export async function fetchMerchantCashoutSessions(targetMerchantId: string) {
  const res = await apiGet<CashoutSessionsResponse>(
    `/merchant/self/cashout-sessions?merchantId=${targetMerchantId}&limit=100`,
  );
  return res.rows.map((r) => ({
    id: r.id,
    public_no: r.publicNo,
    merchant_id: r.merchantId,
    method_code: r.methodCode,
    amount: r.amount,
    fee: r.fee,
    status: r.status,
    payout_address: r.payoutAddress,
    created_at: r.createdAt,
  }));
}
