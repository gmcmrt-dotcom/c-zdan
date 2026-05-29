import MerchantLayout from "@/components/MerchantLayout";
import { useEffect, useState } from "react";
import { rpc } from "@/lib/rpc";
import { fetchMerchantApiCalls } from "@/lib/merchant-self";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { fmtDate } from "@/lib/format";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function MerchantApiCalls() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [children, setChildren] = useState<any[]>([]);
  const [selectedMerchantId, setSelectedMerchantId] = useState("all");
  const [isParent, setIsParent] = useState(false);

  useEffect(() => {
    (async () => {
      const s = await rpc<any | any[]>("merchant_self").catch(() => null);
      const me = (Array.isArray(s) ? s[0] : s) ?? null;
      const parent = me?.merchant_scope === "parent";
      const childRows = parent
        ? await rpc<any[]>("merchant_self_children").catch(() => [] as any[])
        : [];
      const childIds = ((childRows ?? []) as any[]).map((c) => c.id);
      const data = await fetchMerchantApiCalls(selectedMerchantId, childIds, 200).catch(
        () => [] as any[],
      );
      setIsParent(parent);
      setChildren((childRows ?? []) as any[]);
      setRows(data);
      setLoading(false);
    })();
  }, [selectedMerchantId]);

  return (
    <MerchantLayout title="API Çağrıları">
      {isParent && (
        <Card className="p-3 mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium">Bayi filtresi</div>
            <div className="text-xs text-muted-foreground">Parent API loglarında tüm bayiler veya tek bayi seçilebilir.</div>
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
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="text-left p-3">Tarih</th>
              <th className="text-left p-3">Endpoint</th>
              <th className="text-left p-3">Method</th>
              <th className="text-center p-3">Status</th>
              <th className="text-left p-3">Hata</th>
              <th className="text-right p-3">Süre</th>
              <th className="text-left p-3">IP</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={7} className="text-center py-6 text-muted-foreground">Yükleniyor…</td></tr>}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={7} className="text-center py-6 text-muted-foreground">Henüz API çağrısı yok.</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="p-3 text-xs whitespace-nowrap">{fmtDate(r.created_at)}</td>
                <td className="p-3 font-mono text-xs">{r.endpoint}</td>
                <td className="p-3 text-xs">{r.method}</td>
                <td className="p-3 text-center">
                  <Badge variant={r.status_code < 300 ? "secondary" : r.status_code < 500 ? "outline" : "destructive"}>
                    {r.status_code}
                  </Badge>
                </td>
                <td className="p-3 text-xs">
                  {r.error_code ? <Badge variant="destructive">{r.error_code}</Badge> : "—"}
                </td>
                <td className="p-3 text-right tabular-nums text-xs text-muted-foreground">
                  {r.latency_ms ? `${r.latency_ms} ms` : "—"}
                </td>
                <td className="p-3 text-xs font-mono text-muted-foreground">{r.ip ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </MerchantLayout>
  );
}
