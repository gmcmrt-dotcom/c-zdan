import { fmtDate, fmtTRY } from "@/lib/format";
import { maskApiKey, maskUrl } from "@/lib/mask";

export type FinanceIntegrationRow = {
  id: string;
  name: string;
  is_active: boolean;
  api_key: string;
  topup_init_url: string | null;
  webhook_url: string | null;
  cash_pool: number | null;
  cash_pool_updated_at: string | null;
  cash_pool_api_url: string | null;
  deposit_commission_pct: number | null;
  deposit_fixed_fee: number | null;
  withdraw_commission_pct: number | null;
  withdraw_fixed_fee: number | null;
  deposit_min_amount: number | null;
  deposit_max_amount: number | null;
  withdraw_min_amount: number | null;
  withdraw_max_amount: number | null;
};

export type FinanceIntegrationApiCall = {
  merchant_id: string;
  endpoint: string;
  status_code: number | null;
  error_code: string | null;
  latency_ms: number | null;
  created_at: string;
};

function csvCell(v: string | number | null | undefined): string {
  return `"${String(v ?? "").replace(/"/g, '""')}"`;
}

function limitCsv(min: number | null, max: number | null): string {
  if (min == null && max == null) return "Sınırsız";
  return `${min != null ? fmtTRY(min) : "0"} - ${max != null ? fmtTRY(max) : "∞"}`;
}

export function exportFinanceIntegrationsCsv(
  rows: FinanceIntegrationRow[],
  latestByMerchant: Map<string, FinanceIntegrationApiCall>,
  opts: {
    showApiKey: boolean;
    showUrls: boolean;
    isStale: (ts: string | null) => boolean;
  },
) {
  const header =
    "Merchant;Durum;Init URL;Topup init URL;Webhook;Kasa;Kasa güncelleme;Kasa stale;Sync URL;Yatırma limit;Çekim limit;Yatırma komisyon %;Çekim komisyon %;Son endpoint;Son HTTP;Son hata;Son çağrı;Latency ms\n";

  const body = rows
    .map((row) => {
      const latest = latestByMerchant.get(row.id);
      const stale = opts.isStale(row.cash_pool_updated_at);
      return [
        row.name,
        row.is_active ? "Aktif" : "Pasif",
        row.topup_init_url ? "Var" : "Eksik",
        row.topup_init_url
          ? opts.showUrls
            ? row.topup_init_url
            : maskUrl(row.topup_init_url)
          : "",
        row.webhook_url ? (opts.showUrls ? row.webhook_url : "tanımlı") : "",
        row.cash_pool == null ? "" : fmtTRY(row.cash_pool),
        row.cash_pool_updated_at ? fmtDate(row.cash_pool_updated_at) : "",
        stale ? "Evet" : "Hayır",
        row.cash_pool_api_url
          ? opts.showUrls
            ? row.cash_pool_api_url
            : maskUrl(row.cash_pool_api_url)
          : "",
        limitCsv(row.deposit_min_amount, row.deposit_max_amount),
        limitCsv(row.withdraw_min_amount, row.withdraw_max_amount),
        Number(row.deposit_commission_pct ?? 0).toFixed(2),
        Number(row.withdraw_commission_pct ?? 0).toFixed(2),
        latest?.endpoint ?? "",
        latest?.status_code ?? "",
        latest?.error_code ?? "",
        latest ? fmtDate(latest.created_at) : "",
        latest?.latency_ms ?? "",
      ]
        .map(csvCell)
        .join(";");
    })
    .join("\n");

  const blob = new Blob(["\uFEFF" + header + body], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `finance-integrations-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
