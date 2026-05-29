import MerchantLayout from "@/components/MerchantLayout";
import { useEffect, useState } from "react";
import { rpc } from "@/lib/rpc";
import { fetchMerchantSettlement } from "@/lib/merchant-self";
import { Card } from "@/components/ui/card";
import { fmtTRY, fmtDate, settlementReasonLabel } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, AlertCircle, Activity } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Self = {
  id: string;
  name: string;
  merchant_type: string;
  is_active: boolean;
  balance: number;
  credit_limit: number;
  available: number;
  outstanding: number;
  prepaid: number;
  cash_pool: number | null;
  cash_pool_updated_at: string | null;
  today_volume: number;
  today_tx_count: number;
  last_movement_at: string | null;
  merchant_scope?: "standalone" | "parent" | "child";
  child_count?: number;
};

export default function MerchantDashboard() {
  const [self, setSelf] = useState<Self | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recentMovements, setRecentMovements] = useState<any[]>([]);
  const [children, setChildren] = useState<any[]>([]);
  const [selectedMerchantId, setSelectedMerchantId] = useState("all");

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const s = await rpc<Self | Self[]>("merchant_self");
        const row = (Array.isArray(s) ? s[0] : s) ?? null;
        const childRows = row?.merchant_scope === "parent"
          ? await rpc<any[]>("merchant_self_children")
          : ([] as any[]);
        const childIds = ((childRows ?? []) as any[]).map((c) => c.id);
        if (row?.merchant_scope === "parent" && childIds.length === 0) {
          setRecentMovements([]);
          setSelf(row);
          setChildren((childRows ?? []) as any[]);
          return;
        }
        const { rows: l } = await fetchMerchantSettlement(selectedMerchantId, childIds, 10);
        setSelf(row);
        setChildren((childRows ?? []) as any[]);
        setRecentMovements(l ?? []);
      } catch (err: any) {
        setError(err?.message ?? "Dashboard yüklenemedi");
      } finally {
        setLoading(false);
      }
    })();
  }, [selectedMerchantId]);

  if (loading) return <MerchantLayout title="Dashboard"><div className="text-muted-foreground">Yükleniyor…</div></MerchantLayout>;
  if (error) return (
    <MerchantLayout title="Dashboard">
      <Card className="p-8 text-center">
        <AlertCircle className="size-10 mx-auto text-destructive mb-2" />
        <p className="text-sm font-medium">Dashboard yüklenemedi</p>
        <p className="text-xs text-muted-foreground mt-1">{error}</p>
      </Card>
    </MerchantLayout>
  );
  if (!self) return (
    <MerchantLayout title="Dashboard">
      <Card className="p-8 text-center">
        <AlertCircle className="size-10 mx-auto text-warning mb-2" />
        <p className="text-sm text-muted-foreground">Merchant erişiminiz tanımlı değil. Lütfen yöneticiyle görüşün.</p>
      </Card>
    </MerchantLayout>
  );

  // Merchant POV metinleri.
  //   balance >= 0: sistem bu merchant'a borçlu (merchant alacaklıdır) → "Hesabınızdaki bakiye"
  //   balance < 0: merchant credit_limit kullandığı için sisteme borçlu → "Açık borcunuz"
  const isCommerce = self.merchant_type === "commerce";
  const selectedChild = selectedMerchantId !== "all" ? children.find((c) => c.id === selectedMerchantId) : null;
  const statBalance = selectedChild ? Number(selectedChild.balance ?? 0) : Number(self.balance ?? 0);
  const statCreditLimit = selectedChild ? Number(selectedChild.credit_limit ?? 0) : Number(self.credit_limit ?? 0);
  const statTodayVolume = selectedChild ? Number(selectedChild.today_volume ?? 0) : Number(self.today_volume ?? 0);
  const statTodayTxCount = selectedChild ? Number(selectedChild.today_tx_count ?? 0) : Number(self.today_tx_count ?? 0);
  const statCashPool = Number(self.cash_pool ?? 0);
  return (
    <MerchantLayout title={self.name}>
      <div className="space-y-4">
        {self.merchant_scope === "parent" && (
          <Card className="p-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium">Bayi görünümü</div>
              <div className="text-xs text-muted-foreground">Parent hesabınız tüm bayileri aggregate görür; isterseniz tek bayi seçebilirsiniz.</div>
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
        {isCommerce ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat
              label="Hesap bakiyem"
              value={`${statBalance >= 0 ? "+" : "−"}${fmtTRY(Math.abs(statBalance))}`}
              sub={statBalance >= 0 ? "Tahsil edilebilir tutar" : "Açık borç durumu"}
              icon={statBalance >= 0 ? TrendingUp : TrendingDown}
              accent={statBalance >= 0 ? "text-success" : "text-destructive"}
            />
            <Stat label="Borç tavanı" value={fmtTRY(statCreditLimit)} sub="Kasa yetersizse devreye giren borç limiti" />
            <Stat label="Akış B max kapasite" value={fmtTRY(statBalance + statCreditLimit)} sub="Defter + borç tavanı (yalnızca Akış B)" />
            <Stat
              label="Ödeme bekleyen"
              value={fmtTRY(Math.max(0, -statBalance))}
              sub="Henüz ödenmemiş tutar"
              accent={statBalance < 0 ? "text-destructive" : ""}
            />
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat
              label="Kasa bakiyem"
              value={fmtTRY(statCashPool)}
              sub={self.cash_pool_updated_at ? `Son güncelleme: ${fmtDate(self.cash_pool_updated_at)}` : "Banka/kasa senkronu bekleniyor"}
              icon={statCashPool >= 0 ? TrendingUp : TrendingDown}
              accent={statCashPool < 0 ? "text-destructive" : "text-success"}
            />
            <Stat label="Bugünkü işlem hacmi" value={fmtTRY(statTodayVolume)} sub={`${statTodayTxCount} işlem`} icon={Activity} />
            <Stat label="İş yeri tipi" value="Finans" sub={self.is_active ? "Aktif" : "Pasif"} />
            <Stat label="Son hareket" value={self.last_movement_at ? fmtDate(self.last_movement_at) : "—"} sub="Kasa hareketi" />
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <Stat label="Bugünkü işlem hacmi" value={fmtTRY(statTodayVolume)} sub={`${statTodayTxCount} işlem`} icon={Activity} />
          {isCommerce && self.cash_pool != null && (
            <Stat
              label="Kendi kasamdaki nakit"
              value={fmtTRY(self.cash_pool)}
              sub={self.cash_pool_updated_at ? `Son güncelleme: ${fmtDate(self.cash_pool_updated_at)}` : "Bilinmiyor"}
            />
          )}
          <Stat
            label="İş yeri tipi"
            value={isCommerce ? "Ticari" : "Finans"}
            sub={self.is_active ? "Aktif" : "Pasif"}
          />
        </div>

        <Card className="overflow-hidden">
          <div className="p-3 border-b text-sm font-medium">{isCommerce ? "Hesap hareketlerim" : "Kasa hareketlerim"}</div>
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="text-left p-3">Tarih</th>
                <th className="text-left p-3">Sebep</th>
                <th className="text-right p-3">Hareket</th>
                <th className="text-right p-3">Sonra</th>
                <th className="text-left p-3">Not</th>
              </tr>
            </thead>
            <tbody>
              {recentMovements.length === 0 && (
                <tr><td colSpan={5} className="text-center py-6 text-muted-foreground">Henüz hareket yok.</td></tr>
              )}
              {recentMovements.map((r) => {
                const ch = Number(r.change_amount);
                return (
                  <tr key={r.id} className="border-t">
                    <td className="p-3 text-xs">{fmtDate(r.created_at)}</td>
                    {/* Use the localized label, not the raw enum string. */}
                    <td className="p-3"><Badge variant="outline">{settlementReasonLabel(r.reason)}</Badge></td>
                    <td className={`p-3 text-right tabular-nums font-medium ${ch === 0 ? "text-muted-foreground" : ch > 0 ? "text-success" : "text-destructive"}`}>
                      {ch === 0 ? "—" : (ch > 0 ? "+" : "−") + fmtTRY(Math.abs(ch))}
                    </td>
                    <td className="p-3 text-right tabular-nums">{fmtTRY(Number(r.balance_after))}</td>
                    <td className="p-3 text-xs text-muted-foreground max-w-[300px] truncate">{r.notes || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      </div>
    </MerchantLayout>
  );
}

function Stat({ label, value, sub, icon: Icon, accent }: { label: string; value: string; sub?: string; icon?: any; accent?: string }) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs uppercase text-muted-foreground tracking-wider">{label}</div>
          <div className={`text-xl font-semibold tabular-nums mt-1 ${accent ?? ""}`}>{value}</div>
          {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
        </div>
        {Icon && <Icon className={`size-5 ${accent ?? "text-muted-foreground"}`} />}
      </div>
    </Card>
  );
}
