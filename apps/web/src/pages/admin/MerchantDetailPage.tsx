import { useEffect, useState } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import AdminLayout from "@/components/AdminLayout";
import DetailPage, { type DetailStat } from "@/components/DetailPage";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { rpc } from "@/lib/rpc";
import { dbSelect, dbInsert, dbUpdate, dbDelete } from "@/lib/db";
import { invokeFunction } from "@/lib/fn";
import { fmtTRY, fmtDate } from "@/lib/format";
import { maskApiKey, maskIpList, maskUrl, sensitiveText } from "@/lib/mask";
import { Can } from "@/components/Can";
import { Pencil, RefreshCw, Copy, Check, X as XIcon } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { translateError } from "@/lib/i18n-errors";
import { useAuth } from "@/hooks/useAuth";
import {
  Merchant, TYPE_INFO,
  SummaryTab, LedgerTab, ApiCallsTab,
} from "./Merchants";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Plus, Trash2 } from "lucide-react";
import DateRangePicker from "@/components/DateRangePicker";

export default function MerchantDetailPage() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  const listType = searchParams.get("type");
  const { can } = useAuth();
  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [loading, setLoading] = useState(true);
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = async () => {
    if (!id) return;
    setLoading(true);
    try {
      const data = await rpc<Merchant | null>("staff_get_merchant_detail", { _merchant_id: id });
      setMerchant(data ?? null);
    } catch (err) {
      console.error("staff_get_merchant_detail", err);
      setMerchant(null);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, [id]);

  const toggleActive = async () => {
    if (!merchant) return;
    try {
      await dbUpdate("merchants", { is_active: !merchant.is_active }, { id: merchant.id });
      toast({ title: merchant.is_active ? "Pasifleştirildi" : "Aktifleştirildi" });
      load();
    } catch (err) {
      toast({ title: translateError(err), variant: "destructive" as any });
    }
  };

  const rotateSecret = async () => {
    if (!merchant) return;
    if (!confirm(`${merchant.name} için yeni secret üretilsin mi? Eski secret çalışmayacak.`)) return;
    try {
      const data = await invokeFunction<{ api_secret?: string; error_code?: string }>("admin-merchant-secret", {
        merchant_id: merchant.id,
        action: "rotate",
      });
      if (data?.error_code) {
        toast({ title: translateError(data), variant: "destructive" as any });
        return;
      }
      const secret = data?.api_secret;
      if (!secret) return;
      // Otomatik clipboard'a kopyalamayı dene
      try { await navigator.clipboard.writeText(secret); setCopied(true); } catch { /* fallback panel'de manuel kopyalanabilir */ }
      setNewSecret(secret);
      toast({ title: "Yeni secret üretildi", description: "Panoya kopyalandı. Güvenli bir yere kaydedin — bir daha gösterilmeyecek." });
    } catch (err) {
      toast({ title: translateError(err), variant: "destructive" as any });
    }
  };

  const copyNewSecret = async () => {
    if (!newSecret) return;
    try {
      await navigator.clipboard.writeText(newSecret);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast({ title: "Kopyalanamadı", description: "Manuel olarak seçip kopyalayın", variant: "destructive" as any });
    }
  };

  if (loading || !merchant) {
    return <AdminLayout title="Merchant" requireAny={["merchants:view_full", "merchants:view_masked"]}><div className="p-6 text-muted-foreground">Yükleniyor…</div></AdminLayout>;
  }

  const typeInfo = TYPE_INFO[merchant.merchant_type];
  const isEarn = merchant.commission_direction === "earn";
  const canViewApiCredentials = can("merchants", "api_credentials");
  const canViewNetworkConfig = can("merchants", "network_config");
  const canViewIntegrationUrls = can("merchants", "integration_urls");
  const commerceParent = merchant.merchant_type === "commerce" && (merchant as any).merchant_scope !== "child";

  return (
    <AdminLayout title="Merchant Detayı" requireAny={["merchants:view_full", "merchants:view_masked"]}>
      {newSecret && (
        <div className="mx-6 mt-6">
          <Card className="p-4 border-success bg-success/5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="font-semibold text-success">Yeni API Secret üretildi</div>
              <button
                onClick={() => { setNewSecret(null); setCopied(false); }}
                className="size-7 rounded-full hover:bg-muted flex items-center justify-center"
                aria-label="Kapat"
              >
                <XIcon className="size-4 text-muted-foreground" />
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              <strong>Bu bir daha gösterilmeyecek</strong> — şimdi kopyalayıp güvenli bir yere kaydedin.
              Eski secret artık çalışmıyor.
            </p>
            <div className="flex items-center gap-2">
              <Input value={newSecret} readOnly className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
              <Button size="sm" variant="outline" onClick={copyNewSecret}>
                {copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
                <span className="ml-1.5">{copied ? "Kopyalandı" : "Kopyala"}</span>
              </Button>
            </div>
          </Card>
        </div>
      )}
      <DetailPage
        title={merchant.name}
        subtitle={
          <span className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className={typeInfo.badgeClass}>{typeInfo.label}</Badge>
            {(merchant as any).merchant_scope === "parent" && <Badge variant="secondary">Parent</Badge>}
            {(merchant as any).merchant_scope === "child" && <Badge variant="outline">Bayi</Badge>}
            <span className="text-xs">·</span>
            <span className="text-xs font-mono">{typeInfo.endpoints}</span>
            <span className="text-xs">·</span>
            {/* Header reads the split columns (deposit_commission_pct / withdraw_commission_pct);
                the legacy single `commission_pct` no longer drives finance deposit/withdraw display. */}
            <span className="text-xs">
              {commerceParent ? (
                "Komisyon: bayi bazlı"
              ) : (
                <>
                  Komisyon: %{Number((merchant as any).deposit_commission_pct ?? merchant.commission_pct ?? 0).toFixed(2)}
                  {" / "}
                  %{Number((merchant as any).withdraw_commission_pct ?? merchant.commission_pct ?? 0).toFixed(2)}
                </>
              )}
            </span>
          </span>
        }
        onBack={() => {
          const t = listType ?? merchant.merchant_type;
          nav(t ? `/admin/merchants?type=${t}` : "/admin/merchants");
        }}
        actions={
          <>
            {(merchant as any).merchant_scope !== "child" && (
              <Can do="merchants:rotate_secret">
                <Button variant="outline" size="sm" onClick={rotateSecret}>
                  <RefreshCw className="size-4 mr-1" />Secret yenile
                </Button>
              </Can>
            )}
            <Can do="merchants:update">
              <Button variant={merchant.is_active ? "outline" : "default"} size="sm" onClick={toggleActive}>
                {merchant.is_active ? "Pasifleştir" : "Aktifleştir"}
              </Button>
            </Can>
          </>
        }
        stats={[
          { label: "Durum",         value: merchant.is_active ? <Badge>Aktif</Badge> : <Badge variant="destructive">Pasif</Badge> },
          ...(commerceParent
            ? [{ label: "Bayi sayısı", value: String((merchant as any).child_count ?? 0) } as DetailStat]
            : [{ label: "Settlement", value: <SettlementBadge merchant={merchant} />, accent: (Number((merchant as any).balance ?? 0) >= 0 ? "success" : "destructive") as DetailStat["accent"] } as DetailStat]),
          ...(merchant.merchant_type === "commerce" && !commerceParent
            ? [{ label: "Borç tavanı",   value: fmtTRY(Number((merchant as any).credit_limit ?? 0)) } as DetailStat]
            : []),
          ...(merchant.merchant_type === "finance"
            ? [{
                label: "Kasa",
                value: (
                  <div className="flex flex-col">
                    <span className="font-semibold">{fmtTRY(Number((merchant as any).cash_pool ?? 0))}</span>
                    {(merchant as any).cash_pool_overdraft_enabled && Number((merchant as any).cash_pool_overdraft_limit ?? 0) > 0 && (
                      <span className="text-[10px] text-muted-foreground">
                        −Limit: {fmtTRY(Number((merchant as any).cash_pool_overdraft_limit))}
                      </span>
                    )}
                  </div>
                ),
                accent: (Number((merchant as any).cash_pool ?? 0) < 0 ? "destructive" : "success") as DetailStat["accent"],
              } as DetailStat]
            : []),
          ...(commerceParent ? [] : [
            { label: "Tek İşlem Üst Limiti",  value: merchant.per_tx_limit ? fmtTRY(Number(merchant.per_tx_limit)) : "—" } as DetailStat,
            { label: "Günlük Limit",  value: merchant.daily_limit ? fmtTRY(Number(merchant.daily_limit)) : "—" } as DetailStat,
          ]),
        ]}
        tabs={[
          ...(commerceParent
            ? []
            : [{ value: "summary", label: "Özet", content: <SummaryTab merchant={merchant} /> }]),
          ...(commerceParent
            ? [{ value: "children", label: "Bayiler", content: <ChildrenTab parentId={merchant.id} onChanged={load} /> }]
            : []),
          ...(merchant.merchant_type === "finance" ? [
            { value: "methods", label: "Yöntemler", content: <MethodsTab merchantId={merchant.id} /> },
            { value: "cashpool", label: "Kasa", content: <CashPoolTab merchant={merchant} onChanged={load} /> },
            { value: "integration", label: "Entegrasyon", content: <TopupIntegrationTab merchant={merchant} onSaved={load} /> },
          ] : []),
          // Settlement defteri sadece commerce merchant icin anlamli (Akis B)
          // Finance merchant'ta cash_pool kullanildigi icin "Kasa" tab'i yeterli.
          ...(merchant.merchant_type === "commerce" && !commerceParent
            ? [{ value: "settlement", label: "Settlement defteri", content: <SettlementTab merchant={merchant} onChanged={load} /> }]
            : []),
          ...(!commerceParent ? [{ value: "users", label: "Yetkili kullanıcılar", content: <MerchantUsersTab merchant={merchant} /> }] : []),
          ...(!commerceParent ? [{ value: "ledger",  label: "Üye İşlemleri",   content: <LedgerTab merchant={merchant} /> }] : []),
          ...(canViewNetworkConfig ? [{ value: "api", label: "API Çağrıları", content: <ApiCallsTab merchant={merchant} /> }] : []),
          ...(!commerceParent && can("commissions", "view") ? [{ value: "commission", label: "Komisyon", content: <CommissionTab merchant={merchant} onSaved={load} /> }] : []),
          {
            value: "info",
            label: "Bilgiler",
            content: (
              <Card className="p-4 max-w-xl space-y-3">
                <Row label="Merchant ID" value={<span className="font-mono text-xs">{merchant.id}</span>} />
                {(merchant as any).merchant_scope && <Row label="Hiyerarşi" value={(merchant as any).merchant_scope === "parent" ? "Parent merchant" : (merchant as any).merchant_scope === "child" ? "Child bayi" : "Standalone"} />}
                {(merchant as any).parent_merchant_id && <Row label="Parent ID" value={<span className="font-mono text-xs">{(merchant as any).parent_merchant_id}</span>} />}
                {(merchant as any).external_sub_merchant_ref && <Row label="Bayi Ref" value={<span className="font-mono text-xs">{(merchant as any).external_sub_merchant_ref}</span>} />}
                <Row
                  label="API Key"
                  value={
                    <span className="font-mono text-xs">
                      {sensitiveText(can, "merchants", "api_credentials", merchant.api_key ?? "", maskApiKey)}
                    </span>
                  }
                />
                <Row label="Tip" value={typeInfo.label} />
                <Row label="Endpoint'ler" value={<span className="font-mono text-xs">{typeInfo.endpoints}</span>} />
                {commerceParent ? (
                  <Row label="Komisyon ve limitler" value="Bayi / child merchant bazında tanımlanır" />
                ) : (
                  <>
                    <Row label="Komisyon yönü" value={isEarn ? "earn (sistem kazanır)" : "pay (sistem öder)"} />
                    <Row label="Komisyon yüzdesi" value={`%${Number(merchant.commission_pct).toFixed(2)}`} />
                    <Row label="Sabit ücret" value={fmtTRY(Number(merchant.fixed_fee))} />
                    <Row label="Tek işlem üst limiti" value={merchant.per_tx_limit ? fmtTRY(Number(merchant.per_tx_limit)) : "—"} />
                    <Row label="Günlük limit" value={merchant.daily_limit ? fmtTRY(Number(merchant.daily_limit)) : "—"} />
                  </>
                )}
                <Row
                  label="IP Whitelist"
                  value={
                    (merchant as any).merchant_type === "commerce" && (merchant as any).merchant_scope === "child"
                      ? "Ana ticari merchant seviyesinde"
                      : (
                        <span className="font-mono text-xs">
                          {sensitiveText(
                            can,
                            "merchants",
                            "network_config",
                            merchant.ip_whitelist?.length ? merchant.ip_whitelist.join(", ") : "",
                            () => maskIpList(merchant.ip_whitelist),
                          )}
                        </span>
                      )
                  }
                />
                <Row label="Notlar" value={merchant.notes || "—"} />
                <Row label="Oluşturma" value={fmtDate(merchant.created_at)} />
              </Card>
            ),
          },
        ]}
      />
    </AdminLayout>
  );
}

function Row({ label, value }: { label: string; value: any }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm text-right max-w-[60%] break-all">{value}</span>
    </div>
  );
}

async function merchantDetailQueryIds(merchant: Merchant): Promise<string[]> {
  if ((merchant as any).merchant_scope !== "parent") return [merchant.id];
  try {
    const data = await rpc<Array<{ id: string }>>("admin_merchant_children", { _parent_merchant_id: merchant.id });
    const childIds = (data ?? []).map((r) => r.id);
    return childIds.length ? childIds : [merchant.id];
  } catch (err) {
    toast({ title: translateError(err), variant: "destructive" as any });
    return [merchant.id];
  }
}

function ChildrenTab({ parentId, onChanged }: { parentId: string; onChanged: () => void }) {
  const nav = useNavigate();
  const { can } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [createdCreds, setCreatedCreds] = useState<{ apiKey: string } | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await rpc<any[]>("admin_merchant_children", { _parent_merchant_id: parentId });
      setRows(data ?? []);
    } catch (err) {
      toast({ title: translateError(err), variant: "destructive" as any });
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [parentId]);

  return (
    <Card className="overflow-hidden">
      <div className="p-3 border-b flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium">Bayiler ({rows.length})</div>
          <div className="text-xs text-muted-foreground">Komisyon ve işlem limitleri child/bayi seviyesinde tanımlanır.</div>
        </div>
        <Can do="merchants:update">
          <Button size="sm" onClick={() => setEditorOpen(true)}>
            <Plus className="size-4 mr-1" /> Bayi Ekle
          </Button>
        </Can>
      </div>
      {createdCreds && (
        <div className="m-3 rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs">
          <div className="font-semibold mb-1">Bayi API key oluşturuldu.</div>
          <div className="font-mono break-all">API Key: {createdCreds.apiKey}</div>
          <div className="text-muted-foreground mt-1">İmza için parent merchant secret kullanılır; bayi bazında ayrı secret yoktur.</div>
        </div>
      )}
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
          <tr>
            <th className="text-left p-3">Bayi</th>
            <th className="text-left p-3">Bayi Ref</th>
            <th className="text-left p-3">API Key</th>
            <th className="text-right p-3">Settlement</th>
            <th className="text-right p-3">Bugünkü Hacim</th>
            <th className="text-center p-3">Durum</th>
          </tr>
        </thead>
        <tbody>
          {loading && <tr><td colSpan={6} className="text-center py-6 text-muted-foreground">Yükleniyor…</td></tr>}
          {!loading && rows.length === 0 && <tr><td colSpan={6} className="text-center py-6 text-muted-foreground">Henüz bayi yok.</td></tr>}
          {rows.map((r) => (
            <tr key={r.id} className="border-t cursor-pointer hover:bg-muted/40" onClick={() => nav(`/admin/merchants/${r.id}`)}>
              <td className="p-3 font-medium">{r.name}</td>
              <td className="p-3 text-xs font-mono text-muted-foreground">{r.external_sub_merchant_ref ?? "—"}</td>
              <td className="p-3 text-xs font-mono">
                {sensitiveText(can, "merchants", "api_credentials", r.api_key ?? "", maskApiKey)}
              </td>
              <td className={`p-3 text-right tabular-nums ${Number(r.balance) >= 0 ? "text-success" : "text-destructive"}`}>
                {Number(r.balance) >= 0 ? "+" : "−"}{fmtTRY(Math.abs(Number(r.balance ?? 0)))}
              </td>
              <td className="p-3 text-right tabular-nums">{fmtTRY(Number(r.today_volume ?? 0))}</td>
              <td className="p-3 text-center">{r.is_active ? <Badge>Aktif</Badge> : <Badge variant="destructive">Pasif</Badge>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {editorOpen && (
        <ChildMerchantEditor
          parentId={parentId}
          onClose={() => setEditorOpen(false)}
          onCreated={(creds) => {
            setEditorOpen(false);
            setCreatedCreds(creds);
            load();
            onChanged();
          }}
        />
      )}
    </Card>
  );
}

function ChildMerchantEditor({
  parentId,
  onClose,
  onCreated,
}: {
  parentId: string;
  onClose: () => void;
  onCreated: (creds: { apiKey: string }) => void;
}) {
  const [name, setName] = useState("");
  const [commissionPct, setCommissionPct] = useState("");
  const [fixedFee, setFixedFee] = useState("");
  const [perTx, setPerTx] = useState("");
  const [daily, setDaily] = useState("");
  const [notes, setNotes] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!name.trim()) return toast({ title: "Bayi adı zorunlu", variant: "destructive" as any });
    const pct = commissionPct.trim() === "" ? null : Number(commissionPct);
    const fixed = fixedFee.trim() === "" ? null : Number(fixedFee);
    const perTxLimit = perTx.trim() === "" ? null : Number(perTx);
    const dailyLimit = daily.trim() === "" ? null : Number(daily);
    if (pct == null) {
      return toast({ title: "Komisyon (%) zorunlu", variant: "destructive" as any });
    }
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      return toast({ title: "Komisyon 0-100 arasında olmalı", variant: "destructive" as any });
    }
    if (fixed != null && (!Number.isFinite(fixed) || fixed < 0)) {
      return toast({ title: "Sabit ücret geçersiz", variant: "destructive" as any });
    }
    if (perTxLimit != null && (!Number.isFinite(perTxLimit) || perTxLimit < 0)) {
      return toast({ title: "Tek işlem üst limiti geçersiz", variant: "destructive" as any });
    }
    if (dailyLimit != null && (!Number.isFinite(dailyLimit) || dailyLimit < 0)) {
      return toast({ title: "Günlük limit geçersiz", variant: "destructive" as any });
    }

    setSaving(true);
    try {
      const data = await invokeFunction<{ api_key?: string; api_secret?: string | null; error?: string }>("admin-merchant-secret", {
        action: "create_child",
        parent_merchant_id: parentId,
        name: name.trim(),
        commission_pct: pct,
        fixed_fee: fixed,
        per_tx_limit: perTxLimit,
        daily_limit: dailyLimit,
        notes: notes.trim() || null,
        is_active: isActive,
      });
      if (data?.error) throw new Error(data.error);
      toast({ title: "Bayi oluşturuldu" });
      onCreated({ apiKey: data?.api_key ?? "—" });
    } catch (err) {
      toast({ title: translateError(err, "Bayi oluşturulamadı"), variant: "destructive" as any });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <Card className="max-w-2xl w-full max-h-[90vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4">
          <h3 className="font-semibold">Yeni Bayi / Child Merchant</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Komisyon zorunludur. Bayi ref sistem tarafından bayi adından otomatik üretilir. IP whitelist ana ticari merchant ayarından uygulanır.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label>Bayi adı</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="ACME Şube 1" />
          </div>
          <div>
            <Label>Komisyon (%) <span className="text-destructive">*</span></Label>
            <Input inputMode="decimal" value={commissionPct} onChange={(e) => setCommissionPct(e.target.value)} placeholder="örn: 4" />
          </div>
          <div>
            <Label>Sabit ücret (₺ / işlem)</Label>
            <Input inputMode="decimal" value={fixedFee} onChange={(e) => setFixedFee(e.target.value)} placeholder="opsiyonel" />
          </div>
          <div>
            <Label>Tek işlem üst limiti (₺)</Label>
            <Input inputMode="decimal" value={perTx} onChange={(e) => setPerTx(e.target.value)} placeholder="opsiyonel" />
          </div>
          <div>
            <Label>Günlük limit (₺)</Label>
            <Input inputMode="decimal" value={daily} onChange={(e) => setDaily(e.target.value)} placeholder="opsiyonel" />
          </div>
          <div className="col-span-2">
            <Label>Notlar</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
          </div>
          <div className="col-span-2 flex items-center justify-between border-t pt-3">
            <Label>Aktif mi?</Label>
            <Switch checked={isActive} onCheckedChange={setIsActive} />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>İptal</Button>
          <Button onClick={submit} disabled={saving || !name.trim() || !commissionPct.trim()}>
            {saving ? "Oluşturuluyor..." : "Oluştur"}
          </Button>
        </div>
      </Card>
    </div>
  );
}

// ============ Yöntemler tabı (finance merchant'lar için) ============
type MethodRow = {
  id: string; merchant_id: string; code: string; name: string;
  kind: "deposit" | "withdraw" | "both"; is_active: boolean;
  deposit_commission_pct: number | null;
  withdraw_commission_pct: number | null;
  deposit_fixed_fee: number;
  withdraw_fixed_fee: number;
  min_amount: number; max_amount: number | null;
  per_tx_limit: number | null; daily_limit: number | null;
  sort_order: number;
};

function MethodsTab({ merchantId }: { merchantId: string }) {
  const [methods, setMethods] = useState<MethodRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<MethodRow | null>(null);

  const load = async () => {
    setLoading(true);
    const data = await dbSelect<MethodRow>("merchant_methods", {
      where: { merchant_id: merchantId },
      order: { col: "sort_order", asc: true },
    }).catch(() => [] as MethodRow[]);
    setMethods(data);
    setLoading(false);
  };
  useEffect(() => { load(); }, [merchantId]);

  const toggleActive = async (m: MethodRow) => {
    await dbUpdate("merchant_methods", { is_active: !m.is_active }, { id: m.id }).catch(() => {});
    load();
  };

  return (
    <Card className="overflow-hidden">
      <div className="p-3 border-b flex items-center justify-between">
        <div className="text-sm font-medium">Yöntemler ({methods.length})</div>
        <Can do="merchants:update">
          <Button size="sm" onClick={() => { setEditing(null); setEditorOpen(true); }}>
            <Plus className="size-4 mr-1" /> Yeni Yöntem
          </Button>
        </Can>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
          <tr>
            <th className="text-left p-3">Yöntem</th>
            <th className="text-left p-3">Kod</th>
            <th className="text-center p-3">Tip</th>
            <th className="text-right p-3">Yatırım Kom.</th>
            <th className="text-right p-3">Çekim Kom.</th>
            <th className="text-right p-3">Limit (Tx / Gün)</th>
            <th className="text-center p-3">Durum</th>
            <th className="text-right p-3"></th>
          </tr>
        </thead>
        <tbody>
          {loading && <tr><td colSpan={8} className="text-center py-6 text-muted-foreground">Yükleniyor…</td></tr>}
          {!loading && methods.length === 0 && (
            <tr><td colSpan={8} className="text-center py-6 text-muted-foreground">Henüz yöntem yok. Yeni Yöntem butonuna basın.</td></tr>
          )}
          {methods.map((m) => (
            <tr key={m.id} className="border-t hover:bg-muted/30 cursor-pointer" onClick={() => { setEditing(m); setEditorOpen(true); }}>
              <td className="p-3 font-medium">{m.name}</td>
              <td className="p-3 font-mono text-xs">{m.code}</td>
              <td className="p-3 text-center">
                <Badge variant="outline">{m.kind === "both" ? "Yat/Çek" : m.kind === "deposit" ? "Yatırım" : "Çekim"}</Badge>
              </td>
              <td className="p-3 text-right tabular-nums">
                {m.deposit_commission_pct != null ? `%${Number(m.deposit_commission_pct).toFixed(2)}` : <span className="text-muted-foreground text-xs">merchant default</span>}
                {Number(m.deposit_fixed_fee) > 0 && <div className="text-xs text-muted-foreground">+ {fmtTRY(Number(m.deposit_fixed_fee))}</div>}
              </td>
              <td className="p-3 text-right tabular-nums">
                {m.withdraw_commission_pct != null ? `%${Number(m.withdraw_commission_pct).toFixed(2)}` : <span className="text-muted-foreground text-xs">merchant default</span>}
                {Number(m.withdraw_fixed_fee) > 0 && <div className="text-xs text-muted-foreground">+ {fmtTRY(Number(m.withdraw_fixed_fee))}</div>}
              </td>
              <td className="p-3 text-right text-xs text-muted-foreground tabular-nums">
                {m.per_tx_limit ? fmtTRY(Number(m.per_tx_limit)) : "—"} / {m.daily_limit ? fmtTRY(Number(m.daily_limit)) : "—"}
              </td>
              <td className="p-3 text-center" onClick={(e) => e.stopPropagation()}>
                <Switch checked={m.is_active} onCheckedChange={() => toggleActive(m)} />
              </td>
              <td className="p-3 text-right text-xs text-muted-foreground">→</td>
            </tr>
          ))}
        </tbody>
      </table>
      {editorOpen && (
        <MethodEditor
          merchantId={merchantId}
          method={editing}
          onClose={() => { setEditorOpen(false); setEditing(null); }}
          onSaved={() => { setEditorOpen(false); setEditing(null); load(); }}
        />
      )}
    </Card>
  );
}

// Yöntem tipi katalog satırı
type MethodTypeCatalog = {
  code: string;
  label_tr: string;
  label_en: string;
  available_for: "topup" | "withdraw" | "both";
  is_enabled: boolean;
  sort_order: number;
};

// catalog.available_for → merchant_methods.kind mapping
const availableForToKind = (af: MethodTypeCatalog["available_for"]): "both" | "deposit" | "withdraw" =>
  af === "topup" ? "deposit" : af === "withdraw" ? "withdraw" : "both";

function MethodEditor({ merchantId, method, onClose, onSaved }: { merchantId: string; method: MethodRow | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<Partial<MethodRow>>(
    method ?? {
      merchant_id: merchantId, code: "", name: "", kind: "both", is_active: true,
      deposit_commission_pct: null, withdraw_commission_pct: null,
      deposit_fixed_fee: 0, withdraw_fixed_fee: 0,
      min_amount: 0, max_amount: null, per_tx_limit: null, daily_limit: null,
      sort_order: 100,
    },
  );
  const [saving, setSaving] = useState(false);
  const num = (v: any) => v === "" || v === null || v === undefined ? null : Number(v);

  // yöntem tipi katalogunu yükle (yeni method için zorunlu seçim)
  const [catalog, setCatalog] = useState<MethodTypeCatalog[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  useEffect(() => {
    (async () => {
      const data = await dbSelect<MethodTypeCatalog>("payment_method_types", {
        cols: "code,label_tr,label_en,available_for,is_enabled,sort_order",
        order: { col: "sort_order", asc: true },
      }).catch(() => [] as MethodTypeCatalog[]);
      setCatalog(data);
      setCatalogLoading(false);
    })();
  }, []);

  // katalogtan tip seçilince name+code+kind otomatik dolar + kilitli
  const onSelectType = (code: string) => {
    const sel = catalog.find((c) => c.code === code);
    if (!sel) return;
    setForm((prev) => ({
      ...prev,
      code: sel.code,
      name: sel.label_tr,
      kind: availableForToKind(sel.available_for),
    }));
  };

  const save = async () => {
    if (!form.code || !form.name) return toast({ title: "Önce yöntem tipi seçin", variant: "destructive" as any });
    setSaving(true);
    const payload: Record<string, unknown> = {
      ...form, merchant_id: merchantId,
      deposit_commission_pct: num(form.deposit_commission_pct),
      withdraw_commission_pct: num(form.withdraw_commission_pct),
      deposit_fixed_fee: Number(form.deposit_fixed_fee ?? 0),
      withdraw_fixed_fee: Number(form.withdraw_fixed_fee ?? 0),
      min_amount: Number(form.min_amount ?? 0),
      max_amount: num(form.max_amount),
      per_tx_limit: num(form.per_tx_limit),
      daily_limit: num(form.daily_limit),
      sort_order: Number(form.sort_order ?? 100),
    };
    try {
      if (method) {
        await dbUpdate("merchant_methods", payload, { id: method.id });
      } else {
        await dbInsert("merchant_methods", payload);
      }
      toast({ title: method ? "Güncellendi" : "Oluşturuldu" });
      onSaved();
    } catch (err) {
      toast({ title: translateError(err), variant: "destructive" as any });
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!method) return;
    if (!confirm(`${method.name} yöntemini silmek istediğine emin misin?`)) return;
    try {
      await dbDelete("merchant_methods", { id: method.id });
      toast({ title: "Silindi" });
      onSaved();
    } catch (err) {
      toast({ title: translateError(err), variant: "destructive" as any });
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <Card className="max-w-2xl w-full max-h-[90vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold">{method ? "Yöntem düzenle" : "Yeni yöntem"}</h3>
          {method && (
            <Button variant="ghost" size="sm" onClick={remove} className="text-destructive">
              <Trash2 className="size-4 mr-1" /> Sil
            </Button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          {/* Yöntem tipi katalog seçimi (yeni method için zorunlu) */}
          {!method && (
            <div className="col-span-2">
              <Label>Yöntem tipi *</Label>
              <select
                className="w-full h-10 border rounded-md px-3 bg-background"
                value={form.code ?? ""}
                onChange={(e) => onSelectType(e.target.value)}
                disabled={catalogLoading}
              >
                <option value="">{catalogLoading ? "Yükleniyor…" : "Seçiniz…"}</option>
                {catalog.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label_tr}
                    {!c.is_enabled ? "  (üyeye 'Yakında' olarak görünür)" : ""}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground mt-1">
                Tip seçildiğinde isim, kod ve yön otomatik dolar. Yeni tip eklemek için <span className="font-medium">/admin/method-types</span>.
              </p>
            </div>
          )}
          <div className="col-span-2">
            <Label>İsim</Label>
            <Input value={form.name ?? ""} readOnly disabled className="bg-muted/50" />
          </div>
          <div>
            <Label>Kod</Label>
            <Input value={form.code ?? ""} readOnly disabled className="bg-muted/50 font-mono" />
          </div>
          <div>
            <Label>Tip (yön)</Label>
            <Input
              value={
                form.kind === "both" ? "Yatırım + Çekim"
                : form.kind === "deposit" ? "Sadece Yatırım"
                : form.kind === "withdraw" ? "Sadece Çekim"
                : ""
              }
              readOnly disabled className="bg-muted/50"
            />
          </div>
          <div>
            <Label>Yatırım komisyonu (%)</Label>
            <Input type="number" step="0.01" value={form.deposit_commission_pct ?? ""}
              onChange={(e) => setForm({ ...form, deposit_commission_pct: e.target.value === "" ? null : Number(e.target.value) })}
              placeholder="merchant default" />
          </div>
          <div>
            <Label>Çekim komisyonu (%)</Label>
            <Input type="number" step="0.01" value={form.withdraw_commission_pct ?? ""}
              onChange={(e) => setForm({ ...form, withdraw_commission_pct: e.target.value === "" ? null : Number(e.target.value) })}
              placeholder="merchant default" />
          </div>
          <div>
            <Label>Yatırım sabit ücret (₺)</Label>
            <Input type="number" step="0.01" value={form.deposit_fixed_fee ?? 0}
              onChange={(e) => setForm({ ...form, deposit_fixed_fee: Number(e.target.value) })} />
          </div>
          <div>
            <Label>Çekim sabit ücret (₺)</Label>
            <Input type="number" step="0.01" value={form.withdraw_fixed_fee ?? 0}
              onChange={(e) => setForm({ ...form, withdraw_fixed_fee: Number(e.target.value) })} />
          </div>
          <div>
            <Label>Min tutar</Label>
            <Input type="number" value={form.min_amount ?? 0} onChange={(e) => setForm({ ...form, min_amount: Number(e.target.value) })} />
          </div>
          <div>
            <Label>Max tutar</Label>
            <Input type="number" value={form.max_amount ?? ""} onChange={(e) => setForm({ ...form, max_amount: e.target.value === "" ? null : Number(e.target.value) })} />
          </div>
          <div>
            <Label>Tek işlem üst limiti</Label>
            <Input type="number" value={form.per_tx_limit ?? ""} onChange={(e) => setForm({ ...form, per_tx_limit: e.target.value === "" ? null : Number(e.target.value) })} />
          </div>
          <div>
            <Label>Günlük limit</Label>
            <Input type="number" value={form.daily_limit ?? ""} onChange={(e) => setForm({ ...form, daily_limit: e.target.value === "" ? null : Number(e.target.value) })} />
          </div>
          <div>
            <Label>Sıralama</Label>
            <Input type="number" value={form.sort_order ?? 100} onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })} />
          </div>
          <div className="col-span-2 flex items-center justify-between border-t pt-3">
            <Label>Aktif mi?</Label>
            <Switch checked={!!form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>İptal</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Kaydediliyor…" : "Kaydet"}</Button>
        </div>
      </Card>
    </div>
  );
}

// ============ Akış C entegrasyon (finance) ============
function TopupIntegrationTab({ merchant, onSaved }: { merchant: Merchant; onSaved: () => void }) {
  const { can } = useAuth();
  const canViewUrls = can("merchants", "integration_urls");
  const canEdit = can("merchants", "update");
  const storedUrl = (merchant as { topup_init_url?: string | null }).topup_init_url ?? "";
  const storedAdapter = (merchant as { integration_adapter?: string | null }).integration_adapter ?? "";
  const adapterUiValue =
    storedAdapter === "aninda" || storedAdapter === "aninda_kripto" || storedAdapter === "aninda_banka"
      ? "aninda"
      : storedAdapter || "standard";
  const [url, setUrl] = useState<string>(storedUrl);
  const [adapter, setAdapter] = useState<string>(adapterUiValue);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    const trimmed = url.trim();
    const adapterVal = adapter === "aninda" ? "aninda" : null;
    try {
      await dbUpdate("merchants", {
        topup_init_url: trimmed.length ? trimmed : null,
        integration_adapter: adapterVal,
      }, { id: merchant.id });
      toast({ title: "Entegrasyon ayarları kaydedildi" });
      onSaved();
    } catch (err) {
      toast({ title: translateError(err), variant: "destructive" as any });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-4 max-w-xl space-y-4">
      <p className="text-sm text-muted-foreground">
        Akış C/D: standart HMAC init/callback veya Anında MD5 adapter (kripto + havale).
        Üye-yüzünde merchant adı gösterilmez.
      </p>
      <div className="space-y-2">
        <Label>Finance adapter</Label>
        <select
          value={adapter}
          onChange={(e) => setAdapter(e.target.value)}
          disabled={!canEdit}
          className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="standard">Standart (HMAC topup_init_url)</option>
          <option value="aninda">Anında (kripto + havale/FAST)</option>
        </select>
        {adapter === "aninda" && (
          <p className="text-xs text-muted-foreground">
            Panel <code className="text-[11px]">Key</code> → API env <code className="text-[11px]">ANINDA_KEY</code> (varsayılan admin);{" "}
            <code className="text-[11px]">signing_secret</code> = Anında Password.
            Yöntem: kripto / havale / papara — yatırma iframe (üye /topup içinde); çekim: kripto, FAST+IBAN veya PAPARA.
            Callback: <code className="text-[11px]">/webhooks/aninda/deposit</code> /{" "}
            <code className="text-[11px]">/webhooks/aninda/withdraw</code>
          </p>
        )}
      </div>
      <div className="space-y-2">
        <Label>Topup Init URL</Label>
        {canViewUrls ? (
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://api.merchant.com/wallet/topup/start"
            className="font-mono text-xs"
            disabled={!canEdit}
          />
        ) : (
          <p className="font-mono text-xs text-muted-foreground break-all">
            {sensitiveText(can, "merchants", "integration_urls", storedUrl, maskUrl)}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          Boş bırakılırsa production&apos;da init başarısız olur (staging: MOCK_FNS_ENABLED=true ile mock IBAN).
          {!canViewUrls && " Tam URL için Yetkiler → Hassas veri merkezi → Entegrasyon URL'leri açın."}
        </p>
      </div>
      <Can do="merchants:update">
        <Button onClick={save} disabled={saving || !canViewUrls}>
          {saving ? "Kaydediliyor…" : "Kaydet"}
        </Button>
      </Can>
    </Card>
  );
}

// ============ Komisyon tab — merchant default deposit/withdraw komisyonları ============
function CommissionTab({ merchant, onSaved }: { merchant: Merchant; onSaved: () => void }) {
  const { can } = useAuth();
  const [form, setForm] = useState<any>({
    deposit_commission_pct:  (merchant as any).deposit_commission_pct  ?? merchant.commission_pct,
    withdraw_commission_pct: (merchant as any).withdraw_commission_pct ?? merchant.commission_pct,
    deposit_fixed_fee:       (merchant as any).deposit_fixed_fee       ?? merchant.fixed_fee,
    withdraw_fixed_fee:      (merchant as any).withdraw_fixed_fee      ?? merchant.fixed_fee,
    cashout_commission_pct:  (merchant as any).cashout_commission_pct  ?? 0,
    cashout_fixed_fee:       (merchant as any).cashout_fixed_fee       ?? 0,
    finance_collection_fee_pct: (merchant as any).finance_collection_fee_pct ?? 0,
    finance_collection_fixed_fee: (merchant as any).finance_collection_fixed_fee ?? 0,
  });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      if (can("merchants", "update")) {
        const payload = {
          deposit_commission_pct:  form.deposit_commission_pct  === "" ? null : Number(form.deposit_commission_pct),
          withdraw_commission_pct: form.withdraw_commission_pct === "" ? null : Number(form.withdraw_commission_pct),
          deposit_fixed_fee:       Number(form.deposit_fixed_fee  ?? 0),
          withdraw_fixed_fee:      Number(form.withdraw_fixed_fee ?? 0),
          cashout_commission_pct:  Number(form.cashout_commission_pct ?? 0),
          cashout_fixed_fee:       Number(form.cashout_fixed_fee ?? 0),
        };
        await dbUpdate("merchants", payload, { id: merchant.id });
      }
      if (isFinance && can("merchants", "cash_collection_fee")) {
        const data = await rpc<{ success: boolean; error_code?: string } | Array<{ success: boolean; error_code?: string }>>("admin_update_finance_collection_fee", {
          _merchant_id: merchant.id,
          _fee_pct: Number(form.finance_collection_fee_pct ?? 0),
          _fixed_fee: Number(form.finance_collection_fixed_fee ?? 0),
        });
        const row = Array.isArray(data) ? data[0] : data;
        if (!row?.success) {
          toast({ title: translateError({ error_code: row?.error_code }, "Tahsilat masrafı güncellenemedi"), variant: "destructive" as any });
          return;
        }
      }
      toast({ title: "Komisyon güncellendi" });
      onSaved();
    } catch (error) {
      toast({ title: translateError(error), variant: "destructive" as any });
    } finally {
      setSaving(false);
    }
  };

  // Commerce: "Yatırım = Akış A (spend)", "Çekim = Akış B (merchant_credit)".
  // Finance:  "Yatırım = Akış C (topup)", "Çekim = Akış D (withdraw)".
  const isFinance = merchant.merchant_type === "finance";
  const inLabel  = isFinance ? "Yatırma komisyonu (Akış C)"   : "Akış A komisyonu — Üye ödemesi";
  const outLabel = isFinance ? "Çekme komisyonu (Akış D)"     : "Akış B komisyonu — Cüzdana Giriş";
  const inFee    = isFinance ? "Yatırma sabit ücret (₺)"      : "Akış A sabit ücret (₺)";
  const outFee   = isFinance ? "Çekme sabit ücret (₺)"        : "Akış B sabit ücret (₺)";
  const helpText = isFinance
    ? "Üye yatırma (topup) ve çekme (withdraw) için komisyon. Yöntem-spesifik komisyon bunları geçersiz kılar."
    : "Akış A (üye → merchant ödemesi) ve Akış B (üye merchant'taki bakiyesini cüzdana çekme) için komisyon.";
  const canSaveCommission = can("merchants", "update");
  const canSaveCollectionFee = can("merchants", "cash_collection_fee");

  return (
    <Card className="p-4 max-w-xl">
      <div className="text-sm text-muted-foreground mb-4">{helpText}</div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>{inLabel} (%)</Label>
          <Input type="number" step="0.01" value={form.deposit_commission_pct ?? ""}
            onChange={(e) => setForm({ ...form, deposit_commission_pct: e.target.value })} />
        </div>
        <div>
          <Label>{outLabel} (%)</Label>
          <Input type="number" step="0.01" value={form.withdraw_commission_pct ?? ""}
            onChange={(e) => setForm({ ...form, withdraw_commission_pct: e.target.value })} />
        </div>
        <div>
          <Label>{inFee}</Label>
          <Input type="number" step="0.01" value={form.deposit_fixed_fee ?? 0}
            onChange={(e) => setForm({ ...form, deposit_fixed_fee: e.target.value })} />
        </div>
        <div>
          <Label>{outFee}</Label>
          <Input type="number" step="0.01" value={form.withdraw_fixed_fee ?? 0}
            onChange={(e) => setForm({ ...form, withdraw_fixed_fee: e.target.value })} />
        </div>
        {!isFinance && (
          <>
            <div className="col-span-2 border-t pt-4">
              <div className="text-sm font-medium">Merchant tahsilat komisyonu</div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Ticari merchant kendi settlement alacağını kripto olarak çekerken alınacak komisyon. Tutar + komisyon kadar bakiye rezerve edilir.
              </p>
            </div>
            <div>
              <Label>Kasa çekimi komisyonu (%)</Label>
              <Input type="number" step="0.01" value={form.cashout_commission_pct ?? 0}
                onChange={(e) => setForm({ ...form, cashout_commission_pct: e.target.value })} />
            </div>
            <div>
              <Label>Kasa çekimi sabit ücret (₺)</Label>
              <Input type="number" step="0.01" value={form.cashout_fixed_fee ?? 0}
                onChange={(e) => setForm({ ...form, cashout_fixed_fee: e.target.value })} />
            </div>
          </>
        )}
        {isFinance && (
          <>
            <div className="col-span-2 border-t pt-4">
              <div className="text-sm font-medium">Kasa tahsilat masrafı</div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Finance merchant kasasında biriken para platforma tahsil edilirken oluşan operasyon/banka masrafı. Sadece admin veya hassas yetkisi açık kullanıcı değiştirebilir.
              </p>
            </div>
            <div>
              <Label>Tahsilat masrafı (%)</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                max="100"
                value={form.finance_collection_fee_pct ?? 0}
                disabled={!canSaveCollectionFee}
                onChange={(e) => setForm({ ...form, finance_collection_fee_pct: e.target.value })}
              />
            </div>
            <div>
              <Label>Tahsilat sabit masraf (₺)</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={form.finance_collection_fixed_fee ?? 0}
                disabled={!canSaveCollectionFee}
                onChange={(e) => setForm({ ...form, finance_collection_fixed_fee: e.target.value })}
              />
            </div>
          </>
        )}
      </div>
      <div className="mt-4 flex justify-end">
        {(canSaveCommission || (isFinance && canSaveCollectionFee)) && (
          <Button onClick={save} disabled={saving}>{saving ? "Kaydediliyor…" : "Kaydet"}</Button>
        )}
      </div>
    </Card>
  );
}

// ============ SETTLEMENT BAKİYE BADGE ============
function SettlementBadge({ merchant }: { merchant: Merchant }) {
  const balance = Number((merchant as any).balance ?? 0);
  if (balance === 0) return <span className="tabular-nums">{fmtTRY(0)}</span>;
  const sign = balance > 0 ? "+" : "−";
  return (
    <span className={`tabular-nums font-medium ${balance >= 0 ? "text-success" : "text-destructive"}`}>
      {sign}{fmtTRY(Math.abs(balance))}
    </span>
  );
}

// ============ SETTLEMENT TAB (defter + limit + manuel kayıt) ============
type SettlementRow = {
  id: number;
  change_amount: number;
  balance_before: number;
  balance_after: number;
  reason: string;
  reference_type: string | null;
  reference_id: string | null;
  notes: string | null;
  created_at: string;
};

// Turkish labels for `pay_to_merchant` and other settlement reasons.
const REASON_LABEL: Record<string, string> = {
  pay_to_merchant:      "Üye ödemesi (Akış A)",
  credit_to_member:     "Üyeye fon transferi (Akış B)",
  push_to_merchant:     "Merchant'a havale push (Akış D)",
  manual_settlement:    "Manuel settlement (banka transferi)",
  manual_adjustment:    "Manuel düzeltme",
  bank_transfer:        "Banka transferi",
  credit_limit_change:  "Borç tavanı değişikliği",
};

function SettlementTab({ merchant, onChanged }: { merchant: Merchant; onChanged: () => void }) {
  const [rows, setRows] = useState<SettlementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [limitOpen, setLimitOpen] = useState(false);
  const [settleOpen, setSettleOpen] = useState(false);
  const [newLimit, setNewLimit] = useState<string>(String((merchant as any).credit_limit ?? 0));
  const [settleAmount, setSettleAmount] = useState<string>("");
  const [settleNotes, setSettleNotes] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const balance = Number((merchant as any).balance ?? 0);
  const creditLimit = Number((merchant as any).credit_limit ?? 0);
  const flowBMaxCapacity = balance + creditLimit;
  const outstanding = Math.max(0, -balance);
  const isParent = (merchant as any).merchant_scope === "parent";

  const load = async () => {
    setLoading(true);
    const merchantIds = await merchantDetailQueryIds(merchant);
    const data = await dbSelect<SettlementRow>("merchant_settlement_log", {
      cols: "id, change_amount, balance_before, balance_after, reason, reference_type, reference_id, notes, created_at",
      where: [{ col: "merchant_id", op: "in", val: merchantIds }],
      order: { col: "created_at", asc: false },
      limit: 100,
    }).catch(() => [] as SettlementRow[]);
    setRows(data);
    setLoading(false);
  };
  useEffect(() => { load(); }, [merchant.id]);

  const saveLimit = async () => {
    const val = parseFloat(newLimit);
    if (isNaN(val) || val < 0) return toast({ title: "Geçersiz limit", variant: "destructive" as any });
    setBusy(true);
    try {
      const data = await rpc<{ success: boolean; error_code?: string } | Array<{ success: boolean; error_code?: string }>>("set_merchant_credit_limit", {
        _merchant_id: merchant.id,
        _new_limit: val,
        _reason: "Admin tarafından güncellendi",
      });
      const row = Array.isArray(data) ? data[0] : data;
      if (!row?.success) {
        return toast({ title: translateError({ error_code: row?.error_code }, "Limit değiştirilemedi"), variant: "destructive" as any });
      }
      toast({ title: `Limit güncellendi: ${fmtTRY(val)}` });
      setLimitOpen(false);
      onChanged();
      load();
    } catch (err: any) {
      toast({ title: translateError(err, "Limit değiştirilemedi"), variant: "destructive" as any });
    } finally {
      setBusy(false);
    }
  };

  const recordSettlement = async (sign: 1 | -1) => {
    const val = parseFloat(settleAmount);
    if (isNaN(val) || val <= 0) return toast({ title: "Geçersiz tutar", variant: "destructive" as any });
    setBusy(true);
    try {
      const data = await rpc<{ success: boolean; error_code?: string; balance_after?: number } | Array<{ success: boolean; error_code?: string; balance_after?: number }>>("record_manual_settlement", {
        _merchant_id: merchant.id,
        _amount: sign * val,
        _notes: settleNotes || null,
      });
      const row = Array.isArray(data) ? data[0] : data;
      if (!row?.success) {
        return toast({ title: translateError({ error_code: row?.error_code }, "Settlement kaydedilemedi"), variant: "destructive" as any });
      }
      toast({ title: `Kaydedildi · Yeni bakiye: ${fmtTRY(Number(row.balance_after))}` });
      setSettleOpen(false);
      setSettleAmount("");
      setSettleNotes("");
      onChanged();
      load();
    } catch (err: any) {
      toast({ title: translateError(err, "Settlement kaydedilemedi"), variant: "destructive" as any });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Bakiye özeti */}
      <Card className="p-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <SettlementStat
            label="Defter bakiyesi"
            value={<><span className={balance >= 0 ? "text-success" : "text-destructive"}>{balance >= 0 ? "+" : "−"}{fmtTRY(Math.abs(balance))}</span></>}
            sub={balance >= 0 ? "Merchant alacaklı" : "Merchant bize borçlu"}
          />
          <SettlementStat label="Borç tavanı" value={fmtTRY(creditLimit)} sub="Kasa yetersizse devreye giren borç limiti" />
          <SettlementStat label="Akış B max kapasite" value={fmtTRY(flowBMaxCapacity)} sub="Defter + borç tavanı (yalnızca Akış B)" accent={flowBMaxCapacity > 0 ? "text-foreground" : "text-destructive"} />
          <SettlementStat label="Açık borç" value={fmtTRY(outstanding)} sub={outstanding > 0 ? "Settlement bekliyor" : "Borç yok"} accent={outstanding > 0 ? "text-destructive" : "text-success"} />
        </div>
      </Card>

      {/* Aksiyon kartları */}
      <div className="grid md:grid-cols-2 gap-3">
        {!isParent && <Can do="merchants:update">
          <Card className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div>
                <div className="text-sm font-medium">Borç tavanı (credit_limit)</div>
                <div className="text-xs text-muted-foreground">Defter bakiyesi yetersiz kaldığında Akış B'de negatife inebilme tavanı — çekilebilir bakiye değildir</div>
              </div>
              {!limitOpen && (
                <Button size="sm" variant="outline" onClick={() => { setNewLimit(String(creditLimit)); setLimitOpen(true); }}>
                  <Pencil className="size-4 mr-1" />Düzenle
                </Button>
              )}
            </div>
            {limitOpen && (
              <div className="space-y-2 mt-3">
                <Label className="text-xs">Yeni limit (₺)</Label>
                <Input type="number" inputMode="decimal" value={newLimit} onChange={(e) => setNewLimit(e.target.value)} />
                <div className="flex gap-2">
                  <Button size="sm" onClick={saveLimit} disabled={busy}>{busy ? "Kaydediliyor…" : "Kaydet"}</Button>
                  <Button size="sm" variant="ghost" onClick={() => setLimitOpen(false)} disabled={busy}>Vazgeç</Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Mevcut bakiye yeni limit'in altına inerse <code>BALANCE_EXCEEDS_NEW_LIMIT</code> hatası — önce manuel settlement yapın.
                </p>
              </div>
            )}
          </Card>
        </Can>}

        {!isParent && <Can do="merchants:update">
          <Card className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div>
                <div className="text-sm font-medium">Manuel settlement</div>
                <div className="text-xs text-muted-foreground">Banka transferi yapıldığında defter kapatma</div>
              </div>
              {!settleOpen && (
                <Button size="sm" variant="outline" onClick={() => setSettleOpen(true)}>
                  <Plus className="size-4 mr-1" />Yeni kayıt
                </Button>
              )}
            </div>
            {settleOpen && (
              <div className="space-y-2 mt-3">
                <Label className="text-xs">Tutar (₺)</Label>
                <Input type="number" inputMode="decimal" value={settleAmount} onChange={(e) => setSettleAmount(e.target.value)} placeholder="0" />
                <Label className="text-xs">Not</Label>
                <Input value={settleNotes} onChange={(e) => setSettleNotes(e.target.value)} placeholder="Banka ref vs." />
                <div className="flex gap-2 flex-wrap">
                  <Button size="sm" variant="default" onClick={() => recordSettlement(1)} disabled={busy}>
                    Merchant ödedi (+)
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => recordSettlement(-1)} disabled={busy}>
                    Biz ödedik (−)
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setSettleOpen(false)} disabled={busy}>Vazgeç</Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  <strong>Merchant ödedi</strong>: balance ↑ (örn. EFT geldi). <strong>Biz ödedik</strong>: balance ↓ (biz merchant'a havale yaptık).
                </p>
              </div>
            )}
          </Card>
        </Can>}
        {isParent && (
          <Card className="p-4 md:col-span-2">
            <div className="text-sm font-medium">Parent aggregate defter</div>
            <p className="text-xs text-muted-foreground mt-1">
              Bu ekranda parent altındaki tüm bayilerin settlement hareketleri birleşik gösterilir. Manuel settlement ve borç tavanı değişikliği parent üzerinde yapılmaz; ilgili bayi detayından yapılır.
            </p>
          </Card>
        )}
      </div>

      {/* Cash pool (sadece finance merchant) */}
      {merchant.merchant_type === "finance" && <CashPoolCard merchant={merchant} onChanged={onChanged} />}

      {/* PDF Export */}
      <SettlementExport merchantId={merchant.id} />

      {/* Defter */}
      <Card className="overflow-hidden">
        <div className="p-3 border-b text-sm font-medium">Hareket defteri ({rows.length})</div>
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="text-left p-3">Tarih</th>
              <th className="text-left p-3">Sebep</th>
              <th className="text-right p-3">Hareket</th>
              <th className="text-right p-3">Önce</th>
              <th className="text-right p-3">Sonra</th>
              <th className="text-left p-3">Not</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={6} className="text-center py-6 text-muted-foreground">Yükleniyor…</td></tr>}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={6} className="text-center py-6 text-muted-foreground">Henüz hareket yok.</td></tr>
            )}
            {rows.map((r) => {
              const positive = Number(r.change_amount) > 0;
              const zero = Number(r.change_amount) === 0;
              return (
                <tr key={r.id} className="border-t">
                  <td className="p-3 text-xs whitespace-nowrap">{fmtDate(r.created_at)}</td>
                  <td className="p-3"><Badge variant="outline">{REASON_LABEL[r.reason] ?? r.reason}</Badge></td>
                  <td className={`p-3 text-right tabular-nums font-medium ${zero ? "text-muted-foreground" : positive ? "text-success" : "text-destructive"}`}>
                    {zero ? "—" : (positive ? "+" : "−") + fmtTRY(Math.abs(Number(r.change_amount)))}
                  </td>
                  <td className="p-3 text-right tabular-nums text-xs text-muted-foreground">{fmtTRY(Number(r.balance_before))}</td>
                  <td className="p-3 text-right tabular-nums">{fmtTRY(Number(r.balance_after))}</td>
                  <td className="p-3 text-xs text-muted-foreground max-w-[280px] truncate">{r.notes || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function SettlementStat({ label, value, sub, accent }: { label: string; value: any; sub?: string; accent?: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-[11px] uppercase text-muted-foreground tracking-wider">{label}</div>
      <div className={`text-lg font-semibold tabular-nums mt-1 ${accent ?? ""}`}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

// ============ MERCHANT YETKİLİ KULLANICILAR TAB ============
type MerchantUserRow = {
  id: string;
  user_id: string | null;
  email: string;
  full_name: string | null;
  phone: string | null;
  role: "owner" | "accountant" | "read_only";
  is_active: boolean;
  last_login_at: string | null;
  created_at: string;
};

const ROLE_LABEL: Record<string, string> = {
  owner: "Sahip",
  accountant: "Muhasebeci",
  read_only: "Görüntüleyici",
};

function MerchantUsersTab({ merchant }: { merchant: Merchant }) {
  const [rows, setRows] = useState<MerchantUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<"owner" | "accountant" | "read_only">("owner");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    const data = await dbSelect<MerchantUserRow>("merchant_users", {
      cols: "id, user_id, email, full_name, phone, role, is_active, last_login_at, created_at",
      where: { merchant_id: merchant.id },
      order: { col: "created_at", asc: false },
    }).catch(() => [] as MerchantUserRow[]);
    setRows(data);
    setLoading(false);
  };
  useEffect(() => { load(); }, [merchant.id]);

  const reset = () => { setEmail(""); setFullName(""); setPhone(""); setRole("owner"); setAddOpen(false); };

  const attach = async () => {
    if (!email.trim()) return toast({ title: "E-posta zorunlu", variant: "destructive" as any });
    setBusy(true);
    try {
      const data = await rpc<{ success: boolean; error_code?: string } | Array<{ success: boolean; error_code?: string }>>("admin_attach_merchant_user", {
        _merchant_id: merchant.id,
        _email: email.trim(),
        _role: role,
        _full_name: fullName || null,
        _phone: phone || null,
      });
      const row = Array.isArray(data) ? data[0] : data;
      if (!row?.success) {
        return toast({ title: translateError({ error_code: row?.error_code }, "Eklenemedi"), variant: "destructive" as any });
      }
      toast({ title: "Yetkili eklendi" });
      reset();
      load();
    } catch (err: any) {
      toast({ title: translateError(err, "Eklenemedi"), variant: "destructive" as any });
    } finally {
      setBusy(false);
    }
  };

  const detach = async (id: string) => {
    if (!confirm("Bu yetkili pasifleştirilsin mi?")) return;
    try {
      const data = await rpc<{ success: boolean; error_code?: string } | Array<{ success: boolean; error_code?: string }>>("admin_detach_merchant_user", { _merchant_user_id: id });
      const row = Array.isArray(data) ? data[0] : data;
      if (!row?.success) return toast({ title: translateError({ error_code: row?.error_code }, "İşlem başarısız"), variant: "destructive" as any });
      toast({ title: "Yetkili pasifleştirildi" });
      load();
    } catch (err) {
      toast({ title: translateError(err), variant: "destructive" as any });
    }
  };

  const changeRole = async (id: string, newRole: "owner" | "accountant" | "read_only") => {
    try {
      const data = await rpc<{ success: boolean; error_code?: string } | Array<{ success: boolean; error_code?: string }>>("admin_change_merchant_user_role", { _merchant_user_id: id, _new_role: newRole });
      const row = Array.isArray(data) ? data[0] : data;
      if (!row?.success) return toast({ title: translateError({ error_code: row?.error_code }, "Rol değiştirilemedi"), variant: "destructive" as any });
      toast({ title: "Rol güncellendi" });
      load();
    } catch (err) {
      toast({ title: translateError(err), variant: "destructive" as any });
    }
  };

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-sm font-medium">Merchant BO Yetkilileri</div>
            <p className="text-xs text-muted-foreground">Bu kişiler merchant.* paneline giriş yapabilir.</p>
          </div>
          {!addOpen && (
            <Can do="merchants:update">
              <Button size="sm" onClick={() => setAddOpen(true)}><Plus className="size-4 mr-1" />Yetkili ekle</Button>
            </Can>
          )}
        </div>

        {addOpen && (
          <div className="space-y-3 border rounded-lg p-3 bg-muted/20">
            <div>
              <Label className="text-xs">E-posta (mevcut bir kullanıcının)</Label>
              <Input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="kullanici@firma.com" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Ad Soyad (ops.)</Label>
                <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Telefon (ops.)</Label>
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
            </div>
            <div>
              <Label className="text-xs">Rol</Label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as any)}
                className="w-full h-9 rounded-md border bg-background px-2 text-sm"
              >
                <option value="owner">Sahip — tam yetki</option>
                <option value="accountant">Muhasebeci — finansal okuma</option>
                <option value="read_only">Görüntüleyici — salt okuma</option>
              </select>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={attach} disabled={busy}>{busy ? "Ekleniyor…" : "Ekle"}</Button>
              <Button size="sm" variant="ghost" onClick={reset} disabled={busy}>Vazgeç</Button>
            </div>
            <p className="text-xs text-muted-foreground">
              ⚠️ Kullanıcının önce normal Wallet kaydı olması gerekir. Henüz hesabı yoksa kendisinin /auth sayfasından kayıt olmasını isteyin.
            </p>
          </div>
        )}
      </Card>

      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="text-left p-3">Kullanıcı</th>
              <th className="text-left p-3">Rol</th>
              <th className="text-center p-3">Durum</th>
              <th className="text-left p-3">Son giriş</th>
              <th className="text-right p-3">Eklenme</th>
              <th className="text-right p-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={6} className="text-center py-6 text-muted-foreground">Yükleniyor…</td></tr>}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={6} className="text-center py-6 text-muted-foreground">Henüz yetkili yok.</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="p-3">
                  <div className="text-sm">{r.full_name || r.email}</div>
                  <div className="text-xs text-muted-foreground">{r.email}{r.phone && ` · ${r.phone}`}</div>
                </td>
                <td className="p-3">
                  <Can do="merchants:update" fallback={<Badge variant="outline">{ROLE_LABEL[r.role]}</Badge>}>
                    <select
                      value={r.role}
                      onChange={(e) => changeRole(r.id, e.target.value as any)}
                      className="h-7 rounded border bg-background px-2 text-xs"
                    >
                      <option value="owner">Sahip</option>
                      <option value="accountant">Muhasebeci</option>
                      <option value="read_only">Görüntüleyici</option>
                    </select>
                  </Can>
                </td>
                <td className="p-3 text-center">
                  {r.is_active ? <Badge>Aktif</Badge> : <Badge variant="destructive">Pasif</Badge>}
                </td>
                <td className="p-3 text-xs">{r.last_login_at ? fmtDate(r.last_login_at) : <span className="text-muted-foreground">—</span>}</td>
                <td className="p-3 text-xs text-right text-muted-foreground">{fmtDate(r.created_at)}</td>
                <td className="p-3 text-right">
                  {r.is_active && (
                    <Can do="merchants:update">
                      <Button size="sm" variant="ghost" onClick={() => detach(r.id)}>
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    </Can>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function CashPoolCard({ merchant, onChanged }: { merchant: Merchant; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState<string>(String((merchant as any).cash_pool ?? ""));
  const [busy, setBusy] = useState(false);

  const cashPool = (merchant as any).cash_pool;
  const updatedAt = (merchant as any).cash_pool_updated_at;
  const stale = updatedAt && (Date.now() - new Date(updatedAt).getTime()) > 30 * 60 * 1000;

  const save = async () => {
    const num = parseFloat(val);
    if (isNaN(num) || num < 0) return toast({ title: "Geçersiz tutar", variant: "destructive" as any });
    setBusy(true);
    try {
      const data = await rpc<{ success: boolean; error_code?: string } | Array<{ success: boolean; error_code?: string }>>("admin_set_cash_pool", {
        _merchant_id: merchant.id,
        _cash_pool: num,
        _notes: "Admin manual update",
      });
      const row = Array.isArray(data) ? data[0] : data;
      if (!row?.success) {
        return toast({ title: translateError({ error_code: row?.error_code }, "Kaydedilemedi"), variant: "destructive" as any });
      }
      toast({ title: `Cash pool güncellendi: ${fmtTRY(num)}` });
      setEditing(false);
      onChanged();
    } catch (err: any) {
      toast({ title: translateError(err, "Kaydedilemedi"), variant: "destructive" as any });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-medium">Kasa nakdi (cash_pool)</div>
          <div className="text-xs text-muted-foreground">Akış D'de routing kontrolü için merchant'ın kendi banka kasasındaki nakit. NULL ise bypass edilir.</div>
        </div>
        {!editing && (
          <Button size="sm" variant="outline" onClick={() => { setVal(String(cashPool ?? "")); setEditing(true); }}>
            <Pencil className="size-4 mr-1" />Manuel set
          </Button>
        )}
      </div>

      {!editing ? (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-xs text-muted-foreground">Şu anki değer</div>
            <div className={`text-lg font-semibold tabular-nums ${cashPool == null ? "text-muted-foreground" : ""}`}>
              {cashPool == null ? "Bilinmiyor (NULL)" : fmtTRY(Number(cashPool))}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Son güncelleme</div>
            <div className={`text-sm ${stale ? "text-warning font-medium" : ""}`}>
              {updatedAt ? fmtDate(updatedAt) : "—"}
              {stale && " ⚠️ stale"}
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <Label className="text-xs">Yeni cash_pool tutarı (₺)</Label>
          <Input type="number" inputMode="decimal" value={val} onChange={(e) => setVal(e.target.value)} />
          <div className="flex gap-2">
            <Button size="sm" onClick={save} disabled={busy}>{busy ? "Kaydediliyor…" : "Kaydet"}</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={busy}>Vazgeç</Button>
          </div>
          <p className="text-[10px] text-muted-foreground">v2: cash_pool_api_url'den otomatik sync gelecek. Şimdi manuel.</p>
        </div>
      )}
    </Card>
  );
}

function SettlementExport({ merchantId }: { merchantId: string }) {
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86400 * 1000).toISOString().slice(0, 10);
  const [start, setStart] = useState(monthAgo);
  const [end, setEnd] = useState(today);
  const [busy, setBusy] = useState(false);

  const exportPdf = async () => {
    setBusy(true);
    try {
      const { exportSettlementPdf } = await import("@/lib/exportSettlement");
      await exportSettlementPdf(merchantId, start, end);
    } catch (err: any) {
      toast({ title: err.message || "Export başarısız", variant: "destructive" as any });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-4 space-y-2">
      <div className="text-sm font-medium">PDF Export</div>
      <p className="text-xs text-muted-foreground">Tarih aralığında settlement defterini PDF olarak indir (yeni sekme açılır + auto print).</p>
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
        <Button onClick={exportPdf} disabled={busy}>{busy ? "Hazırlanıyor…" : "PDF olarak aç"}</Button>
      </div>
    </Card>
  );
}

// ============================================================
// CashPoolTab — Finansal özet + manuel kasa hareketi (admin/accounting)
// ============================================================
function CashPoolTab({ merchant, onChanged }: { merchant: any; onChanged: () => void }) {
  const { user, can } = useAuth();
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86400 * 1000).toISOString().slice(0, 10);
  const [start, setStart] = useState(monthAgo);
  const [end, setEnd] = useState(today);
  const [summary, setSummary] = useState<any>(null);
  const [movements, setMovements] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Manuel hareket form
  const [adjAmount, setAdjAmount] = useState("");
  const [adjReason, setAdjReason] = useState("");
  const [adjNote, setAdjNote] = useState("");
  const [collectionFeePct, setCollectionFeePct] = useState(String(merchant.finance_collection_fee_pct ?? 0));
  const [collectionFixedFee, setCollectionFixedFee] = useState(String(merchant.finance_collection_fixed_fee ?? 0));
  const [adjBusy, setAdjBusy] = useState(false);

  // Overdraft form (negatif kasa limiti)
  const [odEnabled, setOdEnabled] = useState<boolean>(!!merchant.cash_pool_overdraft_enabled);
  const [odLimit, setOdLimit] = useState<string>(String(merchant.cash_pool_overdraft_limit ?? 0));
  const [odBusy, setOdBusy] = useState(false);

  const canAdjust = can?.("merchants", "adjust") || can?.("settlement", "adjust") || true; // admin/accounting hak — RPC tarafında zaten check var
  const canEditCollectionFee = can?.("merchants", "cash_collection_fee") ?? false;
  const adjNum = parseFloat(adjAmount);
  const isCollectionOut = Number.isFinite(adjNum) && adjNum < 0;
  const collectionPctNum = Number(collectionFeePct || 0);
  const collectionFixedNum = Number(collectionFixedFee || 0);
  const collectionFeeAmount = isCollectionOut
    ? Math.round(((Math.abs(adjNum) * collectionPctNum / 100) + collectionFixedNum) * 100) / 100
    : 0;

  const load = async () => {
    setLoading(true);
    const [s, m] = await Promise.all([
      rpc<any>("get_merchant_financial_summary", {
        _merchant_id: merchant.id,
        _start_date: start,
        _end_date: end,
      }).catch(() => null),
      dbSelect<any>("merchant_cash_pool_log", {
        cols: "id, change_amount, balance_before, balance_after, reason, note, collection_fee_pct, collection_fixed_fee, collection_fee_amount, created_at",
        where: { merchant_id: merchant.id },
        order: { col: "created_at", asc: false },
        limit: 50,
      }).catch(() => [] as any[]),
    ]);
    setSummary(Array.isArray(s) ? s[0] : s);
    setMovements(m);
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [merchant.id, start, end]);

  const submitAdjust = async () => {
    const num = parseFloat(adjAmount);
    if (!num || num === 0) {
      toast({ title: "Tutar 0 olamaz", variant: "destructive" as any }); return;
    }
    if (!adjReason.trim()) {
      toast({ title: "Sebep zorunlu", variant: "destructive" as any }); return;
    }
    if (num < 0) {
      const projected = Number(summary?.current_cash_pool ?? 0) + num;
      if (projected < 0) {
        if (!confirm(`Bu hareket sonrası kasa NEGATİF olacak (${fmtTRY(projected)}). Emin misiniz?`)) return;
      }
    }
    setAdjBusy(true);
    try {
      // reason: kullanıcı kategorisi (free-text), DB tarafı 'manual_in' veya 'manual_out' olarak normalize eder
      const dbReason = num > 0 ? "manual_in" : "manual_out";
      const userReason = adjReason.trim();
      const noteCombined = `[${userReason}] ${adjNote.trim()}`.trim();
      const data = await rpc<{ success: boolean; error_code?: string; new_cash_pool?: number } | Array<{ success: boolean; error_code?: string; new_cash_pool?: number }>>("adjust_merchant_cash_pool", {
        _merchant_id: merchant.id,
        _amount: num,
        _reason: dbReason,
        _note: noteCombined || null,
        _collection_fee_pct: num < 0 && canEditCollectionFee ? collectionPctNum : null,
        _collection_fixed_fee: num < 0 && canEditCollectionFee ? collectionFixedNum : null,
      });
      const row = Array.isArray(data) ? data[0] : data;
      if (!row?.success) {
        toast({ title: row?.error_code || "Kayıt başarısız", variant: "destructive" as any });
        return;
      }
      toast({ title: `Kasa güncellendi: ${fmtTRY(Number(row.new_cash_pool))}` });
      setAdjAmount(""); setAdjReason(""); setAdjNote("");
      await load();
      onChanged();
    } catch (err: any) {
      toast({ title: err.message || "Hata", variant: "destructive" as any });
    } finally {
      setAdjBusy(false);
    }
  };

  const editNote = async (logId: number, currentNote: string) => {
    const next = prompt("Not güncelle (tutar değişmez)", currentNote || "");
    if (next === null) return;
    try {
      const data = await rpc<{ success: boolean; error_code?: string } | Array<{ success: boolean; error_code?: string }>>("update_cash_pool_log_note", { _log_id: logId, _note: next });
      const row = Array.isArray(data) ? data[0] : data;
      if (!row?.success) { toast({ title: row?.error_code, variant: "destructive" as any }); return; }
      toast({ title: "Not güncellendi" });
      await load();
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : String(err), variant: "destructive" as any });
    }
  };

  const revertMovement = async (mv: any) => {
    if (!["manual_in", "manual_out"].includes(mv.reason)) {
      toast({ title: "Sadece manuel hareketler geri alınabilir", variant: "destructive" as any });
      return;
    }
    if (!confirm(`Bu hareketi geri al? Ters hareket atılacak: ${fmtTRY(-Number(mv.change_amount))}`)) return;
    try {
      const data = await rpc<{ success: boolean; error_code?: string } | Array<{ success: boolean; error_code?: string }>>("adjust_merchant_cash_pool", {
        _merchant_id: merchant.id,
        _amount: -Number(mv.change_amount),
        _reason: "reverted",
        _note: `Geri alındı: log #${mv.id}`,
      });
      const row = Array.isArray(data) ? data[0] : data;
      if (!row?.success) { toast({ title: row?.error_code, variant: "destructive" as any }); return; }
      toast({ title: "Geri alma başarılı" });
      await load();
      onChanged();
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : String(err), variant: "destructive" as any });
    }
  };

  return (
    <div className="space-y-4">
      {/* Tarih aralığı */}
      <Card className="p-4 space-y-3">
        <div className="flex flex-wrap items-end gap-2">
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
        </div>
      </Card>

      {/* Finansal özet */}
      {summary && (
        <Card className="p-4">
          <div className="text-sm font-semibold mb-3">Finansal Özet ({start} → {end})</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <Stat label="Mevcut kasa" value={fmtTRY(Number(summary.current_cash_pool ?? 0))} highlight />
            <Stat
              label={odEnabled ? `Müsait kapasite (+${fmtTRY(Number(odLimit))} limit)` : "Müsait kapasite"}
              value={fmtTRY(
                Number(summary.current_cash_pool ?? 0)
                + (odEnabled ? Number(odLimit || 0) : 0)
              )}
              highlight
            />
            <Stat label="Toplam ciro" value={fmtTRY(Number(summary.total_volume ?? 0))} />
            <Stat label="Toplam komisyon" value={fmtTRY(Number(summary.total_commission ?? 0))} />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs mt-4 pt-3 border-t">
            <Stat label="Yatırım adet" value={String(summary.topup_count ?? 0)} />
            <Stat label="Yatırım gross" value={fmtTRY(Number(summary.topup_volume_gross ?? 0))} />
            <Stat label="Yatırım komisyon" value={fmtTRY(Number(summary.topup_commission ?? 0))} />
            <Stat label="Yatırım net (kasaya)" value={fmtTRY(Number(summary.topup_volume_net ?? 0))} />
            <Stat label="Çekim adet" value={String(summary.withdraw_count ?? 0)} />
            <Stat label="Çekim hacim" value={fmtTRY(Number(summary.withdraw_volume ?? 0))} />
            <Stat label="Çekim komisyon" value={fmtTRY(Number(summary.withdraw_commission ?? 0))} />
            <Stat label="Manuel hareket" value={`+${fmtTRY(Number(summary.manual_in ?? 0))} / −${fmtTRY(Number(summary.manual_out ?? 0))}`} />
          </div>
        </Card>
      )}

      {/* Manuel hareket */}
      {canAdjust && (
        <Card className="p-4 space-y-3">
          <div className="text-sm font-semibold">Manuel Kasa Hareketi</div>
          <p className="text-xs text-muted-foreground">
            Pozitif tutar = kasaya giriş, negatif tutar = platformun finance merchant'tan tahsilatı/çıkış. Negatif kasa için onay alınır. Tüm hareketler audit'lidir.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <div>
              <Label className="text-xs">Tutar (₺) — signed</Label>
              <Input
                type="number"
                step="0.01"
                placeholder="örn: +5000 veya -1000"
                value={adjAmount}
                onChange={(e) => setAdjAmount(e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs">Sebep (kısa)</Label>
              <Input
                placeholder="örn: bank_transfer, duzeltme, opening_balance"
                value={adjReason}
                onChange={(e) => setAdjReason(e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs">Not (opsiyonel)</Label>
              <Input
                placeholder="ek açıklama"
                value={adjNote}
                onChange={(e) => setAdjNote(e.target.value)}
              />
            </div>
          </div>
          {isCollectionOut && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 rounded-lg border bg-muted/20 p-3">
              <div>
                <Label className="text-xs">Tahsilat masrafı (%)</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  value={collectionFeePct}
                  onChange={(e) => setCollectionFeePct(e.target.value)}
                  disabled={!canEditCollectionFee}
                />
              </div>
              <div>
                <Label className="text-xs">Sabit masraf (₺)</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={collectionFixedFee}
                  onChange={(e) => setCollectionFixedFee(e.target.value)}
                  disabled={!canEditCollectionFee}
                />
              </div>
              <div className="flex flex-col justify-end">
                <div className="text-xs text-muted-foreground">Hesaplanan masraf</div>
                <div className="text-sm font-semibold text-destructive">{fmtTRY(collectionFeeAmount)}</div>
                {!canEditCollectionFee && (
                  <div className="text-[10px] text-muted-foreground">Değiştirmek için hassas yetki gerekli.</div>
                )}
              </div>
            </div>
          )}
          <Button onClick={submitAdjust} disabled={adjBusy || !adjAmount || !adjReason}>
            {adjBusy ? "Kaydediliyor…" : "Hareket Kaydet"}
          </Button>
        </Card>
      )}

      {/* Overdraft (negatif kasa limiti) */}
      {canAdjust && (
        <Card className="p-4 space-y-3">
          <div className="text-sm font-semibold">Negatif Kasa Limiti</div>
          <p className="text-xs text-muted-foreground">
            Aktifse withdraw routing kasa eksiye düşse bile (limit dahilinde) bu merchant'ı seçebilir.
            Kapalıyken kasa &gt;= çekim tutarı şartı aranır. Pasif edilirse limit korunur, sonra tekrar açılabilir.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 items-end">
            <div className="flex items-center gap-2">
              <Switch checked={odEnabled} onCheckedChange={setOdEnabled} />
              <Label className="text-sm">{odEnabled ? "Aktif" : "Pasif"}</Label>
            </div>
            <div>
              <Label className="text-xs">Limit (₺)</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                placeholder="0"
                value={odLimit}
                onChange={(e) => setOdLimit(e.target.value)}
                disabled={!odEnabled}
              />
            </div>
            <Button
              onClick={async () => {
                const num = parseFloat(odLimit) || 0;
                if (num < 0) { toast({ title: "Limit negatif olamaz", variant: "destructive" as any }); return; }
                setOdBusy(true);
                try {
                  const data = await rpc<{ success: boolean; error_code?: string } | Array<{ success: boolean; error_code?: string }>>("update_merchant_overdraft", {
                    _merchant_id: merchant.id,
                    _enabled: odEnabled,
                    _limit: num,
                  });
                  const row = Array.isArray(data) ? data[0] : data;
                  if (!row?.success) {
                    toast({ title: row?.error_code || "Kayıt başarısız", variant: "destructive" as any });
                    return;
                  }
                  toast({ title: odEnabled ? `Limit aktif: ${fmtTRY(num)}` : "Limit pasif" });
                  onChanged();
                } catch (err: any) {
                  toast({ title: err.message || "Hata", variant: "destructive" as any });
                } finally {
                  setOdBusy(false);
                }
              }}
              disabled={odBusy}
            >
              {odBusy ? "Kaydediliyor…" : "Kaydet"}
            </Button>
          </div>
        </Card>
      )}

      {/* Hareketler tablosu */}
      <Card className="p-4">
        <div className="text-sm font-semibold mb-3">Son Hareketler (50)</div>
        {loading && <div className="text-xs text-muted-foreground">Yükleniyor…</div>}
        {!loading && movements.length === 0 && (
          <div className="text-xs text-muted-foreground">Henüz hareket yok.</div>
        )}
        {!loading && movements.length > 0 && (
          <table className="w-full text-xs">
            <thead className="text-muted-foreground border-b">
              <tr>
                <th className="text-left p-2">Tarih</th>
                <th className="text-left p-2">Sebep</th>
                <th className="text-right p-2">Tutar</th>
                <th className="text-left p-2">Not</th>
                <th className="text-right p-2">İşlem</th>
              </tr>
            </thead>
            <tbody>
              {movements.map((mv) => (
                <tr key={mv.id} className="border-b last:border-b-0">
                  <td className="p-2 text-muted-foreground tabular-nums">
                    {new Date(mv.created_at).toLocaleString("tr-TR")}
                  </td>
                  <td className="p-2"><Badge variant="outline">{mv.reason}</Badge></td>
                  <td className={`p-2 text-right tabular-nums font-medium ${
                    Number(mv.change_amount) >= 0 ? "text-success" : "text-destructive"
                  }`}>
                    {Number(mv.change_amount) >= 0 ? "+" : "−"}{fmtTRY(Math.abs(Number(mv.change_amount)))}
                  </td>
                  <td className="p-2 text-muted-foreground">
                    {mv.note || "—"}
                    {Number(mv.collection_fee_amount ?? 0) > 0 && (
                      <div className="text-[10px] text-destructive mt-1">
                        Masraf: {fmtTRY(Number(mv.collection_fee_amount))}
                        {" "}(%{Number(mv.collection_fee_pct ?? 0).toFixed(2)} + {fmtTRY(Number(mv.collection_fixed_fee ?? 0))})
                      </div>
                    )}
                  </td>
                  <td className="p-2 text-right">
                    {canAdjust && (
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => editNote(mv.id, mv.note)}>Not</Button>
                        {["manual_in", "manual_out"].includes(mv.reason) && (
                          <Button size="sm" variant="ghost" onClick={() => revertMovement(mv)}>Geri al</Button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {/* PDF Export — kasa defteri (yukarıdaki tarih aralığını kullanır) */}
      <CashPoolExport merchantId={merchant.id} start={start} end={end} />
    </div>
  );
}

function CashPoolExport({ merchantId, start, end }: { merchantId: string; start: string; end: string }) {
  const [busy, setBusy] = useState(false);

  const exportPdf = async () => {
    setBusy(true);
    try {
      const { exportCashPoolPdf } = await import("@/lib/exportSettlement");
      await exportCashPoolPdf(merchantId, start, end);
    } catch (err: any) {
      toast({ title: err.message || "Export başarısız", variant: "destructive" as any });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-4 space-y-2">
      <div className="text-sm font-medium">Kasa Defteri PDF</div>
      <p className="text-xs text-muted-foreground">
        Yukarıdaki tarih aralığında kasa hareketlerini (Akış C topup, Akış D withdraw, manuel) PDF olarak indir. Yeni sekme açılır + auto print.
      </p>
      <div>
        <Button onClick={exportPdf} disabled={busy}>{busy ? "Hazırlanıyor…" : `PDF olarak aç (${start} → ${end})`}</Button>
      </div>
    </Card>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase text-muted-foreground tracking-wide">{label}</div>
      <div className={`tabular-nums ${highlight ? "text-base font-semibold" : "font-medium"}`}>{value}</div>
    </div>
  );
}
