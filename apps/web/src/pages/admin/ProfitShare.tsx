import { useEffect, useMemo, useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import { Card } from "@/components/ui/card";
import { StatValue } from "@/components/ui/stat-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { rpc } from "@/lib/rpc";
import { useAuth } from "@/hooks/useAuth";
import { fmtDate, fmtTRY } from "@/lib/format";
import { translateError } from "@/lib/i18n-errors";
import { isAffiliateEnabled } from "@/lib/feature-flags";
import DateRangePicker from "@/components/DateRangePicker";
import {
  ArrowDownLeft,
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  Clock,
  Clipboard,
  Gift,
  Loader2,
  Mail,
  PieChart,
  RefreshCw,
  Send,
  Trophy,
  Users,
} from "lucide-react";
import { toast } from "sonner";

type PeriodType = "daily" | "weekly" | "monthly";

type PreviewSummary = {
  period_type: PeriodType;
  period_from: string;
  period_to: string;
  distribution_pct: number;
  max_recipients: number;
  claim_expires_hours: number;
  platform_revenue: number;
  platform_cost: number;
  affiliate_cost: number;
  net_profit: number;
  pool_amount: number;
  top_turnover_total: number;
  eligible_count: number;
};

type PreviewRow = {
  rank_no: number;
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  member_no: string | null;
  turnover_amount: number;
  share_pct: number;
  allocated_amount: number;
};

type Preview = {
  summary: PreviewSummary;
  allocations: PreviewRow[];
};

type CampaignRow = {
  id: string;
  period_type: PeriodType;
  period_from: string;
  period_to: string;
  distribution_pct: number;
  max_recipients: number;
  claim_expires_hours: number;
  net_profit: number;
  pool_amount: number;
  eligible_count: number;
  status: "draft" | "published" | "closed" | "cancelled";
  created_at: string;
  published_at: string | null;
  claim_expires_at: string | null;
  claimed_count: number;
  claimed_amount: number;
  pending_count: number;
  pending_amount: number;
  expired_count: number;
  expired_amount: number;
};

type AllocationRow = {
  allocation_id: string;
  user_id: string;
  member_no: string | null;
  first_name: string | null;
  last_name: string | null;
  rank_no: number;
  turnover_amount: number;
  share_pct: number;
  allocated_amount: number;
  status: "pending" | "claimed" | "expired";
  expires_at: string | null;
  claimed_at: string | null;
  expired_at: string | null;
  claim_tx_public_no: string | null;
};

const PERIOD_LABEL: Record<PeriodType, string> = {
  daily: "Günlük",
  weekly: "Haftalık",
  monthly: "Aylık",
};

const STATUS_LABEL: Record<CampaignRow["status"], string> = {
  draft: "Taslak",
  published: "Yayında",
  closed: "Kapalı",
  cancelled: "İptal",
};

const ALLOCATION_STATUS_LABEL: Record<AllocationRow["status"], string> = {
  pending: "Bekliyor",
  claimed: "Faydalandı",
  expired: "İptal oldu",
};

const ALLOCATION_STATUS_CLASS: Record<AllocationRow["status"], string> = {
  pending: "bg-warning/10 text-warning-foreground border-warning/30",
  claimed: "bg-success/10 text-success border-success/30",
  expired: "bg-destructive/10 text-destructive border-destructive/30",
};

const STATUS_CLASS: Record<CampaignRow["status"], string> = {
  draft: "bg-muted text-muted-foreground",
  published: "bg-success/10 text-success border-success/30",
  closed: "bg-primary/10 text-primary border-primary/30",
  cancelled: "bg-destructive/10 text-destructive border-destructive/30",
};

function toInputDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseInputDate(date: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

function defaultRange(periodType: PeriodType) {
  const to = new Date();
  to.setHours(0, 0, 0, 0);
  const from = new Date(to);
  if (periodType === "daily") from.setDate(from.getDate() - 1);
  if (periodType === "weekly") from.setDate(from.getDate() - 7);
  if (periodType === "monthly") from.setMonth(from.getMonth() - 1);
  return { from: toInputDate(from), to: toInputDate(to) };
}

/** Local midnight → ISO for RPC (`created_at >= from`, `< to`). */
function asIsoStart(date: string): string | null {
  const d = parseInputDate(date);
  if (!d) return null;
  return d.toISOString();
}

function periodRangeValid(from: string, to: string) {
  const fromD = parseInputDate(from);
  const toD = parseInputDate(to);
  return Boolean(fromD && toD && fromD < toD);
}

function displayName(row: PreviewRow) {
  const name = `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim();
  return name || row.member_no || row.user_id.slice(0, 8);
}

function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: string;
  hint: string;
  icon: any;
  tone?: "default" | "success" | "danger" | "primary";
}) {
  const toneClass =
    tone === "success"
      ? "text-success"
      : tone === "danger"
        ? "text-destructive"
        : tone === "primary"
          ? "text-primary"
          : "text-foreground";
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-1">
        <div className="text-xs text-muted-foreground">{label}</div>
        <Icon className={`size-4 ${toneClass}`} />
      </div>
      <StatValue size="md" className={toneClass}>{value}</StatValue>
      <div className="text-[11px] text-muted-foreground mt-1">{hint}</div>
    </Card>
  );
}

function buildMailDraft(periodType: PeriodType, claimExpiresHours: string) {
  const subject = "Kazanç payın hazır: süre dolmadan bakiyene aktar";
  const body = [
    "Merhaba {{first_name}},",
    "",
    `${PERIOD_LABEL[periodType].toLowerCase()} kazanç dağıtımı kapsamında sana özel {{amount}} kazanç payı tanımlandı.`,
    "",
    `Bu hak yalnızca ${claimExpiresHours || "{{claim_expires_hours}}"} saat geçerli. Süre dolmadan hesabına giriş yapıp "Bakiyeme aktar" butonuna basarsan tutar cüzdan bakiyene eklenir.`,
    "",
    "Son kullanım zamanı: {{expires_at}}",
    "Kazanç payını almak için: {{claim_url}}",
    "",
    "Not: Süre içinde işlem yapılmazsa bu kazanç payı otomatik iptal edilir.",
    "",
    "Yıldız Cüzdan",
  ].join("\n");
  return { subject, body };
}

export default function AdminProfitShare() {
  const { can } = useAuth();
  const canManage = can("profit_share", "manage");
  const initial = defaultRange("daily");
  const [periodType, setPeriodType] = useState<PeriodType>("daily");
  const [periodFrom, setPeriodFrom] = useState(initial.from);
  const [periodTo, setPeriodTo] = useState(initial.to);
  const [distributionPct, setDistributionPct] = useState("10");
  const [maxRecipients, setMaxRecipients] = useState("50");
  const [claimExpiresHours, setClaimExpiresHours] = useState("2");
  const [notes, setNotes] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [allocationRows, setAllocationRows] = useState<AllocationRow[]>([]);
  const [previewing, setPreviewing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [loadingCampaigns, setLoadingCampaigns] = useState(true);
  const [loadingAllocations, setLoadingAllocations] = useState(false);

  const periodFromIso = useMemo(() => asIsoStart(periodFrom), [periodFrom]);
  const periodToIso = useMemo(() => asIsoStart(periodTo), [periodTo]);
  const periodRangeReady = periodRangeValid(periodFrom, periodTo);

  const loadCampaigns = async () => {
    setLoadingCampaigns(true);
    try {
      const data = await rpc<CampaignRow[]>("admin_list_profit_share_campaigns");
      setCampaigns(data ?? []);
    } catch (err) {
      toast.error(translateError(err, "Kazanç dağıtımı kampanyaları yüklenemedi"));
    } finally {
      setLoadingCampaigns(false);
    }
  };

  useEffect(() => {
    loadCampaigns();
  }, []);

  const updatePeriodType = (next: PeriodType) => {
    setPeriodType(next);
    const r = defaultRange(next);
    setPeriodFrom(r.from);
    setPeriodTo(r.to);
    setPreview(null);
  };

  const runPreview = async () => {
    if (!periodFromIso || !periodToIso || !periodRangeReady) {
      toast.error("Geçerli bir tarih aralığı seçin (bitiş, başlangıçtan sonra olmalı)");
      return;
    }
    setPreviewing(true);
    try {
      const data = await rpc<Preview>("admin_preview_profit_share", {
        _period_type: periodType,
        _period_from: periodFromIso,
        _period_to: periodToIso,
        _distribution_pct: Number(distributionPct),
        _max_recipients: Number(maxRecipients),
        _claim_expires_hours: Number(claimExpiresHours),
      });
      setPreview(data);
    } catch (err) {
      toast.error(translateError(err, "Önizleme hesaplanamadı"));
    } finally {
      setPreviewing(false);
    }
  };

  const createDraft = async () => {
    if (!canManage) {
      toast.error("Bu işlem için admin yetkisi gerekiyor");
      return;
    }
    if (!periodFromIso || !periodToIso || !periodRangeReady) {
      toast.error("Geçerli bir tarih aralığı seçin (bitiş, başlangıçtan sonra olmalı)");
      return;
    }
    setCreating(true);
    try {
      await rpc("admin_create_profit_share_campaign", {
        _period_type: periodType,
        _period_from: periodFromIso,
        _period_to: periodToIso,
        _distribution_pct: Number(distributionPct),
        _max_recipients: Number(maxRecipients),
        _claim_expires_hours: Number(claimExpiresHours),
        _notes: notes || null,
      });
      toast.success("Kazanç dağıtımı taslağı oluşturuldu");
      setNotes("");
      await loadCampaigns();
    } catch (err) {
      toast.error(translateError(err, "Taslak oluşturulamadı"));
    } finally {
      setCreating(false);
    }
  };

  const publish = async (campaignId: string) => {
    if (!canManage) {
      toast.error("Bu işlem için admin yetkisi gerekiyor");
      return;
    }
    setPublishingId(campaignId);
    try {
      await rpc("admin_publish_profit_share_campaign", {
        _campaign_id: campaignId,
      });
      toast.success("Kazanç dağıtımı üyelere açıldı");
      await loadCampaigns();
    } catch (err) {
      toast.error(translateError(err, "Yayınlanamadı"));
    } finally {
      setPublishingId(null);
    }
  };

  const loadAllocations = async (campaignId: string) => {
    if (selectedCampaignId === campaignId) {
      setSelectedCampaignId(null);
      setAllocationRows([]);
      return;
    }
    setSelectedCampaignId(campaignId);
    setLoadingAllocations(true);
    try {
      const data = await rpc<AllocationRow[]>("admin_list_profit_share_allocations", {
        _campaign_id: campaignId,
      });
      setAllocationRows(data ?? []);
      await loadCampaigns();
    } catch (err) {
      toast.error(translateError(err, "Dağıtım detayları yüklenemedi"));
    } finally {
      setLoadingAllocations(false);
    }
  };

  const summary = preview?.summary;
  const mailDraft = useMemo(
    () => buildMailDraft(periodType, claimExpiresHours),
    [periodType, claimExpiresHours],
  );

  const copyMailDraft = async () => {
    try {
      await navigator.clipboard.writeText(`Konu: ${mailDraft.subject}\n\n${mailDraft.body}`);
      toast.success("Mail taslağı kopyalandı");
    } catch {
      toast.error("Mail taslağı kopyalanamadı");
    }
  };

  return (
    <AdminLayout title="Kazanç Dağıtımı" requireAny={["profit_share:view"]}>
      <div className="space-y-5 max-w-7xl mx-auto min-w-0 w-full">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Gift className="size-6 text-primary" />
              Kazanç Dağıtımı
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Net platform kârından belirlenen oranı, ilgili dönemin en yüksek turnover yapan ilk N üyesine paylaştırın.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={loadCampaigns} disabled={loadingCampaigns}>
            <RefreshCw className={`size-4 mr-1 ${loadingCampaigns ? "animate-spin" : ""}`} />
            Yenile
          </Button>
        </div>

        <Card className="p-4 border-info/30 bg-info/5">
          <div className="text-sm font-medium">Muhasebe kuralı</div>
          <p className="text-sm text-muted-foreground mt-1">
            Bu ekran para hareketini yayın anında yapmaz. Üye ödülünü kendi hesabına girip
            <span className="font-medium"> Bakiyeme aktar </span>
            dediğinde bakiye artar ve `profit_share` işlem kaydı oluşur.
          </p>
        </Card>

        <Card className="p-4 overflow-hidden">
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 items-end">
            <div className="min-w-0">
              <Label>Dönem tipi</Label>
              <Select value={periodType} onValueChange={(v) => updatePeriodType(v as PeriodType)}>
                <SelectTrigger className="mt-1 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Günlük</SelectItem>
                  <SelectItem value="weekly">Haftalık</SelectItem>
                  <SelectItem value="monthly">Aylık</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-0">
              <Label>Dağıtım oranı (%)</Label>
              <Input
                className="mt-1 w-full"
                type="number"
                min="0.01"
                max="100"
                step="0.01"
                value={distributionPct}
                onChange={(e) => { setDistributionPct(e.target.value); setPreview(null); }}
              />
            </div>
            <div className="min-w-0">
              <Label>Kişi sayısı</Label>
              <Input
                className="mt-1 w-full"
                type="number"
                min="1"
                max="500"
                step="1"
                value={maxRecipients}
                onChange={(e) => { setMaxRecipients(e.target.value); setPreview(null); }}
              />
            </div>
            <div className="min-w-0">
              <Label>Geçerlilik (saat)</Label>
              <Input
                className="mt-1 w-full"
                type="number"
                min="1"
                max="720"
                step="1"
                value={claimExpiresHours}
                onChange={(e) => { setClaimExpiresHours(e.target.value); setPreview(null); }}
              />
            </div>
          </div>
          <div className="mt-3 grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-3 items-end">
            <div className="min-w-0">
              <Label>Tarih aralığı</Label>
              <DateRangePicker
                value={{ from: periodFrom, to: periodTo }}
                onChange={(next) => {
                  if (!next.from && !next.to) {
                    const r = defaultRange(periodType);
                    setPeriodFrom(r.from);
                    setPeriodTo(r.to);
                    setPreview(null);
                    return;
                  }
                  const from = next.from ?? periodFrom;
                  let to = next.to ?? periodTo;
                  // Tek gün: DB aralığı [gün 00:00, ertesi gün 00:00) — aynı gün boş dönem olur
                  if (from && to && from === to) {
                    const d = parseInputDate(from);
                    if (d) {
                      d.setDate(d.getDate() + 1);
                      to = toInputDate(d);
                    }
                  }
                  setPeriodFrom(from);
                  setPeriodTo(to);
                  setPreview(null);
                }}
                buttonClassName="mt-1 w-full"
                align="start"
              />
            </div>
            <Button
              className="w-full lg:w-auto shrink-0"
              onClick={runPreview}
              disabled={previewing || !periodRangeReady}
            >
              {previewing ? <Loader2 className="size-4 mr-1 animate-spin" /> : <PieChart className="size-4 mr-1" />}
              Hesapla
            </Button>
          </div>
          <div className="mt-3">
            <Label>Not (opsiyonel)</Label>
            <Input
              className="mt-1"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Örn. Mayıs haftalık kazanç payı"
            />
          </div>
        </Card>

        {summary && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
              <StatCard
                label="Komisyon geliri"
                value={`+${fmtTRY(summary.platform_revenue)}`}
                hint="Dönem içi platform_revenue"
                icon={ArrowDownLeft}
                tone="success"
              />
              <StatCard
                label="Platform gideri"
                value={`-${fmtTRY(summary.platform_cost + (isAffiliateEnabled() ? summary.affiliate_cost : 0))}`}
                hint={isAffiliateEnabled() ? "platform_cost + affiliate" : "platform_cost"}
                icon={ArrowUpRight}
                tone="danger"
              />
              <StatCard
                label="Net kâr"
                value={fmtTRY(summary.net_profit)}
                hint={`${PERIOD_LABEL[periodType]} dönem snapshot`}
                icon={PieChart}
                tone={summary.net_profit >= 0 ? "success" : "danger"}
              />
              <StatCard
                label="Dağıtılacak pool"
                value={fmtTRY(summary.pool_amount)}
                hint={`Net kârın %${Number(summary.distribution_pct).toFixed(2)} kadarı`}
                icon={Gift}
                tone="primary"
              />
              <StatCard
                label="Eligible üye"
                value={String(summary.eligible_count)}
                hint={`Top ${summary.max_recipients} · ${summary.claim_expires_hours} saat geçerli`}
                icon={Users}
              />
            </div>

            <Card className="overflow-hidden">
              <div className="px-4 py-3 border-b bg-muted/40 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold">Önizleme</h2>
                  <p className="text-xs text-muted-foreground truncate">
                    {fmtDate(summary.period_from)} - {fmtDate(summary.period_to)}
                  </p>
                </div>
                <Button
                  className="w-full sm:w-auto shrink-0"
                  onClick={createDraft}
                  disabled={!canManage || creating || summary.pool_amount <= 0 || preview.allocations.length === 0}
                >
                  {creating ? <Loader2 className="size-4 mr-1 animate-spin" /> : <CheckCircle2 className="size-4 mr-1" />}
                  Taslak oluştur
                </Button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/30 text-left">
                    <tr>
                      <th className="px-4 py-3">Sıra</th>
                      <th className="px-4 py-3">Üye</th>
                      <th className="px-4 py-3 text-right">Turnover</th>
                      <th className="px-4 py-3 text-right">Pay</th>
                      <th className="px-4 py-3 text-right">Ödül</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.allocations.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                          Bu dönem için uygun turnover yok.
                        </td>
                      </tr>
                    ) : (
                      preview.allocations.map((row) => (
                        <tr key={row.user_id} className="border-t">
                          <td className="px-4 py-3 font-medium">#{row.rank_no}</td>
                          <td className="px-4 py-3">
                            <div className="font-medium">{displayName(row)}</div>
                            <div className="text-xs text-muted-foreground font-mono">{row.member_no ?? row.user_id.slice(0, 8)}</div>
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums">{fmtTRY(row.turnover_amount)}</td>
                          <td className="px-4 py-3 text-right tabular-nums">%{Number(row.share_pct).toFixed(4)}</td>
                          <td className="px-4 py-3 text-right font-semibold text-success tabular-nums">
                            +{fmtTRY(row.allocated_amount)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}

        <Card className="overflow-hidden">
          <div className="px-4 py-3 border-b bg-muted/40 flex items-center gap-2">
            <CalendarDays className="size-4 text-primary" />
            <h2 className="text-sm font-semibold">Kampanyalar</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-left">
                <tr>
                  <th className="px-4 py-3">Dönem</th>
                  <th className="px-4 py-3">Durum</th>
                  <th className="px-4 py-3 text-right">Net kâr</th>
                  <th className="px-4 py-3 text-right">Pool</th>
                  <th className="px-4 py-3 text-right">Muhasebe</th>
                  <th className="px-4 py-3 text-right">Aksiyon</th>
                </tr>
              </thead>
              <tbody>
                {loadingCampaigns ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                      <Loader2 className="size-5 animate-spin mx-auto mb-2" />
                      Yükleniyor...
                    </td>
                  </tr>
                ) : campaigns.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                      Henüz kampanya yok.
                    </td>
                  </tr>
                ) : (
                  campaigns.map((campaign) => (
                    <tr key={campaign.id} className="border-t">
                      <td className="px-4 py-3">
                        <div className="font-medium">{PERIOD_LABEL[campaign.period_type]}</div>
                        <div className="text-xs text-muted-foreground">
                          {fmtDate(campaign.period_from)} - {fmtDate(campaign.period_to)}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="outline" className={STATUS_CLASS[campaign.status]}>
                          {STATUS_LABEL[campaign.status]}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{fmtTRY(campaign.net_profit)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        <div className="font-medium">{fmtTRY(campaign.pool_amount)}</div>
                        <div className="text-xs text-muted-foreground">
                          {campaign.eligible_count}/{campaign.max_recipients} üye
                        </div>
                        <div className="text-xs text-muted-foreground flex items-center justify-end gap-1">
                          <Clock className="size-3" />
                          {campaign.claim_expires_hours} saat
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        <div className="text-success">Faydalandı: {fmtTRY(campaign.claimed_amount)}</div>
                        <div className="text-warning-foreground">Bekleyen: {fmtTRY(campaign.pending_amount)}</div>
                        <div className="text-destructive">İptal: {fmtTRY(campaign.expired_amount)}</div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {campaign.status === "draft" ? (
                          <Button
                            size="sm"
                            onClick={() => publish(campaign.id)}
                            disabled={!canManage || publishingId === campaign.id}
                          >
                            {publishingId === campaign.id ? (
                              <Loader2 className="size-4 mr-1 animate-spin" />
                            ) : (
                              <Send className="size-4 mr-1" />
                            )}
                            Yayınla
                          </Button>
                        ) : (
                          <Button variant="outline" size="sm" onClick={() => loadAllocations(campaign.id)}>
                            <Trophy className="size-3 mr-1" />
                            Detay
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>

        {selectedCampaignId && (
          <Card className="overflow-hidden">
            <div className="px-4 py-3 border-b bg-muted/40 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Kampanya dağıtım detayları</h2>
              <Button variant="ghost" size="sm" onClick={() => loadAllocations(selectedCampaignId)} disabled={loadingAllocations}>
                <RefreshCw className={`size-4 mr-1 ${loadingAllocations ? "animate-spin" : ""}`} />
                Yenile
              </Button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 text-left">
                  <tr>
                    <th className="px-4 py-3">Sıra</th>
                    <th className="px-4 py-3">Üye</th>
                    <th className="px-4 py-3">Durum</th>
                    <th className="px-4 py-3 text-right">Turnover</th>
                    <th className="px-4 py-3 text-right">Ödül</th>
                    <th className="px-4 py-3">Süre / İşlem</th>
                  </tr>
                </thead>
                <tbody>
                  {loadingAllocations ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                        <Loader2 className="size-5 animate-spin mx-auto mb-2" />
                        Yükleniyor...
                      </td>
                    </tr>
                  ) : allocationRows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                        Detay yok.
                      </td>
                    </tr>
                  ) : (
                    allocationRows.map((row) => (
                      <tr key={row.allocation_id} className="border-t">
                        <td className="px-4 py-3 font-medium">#{row.rank_no}</td>
                        <td className="px-4 py-3">
                          <div className="font-medium">
                            {`${row.first_name ?? ""} ${row.last_name ?? ""}`.trim() || row.member_no || row.user_id.slice(0, 8)}
                          </div>
                          <div className="text-xs text-muted-foreground font-mono">{row.member_no ?? row.user_id.slice(0, 8)}</div>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="outline" className={ALLOCATION_STATUS_CLASS[row.status]}>
                            {ALLOCATION_STATUS_LABEL[row.status]}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">{fmtTRY(row.turnover_amount)}</td>
                        <td className="px-4 py-3 text-right font-medium tabular-nums">{fmtTRY(row.allocated_amount)}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {row.status === "claimed" && (
                            <>
                              <div>Claim: {fmtDate(row.claimed_at)}</div>
                              {row.claim_tx_public_no && <div className="font-mono">{row.claim_tx_public_no}</div>}
                            </>
                          )}
                          {row.status === "expired" && <div>İptal: {fmtDate(row.expired_at)}</div>}
                          {row.status === "pending" && <div>Son süre: {fmtDate(row.expires_at)}</div>}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        <Card className="p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold flex items-center gap-2">
                <Mail className="size-4 text-primary" />
                Mail taslağı
              </h2>
              <p className="text-xs text-muted-foreground mt-1">
                Kampanya yayınlandıktan sonra mail altyapısında kullanıcıya özel değişkenlerle gönderilecek metin.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={copyMailDraft}>
              <Clipboard className="size-4 mr-1" />
              Kopyala
            </Button>
          </div>

          <div className="space-y-3">
            <div>
              <Label>Konu</Label>
              <Input className="mt-1 font-medium" value={mailDraft.subject} readOnly />
            </div>
            <div>
              <Label>Gövde</Label>
              <textarea
                className="mt-1 min-h-[260px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono leading-relaxed ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                value={mailDraft.body}
                readOnly
              />
            </div>
            <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
              Değişkenler: <span className="font-mono">{"{{first_name}}"}</span>,{" "}
              <span className="font-mono">{"{{amount}}"}</span>,{" "}
              <span className="font-mono">{"{{expires_at}}"}</span>,{" "}
              <span className="font-mono">{"{{claim_url}}"}</span>. Üye tarafında merchant adı veya provider ücreti gösterilmez.
            </div>
          </div>
        </Card>
      </div>
    </AdminLayout>
  );
}
