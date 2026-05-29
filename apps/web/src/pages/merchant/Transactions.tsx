import MerchantLayout from "@/components/MerchantLayout";
import { useEffect, useState } from "react";
import { rpc } from "@/lib/rpc";
import { fetchMerchantTransactions } from "@/lib/merchant-self";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { fmtTRY, fmtDate, txTypeLabel } from "@/lib/format";
import { exportSettlementPdf, exportCashPoolPdf } from "@/lib/exportSettlement";
import { FileText } from "lucide-react";
import DateRangePicker from "@/components/DateRangePicker";

type SelfRow = { id: string; merchant_type: "commerce" | "finance"; merchant_scope?: "standalone" | "parent" | "child" };

const postedAmount = (row: any): number | null => {
  const raw = row.merchant_posted_amount ?? row.merchant_net_amount;
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
};

export default function MerchantTransactions() {
  const [self, setSelf] = useState<SelfRow | null>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [children, setChildren] = useState<any[]>([]);
  const [selectedMerchantId, setSelectedMerchantId] = useState("all");

  useEffect(() => {
    (async () => {
      const s = await rpc<SelfRow | SelfRow[]>("merchant_self").catch(() => null);
      const me = (Array.isArray(s) ? s[0] : s) ?? null;
      const childRows = me?.merchant_scope === "parent"
        ? await rpc<any[]>("merchant_self_children").catch(() => [] as any[])
        : ([] as any[]);
      const childIds = ((childRows ?? []) as any[]).map((c) => c.id);
      const data = await fetchMerchantTransactions(selectedMerchantId, childIds, 200).catch(
        () => [] as any[],
      );
      setSelf(me);
      setChildren((childRows ?? []) as any[]);
      setRows(data);
      setLoading(false);
    })();
  }, [selectedMerchantId]);

  return (
    <MerchantLayout title="Üye İşlemleri">
      {self?.merchant_scope === "parent" && (
        <Card className="p-3 mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium">Bayi filtresi</div>
            <div className="text-xs text-muted-foreground">Tüm bayiler veya tek bayi işlem listesi.</div>
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
        <div className="p-3 border-b text-xs text-muted-foreground">
          Üye PII'si gösterilmez. Sadece anonim üye ID + işlem detayları.
        </div>
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="text-left p-3">Tarih</th>
              <th className="text-left p-3">Tip</th>
              <th className="text-left p-3">Üye</th>
              <th className="text-right p-3">Tutar</th>
              <th className="text-right p-3">Komisyon</th>
              <th className="text-right p-3">İşlenen Net</th>
              <th className="text-center p-3">Durum</th>
              <th className="text-left p-3">Ref</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={8} className="text-center py-6 text-muted-foreground">Yükleniyor…</td></tr>}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={8} className="text-center py-6 text-muted-foreground">Henüz işlem yok.</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="p-3 text-xs whitespace-nowrap">{fmtDate(r.created_at)}</td>
                <td className="p-3">
                  <Badge variant="outline">{txTypeLabel(r.type)}</Badge>
                  {r.merchant_note && (
                    <div
                      className="mt-1 italic text-[11px] text-muted-foreground/80 max-w-[220px] truncate"
                      title={r.merchant_note}
                    >
                      Not: {r.merchant_note}
                    </div>
                  )}
                </td>
                <td className="p-3 text-xs font-mono">{r.member_anon_label}</td>
                <td className="p-3 text-right tabular-nums">{fmtTRY(Number(r.amount))}</td>
                <td className="p-3 text-right tabular-nums text-xs text-muted-foreground">
                  {Number(r.fee) > 0 ? fmtTRY(Number(r.fee)) : "—"}
                </td>
                <td className={`p-3 text-right tabular-nums text-xs ${
                  postedAmount(r) === null ? "text-muted-foreground" : postedAmount(r)! < 0 ? "text-destructive" : "text-success"
                }`}>
                  {postedAmount(r) === null ? "—" : `${postedAmount(r)! < 0 ? "−" : "+"}${fmtTRY(Math.abs(postedAmount(r)!))}`}
                </td>
                <td className="p-3 text-center">
                  <Badge variant={r.status === "completed" ? "secondary" : r.status === "failed" ? "destructive" : "outline"}>
                    {r.status}
                  </Badge>
                </td>
                <td className="p-3 text-xs font-mono text-muted-foreground">
                  {r.merchant_ref ? r.merchant_ref.slice(0, 16) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </MerchantLayout>
  );
}

// PDF export butonu Settlement sayfasından buraya taşındı.
// Commerce → settlement_log, Finance → cash_pool_log üzerinden çalışır.
function PdfExportCard({ merchantId, merchantType }: { merchantId: string; merchantType: "commerce" | "finance" }) {
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86400 * 1000).toISOString().slice(0, 10);
  const [start, setStart] = useState(monthAgo);
  const [end, setEnd] = useState(today);
  const [busy, setBusy] = useState(false);

  const isFinance = merchantType === "finance";
  const label = isFinance ? "Kasa hareketleri PDF'i" : "İşlem dökümü PDF'i";
  const description = isFinance
    ? "Tarih aralığında kasa hareketlerinizi (yatırma + çekim) PDF olarak indirin."
    : "Tarih aralığında üye işlemleri ve hesap hareketlerinizi PDF olarak indirin.";

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
      <div className="flex items-center gap-2 text-sm font-medium">
        <FileText className="size-4 text-primary" />
        {label}
      </div>
      <p className="text-xs text-muted-foreground">{description} Yeni sekmede açılır + otomatik yazdır.</p>
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
