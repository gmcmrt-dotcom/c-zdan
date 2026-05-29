import MerchantLayout from "@/components/MerchantLayout";
import { useEffect, useState } from "react";
import { rpc } from "@/lib/rpc";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { fmtDate, fmtTRY } from "@/lib/format";
import { AlertCircle } from "lucide-react";

export default function MerchantChildren() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const selfData = await rpc<any | any[]>("merchant_self");
        const self = (Array.isArray(selfData) ? selfData[0] : selfData) ?? null;
        if (self?.merchant_scope !== "parent") {
          setRows([]);
          setError("Bu sayfa sadece parent ticari merchant hesapları içindir.");
          return;
        }
        const data = await rpc<any[]>("merchant_self_children");
        setRows((data ?? []) as any[]);
      } catch (err: any) {
        setError(err?.message ?? "Bayiler yüklenemedi");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <MerchantLayout title="Bayiler">
      {loading ? (
        <div className="text-sm text-muted-foreground">Yükleniyor…</div>
      ) : error ? (
        <Card className="p-8 text-center">
          <AlertCircle className="size-10 mx-auto text-warning mb-2" />
          <p className="text-sm text-muted-foreground">{error}</p>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="text-left p-3">Bayi</th>
                <th className="text-left p-3">Bayi Ref</th>
                <th className="text-right p-3">Bakiye</th>
                <th className="text-right p-3">Bugün</th>
                <th className="text-left p-3">Son hareket</th>
                <th className="text-center p-3">Durum</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={6} className="text-center py-8 text-muted-foreground">Tanımlı bayi yok.</td></tr>
              )}
              {rows.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="p-3 font-medium">{r.name}</td>
                  <td className="p-3 font-mono text-xs text-muted-foreground">{r.external_sub_merchant_ref ?? "—"}</td>
                  <td className={`p-3 text-right tabular-nums ${Number(r.balance) >= 0 ? "text-success" : "text-destructive"}`}>
                    {fmtTRY(Number(r.balance ?? 0))}
                  </td>
                  <td className="p-3 text-right tabular-nums">
                    {fmtTRY(Number(r.today_volume ?? 0))}
                    <div className="text-[10px] text-muted-foreground">{Number(r.today_tx_count ?? 0)} işlem</div>
                  </td>
                  <td className="p-3 text-xs">{r.last_movement_at ? fmtDate(r.last_movement_at) : "—"}</td>
                  <td className="p-3 text-center">
                    <Badge variant={r.is_active ? "secondary" : "destructive"}>{r.is_active ? "Aktif" : "Pasif"}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </MerchantLayout>
  );
}
