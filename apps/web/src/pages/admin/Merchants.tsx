import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useCallback, useEffect, useMemo, useState } from "react";
import { rpc } from "@/lib/rpc";
import { dbSelect, dbUpdate, type WhereCondition } from "@/lib/db";
import { invokeFunction } from "@/lib/fn";
import AdminLayout from "@/components/AdminLayout" ;
import { Button } from "@/components/ui/button" ;
import { Input } from "@/components/ui/input" ;
import { Label } from "@/components/ui/label" ;
import { Textarea } from "@/components/ui/textarea" ;
import { Switch } from "@/components/ui/switch" ;
import {
  Dialog, DialogContent , DialogDescription , DialogFooter, DialogHeader, DialogTitle, DialogTrigger ,
} from "@/components/ui/dialog" ;
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table" ;
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs" ;
import { Badge } from "@/components/ui/badge" ;
import {
  Select, SelectContent , SelectItem, SelectTrigger , SelectValue,
} from "@/components/ui/select" ;
import { useAuth } from "@/hooks/useAuth" ;
import { Can } from "@/components/Can";
import { translateError } from "@/lib/i18n-errors" ;
import { toast } from "@/hooks/use-toast" ;
import { Plus, RefreshCw, AlertTriangle, ArrowDownLeft, ArrowUpRight, RotateCcw, Settings as SettingsIcon, Search, Store, PlugZap, Download } from "lucide-react";
import { fmtTRY, txTypeLabel } from "@/lib/format";
import { exportMerchantsCsv } from "@/lib/admin-merchants";
import { Card } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { Skeleton } from "@/components/ui/skeleton";
import { CopyButton } from "@/components/CopyButton" ;
import { errorCodeLabel } from "@/lib/bo-labels";
import { maskApiKey, sensitiveText } from "@/lib/mask";

export type MerchantType = "finance" | "commerce";

export type Merchant = {
   id: string;
   name: string;
   api_key?: string | null;
   is_active: boolean;
   ip_whitelist : string[];
   daily_limit: number | null;
   per_tx_limit : number | null;
   notes: string | null;
   created_at: string;
   merchant_type : MerchantType;
   commission_pct : number;
   fixed_fee: number;
   commission_direction : "pay" | "earn";
   // finance merchant min-max amount limits
   deposit_min_amount?: number | null;
   deposit_max_amount?: number | null;
   withdraw_min_amount?: number | null;
   withdraw_max_amount?: number | null;
   merchant_scope?: "standalone" | "parent" | "child";
   parent_merchant_id?: string | null;
   external_sub_merchant_ref?: string | null;
   child_count?: number | null;
   balance?: number | null;
   credit_limit?: number | null;
   cash_pool?: number | null;
   cash_pool_updated_at?: string | null;
   deposit_commission_pct?: number | null;
   withdraw_commission_pct?: number | null;
};

// 01/MM-03: refund kaldırıldı; commerce'ta charge + credit_member,
// finance'ta yatırma + çekme. Türkçe label'lar.
export const TYPE_INFO: Record<MerchantType, { label: string; endpoints: string; badgeClass: string }> = {
   finance: {
     label: "Finans",
     endpoints: "Yatırma / Çekme" ,
     badgeClass : "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30" ,
   },
   commerce: {
     label: "Ticaret",
     endpoints: "Ödeme / Cüzdana Giriş" ,
     badgeClass : "bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/30" ,
   },
};

export type ApiCall = {
   id: string;
   endpoint: string;
   method: string;
   ip: string | null;
   status_code: number | null;
   error_code: string | null;
   latency_ms: number | null;
   created_at: string;
   request_body : any;
   response_body : any;
};

export type LedgerTx = {
   id: string;
   user_id: string;
   type: string;
   amount: number;
   status: string;
   description: string | null;
   created_at: string;
   metadata: any;
   profile?: { first_name: string; last_name: string; member_no: string } | null;
};

export type RangeKey = "today" | "7d" | "30d" | "all";

function isCashPoolStale(updatedAt: string | null | undefined): boolean {
  if (!updatedAt) return true;
  const ts = new Date(updatedAt).getTime();
  if (Number.isNaN(ts)) return true;
  return Date.now() - ts > 24 * 60 * 60 * 1000;
}

export default function AdminMerchants () {
  const { can } = useAuth();
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  const filterType = (searchParams.get("type") as MerchantType | null) || null;
  const isCommerceList = filterType === "commerce";
  const isFinanceList = filterType === "finance";
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  const [createOpen, setCreateOpen] = useState(false);
  const [secretReveal, setSecretReveal] = useState<{ apiKey: string; apiSecret: string } | null>(null);
  const [editCommission, setEditCommission] = useState<Merchant | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const where: WhereCondition[] = [];
    if (filterType) where.push({ col: "merchant_type", op: "eq", val: filterType });
    if (isCommerceList) where.push({ col: "merchant_scope", op: "in", val: ["parent", "standalone"] });
    if (isFinanceList) where.push({ col: "merchant_scope", op: "eq", val: "standalone" });
    try {
      const list = await dbSelect<Merchant>("merchants", {
        cols: "id, name, is_active, api_key, ip_whitelist, daily_limit, per_tx_limit, notes, created_at, merchant_type, commission_pct, fixed_fee, commission_direction, deposit_min_amount, deposit_max_amount, withdraw_min_amount, withdraw_max_amount, merchant_scope, parent_merchant_id, external_sub_merchant_ref, balance, credit_limit, cash_pool, cash_pool_updated_at, deposit_commission_pct, withdraw_commission_pct",
        where,
        order: { col: "created_at", asc: false },
      });

      let childCountByParent = new Map<string, number>();
      if (isCommerceList && list.some((m) => m.merchant_scope === "parent")) {
        const childRows = await dbSelect<{ parent_merchant_id: string | null }>("merchants", {
          cols: "parent_merchant_id",
          where: [
            { col: "merchant_type", op: "eq", val: "commerce" },
            { col: "merchant_scope", op: "eq", val: "child" },
          ],
        }).catch(() => [] as Array<{ parent_merchant_id: string | null }>);
        childCountByParent = childRows.reduce<Map<string, number>>((map, row) => {
          const pid = row.parent_merchant_id;
          if (pid) map.set(pid, (map.get(pid) ?? 0) + 1);
          return map;
        }, new Map<string, number>());
      }

      setMerchants(
        list.map((m) => ({
          ...m,
          child_count: m.merchant_scope === "parent" ? childCountByParent.get(m.id) ?? 0 : null,
        })),
      );
    } catch (err) {
      toast({ title: translateError(err), variant: "destructive" as const });
      setMerchants([]);
    } finally {
      setLoading(false);
    }
  }, [filterType, isCommerceList, isFinanceList]);

  useEffect(() => { void load(); }, [load]);

  const filteredMerchants = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return merchants;
    return merchants.filter((m) => {
      const haystack = [m.name, m.api_key ?? "", m.merchant_scope ?? "", m.notes ?? ""].join(" ").toLowerCase();
      return haystack.includes(q);
    });
  }, [merchants, searchQuery]);

  const listStats = useMemo(() => {
    const rows = filteredMerchants;
    const active = rows.filter((m) => m.is_active).length;
    const base = { total: rows.length, active, passive: rows.length - active };
    if (isCommerceList) {
      return {
        ...base,
        extraLabel: "Toplam settlement",
        extraValue: fmtTRY(rows.reduce((s, m) => s + Number(m.balance ?? 0), 0)),
        extra2Label: "Parent merchant",
        extra2Value: String(rows.filter((m) => m.merchant_scope === "parent").length),
      };
    }
    if (isFinanceList) {
      return {
        ...base,
        extraLabel: "Toplam kasa",
        extraValue: fmtTRY(rows.reduce((s, m) => s + Number(m.cash_pool ?? 0), 0)),
        extra2Label: "Kasa eski",
        extra2Value: String(rows.filter((m) => isCashPoolStale(m.cash_pool_updated_at)).length),
        extra2Accent: true as const,
      };
    }
    return base;
  }, [filteredMerchants, isCommerceList, isFinanceList]);

  const canViewApiCredentials = can("merchants", "api_credentials");

async function toggleActive(m: Merchant) {
  try {
    await dbUpdate("merchants", { is_active: !m.is_active }, { id: m.id });
    toast({ title: m.is_active ? "Pasifleştirildi" : "Aktifleştirildi" });
    load();
  } catch (err) {
    toast({ title: translateError(err), variant: "destructive" as any });
  }
}

async function rotateSecret(m: Merchant) {
  if (!confirm(`${m.name} için yeni secret üretilsin mi? Eski secret çalışmayacak.` )) return;
  try {
    const data = await invokeFunction<{ api_secret?: string; error?: string }>("admin-merchant-secret", {
      action: "rotate",
      merchant_id: m.id,
    });
    if (data?.error) throw new Error(data.error);
    const apiSecret = data?.api_secret;
    if (apiSecret) setSecretReveal({ apiKey: m.api_key ?? "", apiSecret });
  } catch (err) {
    toast({ title: translateError(err), variant: "destructive" as any });
  }
}

// başlık ve alt yazı tip filtresine göre değişir
const pageTitle = filterType === "commerce"
  ? "Ticari Merchant'lar"
  : filterType === "finance"
  ? "Finans Merchant'lar"
  : "Merchant'lar";
const pageSubtitle = filterType === "commerce"
  ? "Ticari çatı merchant'lar (parent/standalone). Bayi operasyonu için Bayiler menüsünü kullanın."
  : filterType === "finance"
  ? "Finans merchant'lar (standalone). Akış C/D entegrasyon durumu için Finance Entegrasyon panelini kullanın."
  : "API ile sisteme bağlanan iş yerleri ve muhasebeleri";

const colCount = isCommerceList ? 9 : isFinanceList ? 8 : filterType ? 7 : 8;

return (
  <AdminLayout title={pageTitle} requireAny={["merchants:view_full", "merchants:view_masked"]}>
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 mb-4">
      <MerchantListStatCard label="Listede" value={String(listStats.total)} loading={loading} />
      <MerchantListStatCard label="Aktif" value={String(listStats.active)} loading={loading} />
      <MerchantListStatCard
        label="Pasif"
        value={String(listStats.passive)}
        loading={loading}
        accent={listStats.passive > 0 ? "destructive" : undefined}
      />
      <MerchantListStatCard
        label={"extraLabel" in listStats && listStats.extraLabel ? listStats.extraLabel : "Görünüm"}
        value={"extraValue" in listStats && listStats.extraValue ? listStats.extraValue : (searchQuery.trim() ? "Filtreli" : "Tümü")}
        loading={loading}
        accent={
          isFinanceList && "extra2Value" in listStats && Number(listStats.extra2Value) > 0
            ? "warning"
            : undefined
        }
      />
    </div>
    {(isCommerceList || isFinanceList) && "extra2Label" in listStats && listStats.extra2Label && (
      <p className="text-xs text-muted-foreground -mt-2 mb-3">
        {listStats.extra2Label}:{" "}
        <span
          className={`font-medium tabular-nums ${
            isFinanceList && Number(listStats.extra2Value) > 0 ? "text-warning" : ""
          }`}
        >
          {listStats.extra2Value}
        </span>
      </p>
    )}

    <div className="flex items-center justify-between mb-4">
       <p className="text-sm text-muted-foreground">{pageSubtitle}</p>
       <div className="flex flex-wrap items-center gap-2 shrink-0">
         {isCommerceList && (
           <Button variant="outline" size="sm" asChild>
             <Link to="/admin/merchant-children"><Store className="size-4 mr-1" /> Bayiler</Link>
           </Button>
         )}
         {isFinanceList && (
           <Button variant="outline" size="sm" asChild>
             <Link to="/admin/finance-integrations"><PlugZap className="size-4 mr-1" /> Entegrasyonlar</Link>
           </Button>
         )}
         <Can do="merchants:update">
           <Dialog open={createOpen} onOpenChange={setCreateOpen}>
             <DialogTrigger asChild>
               <Button><Plus className="size-4 mr-1" /> Yeni Merchant</Button>
             </DialogTrigger>
             <CreateMerchantDialog
               defaultType={filterType ?? undefined}
               onCreated={(creds) => {
                 setCreateOpen(false);
                 setSecretReveal(creds);
                 void load();
               }}
             />
           </Dialog>
         </Can>
       </div>
    </div>

    <div className="flex flex-col sm:flex-row gap-2 mb-3">
      <div className="relative flex-1 max-w-md">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={
            isCommerceList ? "Ara: merchant adı, API key…"
            : isFinanceList ? "Ara: merchant adı, API key, not…"
            : "Ara: merchant adı…"
          }
          className="pl-9 h-9"
        />
      </div>
      <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
        <RefreshCw className={`size-4 mr-1 ${loading ? "animate-spin" : ""}`} />
        Yenile
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() =>
          exportMerchantsCsv(
            filteredMerchants,
            { filterType, showApiKey: canViewApiCredentials },
            filterType ? `merchants-${filterType}` : "merchants",
          )
        }
        disabled={filteredMerchants.length === 0}
      >
        <Download className="size-4 mr-1" />
        CSV
      </Button>
    </div>

    <div className="rounded-xl border bg-card overflow-hidden">
       <Table>
         <TableHeader>
            <TableRow>
               <TableHead>Ad</TableHead>
               {!filterType && <TableHead>Tip</TableHead>}
               {isCommerceList && <TableHead>Kapsam</TableHead>}
               {isCommerceList && <TableHead>Settlement</TableHead>}
               {isCommerceList && <TableHead>Bayi</TableHead>}
               {isFinanceList && <TableHead>Kasa</TableHead>}
               <TableHead>API Key</TableHead>
               <TableHead>Komisyon</TableHead>
               {isFinanceList && <TableHead>Limitler</TableHead>}
               {!filterType && <TableHead>Limitler</TableHead>}
               <TableHead>IP Whitelist</TableHead>
               <TableHead>Durum</TableHead>
               <TableHead className="text-right">Aksiyonlar</TableHead>
            </TableRow>
         </TableHeader>
         <TableBody>
            {loading ? (
               <TableRow><TableCell colSpan={colCount} className="text-center py-6 text-muted-foreground">Yükleniyor...</TableCell></TableRow>
            ) : filteredMerchants.length === 0 ? (
               <TableRow><TableCell colSpan={colCount} className="text-center py-6 text-muted-foreground">
                 {merchants.length === 0 ? "Henüz merchant yok" : "Filtreyle eşleşen kayıt yok"}
               </TableCell></TableRow>
            ) : filteredMerchants.map((m) => {
               const info = TYPE_INFO[m.merchant_type] ?? TYPE_INFO.commerce;
               // YENİ YÖN: commerce = earn (gelir), finance = pay (maliyet)
               const isEarn = m.commission_direction === "earn";
           const commerceParent = m.merchant_type === "commerce" && m.merchant_scope !== "child";
           const sign = isEarn ? "+" : "−";
           const toneClass = isEarn ? "text-success" : "text-destructive" ;
           // pasif merchant satırları full kırmızı + üstü çizik
           const rowClass = m.is_active
             ? "cursor-pointer hover:bg-muted/40"
             : "cursor-pointer hover:bg-destructive/15 bg-destructive/10 text-destructive/80";
           return (
           <TableRow key={m.id} className={rowClass} onClick={() => nav(`/admin/merchants/${m.id}${filterType ? `?type=${filterType}` : ""}`)}>
              <TableCell className="font-medium">
                {!m.is_active && <span className="text-[10px] uppercase mr-1 px-1.5 py-0.5 rounded bg-destructive text-destructive-foreground font-bold">Pasif</span>}
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span>{m.name}</span>
                    {m.merchant_scope === "parent" && <Badge variant="secondary" className="text-[10px]">Parent</Badge>}
                    {m.merchant_scope === "child" && <Badge variant="outline" className="text-[10px]">Bayi</Badge>}
                  </div>
                  {m.merchant_scope === "child" && (
                    <div className="text-[10px] text-muted-foreground font-mono">
                      Parent: {m.parent_merchant_id?.slice(0, 8)} · Ref: {m.external_sub_merchant_ref}
                    </div>
                  )}
                </div>
              </TableCell>
              {!filterType && (
              <TableCell>
                <div className="flex flex-col gap-0.5">
                   <Badge variant="outline" className={info.badgeClass}>{info.label}</Badge>
                   <span className="text-[10px] text-muted-foreground font-mono">{info.endpoints}</span>
                </div>
              </TableCell>
              )}
              {isCommerceList && (
                <TableCell className="text-xs">
                  {m.merchant_scope === "parent" ? "Parent" : "Standalone"}
                </TableCell>
              )}
              {isCommerceList && (
                <TableCell className={`text-xs tabular-nums ${Number(m.balance ?? 0) >= 0 ? "text-success" : "text-destructive"}`}>
                  {fmtTRY(Number(m.balance ?? 0))}
                </TableCell>
              )}
              {isCommerceList && (
                <TableCell className="text-xs">
                  {m.merchant_scope === "parent" ? (
                    <Link
                      to="/admin/merchant-children"
                      className="text-primary hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {m.child_count ?? 0} bayi
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
              )}
              {isFinanceList && (
                <TableCell className="text-xs">
                  <div className={`tabular-nums font-medium ${Number(m.cash_pool ?? 0) >= 0 ? "text-success" : "text-destructive"}`}>
                    {fmtTRY(Number(m.cash_pool ?? 0))}
                  </div>
                  {isCashPoolStale(m.cash_pool_updated_at) ? (
                    <div className="text-[10px] text-warning flex items-center gap-0.5 mt-0.5">
                      <AlertTriangle className="size-3" /> Kasa eski
                    </div>
                  ) : m.cash_pool_updated_at ? (
                    <div className="text-[10px] text-muted-foreground mt-0.5">Güncel</div>
                  ) : null}
                </TableCell>
              )}
              <TableCell className="font-mono text-xs">
                {sensitiveText(can, "merchants", "api_credentials", m.api_key ?? "", maskApiKey)}
              </TableCell>
              <TableCell className={`text-xs font-medium ${commerceParent ? "text-muted-foreground" : toneClass}`}>
                {commerceParent ? (
                  <div>Bayi bazlı</div>
                ) : isFinanceList ? (
                  <>
                    <div>-%{Number(m.deposit_commission_pct ?? m.commission_pct ?? 0).toFixed(2)} yatırma</div>
                    <div>-%{Number(m.withdraw_commission_pct ?? m.commission_pct ?? 0).toFixed(2)} çekim</div>
                    <div className="text-[10px] text-muted-foreground font-normal">maliyet</div>
                  </>
                ) : (
                  <>
                    <div>{sign}%{Number(m.commission_pct).toFixed(2)}</div>
                    {Number(m.fixed_fee) > 0 && <div className="text-[10px]">{sign}{fmtTRY(m.fixed_fee)}</div>}
                    <div className="text-[10px] text-muted-foreground font-normal" >
                       {isEarn ? "kazanç" : "maliyet"}
                    </div>
                  </>
                )}
              </TableCell>
              {(isFinanceList || !filterType) && (
              <TableCell className="text-xs">
                {commerceParent && <span className="text-muted-foreground">Bayi bazlı</span>}
                {!commerceParent && m.per_tx_limit != null && <div>İşlem: {fmtTRY(m.per_tx_limit)}</div>}
                {!commerceParent && m.daily_limit != null && <div>Günlük: {fmtTRY(m.daily_limit)}</div>}
                {/* finance min-max */}
                {m.merchant_type === "finance" && (m.deposit_min_amount != null || m.deposit_max_amount != null) && (
                  <div className="text-[10px] text-muted-foreground">
                    Yatırma: {m.deposit_min_amount != null ? fmtTRY(m.deposit_min_amount) : "0"} – {m.deposit_max_amount != null ? fmtTRY(m.deposit_max_amount) : "∞"}
                  </div>
                )}
                {m.merchant_type === "finance" && (m.withdraw_min_amount != null || m.withdraw_max_amount != null) && (
                  <div className="text-[10px] text-muted-foreground">
                    Çekim: {m.withdraw_min_amount != null ? fmtTRY(m.withdraw_min_amount) : "0"} – {m.withdraw_max_amount != null ? fmtTRY(m.withdraw_max_amount) : "∞"}
                  </div>
                )}
                {!commerceParent && m.per_tx_limit == null && m.daily_limit == null && m.deposit_min_amount == null && m.deposit_max_amount == null && m.withdraw_min_amount == null && m.withdraw_max_amount == null && <span className="text-muted-foreground">—</span>}
              </TableCell>
              )}
              <TableCell className="text-xs">
                {m.ip_whitelist.length === 0 ? (
                   <span className="text-muted-foreground" >Tümü</span>
                ) : (
                   <span>{m.ip_whitelist.length} IP</span>
                )}
              </TableCell>
              <TableCell onClick={(e) => e.stopPropagation()}>
                <Can do="merchants:update">
                  <Switch checked={m.is_active} onCheckedChange={() => toggleActive(m)} />
                </Can>
              </TableCell>
              <TableCell className="text-right space-x-1" onClick={(e) => e.stopPropagation()}>
                <Can do="merchants:update">
                  {!commerceParent && (
                    <Button size="sm" variant="ghost" onClick={() => setEditCommission(m)} title="Komisyon ayarları">
                       <SettingsIcon className="size-4" />
                    </Button>
                  )}
                </Can>
                <Can do="merchants:rotate_secret">
                  {m.merchant_scope !== "child" && (
                    <Button size="sm" variant="ghost" onClick={() => rotateSecret(m)} title="Secret yenile">
                       <RefreshCw className="size-4" />
                    </Button>
                  )}
                </Can>
              </TableCell>
           </TableRow>
           );
        })}
     </TableBody>
   </Table>
</div>

{/* Edit commission dialog */ }
<Dialog open={!!editCommission } onOpenChange={(o) => !o && setEditCommission (null)}>
   <DialogContent>
     {editCommission && (
        <EditCommissionDialog
           merchant={editCommission }
           onSaved={() => { setEditCommission (null); load(); }}
        />
     )}
   </DialogContent>
</Dialog>

{/* Secret reveal dialog */ }
<Dialog open={!!secretReveal} onOpenChange={(o) => !o && setSecretReveal (null)}>
   <DialogContent>
     <DialogHeader>
        <DialogTitle className="flex items-center gap-2" >
           <AlertTriangle className="size-5 text-destructive" />
          API Bilgileri
        </DialogTitle>
        <DialogDescription >
           <strong>Bu secret bir daha gösterilmez .</strong> Hemen güvenli bir yere kaydedin .
        </DialogDescription >
     </DialogHeader>
     {secretReveal && (
        <div className="space-y-3">
           <div>
              <Label>API Key</Label>
              <div className="flex gap-2 mt-1 items-center" >
                <Input readOnly value={secretReveal.apiKey} className="font-mono text-xs" />
                <CopyButton value={secretReveal.apiKey} size="md" label="API Key kopyala" />
              </div>
           </div>
           <div>
              <Label>API Secret</Label>
              <div className="flex gap-2 mt-1 items-center" >
                <Input readOnly value={secretReveal.apiSecret} className="font-mono text-xs" />
                <CopyButton value={secretReveal.apiSecret} size="md" label="API Secret kopyala" />
              </div>
           </div>
        </div>
            )}
            <DialogFooter>
               <Button onClick={() => setSecretReveal (null)}>Kaydettim, kapat</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

      </AdminLayout>
   );
}

/* ---------------- Detail panel ---------------- */

export function MerchantDetail({ merchant }: { merchant: Merchant }) {
   return (
      <Tabs defaultValue="summary" className="w-full">
        <TabsList className="w-full grid grid-cols-3">
          <TabsTrigger value="summary">Özet</TabsTrigger>
          <TabsTrigger value="ledger">Hareketler</TabsTrigger>
          <TabsTrigger value="api">API Çağrıları</TabsTrigger>
        </TabsList>

        <TabsContent value="summary" className="pt-4">
          <SummaryTab merchant={merchant} />
        </TabsContent>
        <TabsContent value="ledger" className="pt-4">
          <LedgerTab merchant={merchant} />
        </TabsContent>
        <TabsContent value="api" className="pt-4">
          <ApiCallsTab merchant={merchant} />
        </TabsContent>
      </Tabs>
   );
}

export function rangeStart(range: RangeKey): string | null {
   const now = new Date();
   if (range === "today") {
      const d = new Date(now); d.setHours(0, 0, 0, 0); return d.toISOString();
   }
   if (range === "7d") {
      const d = new Date(now); d.setDate(d.getDate() - 7); return d.toISOString();
   }
   if (range === "30d") {
      const d = new Date(now); d.setDate(d.getDate() - 30); return d.toISOString();
   }
   return null;
}

async function merchantQueryIds(merchant: Merchant): Promise<string[]> {
   if (merchant.merchant_scope !== "parent") return [merchant.id];
   try {
     const data = await rpc<Array<{ id: string }>>("admin_merchant_children", { _parent_merchant_id: merchant.id });
     const childIds = (data ?? []).map((r) => r.id);
     return childIds.length ? childIds : [merchant.id];
   } catch (err) {
     toast({ title: translateError(err), variant: "destructive" as any });
     return [merchant.id];
   }
}

export function SummaryTab({ merchant }: { merchant: Merchant }) {
   const { can } = useAuth();
   const isFinance = merchant.merchant_type === "finance";
   const [range, setRange] = useState<RangeKey>("30d");
   const [loading, setLoading] = useState(true);
   const [agg, setAgg] = useState({
      inflow: 0,
      outflow: 0,
      merchantCredit: 0,
      withdraw: 0,
      countDeposit: 0,
      countSpend: 0,
      countMerchantCredit: 0,
      countWithdraw: 0,
      platformAmount: 0, // toplam platform geliri (Tip 2) veya maliyeti (Tip 1)
   });

   useEffect(() => {
      (async () => {
        setLoading(true);
        try {
          const merchantIds = await merchantQueryIds(merchant);
          const where: WhereCondition[] = [
            { col: "metadata->>merchant_id", op: "in", val: merchantIds },
          ];
          const start = rangeStart(range);
          if (start) where.push({ col: "created_at", op: "gte", val: start });
          const data = await dbSelect<{ type: string; amount: number; status: string; fee: number; metadata: any }>("transactions", {
            cols: "type, amount, status, fee, metadata",
            where,
            limit: 500, // /from shim hard cap (from.routes FromBody.limit.max)
          });
          const a = { inflow: 0, outflow: 0, merchantCredit: 0, withdraw: 0, countDeposit: 0, countSpend: 0, countMerchantCredit: 0, countWithdraw: 0, platformAmount: 0 };
          data.forEach((t: any) => {
      const amt = Number(t.amount) || 0;
      const fee = Number(t.fee) || 0;
      const metaPlatform =
         Number(t.metadata?.platform_revenue ?? t.metadata?.platform_cost ?? 0) || 0;
      const platformVal = metaPlatform > 0 ? metaPlatform : fee;
      if (((isFinance && t.type === "topup") || (!isFinance && t.type === "merchant_deposit")) && t.status === "completed") {
         a.inflow += amt; a.countDeposit++;
         a.platformAmount += platformVal;
      } else if (t.type === "spend" && t.status === "completed") {
         a.outflow += amt; a.countSpend++;
         a.platformAmount += platformVal;
      } else if (t.type === "merchant_credit" && t.status === "completed") {
         a.merchantCredit += amt; a.countMerchantCredit++;
         a.platformAmount += platformVal;
      } else if (t.type === "merchant_withdraw" && t.status === "completed") {
         a.withdraw += amt; a.countWithdraw++;
         a.platformAmount += platformVal;
      }
    });
          setAgg(a);
        } catch (err) {
          toast({ title: translateError(err), variant: "destructive" as any });
        } finally {
          setLoading(false);
        }
      })();
   }, [merchant.id, merchant.merchant_scope, range, isFinance]);

// YENİ YÖN: commerce → sistem KAZANIR, finance → sistem ÖDER
const isEarn = merchant.commission_direction === "earn";
// finance: Net = yatırma − çekim (merchant lehine: pozitif = üyelere net para verdi)
// commerce: Net = tahsilat − cüzdana giriş (Akış B)
const net = isFinance ? agg.inflow - agg.withdraw : agg.outflow - agg.merchantCredit;
const netLabel = isFinance ? "Net (yatırma − çekim)" : "Net (tahsilat − cüzdana giriş)";
const netHint = isFinance
  ? "Net > 0: merchant üyelere net olarak para gönderdi. Net < 0: merchant üyelerden net çekim yaptı."
  : "Net > 0: merchant üyelerden net tahsilat yaptı. Net < 0: cüzdana giriş tahsilatı aştı.";

return (
  <div className="space-y-4">
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-3 text-xs">
         <Badge variant="outline" className={TYPE_INFO[merchant.merchant_type].badgeClass}>
           {TYPE_INFO[merchant.merchant_type].label} Merchant
         </Badge>
         <span className="text-muted-foreground">
           API Key:{" "}
           <span className="font-mono">
             {sensitiveText(can, "merchants", "api_credentials", merchant.api_key ?? "", maskApiKey)}
           </span>
         </span>
      </div>
      <Select value={range} onValueChange={(v) => setRange(v as RangeKey)}>
         <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
         <SelectContent>
           <SelectItem value="today">Bugün</SelectItem>
           <SelectItem value="7d">Son 7 gün</SelectItem>
           <SelectItem value="30d">Son 30 gün</SelectItem>
           <SelectItem value="all">Tümü</SelectItem>
         </SelectContent>
      </Select>
    </div>

    {loading ? (
      <div className="text-center py-8 text-muted-foreground text-sm">Yükleniyor...</div>
    ) : (
      <>
         <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
           {isFinance ? (
             <>
                <SummaryCard
                   label="Yatırma (üyeye giren)"
                   value={fmtTRY(agg.inflow)}
                   sub={`${agg.countDeposit} işlem`}
                   icon={<ArrowDownLeft className="size-4 text-success" />}
                   tone="success"
                />
                <SummaryCard
                   label="Çekim (üyeden çıkan)"
                   value={fmtTRY(agg.withdraw)}
                   sub={`${agg.countWithdraw} işlem`}
                   icon={<ArrowUpRight className="size-4 text-destructive" />}
                   tone="destructive"
                />
             </>
           ) : (
             <>
                <SummaryCard
                   label="Tahsilat (üyeden)"
                   value={fmtTRY(agg.outflow)}
                   sub={`${agg.countSpend} işlem`}
                   icon={<ArrowUpRight className="size-4 text-destructive" />}
                   tone="destructive"
                />
                <SummaryCard
                   label="Cüzdana giriş (Akış B)"
                   value={fmtTRY(agg.merchantCredit)}
                   sub={`${agg.countMerchantCredit} işlem`}
                   icon={<RotateCcw className="size-4 text-warning" />}
                   tone="warning"
                    />
                  </>
               )}
               <SummaryCard
                  label={netLabel}
                  value={fmtTRY(net)}
                  sub="merchant lehine"
                  tone={net >= 0 ? "success" : "destructive"}
               />
               <SummaryCard
                  label={isEarn ? "Platform Geliri" : "Platform Maliyeti"}
                  value={`${isEarn ? "+" : "−"}${fmtTRY(agg.platformAmount)}`}
                  sub={
                    isFinance
                      ? `Yatır %${Number(merchant.deposit_commission_pct ?? merchant.commission_pct ?? 0).toFixed(2)} · Çekim %${Number(merchant.withdraw_commission_pct ?? merchant.commission_pct ?? 0).toFixed(2)}`
                      : `%${Number(merchant.commission_pct).toFixed(2)}${Number(merchant.fixed_fee) > 0 ? ` + ${fmtTRY(merchant.fixed_fee)}/işlem` : ""}`
                  }
                  tone={isEarn ? "success" : "destructive"}
                  icon={isEarn ? <ArrowDownLeft className="size-4 text-success" /> : <ArrowUpRight className="size-4 text-destructive" />}
               />
             </div>
             <div className="text-xs text-muted-foreground">{netHint}</div>
           </>
        )}
      </div>
   );
}

function SummaryCard({
   label, value, sub, icon, tone,
}: {
   label: string; value: string; sub?: string; icon?: React.ReactNode;
   tone?: "success" | "destructive" | "warning" | "neutral";
}) {
   const toneClass =
      tone === "success" ? "text-success"
      : tone === "destructive" ? "text-destructive"
      : tone === "warning" ? "text-warning"
      : "text-foreground";
   return (
      <div className="rounded-xl border bg-card p-4">
        <div className="flex items-center justify-between mb-2">
           <div className="text-xs text-muted-foreground">{label}</div>
           {icon}
        </div>
        <div className={`text-lg font-semibold tabular-nums ${toneClass}`}>{value}</div>
        {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
      </div>
   );
}

/* ---------------- Ledger ---------------- */

export function LedgerTab({ merchant }: { merchant: Merchant }) {
   const [filter, setFilter] = useState<"all" | "spend" | "merchant_credit" | "merchant_deposit" | "merchant_withdraw" | "topup">("all");
   const [rows, setRows] = useState<LedgerTx[]>([]);
   const [loading, setLoading] = useState(false);
   const [hasMore, setHasMore] = useState(true);
   const [cursor, setCursor] = useState<string | null>(null);
   const PAGE = 50;

   const load = async (reset: boolean) => {
      setLoading(true);
      try {
        const merchantIds = await merchantQueryIds(merchant);
        const where: WhereCondition[] = [
          { col: "metadata->>merchant_id", op: "in", val: merchantIds },
        ];
        if (filter !== "all") where.push({ col: "type", op: "eq", val: filter });
        const c = reset ? null : cursor;
        if (c) where.push({ col: "created_at", op: "lt", val: c });
        const txs = await dbSelect<LedgerTx>("transactions", {
          cols: "id, user_id, type, amount, status, description, created_at, metadata",
          where,
          order: { col: "created_at", asc: false },
          limit: PAGE,
        });
        const ids = Array.from(new Set(txs.map((t) => t.user_id)));
        const profs = ids.length
          ? await dbSelect<{ id: string; first_name: string; last_name: string; member_no: string }>("profiles", {
              cols: "id, first_name, last_name, member_no",
              where: [{ col: "id", op: "in", val: ids }],
            }).catch(() => [])
          : [];
        const pm = new Map(profs.map((p) => [p.id, p]));
        const merged = txs.map((t) => ({ ...t, profile: pm.get(t.user_id) ?? null }));
        setHasMore(txs.length === PAGE);
        if (txs.length > 0) setCursor(txs[txs.length - 1].created_at);
        setRows((prev) => (reset ? merged : [...prev, ...merged]));
      } catch (err) {
        toast({ title: translateError(err), variant: "destructive" as any });
      } finally {
        setLoading(false);
      }
   };

   useEffect(() => {
      setCursor(null);
      setRows([]);
      setHasMore(true);
  load(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [filter, merchant.id, merchant.merchant_scope]);

const isFinance = merchant.merchant_type === "finance";

const balance = useMemo(() => {
  // Running display: not strictly per-row since we paginate, but show subtotal per loaded set
  let inflow = 0, outflow = 0, merchantCredit = 0, withdraw = 0;
  rows.forEach((t) => {
    if (t.status !== "completed") return;
    const a = Number(t.amount) || 0;
    if ((isFinance && t.type === "topup") || (!isFinance && t.type === "merchant_deposit")) inflow += a;
    else if (t.type === "spend") outflow += a;
    else if (t.type === "merchant_credit") merchantCredit += a;
    else if (t.type === "merchant_withdraw") withdraw += a;
  });
  return { inflow, outflow, merchantCredit, withdraw, net: inflow - outflow - merchantCredit - withdraw };
}, [rows, isFinance]);

return (
  <div className="space-y-3">
    <div className="flex items-center justify-between flex-wrap gap-2">
      <Select value={filter} onValueChange={(v) => setFilter(v as any)}>
         <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
         <SelectContent>
            <SelectItem value="all">Tüm hareketler</SelectItem>
            {isFinance ? (
               <>
                  <SelectItem value="topup">Para yatırma (Akış C)</SelectItem>
                  <SelectItem value="merchant_withdraw">Para çekme (Akış D)</SelectItem>
               </>
            ) : (
               <>
                  <SelectItem value="spend">Tahsilat (spend)</SelectItem>
                  <SelectItem value="merchant_credit">Cüzdana giriş (Akış B)</SelectItem>
               </>
            )}
         </SelectContent>
      </Select>
      <div className="text-xs text-muted-foreground tabular-nums">
         {isFinance ? (
            <>
               Yatırma: <span className="text-success">+{fmtTRY(balance.inflow)}</span>
               {" · Çekim: "}
               <span className="text-destructive">−{fmtTRY(balance.withdraw)}</span>
               {" · Net "}
               <span className={(balance.inflow - balance.withdraw) >= 0 ? "text-success" : "text-destructive"}>{fmtTRY(balance.inflow - balance.withdraw)}</span>
            </>
         ) : (
            <>
               Tahsilat: <span className="text-destructive">−{fmtTRY(balance.outflow)}</span>
               {" · Cüzdana giriş: "}
               <span className="text-warning">{fmtTRY(balance.merchantCredit)}</span>
               {" · Net "}
               <span className={(balance.outflow - balance.merchantCredit) >= 0 ? "text-success" : "text-destructive"}>{fmtTRY(balance.outflow - balance.merchantCredit)}</span>
            </>
         )}
      </div>
    </div>

    <div className="rounded-lg border max-h-[420px] overflow-auto">
      <Table>
         <TableHeader className="sticky top-0 bg-muted/80 backdrop-blur">
            <TableRow>
               <TableHead>Tarih</TableHead>
               <TableHead>Tip</TableHead>
               <TableHead>Üye</TableHead>
               <TableHead className="text-right">Tutar</TableHead>
               <TableHead>Açıklama</TableHead>
            </TableRow>
         </TableHeader>
         <TableBody>
            {rows.length === 0 && !loading ? (
               <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground">Hareket yok</TableCell></TableRow>
            ) : rows.map((t) => {
               const isInflow = isFinance ? t.type === "topup" : t.type === "merchant_deposit";
               return (
                  <TableRow key={t.id}>
                    <TableCell className="text-xs whitespace-nowrap">{new Date(t.created_at).toLocaleString("tr-TR")}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{txTypeLabel(t.type)}</Badge>
                    </TableCell>
                    <TableCell className="text-xs">
                      <div className="font-medium">{t.profile?.first_name} {t.profile?.last_name}</div>
                      <div className="font-mono text-muted-foreground">{t.profile?.member_no ?? "?"}</div>
                    </TableCell>
                    <TableCell className={`text-right tabular-nums font-medium ${isInflow ? "text-success" : "text-destructive"}`}>
{isInflow ? "+" : "−"}{fmtTRY(Math.abs(Number(t.amount)))}
                       </TableCell>
                       <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate" title={t.description ?? ""}>
                         {t.description ?? "?"}
                         {t.metadata?.external_ref && (
                            <div className="font-mono text-[10px]">ref: {t.metadata.external_ref}</div>
                         )}
                       </TableCell>
                     </TableRow>
                  );
               })}
             </TableBody>
           </Table>
        </div>

        {hasMore && rows.length > 0 && (
           <div className="flex justify-center">
             <Button variant="outline" size="sm" onClick={() => load(false)} disabled={loading}>
               {loading ? "Yükleniyor..." : "Daha fazla"}
             </Button>
           </div>
        )}
      </div>
   );
}

/* ---------------- API calls ---------------- */

export function ApiCallsTab({ merchant }: { merchant: Merchant }) {
   const [calls, setCalls] = useState<ApiCall[]>([]);
   const [loading, setLoading] = useState(true);

   useEffect(() => {
      (async () => {
        setLoading(true);
        try {
          const merchantIds = await merchantQueryIds(merchant);
          const data = await dbSelect<ApiCall>("merchant_api_calls", {
            where: [{ col: "merchant_id", op: "in", val: merchantIds }],
            order: { col: "created_at", asc: false },
            limit: 100,
          });
          setCalls(data);
        } catch (err) {
          toast({ title: translateError(err), variant: "destructive" as any });
        } finally {
          setLoading(false);
        }
      })();
   }, [merchant.id, merchant.merchant_scope]);

   return (
      <div className="rounded-lg border max-h-[480px] overflow-auto">
        <Table>
           <TableHeader className="sticky top-0 bg-muted/80 backdrop-blur">
             <TableRow>
               <TableHead>Tarih</TableHead>
               <TableHead>Endpoint</TableHead>
               <TableHead>IP</TableHead>
               <TableHead>Durum</TableHead>
               <TableHead>Hata</TableHead>
               <TableHead className="text-right">Süre</TableHead>
             </TableRow>
           </TableHeader>
           <TableBody>
             {loading ? (
               <TableRow><TableCell colSpan={6} className="text-center py-4 text-muted-foreground">Yükleniyor...</TableCell></TableRow>
             ) : calls.length === 0 ? (
               <TableRow><TableCell colSpan={6} className="text-center py-4 text-muted-foreground">Çağrı kaydı yok</TableCell></TableRow>
             ) : calls.map((c) => (
               <TableRow key={c.id}>
                  <TableCell className="text-xs whitespace-nowrap">{new Date(c.created_at).toLocaleString("tr-TR")}</TableCell>
                  <TableCell className="text-xs font-mono">{c.endpoint}</TableCell>
                  <TableCell className="text-xs font-mono">{c.ip ?? "?"}</TableCell>
                  <TableCell>
                     <Badge variant={c.status_code && c.status_code < 400 ? "default" : "destructive"}>{c.status_code ?? "—"}</Badge>
                  </TableCell>
                  <TableCell className="text-xs">{c.error_code ? errorCodeLabel(c.error_code) : "—"}</TableCell>
                  <TableCell className="text-right text-xs tabular">{c.latency_ms ?? "?"} ms</TableCell>
               </TableRow>
             ))}
           </TableBody>
        </Table>
      </div>
   );
}

/* ---------------- Create merchant ---------------- */

function CreateMerchantDialog({ onCreated, defaultType }: { onCreated: (creds: { apiKey: string; apiSecret: string }) => void; defaultType?: MerchantType }) {
   const [name, setName] = useState("");
   // alt menüden tip filtresiyle açıldıysa defaultType'ı al
   const [merchantType, setMerchantType] = useState<MerchantType>(defaultType ?? "commerce");
const [ipList, setIpList] = useState("");
const [perTx, setPerTx] = useState("");
const [daily, setDaily] = useState("");
const [notes, setNotes] = useState("");
const [submitting, setSubmitting] = useState(false);

// Komisyon — her merchant'ta explicit gir (default toggle yoktur).
const [commissionPct, setCommissionPct] = useState<string>("");
const [fixedFee, setFixedFee] = useState<string>("");

// finance merchant için yatırma/çekim min-max
const [depositMin, setDepositMin] = useState<string>("");
const [depositMax, setDepositMax] = useState<string>("");
const [withdrawMin, setWithdrawMin] = useState<string>("");
const [withdrawMax, setWithdrawMax] = useState<string>("");

async function submit() {
  if (!name.trim()) return;
  setSubmitting(true);
  const ips = ipList.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
  const isFinance = merchantType === "finance";
  const isCommerce = merchantType === "commerce";
  try {
    const data = await invokeFunction<{ api_key?: string; api_secret?: string; error?: string }>("admin-merchant-secret", {
      action: "create",
      name: name.trim(),
      ip_whitelist: ips,
      per_tx_limit: isCommerce ? null : (perTx ? Number(perTx) : null),
      daily_limit: isCommerce ? null : (daily ? Number(daily) : null),
      notes: notes.trim() || null,
      merchant_type: merchantType,
      commission_pct: isCommerce ? 0 : (commissionPct === "" ? 0 : Number(commissionPct)),
      fixed_fee: isCommerce ? 0 : (fixedFee === "" ? 0 : Number(fixedFee)),
      // min-max sadece finance için gönderilir
      deposit_min: isFinance && depositMin !== "" ? Number(depositMin) : null,
      deposit_max: isFinance && depositMax !== "" ? Number(depositMax) : null,
      withdraw_min: isFinance && withdrawMin !== "" ? Number(withdrawMin) : null,
      withdraw_max: isFinance && withdrawMax !== "" ? Number(withdrawMax) : null,
    });
    if (data?.error) throw new Error(data.error);
    if (data?.api_key && data?.api_secret) onCreated({ apiKey: data.api_key, apiSecret: data.api_secret });
  } catch (err) {
    toast({ title: translateError(err), variant: "destructive" as any });
  } finally {
    setSubmitting(false);
  }
}

const typeHint = merchantType === "finance"
  ? "Akış C/D: topup callback ve withdraw callback. Üye-yüzünde merchant adı gösterilmez. Sistem bu merchant'a komisyon öder."
  : "Akış A/B parent merchant. Komisyon ve işlem limitleri bayi/child merchant seviyesinde tanımlanır.";

// YENİ YÖN: commerce = earn (gelir), finance = pay (maliyet)
const isEarn = merchantType === "commerce";
const commissionTitle = isEarn ? "Sistemin Kazancı" : "Sisteme Bağlanma Maliyeti" ;
const commissionDesc = isEarn
  ? "Bu merchant'tan her işlemde alınacak komisyon ? platform geliri."
  : "Bu merchant'a her işlemde ödenecek komisyon ? platform maliyeti." ;
const commissionToneClass = isEarn
  ? "border-success/30 bg-success/5"
  : "border-destructive/30 bg-destructive/5" ;

return (
  <DialogContent className="max-h-[90vh] overflow-y-auto" >
    <DialogHeader>
       <DialogTitle>Yeni Merchant</DialogTitle>
       <DialogDescription >API key ve secret üretilir ; secret yalnızca bir kez gösterilir .</DialogDescription >
    </DialogHeader>
    <div className="space-y-3">
       <div>
         <Label>Ad</Label>
         <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="ACME şirket" />
       </div>
       <div>
         <Label>Tip</Label>
         <Select value={merchantType} onValueChange={(v) => setMerchantType (v as MerchantType)}>
           <SelectTrigger><SelectValue /></SelectTrigger>
           <SelectContent>
              <SelectItem value="finance">
                <div className="flex flex-col" >
                  <span>Finans Merchant </span>
                  <span className="text-[11px] text-muted-foreground" >Cüzdana para yatırma /çekme (deposit/withdraw)</span>
                </div>
              </SelectItem>
              <SelectItem value="commerce">
                <div className="flex flex-col" >
                  <span>Ticaret Merchant </span>
                  <span className="text-[11px] text-muted-foreground" >Ödeme kodu ile tahsilat / cüzdana giriş</span>
                </div>
                 </SelectItem>
               </SelectContent>
            </Select>
            <div className="text-[11px] text-muted-foreground mt-1" >{typeHint}</div>
          </div>

          {merchantType === "finance" ? (
            <div className={`rounded-lg border p-3 space-y-3 ${ commissionToneClass }`}>
              <div className="flex items-start justify-between gap-3" >
                 <div>
                   <div className="text-sm font-semibold" >{commissionTitle }</div>
                   <div className="text-[11px] text-muted-foreground" >{commissionDesc }</div>
                 </div>
                 <Badge variant="outline" className={isEarn ? "text-success border-success/40" : "text-destructive border-destructive/40"}>
                   {isEarn ? "Kazanç" : "Maliyet"}
                 </Badge>
              </div>
              {/* Her merchant için komisyon explicit — "varsayılanı kullan" kaldırıldı */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Komisyon (%)</Label>
                  <Input
                    inputMode="decimal"
                    value={commissionPct}
                    onChange={(e) => setCommissionPct(e.target.value)}
                    placeholder="örn: 4"
                  />
                </div>
                <div>
                  <Label className="text-xs">Sabit Ücret (₺ / işlem)</Label>
                  <Input
                    inputMode="decimal"
                    value={fixedFee}
                    onChange={(e) => setFixedFee(e.target.value)}
                    placeholder="opsiyonel"
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-purple-500/20 bg-purple-500/5 p-3 text-xs text-muted-foreground">
              Bu kayıt ana ticaret merchant'ıdır. Komisyon, tek işlem üst limiti ve günlük limit bayi/child merchant eklerken tanımlanır.
            </div>
          )}

          <div>
            <Label>IP Whitelist (virgül/boşluk ile ayır , boş bırak = tüm IP'ler)</Label>
            <Input value={ipList} onChange={(e) => setIpList(e.target.value)} placeholder="1.2.3.4, 5.6.7.8" />
          </div>
          {merchantType === "finance" && (
            <div className="grid grid-cols-2 gap-3" >
              <div>
                 <Label>Tek işlem üst limiti (₺)</Label>
                 <Input inputMode="decimal" value={perTx} onChange={(e) => setPerTx(e.target.value)} placeholder="opsiyonel"/>
              </div>
              <div>
                 <Label>Günlük Limit (₺)</Label>
                 <Input inputMode="decimal" value={daily} onChange={(e) => setDaily(e.target.value)} placeholder="opsiyonel"/>
              </div>
            </div>
          )}

          {/* Finance merchant için yatırma/çekim min-max */}
          {merchantType === "finance" && (
            <div className="rounded-lg border p-3 space-y-3 bg-blue-50/30 dark:bg-blue-950/20">
              <div className="text-sm font-semibold">Yatırma/çekim tutar limitleri</div>
              <p className="text-[11px] text-muted-foreground">
                Üyenin işlem tutarı bu aralığın dışındaysa bu merchant'a yönlendirilmez. Boş bırakırsanız o yönde sınır yoktur.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Min. yatırma (₺)</Label>
                  <Input inputMode="decimal" value={depositMin} onChange={(e) => setDepositMin(e.target.value)} placeholder="örn: 100" />
                </div>
                <div>
                  <Label className="text-xs">Maks. yatırma (₺)</Label>
                  <Input inputMode="decimal" value={depositMax} onChange={(e) => setDepositMax(e.target.value)} placeholder="örn: 50000" />
                </div>
                <div>
                  <Label className="text-xs">Min. çekim (₺)</Label>
                  <Input inputMode="decimal" value={withdrawMin} onChange={(e) => setWithdrawMin(e.target.value)} placeholder="örn: 100" />
                </div>
                <div>
                  <Label className="text-xs">Maks. çekim (₺)</Label>
                  <Input inputMode="decimal" value={withdrawMax} onChange={(e) => setWithdrawMax(e.target.value)} placeholder="örn: 100000" />
                </div>
              </div>
            </div>
          )}

          <div>
            <Label>Notlar</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={!name.trim() || submitting}>
            {submitting ? "Oluşturuluyor..." : "Oluştur"}
          </Button>
        </DialogFooter>
      </DialogContent>
   );
}

/* ---------------- Edit merchant (commission + limits) ---------------- */

function EditCommissionDialog ({ merchant, onSaved }: { merchant: Merchant; onSaved: () => void }) {
   const [pct, setPct] = useState<string>(String(merchant.commission_pct ?? 0));
   const [fee, setFee] = useState<string>(String(merchant.fixed_fee ?? 0));
   const [perTx, setPerTx] = useState<string>(merchant.per_tx_limit != null ? String(merchant.per_tx_limit) : "");
   const [daily, setDaily] = useState<string>(merchant.daily_limit != null ? String(merchant.daily_limit) : "");
   // finance min-max
   const [depositMin, setDepositMin] = useState<string>(merchant.deposit_min_amount != null ? String(merchant.deposit_min_amount) : "");
   const [depositMax, setDepositMax] = useState<string>(merchant.deposit_max_amount != null ? String(merchant.deposit_max_amount) : "");
   const [withdrawMin, setWithdrawMin] = useState<string>(merchant.withdraw_min_amount != null ? String(merchant.withdraw_min_amount) : "");
   const [withdrawMax, setWithdrawMax] = useState<string>(merchant.withdraw_max_amount != null ? String(merchant.withdraw_max_amount) : "");
   const [saving, setSaving] = useState(false);

   const isFinance = merchant.merchant_type === "finance";
   // YENİ YÖN: commerce = earn (gelir), finance = pay (maliyet)
   const isEarn = merchant.commission_direction === "earn";
   const title = isEarn ? "Komisyon (Platform Geliri)" : "Komisyon (Platform Maliyeti)" ;
   const tone = isEarn ? "border-success/30 bg-success/5" : "border-destructive/30 bg-destructive/5" ;

   const initialPct = Number(merchant.commission_pct ?? 0);
const initialFee = Number(merchant.fixed_fee ?? 0);
const initialPerTx = merchant.per_tx_limit;
const initialDaily = merchant.daily_limit;
const initialDepositMin = merchant.deposit_min_amount ?? null;
const initialDepositMax = merchant.deposit_max_amount ?? null;
const initialWithdrawMin = merchant.withdraw_min_amount ?? null;
const initialWithdrawMax = merchant.withdraw_max_amount ?? null;

async function save() {
  const pctN = Number(pct);
  const feeN = Number(fee);
  if (!Number.isFinite(pctN) || pctN < 0 || pctN > 100) {
    toast({ title: "Komisyon yüzdesi 0-100 arasında olmalı" , variant: "destructive" as any });
     return;
  }
  if (!Number.isFinite(feeN) || feeN < 0) {
    toast({ title: "Sabit ücret negatif olamaz" , variant: "destructive" as any });
     return;
  }

  const perTxN = perTx.trim() === "" ? null : Number(perTx);
  const dailyN = daily.trim() === "" ? null : Number(daily);
  if (perTxN != null && (!Number.isFinite(perTxN) || perTxN < 0)) {
    toast({ title: "Tek işlem üst limiti geçersiz" , variant: "destructive" as any });
     return;
  }
  if (dailyN != null && (!Number.isFinite(dailyN) || dailyN < 0)) {
    toast({ title: "Günlük limit geçersiz" , variant: "destructive" as any });
     return;
  }

  setSaving(true);

  // Komisyon değiştiyse güncelle
  if (pctN !== initialPct || feeN !== initialFee) {
     try {
       await rpc("admin_set_merchant_commission", {
         _merchant_id: merchant.id,
         _commission_pct: pctN,
         _fixed_fee: feeN,
       });
     } catch (err) {
       setSaving(false);
       toast({ title: translateError(err), variant: "destructive" as any });
       return;
     }
  }

  // min-max parse
  const dminN = depositMin.trim() === "" ? null : Number(depositMin);
  const dmaxN = depositMax.trim() === "" ? null : Number(depositMax);
  const wminN = withdrawMin.trim() === "" ? null : Number(withdrawMin);
  const wmaxN = withdrawMax.trim() === "" ? null : Number(withdrawMax);
  if (isFinance) {
    if (dminN != null && (!Number.isFinite(dminN) || dminN < 0)) {
      toast({ title: "Min. yatırma geçersiz", variant: "destructive" as any });
      return;
    }
    if (dmaxN != null && (!Number.isFinite(dmaxN) || dmaxN < 0)) {
      toast({ title: "Maks. yatırma geçersiz", variant: "destructive" as any });
      return;
    }
    if (dminN != null && dmaxN != null && dminN > dmaxN) {
      toast({ title: "Min. yatırma > Maks. yatırma olamaz", variant: "destructive" as any });
      return;
    }
    if (wminN != null && (!Number.isFinite(wminN) || wminN < 0)) {
      toast({ title: "Min. çekim geçersiz", variant: "destructive" as any });
      return;
    }
    if (wmaxN != null && (!Number.isFinite(wmaxN) || wmaxN < 0)) {
      toast({ title: "Maks. çekim geçersiz", variant: "destructive" as any });
      return;
    }
    if (wminN != null && wmaxN != null && wminN > wmaxN) {
      toast({ title: "Min. çekim > Maks. çekim olamaz", variant: "destructive" as any });
      return;
    }
  }

  // Limit veya min-max değiştiyse güncelle
  const limitsChanged =
     (perTxN ?? null) !== (initialPerTx ?? null) ||
     (dailyN ?? null) !== (initialDaily ?? null) ||
     (dminN ?? null) !== initialDepositMin ||
     (dmaxN ?? null) !== initialDepositMax ||
     (wminN ?? null) !== initialWithdrawMin ||
     (wmaxN ?? null) !== initialWithdrawMax;
  if (limitsChanged) {
     try {
       await rpc("admin_set_merchant_limits", {
         _merchant_id: merchant.id,
         _per_tx_limit: perTxN,
         _daily_limit: dailyN,
         _deposit_min: isFinance ? dminN : null,
         _deposit_max: isFinance ? dmaxN : null,
         _withdraw_min: isFinance ? wminN : null,
         _withdraw_max: isFinance ? wmaxN : null,
       });
     } catch (err) {
       setSaving(false);
       toast({ title: translateError(err), variant: "destructive" as any });
       return;
     }
  }

  setSaving(false);
  toast({ title: "Güncellendi" });
  onSaved();
}

return (
  <>
     <DialogHeader>
       <DialogTitle>{merchant.name} ? Ayarlar</DialogTitle>
       <DialogDescription >
         Komisyon ve işlem limitlerini düzenleyin .
       </DialogDescription >
     </DialogHeader>

     <div className="space-y-3">
       <div className={`rounded-lg border p-3 space-y-3 ${ tone}`}>
         <div className="text-sm font-medium" >{title}</div>
         <div className="grid grid-cols-2 gap-3" >
           <div>
              <Label className="text-xs">Komisyon (%)</Label>
              <Input inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} />
           </div>
           <div>
              <Label className="text-xs">Sabit Ücret (? / işlem)</Label>
              <Input inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} />
           </div>
         </div>
       </div>

       <div className="rounded-lg border p-3 space-y-3 border-border bg-muted/30" >
         <div>
           <div className="text-sm font-medium" >Limitler</div>
           <div className="text-[11px] text-muted-foreground" >Boş bırakılırsa o limit uygulanmaz .</div>
            </div>
            <div className="grid grid-cols-2 gap-3" >
               <div>
                 <Label className="text-xs">İşlem Başına Limit (₺)</Label>
                 <Input
                    inputMode="decimal"
                    value={perTx}
                    onChange={(e) => setPerTx(e.target.value)}
                    placeholder="limitsiz"
                 />
               </div>
               <div>
                 <Label className="text-xs">Günlük Limit (₺)</Label>
                 <Input
                    inputMode="decimal"
                    value={daily}
                    onChange={(e) => setDaily(e.target.value)}
                    placeholder="limitsiz"
                 />
               </div>
            </div>
          </div>

          {/* Finance merchant için yatırma/çekim min-max */}
          {isFinance && (
            <div className="rounded-lg border p-3 space-y-3 bg-blue-50/30 dark:bg-blue-950/20">
              <div>
                <div className="text-sm font-medium">Yatırma/çekim tutar limitleri</div>
                <div className="text-[11px] text-muted-foreground">
                  Üyenin işlem tutarı bu aralığın dışındaysa bu merchant'a yönlendirilmez.
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Min. yatırma (₺)</Label>
                  <Input inputMode="decimal" value={depositMin} onChange={(e) => setDepositMin(e.target.value)} placeholder="sınırsız" />
                </div>
                <div>
                  <Label className="text-xs">Maks. yatırma (₺)</Label>
                  <Input inputMode="decimal" value={depositMax} onChange={(e) => setDepositMax(e.target.value)} placeholder="sınırsız" />
                </div>
                <div>
                  <Label className="text-xs">Min. çekim (₺)</Label>
                  <Input inputMode="decimal" value={withdrawMin} onChange={(e) => setWithdrawMin(e.target.value)} placeholder="sınırsız" />
                </div>
                <div>
                  <Label className="text-xs">Maks. çekim (₺)</Label>
                  <Input inputMode="decimal" value={withdrawMax} onChange={(e) => setWithdrawMax(e.target.value)} placeholder="sınırsız" />
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button onClick={save} disabled={saving}>{saving ? "Kaydediliyor..." : "Kaydet"}</Button>
        </DialogFooter>
      </>
   );
}

function MerchantListStatCard({
  label,
  value,
  loading,
  accent,
}: {
  label: string;
  value: string;
  loading?: boolean;
  accent?: "destructive" | "warning";
}) {
  return (
    <StatCard
      label={label}
      value={value}
      loading={loading}
      accent={accent === "destructive" ? "destructive" : accent === "warning" ? "warning" : undefined}
      valueSize="lg"
    />
  );
}
