/**
 * Print-to-PDF HTML reports — mirror the original `export-*-pdf` edge functions
 * that also return HTML (not binary PDFs). Frontend invokes `window.print()`
 * after fetching.
 */
import { and, between, eq } from "drizzle-orm";
import { db } from "../db/client";
import { merchantCashPoolLog, merchantSettlementLog, merchants } from "../db/schema";
import { NotFoundError } from "../lib/errors";

function fmt(n: string | number): string {
  return new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n));
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function exportSettlementHtml(opts: {
  merchantId: string;
  startDate: string;
  endDate: string;
}): Promise<string> {
  const [m] = await db.select().from(merchants).where(eq(merchants.id, opts.merchantId)).limit(1);
  if (!m) throw new NotFoundError("MERCHANT_NOT_FOUND");
  const rows = await db
    .select()
    .from(merchantSettlementLog)
    .where(
      and(
        eq(merchantSettlementLog.merchantId, opts.merchantId),
        between(merchantSettlementLog.createdAt, new Date(opts.startDate), new Date(opts.endDate)),
      ),
    );
  const total = rows.reduce((s, r) => s + Number(r.changeAmount), 0);
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>Settlement — ${escapeHtml(m.name)}</title>
  <style>body{font:13px/1.4 system-ui,sans-serif;padding:24px}table{border-collapse:collapse;width:100%}th,td{padding:6px 10px;border-bottom:1px solid #eee;text-align:left}th{background:#fafafa}.r{text-align:right}.pos{color:#0a7}.neg{color:#c33}</style>
  </head><body>
  <h1>Settlement Report</h1>
  <p><strong>Merchant:</strong> ${escapeHtml(m.name)}<br>
  <strong>Period:</strong> ${escapeHtml(opts.startDate)} → ${escapeHtml(opts.endDate)}</p>
  <table><thead><tr><th>Date</th><th>Reason</th><th class="r">Change</th><th class="r">Balance After</th><th>Notes</th></tr></thead><tbody>
  ${rows
    .map(
      (r) =>
        `<tr><td>${r.createdAt.toISOString().slice(0, 19).replace("T", " ")}</td><td>${escapeHtml(r.reason)}</td><td class="r ${Number(r.changeAmount) >= 0 ? "pos" : "neg"}">${fmt(r.changeAmount)}</td><td class="r">${fmt(r.balanceAfter)}</td><td>${escapeHtml(r.notes ?? "")}</td></tr>`,
    )
    .join("")}
  </tbody><tfoot><tr><th colspan="2">Total</th><th class="r ${total >= 0 ? "pos" : "neg"}">${fmt(total)}</th><th></th><th></th></tr></tfoot></table>
  </body></html>`;
}

export async function exportCashPoolHtml(opts: {
  merchantId: string;
  startDate: string;
  endDate: string;
}): Promise<string> {
  const [m] = await db.select().from(merchants).where(eq(merchants.id, opts.merchantId)).limit(1);
  if (!m) throw new NotFoundError("MERCHANT_NOT_FOUND");
  const rows = await db
    .select()
    .from(merchantCashPoolLog)
    .where(
      and(
        eq(merchantCashPoolLog.merchantId, opts.merchantId),
        between(merchantCashPoolLog.createdAt, new Date(opts.startDate), new Date(opts.endDate)),
      ),
    );
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>Cash Pool — ${escapeHtml(m.name)}</title>
  <style>body{font:13px/1.4 system-ui,sans-serif;padding:24px}table{border-collapse:collapse;width:100%}th,td{padding:6px 10px;border-bottom:1px solid #eee;text-align:left}.r{text-align:right}</style></head><body>
  <h1>Cash Pool Report</h1>
  <p><strong>Merchant:</strong> ${escapeHtml(m.name)}<br>
  <strong>Period:</strong> ${escapeHtml(opts.startDate)} → ${escapeHtml(opts.endDate)}</p>
  <table><thead><tr><th>Date</th><th>Reason</th><th class="r">Change</th><th class="r">Balance After</th><th>Note</th></tr></thead><tbody>
  ${rows
    .map(
      (r) =>
        `<tr><td>${r.createdAt.toISOString().slice(0, 19).replace("T", " ")}</td><td>${escapeHtml(r.reason)}</td><td class="r">${fmt(r.changeAmount)}</td><td class="r">${fmt(r.balanceAfter)}</td><td>${escapeHtml(r.notes ?? "")}</td></tr>`,
    )
    .join("")}
  </tbody></table></body></html>`;
}
