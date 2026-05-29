import { fmtTRY } from "@/lib/format";
import { maskApiKey } from "@/lib/mask";
import type { Merchant, MerchantType } from "@/pages/admin/Merchants";

function csvCell(v: string | number | null | undefined): string {
  return `"${String(v ?? "").replace(/"/g, '""')}"`;
}

export function exportMerchantsCsv(
  rows: Merchant[],
  opts: {
    filterType: MerchantType | null;
    showApiKey: boolean;
  },
  filenamePrefix = "merchants",
) {
  const isCommerce = opts.filterType === "commerce";
  const isFinance = opts.filterType === "finance";

  let header: string;
  if (isCommerce) {
    header =
      "Ad;Kapsam;Settlement;Bayi sayısı;API Key;Komisyon %;Sabit ücret;IP sayısı;Durum\n";
  } else if (isFinance) {
    header =
      "Ad;Kasa;API Key;Yatırma komisyon %;Çekim komisyon %;Yatırma min-max;Çekim min-max;IP sayısı;Durum\n";
  } else {
    header =
      "Ad;Tip;Kapsam;Settlement/Kasa;API Key;Komisyon %;IP sayısı;Durum\n";
  }

  const body = rows
    .map((m) => {
      const apiKey = opts.showApiKey ? (m.api_key ?? "") : maskApiKey(m.api_key ?? "");
      const status = m.is_active ? "Aktif" : "Pasif";
      if (isCommerce) {
        const scope = m.merchant_scope === "parent" ? "Parent" : "Standalone";
        return [
          m.name,
          scope,
          fmtTRY(Number(m.balance ?? 0)),
          m.merchant_scope === "parent" ? (m.child_count ?? 0) : "",
          apiKey,
          Number(m.commission_pct).toFixed(2),
          Number(m.fixed_fee) > 0 ? fmtTRY(m.fixed_fee) : "",
          m.ip_whitelist.length,
          status,
        ]
          .map(csvCell)
          .join(";");
      }
      if (isFinance) {
        const depLim =
          m.deposit_min_amount != null || m.deposit_max_amount != null
            ? `${m.deposit_min_amount != null ? fmtTRY(m.deposit_min_amount) : "0"}-${m.deposit_max_amount != null ? fmtTRY(m.deposit_max_amount) : "∞"}`
            : "";
        const wLim =
          m.withdraw_min_amount != null || m.withdraw_max_amount != null
            ? `${m.withdraw_min_amount != null ? fmtTRY(m.withdraw_min_amount) : "0"}-${m.withdraw_max_amount != null ? fmtTRY(m.withdraw_max_amount) : "∞"}`
            : "";
        return [
          m.name,
          fmtTRY(Number(m.cash_pool ?? 0)),
          apiKey,
          Number(m.deposit_commission_pct ?? m.commission_pct ?? 0).toFixed(2),
          Number(m.withdraw_commission_pct ?? m.commission_pct ?? 0).toFixed(2),
          depLim,
          wLim,
          m.ip_whitelist.length,
          status,
        ]
          .map(csvCell)
          .join(";");
      }
      const balanceOrPool =
        m.merchant_type === "finance"
          ? fmtTRY(Number(m.cash_pool ?? 0))
          : fmtTRY(Number(m.balance ?? 0));
      return [
        m.name,
        m.merchant_type === "finance" ? "Finans" : "Ticaret",
        m.merchant_scope ?? "standalone",
        balanceOrPool,
        apiKey,
        Number(m.commission_pct).toFixed(2),
        m.ip_whitelist.length,
        status,
      ]
        .map(csvCell)
        .join(";");
    })
    .join("\n");

  const blob = new Blob(["\uFEFF" + header + body], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${filenamePrefix}-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
