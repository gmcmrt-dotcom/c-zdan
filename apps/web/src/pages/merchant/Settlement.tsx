import MerchantLayout from "@/components/MerchantLayout";
import { useEffect, useState } from "react";
import { rpc } from "@/lib/rpc";
import { fetchMerchantSettlement } from "@/lib/merchant-self";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { fmtTRY, fmtDate } from "@/lib/format";
import { exportSettlementPdf, exportCashPoolPdf } from "@/lib/exportSettlement";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import DateRangePicker from "@/components/DateRangePicker";

// commerce — settlement defteri (Akış A spend, Akış B credit)
// Turkish labels for `pay_to_merchant`, manual adjustment, and other settlement reasons.
const SETTLEMENT_REASON_LABEL: Record<string, string> = {
  pay_to_merchant:     "Üye ödemesi (Akış A)",
  credit_to_member:    "Üyeye fon transferi",
  push_to_merchant:    "Tarafımızdan gelen havale",
  manual_settlement:   "Manuel settlement",
  manual_adjustment:   "Manuel düzeltme",
  bank_transfer:       "Banka transferi",
  credit_limit_change: "Borç tavanı değişikliği",
};

// finance — kasa defteri (Akış C topup, Akış D withdraw, manuel)
const CASH_POOL_REASON_LABEL: Record<string, string> = {
  topup_received: "Para yatırma alındı (Akış C)",
  withdraw_paid:  "Çekim ödendi (Akış D)",
  manual_in:      "Manuel kasa girişi",
  manual_out:     "Manuel kasa çıkışı",
  reverted:       "Geri alındı",
};

type SelfRow = {
  id: string;
  name: string;
  merchant_type: "commerce" | "finance";
  merchant_scope?: "standalone" | "parent" | "child";
};

export default function MerchantSettlement() {
  const [self, setSelf] = useState<SelfRow | null>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [children, setChildren] = useState<any[]>([]);
  const [selectedMerchantId, setSelectedMerchantId] = useState("all");

  useEffect(() => {
    (async () => {
      const s = await rpc<SelfRow | SelfRow[]>("merchant_self").catch(() => null);
      const me = (Array.isArray(s) ? s[0] : s) ?? null;
      setSelf(me);
      const childRows = me?.merchant_scope === "parent"
        ? await rpc<any[]>("merchant_self_children").catch(() => [] as any[])
        : ([] as any[]);
      setChildren((childRows ?? []) as any[]);
      if (!me) { setLoading(false); return; }

      const childIds = ((childRows ?? []) as any[]).map((c) => c.id);
      const { rows } = await fetchMerchantSettlement(selectedMerchantId, childIds, 200).catch(
        () => ({ ledger: me.merchant_type === "finance" ? "cash_pool" : "settlement", rows: [] as any[] }),
      );
      setRows(rows);
      setLoading(false);
    })();
  }, [selectedMerchantId]);

  const isFinance = self?.merchant_type === "finance";
  const REASON_LABEL = isFinance ? CASH_POOL_REASON_LABEL : SETTLEMENT_REASON_LABEL;
  const title = isFinance ? "Kasa Defteri" : "Settlement Defteri";

  return (
    <MerchantLayout title={title}>
      {self?.merchant_scope === "parent" && (
        <Card className="p-3 mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium">Bayi filtresi</div>
            <div className="text-xs text-muted-foreground">Parent defterinde tüm bayiler veya tek bayi seçilebilir.</div>
          </div>
          <Select value={selectedMerchantId} onValueChange={setSelectedMerchantId}>
            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tüm bayiler</SelectItem>
              {children.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </Card>
      )}
      {self && <PdfExportCard merchantId={self.id} merchantType={self.merchant_type} />}
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="text-left p-3">Tarih</th>
              <th className="text-left p-3">Sebep</th>
              <th className="text-right p-3">Hareket</th>
              <th className="text-right p-3">Önce</th>
              <th className="text-right p-3">Sonra</th>
              <th className="text-left p-3">Referans</th>
              <th className="text-left p-3">Not</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={7} className="text-center py-6 text-muted-foreground">Yükleniyor…</td></tr>}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={7} className="text-center py-6 text-muted-foreground">Henüz hareket yok.</td></tr>
            )}
            {rows.map((r) => {
              const ch = Number(r.change_amount);
              const noteText = isFinance ? r.note : r.notes;
              const refText = isFinance
                ? (r.reference_id ? `ref:${(r.reference_id ?? "").toString().slice(0, 8)}…` : "—")
                : (r.reference_type ? `${r.reference_type}:${(r.reference_id ?? "").toString().slice(0, 8)}…` : "—");
              return (
                <tr key={r.id} className="border-t">
                  <td className="p-3 text-xs whitespace-nowrap">{fmtDate(r.created_at)}</td>
                  <td className="p-3"><Badge variant="outline">{REASON_LABEL[r.reason] ?? r.reason}</Badge></td>
                  <td className={`p-3 text-right tabular-nums font-medium ${ch === 0 ? "text-muted-foreground" : ch > 0 ? "text-success" : "text-destructive"}`}>
                    {ch === 0 ? "—" : (ch > 0 ? "+" : "−") + fmtTRY(Math.abs(ch))}
                  </td>
                  <td className="p-3 text-right tabular-nums text-xs text-muted-foreground">{fmtTRY(Number(r.balance_before))}</td>
                  <td className="p-3 text-right tabular-nums">{fmtTRY(Number(r.balance_after))}</td>
                  <td className="p-3 text-xs font-mono text-muted-foreground">{refText}</td>
                  <td className="p-3 text-xs text-muted-foreground max-w-[280px] truncate">{noteText || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </MerchantLayout>
  );
}

function PdfExportCard({ merchantId, merchantType }: { merchantId: string; merchantType: "commerce" | "finance" }) {
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86400 * 1000).toISOString().slice(0, 10);
  const [start, setStart] = useState(monthAgo);
  const [end, setEnd] = useState(today);
  const [busy, setBusy] = useState(false);

  const isFinance = merchantType === "finance";
  const label = isFinance ? "Kasa defteri PDF'i" : "Settlement defteri PDF'i";
  const description = isFinance
    ? "Tarih aralığında kasa hareketlerini (Akış C/D + manuel) PDF olarak indir."
    : "Tarih aralığında settlement defterini PDF olarak indir.";

  const onExport = async () => {
    setBusy(true);
    try {
      if (isFinance) await exportCashPoolPdf(merchantId, start, end);
      else await exportSettlementPdf(merchantId, start, end);
    } catch (err: any) {
      toast({ title: err.message || "Export başarısız", variant: "destructive" as any });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-4 space-y-2 mb-4">
      <div className="text-sm font-medium">{label}</div>
      <p className="text-xs text-muted-foreground">{description} Yeni sekme açılır + auto print.</p>
      <div className="flex flex-wrap gap-2 items-end">
        <div className="w-full sm:flex-1 sm:max-w-md min-w-0">
          <Label className="text-xs">Tarih aralığı</Label>
          <DateRangePicker
            value={{ from: start, to: end }}
            onChange={(next) => {
              setStart(next.from ?? "");
              setEnd(next.to ?? "");
            }}
            buttonClassName="w-full"
          />
        </div>
        <Button onClick={onExport} disabled={busy}>{busy ? "Hazırlanıyor…" : "PDF olarak aç"}</Button>
      </div>
    </Card>
  );
}
