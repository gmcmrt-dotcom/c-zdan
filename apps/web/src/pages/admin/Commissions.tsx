import { useEffect, useState } from "react";
import AdminLayout from "@/components/AdminLayout" ;
import { StatCard } from "@/components/ui/stat-card";
import { BoStatGrid } from "@/components/bo/BoPagePrimitives";
import { dbSelect } from "@/lib/db";
import { rpc } from "@/lib/rpc";
import { Card } from "@/components/ui/card" ;
import { Loader2, ArrowDownLeft , ArrowUpRight } from "lucide-react" ;
import { fmtTRY } from "@/lib/format" ;
import {
  Select, SelectContent , SelectItem, SelectTrigger , SelectValue,
} from "@/components/ui/select" ;
import { Badge } from "@/components/ui/badge" ;
import { isAffiliateEnabled } from "@/lib/feature-flags";

type Topup = {
   id: string; gross_amount: number; net_amount: number; provider_cost : number;
   provider_id: string; created_at: string; status: string;
};

type Tx = {
   id: string; type: string; amount: number; fee: number; status: string;
   metadata: any; created_at: string;
};

type Merchant = {
   id: string; name: string; merchant_type : "finance" | "commerce";
   commission_pct : number; fixed_fee: number; commission_direction : "pay" | "earn";
   merchant_scope: string | null; parent_merchant_id: string | null;
};

export default function AdminCommissions () {
  const [topups, setTopups] = useState<Topup[]>([]);
  const [providers, setProviders] = useState<Record<string, string>>({});
  const [txs, setTxs] = useState<Tx[]>([]);
  const [merchants, setMerchants] = useState<Record<string, Merchant>>({});
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState("30");
  // affiliate komisyon maliyeti
  const [affCost, setAffCost] = useState<{ pending: number; paid: number; total: number }>({ pending: 0, paid: 0, total: 0 });

  useEffect(() => {
    (async () => {
      setLoading (true);
      const since = new Date(Date.now() - Number(range) * 86400000).toISOString();
      const [tRows, ps, txRows, ms] = await Promise.all([
        dbSelect<Topup>("topup_requests", {
          where: [
            { col: "created_at", op: "gte", val: since },
            { col: "status", op: "eq", val: "completed" },
          ],
        }).catch(() => [] as Topup[]),
        dbSelect<{ id: string; name: string }>("payment_providers", { cols: "id, name" }).catch(() => [] as Array<{ id: string; name: string }>),
        dbSelect<Tx>("transactions", {
          cols: "id, type, amount, fee, status, metadata, created_at",
          where: [
            { col: "created_at", op: "gte", val: since },
            { col: "status", op: "eq", val: "completed" },
            { col: "type", op: "in", val: ["spend", "merchant_credit", "topup", "merchant_withdraw"] },
          ],
          limit: 500, // /from shim hard cap (from.routes FromBody.limit.max)
        }).catch(() => [] as Tx[]),
        dbSelect<Merchant>("merchants", {
          cols: "id, name, merchant_type, commission_pct, fixed_fee, commission_direction, merchant_scope, parent_merchant_id",
        }).catch(() => [] as Merchant[]),
      ]);
      setTopups (tRows);
      const m: Record<string, string> = {};
      ps.forEach((p) => { m[p.id] = p.name; });
      setProviders (m);
      setTxs(txRows);
      const mm: Record<string, Merchant> = {};
      ms.forEach((x) => { mm[x.id] = x; });
      setMerchants (mm);

      if (isAffiliateEnabled()) {
        const affRows = await rpc<unknown>("admin_affiliate_costs", { _since: since }).catch(() => null);
        const affRow = Array.isArray(affRows) ? (affRows[0] as any) : null;
        setAffCost({
          pending: Number(affRow?.total_pending ?? 0),
          paid: Number(affRow?.total_paid ?? 0),
          total: Number(affRow?.total_all ?? 0),
        });
      } else {
        setAffCost({ pending: 0, paid: 0, total: 0 });
      }

      setLoading (false);
    })();
  }, [range]);

  // Topup sağlayıcılar? (eski blok)
  const provAgg = topups.reduce<Record<string, { count: number; gross: number; net: number; cost: number }>>((acc, t) => {
    const key = t.provider_id;
    acc[key] = acc[key] ?? { count: 0, gross: 0, net: 0, cost: 0 };
    acc[key].count += 1;
    acc[key].gross += Number(t.gross_amount);
    acc[key].net += Number(t.net_amount);
    acc[key].cost += Number(t.provider_cost);
    return acc;
  }, {});

  const totalGross = topups.reduce((s, t) => s + Number(t.gross_amount), 0);
  const totalNet = topups.reduce((s, t) => s + Number(t.net_amount), 0);
  const totalProviderCost = topups.reduce((s, t) => s + Number(t.provider_cost), 0);

  // Merchant başına P&L: revenue/cost metadata kolonları öncelikli, eski kayıtlar için fee fallback.
  const merchAgg = txs.reduce<Record<string, { count: number; volume: number; revenue: number; cost: number; net: number }>>((acc, t) => {
    const mid = t.metadata?.merchant_id;
    if (!mid) return acc;
    const merchant = merchants[mid];
    const revenueRaw = Number(t.metadata?.platform_revenue ?? 0);
    const costRaw = Number(t.metadata?.platform_cost ?? 0);
    const feeFallback = Number(t.fee) || 0;
    const revenue = revenueRaw || (!costRaw && merchant?.commission_direction === "earn" ? feeFallback : 0);
    const cost = costRaw || (!revenueRaw && merchant?.commission_direction === "pay" ? feeFallback : 0);
    acc[mid] = acc[mid] ?? { count: 0, volume: 0, revenue: 0, cost: 0, net: 0 };
    acc[mid].count += 1;
    acc[mid].volume += Number(t.amount) || 0;
    acc[mid].revenue += revenue;
    acc[mid].cost += cost;
    acc[mid].net += revenue - cost;
    return acc;
  }, {});

const commissionRevenue = Object.values(merchAgg).reduce((s, v) => s + v.revenue, 0);
const commissionCost = Object.values(merchAgg).reduce((s, v) => s + v.cost, 0);

const showAffiliateCost = isAffiliateEnabled();
const netPlatform = commissionRevenue - commissionCost - (showAffiliateCost ? affCost.total : 0);

return (
  <AdminLayout title="Komisyonlar & P&L" requireAny={["commissions:view"]} >
    <div className="flex justify-end mb-4" >
       <Select value={range} onValueChange={setRange}>
          <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Son 7 gün</SelectItem>
            <SelectItem value="30">Son 30 gün</SelectItem>
            <SelectItem value="90">Son 90 gün</SelectItem>
            <SelectItem value="365">Son 1 yıl</SelectItem>
          </SelectContent>
       </Select>
    </div>

    {loading ? (
       <div className="p-12 flex justify-center" ><Loader2 className="animate-spin" /></div>
    ) : (
       <>
          {/* P&L özeti */ }
          <BoStatGrid cols={showAffiliateCost ? 5 : 4} className="mb-6">
            <StatCard
              label="Komisyon Geliri"
              value={`+${fmtTRY(commissionRevenue)}`}
              valueSize="lg"
              valueClassName="text-success"
              headerRight={<ArrowDownLeft className="size-4 text-success shrink-0" />}
              hint="Akış A/B gelirleri"
            />
            <StatCard
              label="Komisyon / Provider Gideri"
              value={`−${fmtTRY(commissionCost)}`}
              valueSize="lg"
              valueClassName="text-destructive"
              headerRight={<ArrowUpRight className="size-4 text-destructive shrink-0" />}
              hint="Akış C/D maliyetleri"
            />
            <StatCard
              label="Legacy Topup Maliyeti"
              value={`−${fmtTRY(totalProviderCost)}`}
              valueSize="lg"
              valueClassName="text-destructive"
              hint="Eski topup_requests raporu"
            />
            {showAffiliateCost && (
              <StatCard
                label="Affiliate Maliyeti"
                value={`−${fmtTRY(affCost.total)}`}
                valueSize="lg"
                valueClassName="text-destructive"
                headerRight={<ArrowUpRight className="size-4 text-destructive shrink-0" />}
                hint={`Bekleyen: ${fmtTRY(affCost.pending)} · Ödendi: ${fmtTRY(affCost.paid)}`}
              />
            )}
            <StatCard
              label="Net Platform Geliri"
              value={`${netPlatform >= 0 ? "+" : ""}${fmtTRY(netPlatform)}`}
              valueSize="lg"
              valueClassName={netPlatform >= 0 ? "text-success" : "text-destructive"}
              hint="Tüm gelir − tüm gider"
              className="border-primary/40 bg-primary/5"
            />
          </BoStatGrid>

          {/* Merchant başına dağılım */ }
          <Card className="p-0 overflow-hidden mb-6" >
            <div className="px-4 py-3 border-b bg-muted/40" >
              <h3 className="text-sm font-semibold" >Merchant Bazlı Komisyon Dağılımı </h3>
            </div>
            <table className="w-full text-sm" >
              <thead className="bg-muted/30 text-left" >
                 <tr>
                   <th className="px-4 py-3">Merchant</th>
                   <th className="px-4 py-3">Ana Merchant</th>
                   <th className="px-4 py-3">Tip</th>
                   <th className="px-4 py-3">Oran</th>
                   <th className="px-4 py-3">İşlem</th>
                   <th className="px-4 py-3">Hacim</th>
                   <th className="px-4 py-3 text-right" >Gelir</th>
                   <th className="px-4 py-3 text-right" >Gider</th>
                   <th className="px-4 py-3 text-right" >Net</th>
                 </tr>
              </thead>
              <tbody>
                 {Object.entries(merchAgg).length === 0 ? (
                   <tr><td colSpan={9} className="text-center text-muted-foreground py-12" >Veri yok</td></tr>
                 ) : Object.entries(merchAgg)
                   .sort((a, b) => Math.abs(b[1].net) - Math.abs(a[1].net))
                   .map(([mid, v]) => {
                      const m = merchants[mid];
                      if (!m) return null;
                      const parent = m.parent_merchant_id ? merchants[m.parent_merchant_id] : null;
                      return (
                        <tr key={mid} className="border-t">
                          <td className="px-4 py-3 font-medium" >
                            {m.name}
                            {m.merchant_scope === "child" && <div className="text-[10px] text-muted-foreground">Bayi</div>}
                          </td>
                          <td className="px-4 py-3 text-xs">{parent?.name ?? "—"}</td>
                          <td className="px-4 py-3">
                            <Badge variant="outline" className="text-xs">
                               {m.merchant_type === "finance" ? "Finans" : "Ticaret"}
</Badge>
                              </td>
                              <td className="px-4 py-3 text-xs" >
                                %{Number(m.commission_pct ).toFixed(2)}
                                {Number(m.fixed_fee) > 0 && ` + ${fmtTRY(m.fixed_fee)}`}
                              </td>
                              <td className="px-4 py-3 text-xs" >{v.count}</td>
                              <td className="px-4 py-3 text-xs" >{fmtTRY(v.volume)}</td>
                              <td className="px-4 py-3 text-right font-medium text-success">
                                +{fmtTRY(v.revenue)}
                              </td>
                              <td className="px-4 py-3 text-right font-medium text-destructive">
                                −{fmtTRY(v.cost)}
                              </td>
                              <td className={`px-4 py-3 text-right font-medium ${v.net >= 0 ? "text-success" : "text-destructive"}`}>
                                {v.net >= 0 ? "+" : "−"}{fmtTRY(Math.abs(v.net))}
                              </td>
                            </tr>
                         );
                       })}
                 </tbody>
               </table>
             </Card>

             {/* Topup sağlayıcı tablosu (eski) */ }
             <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4" >
               <Card className="p-4">
                 <div className="text-xs text-muted-foreground" >Topup Brüt</div>
                 <div className="text-xl font-bold" >{fmtTRY(totalGross)}</div>
               </Card>
               <Card className="p-4">
                 <div className="text-xs text-muted-foreground" >Topup Net</div>
                 <div className="text-xl font-bold text-primary" >{fmtTRY(totalNet)}</div>
               </Card>
               <Card className="p-4">
                 <div className="text-xs text-muted-foreground" >Sağlayıcıya Ödenen </div>
                 <div className="text-xl font-bold text-destructive" >{fmtTRY(totalProviderCost )}</div>
               </Card>
             </div>
             <Card className="p-0 overflow-hidden" >
               <div className="px-4 py-3 border-b bg-muted/40" >
                {/* Provider concept removed — header now says "Ödeme yöntemi".
                    `provider_ledger.provider_id` is kept for the historical aggregate; refactor to method_type later. */}
                 <h3 className="text-sm font-semibold" >Topup Yöntem Dağılımı </h3>
               </div>
               <table className="w-full text-sm" >
                 <thead className="bg-muted/30 text-left" >
                    <tr>
                       <th className="px-4 py-3">Ödeme yöntemi</th>
                       <th className="px-4 py-3">İşlem Sayısı</th>
                       <th className="px-4 py-3">Brüt</th>
                       <th className="px-4 py-3">Net</th>
                       <th className="px-4 py-3">Maliyet</th>
                       <th className="px-4 py-3">Ort. Komisyon</th>
                    </tr>
                 </thead>
                 <tbody>
                    {Object.entries(provAgg).map(([pid, v]) => (
                       <tr key={pid} className="border-t">
                         <td className="px-4 py-3 font-medium" >{providers[pid] ?? "— bilinmeyen yöntem —"}</td>
                         <td className="px-4 py-3">{v.count}</td>
                         <td className="px-4 py-3">{fmtTRY(v.gross)}</td>
                         <td className="px-4 py-3">{fmtTRY(v.net)}</td>
                         <td className="px-4 py-3 text-destructive" >{fmtTRY(v.cost)}</td>
                         <td className="px-4 py-3">
                            {v.gross > 0 ? `${((v.cost / v.gross) * 100).toFixed(2)}%` : "—"}
                         </td>
                       </tr>
                    ))}
                    {Object.keys(provAgg).length === 0 && (
                       <tr><td colSpan={6} className="text-center text-muted-foreground py-12" >Veri yok</td></tr>
                    )}
                 </tbody>
               </table>
             </Card>
           </>
        )}
      </AdminLayout>
   );
}
