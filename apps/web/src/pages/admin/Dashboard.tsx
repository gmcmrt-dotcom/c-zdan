import AdminLayout from "@/components/AdminLayout";
import { StatCard, StatValue } from "@/components/ui/stat-card";
import { useEffect, useMemo, useState } from "react";
import { dbSelect, dbCount } from "@/lib/db";
import { rpc } from "@/lib/rpc";
import { fmtTRY } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  Wallet, Users, ArrowDownToLine, ArrowUpFromLine, Activity,
  Calendar, Store, CreditCard, RefreshCw, AlertTriangle, ShieldCheck,
} from "lucide-react";
import SuggestionsPanel from "@/components/SuggestionsPanel";
import { LedgerIntegrityPanel } from "@/pages/admin/LedgerIntegrity";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import DateRangePicker from "@/components/DateRangePicker";
import { useAdminMerchantsPicker } from "@/contexts/AdminReferenceDataContext";

type RangeKey = "today" | "7d" | "30d" | "month" | "custom" | "all";

const RANGES: { key: RangeKey; label: string }[] = [
  { key: "today", label: "Bugün" },
  { key: "7d",    label: "Son 7 gün" },
  { key: "30d",   label: "Son 30 gün" },
  { key: "month", label: "Bu ay" },
  { key: "all",   label: "Tümü" },
  { key: "custom",label: "Özel" },
];

function rangeStart(range: RangeKey, customFrom?: string): Date | null {
  const now = new Date();
  if (range === "all") return null;
  if (range === "today") { const d = new Date(now); d.setHours(0,0,0,0); return d; }
  if (range === "7d")    { const d = new Date(now); d.setDate(d.getDate()-7); return d; }
  if (range === "30d")   { const d = new Date(now); d.setDate(d.getDate()-30); return d; }
  if (range === "month") { return new Date(now.getFullYear(), now.getMonth(), 1); }
  if (range === "custom" && customFrom) return new Date(customFrom);
  return null;
}

function rangeEnd(range: RangeKey, customTo?: string): Date | null {
  if (range === "custom" && customTo) {
    const d = new Date(customTo); d.setHours(23, 59, 59, 999); return d;
  }
  return null;
}

interface Stat {
  totalBalance: number;
  totalReserved: number;
  memberCount: number;
  txCount: number;
  topup: number;
  spend: number;
  refund: number;
  withdraw: number;
  fee: number;
}

interface Ops {
  pendingTopups: number;
  pendingWithdraws: number;
  pendingChat: number;
  failedTx: number;
  staleFinanceMerchants: number;
}

export default function AdminDashboard() {
  const [range, setRange] = useState<RangeKey>("30d");
  const [customFrom, setCustomFrom] = useState<string>("");
  const [customTo, setCustomTo] = useState<string>("");
  const [merchantId, setMerchantId] = useState<string>("");
  const { merchants } = useAdminMerchantsPicker();
  const [s, setS] = useState<Stat | null>(null);
  const [ops, setOps] = useState<Ops | null>(null);
  const [loading, setLoading] = useState(false);

  const startDate = useMemo(() => rangeStart(range, customFrom), [range, customFrom]);
  const endDate   = useMemo(() => rangeEnd(range, customTo),     [range, customTo]);

  const load = async () => {
    setLoading(true);
    const sinceIso = startDate?.toISOString();
    const untilIso = endDate?.toISOString();

    const staleBefore = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    type StatsAgg = {
      transactions?: { tx_count?: number; topup?: number; spend?: number; withdraw?: number; fee?: number };
      accounts?: { total_balance?: number; total_reserved?: number };
      member_count?: number;
    };
    const [statsAgg, pendingTopups, pendingWithdraws, pendingChat, failedTx, financeMerchants] = await Promise.all([
      rpc<StatsAgg>("admin_dashboard_stats", {
        _since: sinceIso ?? null,
        _until: untilIso ?? null,
        _merchant_id: merchantId || null,
      }).catch(() => ({} as StatsAgg)),
      dbCount("topup_sessions", { where: [{ col: "status", op: "in", val: ["pending", "awaiting_member_action", "member_confirmed"] }] }).catch(() => 0),
      dbCount("withdraw_sessions", { where: [{ col: "status", op: "in", val: ["pending", "processing"] }] }).catch(() => 0),
      dbCount("chat_threads", { where: [{ col: "status", op: "in", val: ["open", "pending_staff"] }] }).catch(() => 0),
      dbCount("transactions", { where: [
        { col: "status", op: "eq", val: "failed" },
        { col: "created_at", op: "gte", val: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() },
      ] }).catch(() => 0),
      dbSelect<{ id: string; cash_pool_updated_at: string | null }>("merchants", {
        cols: "id, cash_pool_updated_at",
        where: [
          { col: "merchant_type", op: "eq", val: "finance" },
          { col: "is_active", op: "eq", val: true },
        ],
      }).catch(() => [] as Array<{ id: string; cash_pool_updated_at: string | null }>),
    ]);

    const agg = statsAgg;
    const tx = agg.transactions ?? {};
    const acc = agg.accounts ?? {};
    const stat: Stat = {
      totalBalance:  Number(acc.total_balance ?? 0),
      totalReserved: Number(acc.total_reserved ?? 0),
      memberCount:   Number(agg.member_count ?? 0),
      txCount:       Number(tx.tx_count ?? 0),
      topup:         Number(tx.topup ?? 0),
      spend:         Number(tx.spend ?? 0),
      refund:        0,
      withdraw:      Number(tx.withdraw ?? 0),
      fee:           Number(tx.fee ?? 0),
    };
    setS(stat);
    setOps({
      pendingTopups,
      pendingWithdraws,
      pendingChat,
      failedTx,
      staleFinanceMerchants: financeMerchants.filter(
        (m) => !m.cash_pool_updated_at || m.cash_pool_updated_at < staleBefore,
      ).length,
    });
    setLoading(false);
  };

  useEffect(() => { load(); }, [range, customFrom, customTo, merchantId]);

  const cards = [
    { label: "Toplam Bakiye",  value: s ? fmtTRY(s.totalBalance) : "—",   icon: Wallet,           accent: "text-primary" },
    { label: "Rezerve",        value: s ? fmtTRY(s.totalReserved) : "—",  icon: Activity,         accent: "text-warning" },
    // Lifetime count is independent of the date filter.
    { label: "Toplam Üye (lifetime)", value: s ? s.memberCount.toString() : "—", icon: Users,            accent: "text-primary" },
    { label: "İşlem Sayısı",   value: s ? s.txCount.toString() : "—",     icon: Activity,         accent: "text-foreground" },
    { label: "Yükleme",        value: s ? fmtTRY(s.topup) : "—",          icon: ArrowDownToLine,  accent: "text-success" },
    { label: "Harcama",        value: s ? fmtTRY(s.spend) : "—",          icon: ArrowUpFromLine,  accent: "text-destructive" },
    // No "İade" card — refunds do not exist (Hard rule #13).
    { label: "Çekim",          value: s ? fmtTRY(s.withdraw) : "—",       icon: ArrowUpFromLine,  accent: "text-destructive" },
    { label: "Toplam Komisyon",value: s ? fmtTRY(s.fee) : "—",            icon: CreditCard,       accent: "text-success" },
  ];

  return (
    <AdminLayout title="Dashboard" requireAny={["dashboard:view"]}>
      {/* Sistem önerileri kartlardan SONRAYA taşındı (üstte yer kaplamasın) */}

      {/* Filter bar */}
      <Card className="p-4 mb-6">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label className="text-xs">Dönem</Label>
            <div className="flex flex-wrap gap-1 mt-1">
              {RANGES.map((r) => (
                <button
                  key={r.key}
                  onClick={() => setRange(r.key)}
                  className={`text-xs px-3 py-1.5 rounded-md transition-colors ${
                    range === r.key ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/70"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>
          {range === "custom" && (
            <div className="w-full sm:w-auto sm:min-w-0 flex-1 max-w-md">
              <Label className="text-xs">Tarih aralığı</Label>
              <DateRangePicker
                value={{ from: customFrom, to: customTo }}
                onChange={(next) => {
                  setCustomFrom(next.from ?? "");
                  setCustomTo(next.to ?? "");
                }}
                buttonClassName="w-full h-9 text-xs"
              />
            </div>
          )}
          <div className="w-full sm:w-auto sm:min-w-[10rem] max-w-xs">
            <Label className="text-xs flex items-center gap-1"><Store className="size-3" /> Merchant</Label>
            <select value={merchantId} onChange={(e) => setMerchantId(e.target.value)}
              className="w-full h-9 border rounded-md px-3 bg-background text-xs">
              <option value="">Tümü</option>
              {merchants.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          {/* Provider dropdown removed (provider concept retired). */}
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`size-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Yenile
          </Button>
        </div>
        {(startDate || endDate) && (
          <div className="text-xs text-muted-foreground mt-3 flex items-center gap-1">
            <Calendar className="size-3" />
            {startDate && <span>{startDate.toLocaleDateString("tr-TR")}</span>}
            {startDate && endDate && <span> — </span>}
            {endDate && <span>{endDate.toLocaleDateString("tr-TR")}</span>}
            {!endDate && startDate && <span> — bugün</span>}
          </div>
        )}
      </Card>

      {/* Ledger integrity cross-check */}
      <div className="mb-6">
        <LedgerIntegrityPanel />
      </div>

      {/* Action center */}
      <div className="grid lg:grid-cols-[1.2fr,0.8fr] gap-4 mb-6">
        <Card className="p-5 border-primary/20 bg-primary/5">
          <div className="flex items-start justify-between gap-3 mb-4">
            <div>
              <h2 className="text-lg font-semibold">Operasyon odağı</h2>
              <p className="text-xs text-muted-foreground mt-1">Bugün aksiyon bekleyen başlıklar. Önce riskli olanları kapat.</p>
            </div>
            <ShieldCheck className="size-5 text-primary" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 [&>*]:min-w-0">
            <OpsCard label="Bekleyen yatırma" value={ops?.pendingTopups ?? 0} tone={(ops?.pendingTopups ?? 0) > 0 ? "warning" : "muted"} />
            <OpsCard label="Bekleyen çekim" value={ops?.pendingWithdraws ?? 0} tone={(ops?.pendingWithdraws ?? 0) > 0 ? "warning" : "muted"} />
            <OpsCard label="Destek bekliyor" value={ops?.pendingChat ?? 0} tone={(ops?.pendingChat ?? 0) > 0 ? "warning" : "muted"} />
            <OpsCard label="24s başarısız tx" value={ops?.failedTx ?? 0} tone={(ops?.failedTx ?? 0) > 0 ? "destructive" : "muted"} />
          </div>
        </Card>
        <Card className={`p-5 ${(ops?.staleFinanceMerchants ?? 0) > 0 ? "border-destructive/40 bg-destructive/5" : "border-success/30 bg-success/5"}`}>
          <div className="flex items-start gap-3">
            <div className={`size-10 rounded-xl flex items-center justify-center ${(ops?.staleFinanceMerchants ?? 0) > 0 ? "bg-destructive/10" : "bg-success/10"}`}>
              {(ops?.staleFinanceMerchants ?? 0) > 0
                ? <AlertTriangle className="size-5 text-destructive" />
                : <ShieldCheck className="size-5 text-success" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">Finance kasa sağlığı</div>
              <StatValue
                size="lg"
                className={cn("mt-1", (ops?.staleFinanceMerchants ?? 0) > 0 ? "text-destructive" : "text-success")}
              >
                {ops?.staleFinanceMerchants ?? 0}
              </StatValue>
              <p className="text-xs text-muted-foreground mt-1">
                2 saati aşan veya hiç sync almamış aktif finance merchant sayısı.
              </p>
            </div>
          </div>
        </Card>
      </div>

      {/* Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4 [&>*]:min-w-0">
        {cards.map((c) => (
          <StatCard
            key={c.label}
            label={c.label}
            value={c.value}
            valueSize="lg"
            headerRight={<c.icon className={cn("size-4 shrink-0", c.accent)} />}
            valueClassName={c.accent}
          />
        ))}
      </div>

      {/* Sistem önerileri en altta */}
      <div className="mt-8">
        <SuggestionsPanel />
      </div>
    </AdminLayout>
  );
}

function OpsCard({ label, value, tone }: { label: string; value: number; tone: "warning" | "destructive" | "muted" }) {
  const toneClass = tone === "destructive"
    ? "text-destructive bg-destructive/10 border-destructive/20"
    : tone === "warning"
      ? "text-warning-foreground bg-warning/10 border-warning/30"
      : "text-muted-foreground bg-background border-border";
  return (
    <div className={cn("stat-card rounded-xl border p-3 min-w-0 overflow-hidden", toneClass)}>
      <div className="text-[11px] opacity-80 truncate">{label}</div>
      <StatValue size="md" className="mt-1">{value}</StatValue>
    </div>
  );
}
