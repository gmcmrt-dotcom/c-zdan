import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import AdminLayout from "@/components/AdminLayout";
import { rpc } from "@/lib/rpc";
import { dbSelect } from "@/lib/db";
import { invokeFunction } from "@/lib/fn";
import { fmtDate, fmtTRY } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { translateError } from "@/lib/i18n-errors";
import { endpointLabel, errorCodeLabel } from "@/lib/bo-labels";
import { RefreshCw, AlertTriangle, CheckCircle2, ExternalLink, Loader2, Play, PlugZap, Search, Download, Store } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { maskApiKey, maskUrl, sensitiveText } from "@/lib/mask";
import { exportFinanceIntegrationsCsv } from "@/lib/admin-finance-integrations";
import { Skeleton } from "@/components/ui/skeleton";

type FinanceMerchant = {
  id: string;
  name: string;
  is_active: boolean;
  api_key: string;
  topup_init_url: string | null;
  webhook_url: string | null;
  cash_pool: number | null;
  cash_pool_updated_at: string | null;
  cash_pool_api_url: string | null;
  deposit_commission_pct: number | null;
  deposit_fixed_fee: number | null;
  withdraw_commission_pct: number | null;
  withdraw_fixed_fee: number | null;
  deposit_min_amount: number | null;
  deposit_max_amount: number | null;
  withdraw_min_amount: number | null;
  withdraw_max_amount: number | null;
  per_tx_limit: number | null;
  daily_limit: number | null;
};

type ApiCall = {
  merchant_id: string;
  endpoint: string;
  status_code: number | null;
  error_code: string | null;
  latency_ms: number | null;
  created_at: string;
};

type TestResult = {
  success: boolean;
  error_code: string | null;
  merchant: { id: string; name: string };
  request: {
    url: string;
    headers: Record<string, string>;
    body: Record<string, unknown>;
  };
  response: {
    status: number;
    latency_ms: number;
    json: Record<string, unknown> | null;
    text_preview: string;
  };
  contract: {
    ok: boolean;
    checks: Array<{ key: string; ok: boolean; label: string }>;
  };
  callback_payload_example: Record<string, unknown>;
};

type CashSyncResult = {
  success: boolean;
  error_code: string | null;
  merchant: { id: string; name: string };
  before: number;
  reported_cash_pool: number | null;
  delta: number;
  log_id: number | null;
  response: {
    status: number;
    latency_ms: number;
    json: Record<string, unknown> | null;
    text_preview: string;
  };
  expected_response_contract: Record<string, unknown>;
};

const STALE_MS = 30 * 60 * 1000;
const MOCK_LOCAL = import.meta.env.VITE_DEV_MOCK_MERCHANT === "true";

type FilterPreset = "all" | "missing_init" | "stale_cash" | "missing_sync" | "inactive";

function isStale(ts: string | null) {
  if (!ts) return true;
  return Date.now() - new Date(ts).getTime() > STALE_MS;
}

function yesNo(ok: boolean, okText = "Hazır", badText = "Eksik") {
  return (
    <Badge variant={ok ? "secondary" : "destructive"} className={ok ? "text-success" : ""}>
      {ok ? okText : badText}
    </Badge>
  );
}

function limitLabel(min: number | null, max: number | null) {
  if (min == null && max == null) return "Sınırsız";
  return `${min != null ? fmtTRY(min) : "0"} - ${max != null ? fmtTRY(max) : "∞"}`;
}

export default function AdminFinanceIntegrations() {
  const { can } = useAuth();
  const [rows, setRows] = useState<FinanceMerchant[]>([]);
  const [calls, setCalls] = useState<ApiCall[]>([]);
  const [loading, setLoading] = useState(false);
  const [testOpen, setTestOpen] = useState(false);
  const [testMerchant, setTestMerchant] = useState<FinanceMerchant | null>(null);
  const [testAmount, setTestAmount] = useState("100");
  const [testMethod, setTestMethod] = useState("havale");
  const [testLoading, setTestLoading] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [syncOpen, setSyncOpen] = useState(false);
  const [syncResult, setSyncResult] = useState<CashSyncResult | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterPreset, setFilterPreset] = useState<FilterPreset>("all");

  const canViewApiCredentials = can("merchants", "api_credentials");
  const canViewIntegrationUrls = can("merchants", "integration_urls");

  const load = async () => {
    setLoading(true);
    const [merchantRes, callRes] = await Promise.all([
      rpc<FinanceMerchant[]>("staff_list_finance_merchants").catch(() => [] as FinanceMerchant[]),
      dbSelect<ApiCall>("merchant_api_calls", {
        cols: "merchant_id, endpoint, status_code, error_code, latency_ms, created_at",
        order: { col: "created_at", asc: false },
        limit: 500,
      }).catch(() => [] as ApiCall[]),
    ]);
    setRows(merchantRes);
    setCalls(callRes);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const latestByMerchant = useMemo(() => {
    const map = new Map<string, ApiCall>();
    for (const call of calls) {
      if (!map.has(call.merchant_id)) map.set(call.merchant_id, call);
    }
    return map;
  }, [calls]);

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return rows.filter((row) => {
      if (filterPreset === "inactive" && row.is_active) return false;
      if (filterPreset === "missing_init" && (row.topup_init_url || !row.is_active)) return false;
      if (filterPreset === "stale_cash" && (!row.is_active || !isStale(row.cash_pool_updated_at))) return false;
      if (filterPreset === "missing_sync" && (row.cash_pool_api_url || !row.is_active)) return false;
      if (!q) return true;
      const haystack = [
        row.name,
        row.api_key,
        row.topup_init_url ?? "",
        row.cash_pool_api_url ?? "",
        row.webhook_url ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [rows, searchQuery, filterPreset]);

  const stats = useMemo(() => {
    const active = filteredRows.filter((r) => r.is_active);
    const totalCash = filteredRows.reduce((s, r) => s + Number(r.cash_pool ?? 0), 0);
    return {
      total: filteredRows.length,
      active: active.length,
      passive: filteredRows.length - active.length,
      missingInit: active.filter((r) => !r.topup_init_url).length,
      staleCash: active.filter((r) => isStale(r.cash_pool_updated_at)).length,
      missingSync: active.filter((r) => !r.cash_pool_api_url).length,
      totalCash: fmtTRY(totalCash),
    };
  }, [filteredRows]);

  const filterButtons: { id: FilterPreset; label: string }[] = [
    { id: "all", label: "Tümü" },
    { id: "missing_init", label: "Init eksik" },
    { id: "stale_cash", label: "Kasa stale" },
    { id: "missing_sync", label: "Sync eksik" },
    { id: "inactive", label: "Pasif" },
  ];

  const openTest = (row: FinanceMerchant) => {
    setTestMerchant(row);
    setTestAmount(String(row.deposit_min_amount && row.deposit_min_amount > 0 ? row.deposit_min_amount : 100));
    setTestMethod("havale");
    setTestResult(null);
    setTestOpen(true);
  };

  const runTest = async () => {
    if (!testMerchant) return;
    setTestLoading(true);
    setTestResult(null);
    try {
      const result = await invokeFunction<TestResult>("admin-finance-integration-test", {
        merchant_id: testMerchant.id,
        amount: Number(testAmount),
        method_type: testMethod.trim() || "havale",
      });
      setTestResult(result);
      if (result.success) {
        toast({ title: "Entegrasyon testi başarılı" });
      } else {
        toast({ title: `Entegrasyon testi başarısız: ${errorCodeLabel(result.error_code ?? "UNKNOWN")}`, variant: "destructive" as any });
      }
      load();
    } catch (err) {
      toast({ title: translateError(err, "Test çağrısı başlatılamadı"), variant: "destructive" as any });
    } finally {
      setTestLoading(false);
    }
  };

  const runCashSync = async (row: FinanceMerchant) => {
    if (!row.cash_pool_api_url) return;
    if (!confirm(`${row.name} için cash_pool API sync çalıştırılsın mı? Dönen absolute bakiye yerel kasa değerini güncelleyebilir.`)) {
      return;
    }
    setSyncingId(row.id);
    setSyncResult(null);
    try {
      const result = await invokeFunction<CashSyncResult>("admin-cash-pool-sync", { merchant_id: row.id });
      setSyncResult(result);
      setSyncOpen(true);
      if (result.success) {
        toast({ title: `Cash pool sync tamamlandı: ${fmtTRY(result.reported_cash_pool ?? 0)}` });
      } else {
        toast({ title: `Cash pool sync başarısız: ${errorCodeLabel(result.error_code ?? "UNKNOWN")}`, variant: "destructive" as any });
      }
      load();
    } catch (err) {
      toast({ title: translateError(err, "Cash pool sync başlatılamadı"), variant: "destructive" as any });
    } finally {
      setSyncingId(null);
    }
  };

  return (
    <AdminLayout title="Finance Entegrasyonları" requireAny={["finance_integrations:view", "merchants:view_full"]}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-2xl font-serif font-bold flex items-center gap-2">
              <PlugZap className="size-6 text-primary" /> Finance Entegrasyonları
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Akış C/D için gerçek merchant bağlantı hazırlığını, kasa tazeliğini ve callback sözleşmesini tek yerden kontrol edin.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link to="/admin/merchants?type=finance">
                <Store className="size-4 mr-1" /> Finans merchant'lar
              </Link>
            </Button>
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={`size-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Yenile
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={filteredRows.length === 0}
              onClick={() =>
                exportFinanceIntegrationsCsv(filteredRows, latestByMerchant, {
                  showApiKey: canViewApiCredentials,
                  showUrls: canViewIntegrationUrls,
                  isStale,
                })
              }
            >
              <Download className="size-4 mr-1" /> CSV
            </Button>
          </div>
        </div>

        {MOCK_LOCAL && (
          <Card className="p-4 border-warning/50 bg-warning/10 text-sm flex gap-2">
            <AlertTriangle className="size-4 text-warning shrink-0 mt-0.5" />
            <div>
              <div className="font-medium">Local mock açık görünüyor.</div>
              <div className="text-muted-foreground">
                `VITE_DEV_MOCK_MERCHANT=true` frontend build guard'ına takılır. Production için bu değer kapalı olmalı.
              </div>
            </div>
          </Card>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <FiStatCard label="Listede" value={String(stats.total)} loading={loading} />
          <FiStatCard label="Aktif" value={String(stats.active)} loading={loading} />
          <FiStatCard label="Pasif" value={String(stats.passive)} loading={loading} accent={stats.passive > 0 ? "destructive" : undefined} />
          <FiStatCard
            label="Init URL eksik"
            value={String(stats.missingInit)}
            loading={loading}
            accent={stats.missingInit > 0 ? "destructive" : undefined}
          />
          <FiStatCard
            label="Kasa stale (30dk)"
            value={String(stats.staleCash)}
            loading={loading}
            accent={stats.staleCash > 0 ? "warning" : undefined}
          />
          <FiStatCard
            label="Toplam kasa"
            value={stats.totalCash}
            loading={loading}
            accent={stats.missingSync > 0 ? "warning" : undefined}
            sub={stats.missingSync > 0 ? `Sync URL eksik: ${stats.missingSync}` : undefined}
          />
        </div>

        <div className="flex flex-col gap-3">
          <div className="relative max-w-md">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Ara: merchant adı, API key, init/sync URL…"
              className="pl-9 h-9"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {filterButtons.map((fb) => (
              <Button
                key={fb.id}
                size="sm"
                variant={filterPreset === fb.id ? "default" : "outline"}
                onClick={() => setFilterPreset(fb.id)}
              >
                {fb.label}
              </Button>
            ))}
          </div>
        </div>

        <Card className="overflow-hidden">
          <div className="p-3 border-b bg-muted/40 text-sm text-muted-foreground">
            `topup_init_url` Akış C başlangıcı için zorunludur. `cash_pool_updated_at` 30 dakikadan eskiyse Akış D routing riski artar.
          </div>
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left">
              <tr>
                <th className="p-3">Merchant</th>
                <th className="p-3">Akış C Init</th>
                <th className="p-3">Cash Pool</th>
                <th className="p-3">Limitler</th>
                <th className="p-3">Komisyon</th>
                <th className="p-3">Son API / Test</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">Yükleniyor...</td></tr>}
              {!loading && rows.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">Finance merchant yok.</td></tr>}
              {!loading && rows.length > 0 && filteredRows.length === 0 && (
                <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">Filtreyle eşleşen kayıt yok.</td></tr>
              )}
              {!loading && filteredRows.map((row) => {
                const latest = latestByMerchant.get(row.id);
                const stale = isStale(row.cash_pool_updated_at);
                return (
                  <tr key={row.id} className="border-t align-top">
                    <td className="p-3">
                      <div className="font-medium">{row.name}</div>
                      <div className="text-xs text-muted-foreground font-mono">{sensitiveText(can, "merchants", "api_credentials", row.api_key, maskApiKey)}</div>
                      <div className="mt-1 flex gap-1">
                        {yesNo(row.is_active, "Aktif", "Pasif")}
                        <Link to={`/admin/merchants/${row.id}?type=finance`} className="text-xs text-primary inline-flex items-center gap-1">
                          Detay <ExternalLink className="size-3" />
                        </Link>
                      </div>
                    </td>
                    <td className="p-3 max-w-[260px]">
                      {yesNo(Boolean(row.topup_init_url), "URL var", "URL eksik")}
                      <div className="mt-1 text-xs text-muted-foreground truncate" title={can("merchants", "integration_urls") ? (row.topup_init_url ?? "") : undefined}>
                        {row.topup_init_url
                          ? sensitiveText(can, "merchants", "integration_urls", row.topup_init_url, maskUrl)
                          : "MerchantDetail > Entegrasyon tabından girilmeli"}
                      </div>
                      <div className="mt-2 text-xs">
                        Webhook:{" "}
                        {row.webhook_url ? (
                          can("merchants", "network_config") ? (
                            <span className="text-success font-mono truncate inline-block max-w-[200px] align-bottom" title={row.webhook_url}>
                              {row.webhook_url}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">tanımlı (gizli)</span>
                          )
                        ) : (
                          <span className="text-muted-foreground">opsiyonel/boş</span>
                        )}
                      </div>
                    </td>
                    <td className="p-3">
                      <div className="font-medium tabular-nums">{row.cash_pool == null ? "—" : fmtTRY(row.cash_pool)}</div>
                      <div className={`text-xs ${stale ? "text-destructive" : "text-success"}`}>
                        {row.cash_pool_updated_at ? fmtDate(row.cash_pool_updated_at) : "Hiç sync yok"}
                      </div>
                      <div className="mt-1">{yesNo(!stale, "Taze", "Stale")}</div>
                      <div className="mt-1 text-xs text-muted-foreground truncate" title={can("merchants", "integration_urls") ? (row.cash_pool_api_url ?? "") : undefined}>
                        Sync:{" "}
                        {row.cash_pool_api_url
                          ? sensitiveText(can, "merchants", "integration_urls", row.cash_pool_api_url, maskUrl)
                          : "manuel / adapter yok"}
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-2 h-7 text-xs"
                        disabled={!row.is_active || !row.cash_pool_api_url || syncingId === row.id}
                        onClick={() => runCashSync(row)}
                      >
                        {syncingId === row.id ? <Loader2 className="size-3 mr-1 animate-spin" /> : <RefreshCw className="size-3 mr-1" />}
                        Kasa sync
                      </Button>
                    </td>
                    <td className="p-3 text-xs space-y-1">
                      <div>Yatırma: {limitLabel(row.deposit_min_amount, row.deposit_max_amount)}</div>
                      <div>Çekim: {limitLabel(row.withdraw_min_amount, row.withdraw_max_amount)}</div>
                      <div>Tek işlem üst limiti: {row.per_tx_limit == null ? "—" : fmtTRY(row.per_tx_limit)}</div>
                      <div>Günlük: {row.daily_limit == null ? "—" : fmtTRY(row.daily_limit)}</div>
                    </td>
                    <td className="p-3 text-xs space-y-1">
                      <div>Yatırma: %{Number(row.deposit_commission_pct ?? 0).toFixed(2)} {Number(row.deposit_fixed_fee ?? 0) > 0 ? `+ ${fmtTRY(row.deposit_fixed_fee ?? 0)}` : ""}</div>
                      <div>Çekim: %{Number(row.withdraw_commission_pct ?? 0).toFixed(2)} {Number(row.withdraw_fixed_fee ?? 0) > 0 ? `+ ${fmtTRY(row.withdraw_fixed_fee ?? 0)}` : ""}</div>
                    </td>
                    <td className="p-3 text-xs">
                      {latest ? (
                        <div className="space-y-1">
                          <div>{endpointLabel(latest.endpoint)}</div>
                          <div className="font-mono text-[10px] text-muted-foreground">{latest.endpoint}</div>
                          <div className={latest.status_code && latest.status_code < 400 ? "text-success" : "text-destructive"}>
                            HTTP {latest.status_code ?? "—"} {latest.error_code ? `· ${errorCodeLabel(latest.error_code)}` : ""}
                          </div>
                          <div className="text-muted-foreground">{fmtDate(latest.created_at)} · {latest.latency_ms ?? "—"}ms</div>
                        </div>
                      ) : (
                        <div className="text-muted-foreground">API çağrısı yok</div>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-2 h-7 text-xs"
                        disabled={!row.is_active || !row.topup_init_url}
                        onClick={() => openTest(row)}
                      >
                        <Play className="size-3 mr-1" /> Test et
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-2 font-medium mb-2">
            <CheckCircle2 className="size-4 text-success" /> Beklenen Akış C init contract
          </div>
          <div className="grid md:grid-cols-2 gap-4 text-xs">
            <div>
              <div className="font-medium mb-1">Request</div>
              <pre className="rounded-md bg-muted p-3 overflow-auto">{`POST <topup_init_url>
HMAC: timestamp + ':' + body
{
  "internal_ref": "<topup_session_id>",
  "amount": 100,
  "customer_name": "Ad Soyad",
  "method_type": "havale",
  "callback_url": ".../merchant-topup-callback"
}`}</pre>
            </div>
            <div>
              <div className="font-medium mb-1">Response</div>
              <pre className="rounded-md bg-muted p-3 overflow-auto">{`{
  "success": true,
  "payment_instructions": {
    "type": "bank_transfer",
    "iban": "TR...",
    "account_holder": "...",
    "reference": "..."
  },
  "expires_at": "2026-05-18T15:00:00Z"
}`}</pre>
            </div>
          </div>
        </Card>

        <Dialog open={testOpen} onOpenChange={setTestOpen}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Finance init testi</DialogTitle>
              <DialogDescription>
                {testMerchant?.name} için gerçek `topup_init_url` endpoint'ine HMAC imzalı test request gönderir.
              </DialogDescription>
            </DialogHeader>

            <Card className="p-3 border-warning/40 bg-warning/10 text-sm flex gap-2">
              <AlertTriangle className="size-4 text-warning shrink-0 mt-0.5" />
              <div>
                Bu çağrı merchant tarafında gerçek test session kaydı oluşturabilir. Canlı merchant ile denemeden önce tutar ve yöntem tipini kontrol edin.
              </div>
            </Card>

            <div className="grid sm:grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label>Tutar</Label>
                <Input value={testAmount} onChange={(e) => setTestAmount(e.target.value)} inputMode="decimal" />
              </div>
              <div className="space-y-1">
                <Label>Yöntem tipi</Label>
                <Input value={testMethod} onChange={(e) => setTestMethod(e.target.value)} />
              </div>
              <div className="flex items-end">
                <Button onClick={runTest} disabled={testLoading || !testMerchant} className="w-full">
                  {testLoading ? <Loader2 className="size-4 mr-1 animate-spin" /> : <Play className="size-4 mr-1" />}
                  Testi çalıştır
                </Button>
              </div>
            </div>

            {testResult && (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  {testResult.success ? (
                    <Badge variant="secondary" className="text-success">Başarılı</Badge>
                  ) : (
                    <Badge variant="destructive">Başarısız</Badge>
                  )}
                  <span className="text-sm text-muted-foreground">
                    HTTP {testResult.response.status || "—"} · {testResult.response.latency_ms}ms
                    {testResult.error_code ? ` · ${errorCodeLabel(testResult.error_code)}` : ""}
                  </span>
                </div>

                <div>
                  <div className="font-medium text-sm mb-2">Contract checks</div>
                  <div className="grid sm:grid-cols-2 gap-2">
                    {testResult.contract.checks.map((check) => (
                      <div key={check.key} className="flex items-center gap-2 text-sm rounded-md border p-2">
                        {check.ok ? <CheckCircle2 className="size-4 text-success" /> : <AlertTriangle className="size-4 text-destructive" />}
                        <span>{check.label}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="grid md:grid-cols-2 gap-4 text-xs">
                  <div>
                    <div className="font-medium mb-1">Gönderilen request</div>
                    <pre className="rounded-md bg-muted p-3 overflow-auto">{JSON.stringify(testResult.request, null, 2)}</pre>
                  </div>
                  <div>
                    <div className="font-medium mb-1">Merchant response</div>
                    <pre className="rounded-md bg-muted p-3 overflow-auto">{JSON.stringify(testResult.response.json ?? testResult.response.text_preview, null, 2)}</pre>
                  </div>
                  <div className="md:col-span-2">
                    <div className="font-medium mb-1">Callback payload örneği</div>
                    <pre className="rounded-md bg-muted p-3 overflow-auto">{JSON.stringify(testResult.callback_payload_example, null, 2)}</pre>
                  </div>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        <Dialog open={syncOpen} onOpenChange={setSyncOpen}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Cash pool sync sonucu</DialogTitle>
              <DialogDescription>
                Merchant cash_pool API'den okunan absolute bakiye yerel kasa defteriyle karşılaştırıldı.
              </DialogDescription>
            </DialogHeader>

            {syncResult && (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  {syncResult.success ? (
                    <Badge variant="secondary" className="text-success">Başarılı</Badge>
                  ) : (
                    <Badge variant="destructive">Başarısız</Badge>
                  )}
                  <span className="text-sm text-muted-foreground">
                    HTTP {syncResult.response.status || "—"} · {syncResult.response.latency_ms}ms
                    {syncResult.error_code ? ` · ${errorCodeLabel(syncResult.error_code)}` : ""}
                  </span>
                </div>

                <div className="grid sm:grid-cols-4 gap-3">
                  <Card className="p-3">
                    <div className="text-xs text-muted-foreground">Önceki</div>
                    <div className="font-bold tabular-nums">{fmtTRY(syncResult.before)}</div>
                  </Card>
                  <Card className="p-3">
                    <div className="text-xs text-muted-foreground">Remote</div>
                    <div className="font-bold tabular-nums">{syncResult.reported_cash_pool == null ? "—" : fmtTRY(syncResult.reported_cash_pool)}</div>
                  </Card>
                  <Card className="p-3">
                    <div className="text-xs text-muted-foreground">Delta</div>
                    <div className={`font-bold tabular-nums ${syncResult.delta < 0 ? "text-destructive" : syncResult.delta > 0 ? "text-success" : ""}`}>
                      {syncResult.delta > 0 ? "+" : syncResult.delta < 0 ? "−" : ""}{fmtTRY(Math.abs(syncResult.delta))}
                    </div>
                  </Card>
                  <Card className="p-3">
                    <div className="text-xs text-muted-foreground">Log ID</div>
                    <div className="font-bold tabular-nums">{syncResult.log_id ?? (syncResult.delta === 0 ? "Delta yok" : "—")}</div>
                  </Card>
                </div>

                <div className="grid md:grid-cols-2 gap-4 text-xs">
                  <div>
                    <div className="font-medium mb-1">Merchant response</div>
                    <pre className="rounded-md bg-muted p-3 overflow-auto">{JSON.stringify(syncResult.response.json ?? syncResult.response.text_preview, null, 2)}</pre>
                  </div>
                  <div>
                    <div className="font-medium mb-1">Beklenen contract</div>
                    <pre className="rounded-md bg-muted p-3 overflow-auto">{JSON.stringify(syncResult.expected_response_contract, null, 2)}</pre>
                  </div>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </AdminLayout>
  );
}

function FiStatCard({
  label,
  value,
  loading,
  accent,
  sub,
}: {
  label: string;
  value: string;
  loading?: boolean;
  accent?: "destructive" | "warning";
  sub?: string;
}) {
  const borderClass =
    accent === "destructive"
      ? "border-destructive/30"
      : accent === "warning"
        ? "border-warning/40"
        : "";
  return (
    <StatCard
      label={label}
      value={value}
      loading={loading}
      hint={sub}
      accent={accent === "destructive" ? "destructive" : accent === "warning" ? "warning" : undefined}
      valueSize="lg"
      className={borderClass}
    />
  );
}
