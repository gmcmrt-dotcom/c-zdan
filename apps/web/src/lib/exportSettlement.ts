// PDF export helpers — fetch HTML from the API and open it in a new tab.
//
// Two report types:
//   - Settlement defteri (commerce merchant): exportSettlementPdf
//   - Kasa defteri       (finance merchant):  exportCashPoolPdf
//
// Both endpoints return HTML; we wrap in a Blob URL and rely on the report's
// own `window.onload → window.print()` script to trigger the print dialog.
//
// Auth (Batch O): access token rides as an HttpOnly cookie thanks to
// `credentials: "include"`. POST is state-changing so we echo the JS-readable
// `csrf_token` cookie in the `X-CSRF-Token` header.

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string) || "/api";
const CSRF_COOKIE = "csrf_token";

function readCookie(name: string): string | null {
  const m = document.cookie.match(
    new RegExp(`(?:^|; )${name.replace(/[$()*+./?[\\\]^{|}-]/g, "\\$&")}=([^;]*)`),
  );
  return m ? decodeURIComponent(m[1]!) : null;
}

type ExportArgs = {
  merchantId: string;
  startDate: string;
  endDate: string;
};

async function callPdfExport(path: string, args: ExportArgs) {
  const csrf = readCookie(CSRF_COOKIE);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (csrf) headers["X-CSRF-Token"] = csrf;

  const res = await fetch(`${API_BASE}/admin/export/${path}`, {
    method: "POST",
    credentials: "include",
    headers,
    body: JSON.stringify({
      merchantId: args.merchantId,
      startDate: args.startDate,
      endDate: args.endDate,
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Export başarısız: ${txt}`);
  }
  const html = await res.text();
  const blob = new Blob([html], { type: "text/html" });
  const objUrl = URL.createObjectURL(blob);
  window.open(objUrl, "_blank");
  setTimeout(() => URL.revokeObjectURL(objUrl), 60_000);
}

/** Settlement defteri PDF — commerce merchant (Akış A spend / Akış B credit) */
export async function exportSettlementPdf(merchantId: string, startDate: string, endDate: string) {
  return callPdfExport("settlement", { merchantId, startDate, endDate });
}

/** Kasa defteri PDF — finance merchant (Akış C topup / Akış D withdraw + manuel) */
export async function exportCashPoolPdf(merchantId: string, startDate: string, endDate: string) {
  return callPdfExport("cash-pool", { merchantId, startDate, endDate });
}
