import AdminLayout from "@/components/AdminLayout";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { dbSelect, dbSelectMaybeOne } from "@/lib/db";
import { fmtTRY, txStatusLabel, txTypeLabel, withdrawSessionStatusLabel } from "@/lib/format";
import {
  type AdminTx,
  type AdminTxFilters,
  TX_PAGE_SIZE,
  TX_EXPORT_MAX,
  fetchTransactionPage,
  fetchAllTransactionsForExport,
  merchantLabel,
  postedAmount,
  reconciliationUrl,
  txToCsvRow,
  downloadCsv,
} from "@/lib/admin-transactions";
import TransactionDetailSheet from "@/components/admin/TransactionDetailSheet";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Download, RefreshCw, Filter, X, ChevronDown, ChevronUp, Scale } from "lucide-react";
import { TxIdBadge } from "@/components/TxIdBadge";
import { useAuth } from "@/hooks/useAuth";
import { Can } from "@/components/Can";
import { maskEmail, maskIban, maskName, sensitiveText } from "@/lib/mask";
import DateRangePicker from "@/components/DateRangePicker";
import { useAdminMerchantsPicker } from "@/contexts/AdminReferenceDataContext";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { translateError } from "@/lib/i18n-errors";
import { isAffiliateEnabled } from "@/lib/feature-flags";

type WithdrawQueueRow = {
  id: string;
  public_no: string | null;
  user_id: string;
  amount: number;
  status: string;
  iban: string | null;
  iban_holder: string | null;
  created_at: string;
};

const SEARCH_DEBOUNCE_MS = 400;

const TYPE_OPTIONS_ALL: { value: string; label: string }[] = [
  { value: "topup", label: "Yatırma" },
  { value: "spend", label: "Harcama" },
  { value: "merchant_credit", label: "Cüzdana Giriş (Akış B)" },
  { value: "bonus", label: "Bonus" },
  { value: "adjustment", label: "Düzeltme" },
  { value: "merchant_deposit", label: "Merchant Yatırma" },
  { value: "merchant_withdraw", label: "Merchant Çekim" },
  { value: "referral_bonus", label: "Davet ödülü" },
  { value: "profit_share", label: "Kazanç payı" },
  { value: "affiliate_commission", label: "Affiliate komisyon" },
  { value: "affiliate_payout", label: "Affiliate ödeme" },
];

const TYPE_OPTIONS = TYPE_OPTIONS_ALL.filter(
  (o) => isAffiliateEnabled() || !o.value.startsWith("affiliate_"),
);

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "completed", label: "Tamamlandı" },
  { value: "pending", label: "Beklemede" },
  { value: "failed", label: "Başarısız" },
  { value: "cancelled", label: "İptal edildi" },
  { value: "expired", label: "Süresi doldu" },
];

export default function AdminTransactions() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  const { can } = useAuth();
  const canViewFull = can("transactions", "view_full");
  const canExport = can("transactions", "export");
  const canViewWithdrawDest = can("withdrawals", "view_destination");

  const [types, setTypes] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [merchantId, setMerchantId] = useState<string>("");
  const [amountMin, setAmountMin] = useState<string>("");
  const [amountMax, setAmountMax] = useState<string>("");
  const [search, setSearch] = useState<string>("");
  const [searchDebounced, setSearchDebounced] = useState<string>("");
  const { merchants } = useAdminMerchantsPicker();

  const [txs, setTxs] = useState<AdminTx[]>([]);
  const [loading, setLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const cursorRef = useRef<string | null>(null);
  const [withdrawQueue, setWithdrawQueue] = useState<WithdrawQueueRow[]>([]);
  const [withdrawLoading, setWithdrawLoading] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(true);
  const [selectedTx, setSelectedTx] = useState<AdminTx | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const deepLinkApplied = useRef(false);

  const filters: AdminTxFilters = useMemo(
    () => ({
      types,
      statuses,
      dateFrom,
      dateTo,
      merchantId,
      amountMin,
      amountMax,
      search: searchDebounced,
      merchants,
      canViewFull,
    }),
    [types, statuses, dateFrom, dateTo, merchantId, amountMin, amountMax, searchDebounced, merchants, canViewFull],
  );

  useEffect(() => {
    const handle = window.setTimeout(() => setSearchDebounced(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [search]);

  useEffect(() => {
    if (deepLinkApplied.current) return;
    const sessionId = searchParams.get("session");
    const publicNo = searchParams.get("public_no");
    if (!sessionId && !publicNo) return;
    deepLinkApplied.current = true;

    const apply = async () => {
      if (publicNo) {
        setSearch(publicNo);
        setStatuses([]);
        return;
      }
      if (!sessionId) return;
      const w = await dbSelectMaybeOne<{ public_no: string | null }>("withdraw_sessions", {
        cols: "public_no",
        where: { id: sessionId },
      }).catch(() => null);
      if (w?.public_no) {
        setSearch(w.public_no);
        setStatuses([]);
        return;
      }
      const top = await dbSelectMaybeOne<{ public_no: string | null }>("topup_sessions", {
        cols: "public_no",
        where: { id: sessionId },
      }).catch(() => null);
      if (top?.public_no) {
        setSearch(top.public_no);
        setStatuses([]);
      }
    };
    void apply();
  }, [searchParams]);

  const loadWithdrawQueue = async () => {
    setWithdrawLoading(true);
    const data = await dbSelect<WithdrawQueueRow>("withdraw_sessions", {
      cols: "id, public_no, user_id, amount, status, iban, iban_holder, created_at",
      where: [{ col: "status", op: "in", val: ["pending", "sent_to_merchant"] }],
      order: { col: "created_at", asc: false },
      limit: 20,
    }).catch(() => [] as WithdrawQueueRow[]);
    setWithdrawQueue(data);
    setWithdrawLoading(false);
  };

  const fetchPage = useCallback(
    async (reset: boolean) => {
      setLoading(true);
      const cursor = reset ? null : cursorRef.current;
      const { rows, error } = await fetchTransactionPage(filters, cursor);
      if (error) {
        toast.error(translateError(error, "İşlemler yüklenemedi"));
        setLoading(false);
        return;
      }
      if (rows.length > 0) cursorRef.current = rows[rows.length - 1].created_at;
      setHasMore(rows.length === TX_PAGE_SIZE);
      setTxs((prev) => (reset ? rows : [...prev, ...rows]));
      setLoading(false);
    },
    [filters],
  );

  const refreshAll = useCallback(async () => {
    await loadWithdrawQueue();
    cursorRef.current = null;
    setHasMore(true);
    await fetchPage(true);
  }, [fetchPage]);

  useEffect(() => {
    cursorRef.current = null;
    setHasMore(true);
    void fetchPage(true);
  }, [fetchPage]);

  useEffect(() => {
    void loadWithdrawQueue();
  }, []);

  const csvHeader = canViewFull
    ? "tarih,işlem_no,merchant_ref,external_tx_id,üye,e-posta,merchant,tip,tutar,ücret,işlenen_net,durum,açıklama\n"
    : "tarih,işlem_no,üye,merchant,tip,tutar,ücret,işlenen_net,durum,açıklama\n";

  const exportCsvLoaded = () => {
    if (!canExport || txs.length === 0) return;
    const body = txs.map((row) => txToCsvRow(row, merchants, canViewFull, maskName)).join("\n");
    downloadCsv(csvHeader + body, `transactions-loaded-${Date.now()}.csv`);
    toast.success(`${txs.length} satır dışa aktarıldı`);
  };

  const exportCsvFull = async () => {
    if (!canExport) return;
    setExportLoading(true);
    const { rows, truncated, error } = await fetchAllTransactionsForExport(filters);
    setExportLoading(false);
    if (error) {
      toast.error(translateError(error, "Dışa aktarma başarısız"));
      return;
    }
    if (rows.length === 0) {
      toast.message("Dışa aktarılacak kayıt yok");
      return;
    }
    const body = rows.map((row) => txToCsvRow(row, merchants, canViewFull, maskName)).join("\n");
    downloadCsv(csvHeader + body, `transactions-filter-${Date.now()}.csv`);
    toast.success(
      truncated
        ? `${TX_EXPORT_MAX.toLocaleString("tr-TR")} satır sınırına ulaşıldı — daraltılmış filtreyle tekrar deneyin`
        : `${rows.length} satır dışa aktarıldı`,
    );
  };

  const openTxDetail = (row: AdminTx) => {
    setSelectedTx(row);
    setSheetOpen(true);
  };

  const toggleType = (v: string) => setTypes((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));
  const toggleStatus = (v: string) =>
    setStatuses((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));

  const clearFilters = () => {
    setTypes([]);
    setStatuses([]);
    setDateFrom("");
    setDateTo("");
    setMerchantId("");
    setAmountMin("");
    setAmountMax("");
    setSearch("");
  };

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (types.length > 0) n++;
    if (statuses.length > 0) n++;
    if (dateFrom) n++;
    if (dateTo) n++;
    if (merchantId) n++;
    if (amountMin) n++;
    if (amountMax) n++;
    if (search) n++;
    return n;
  }, [types, statuses, dateFrom, dateTo, merchantId, amountMin, amountMax, search]);

  const highlightPublicNo = searchDebounced.toUpperCase();

  return (
    <AdminLayout title="İşlemler" requireAny={["transactions:view_full", "transactions:view_masked"]}>
      <Card className="p-4 mb-4">
        <button
          type="button"
          className="flex w-full items-center justify-between gap-2 text-left"
          onClick={() => setWithdrawOpen((o) => !o)}
        >
          <div>
            <div className="text-sm font-medium">Bekleyen üye çekimleri</div>
            <div className="text-xs text-muted-foreground">
              {withdrawQueue.length > 0
                ? `${withdrawQueue.length} kayıt`
                : "Bekleyen çekim yok"}
              {" · "}
              IBAN {canViewWithdrawDest ? "tam" : "maskeli"} görünür
            </div>
          </div>
          {withdrawOpen ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
        </button>
        {withdrawOpen && (
          <div className="mt-3">
            {withdrawLoading ? (
              <div className="text-sm text-muted-foreground">Yükleniyor…</div>
            ) : withdrawQueue.length === 0 ? null : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="text-left p-2">İşlem No</th>
                      <th className="text-left p-2">Tutar</th>
                      <th className="text-left p-2">IBAN</th>
                      <th className="text-left p-2">Hesap sahibi</th>
                      <th className="text-left p-2">Durum</th>
                    </tr>
                  </thead>
                  <tbody>
                    {withdrawQueue.map((w) => (
                      <tr
                        key={w.id}
                        className="border-t hover:bg-muted/30 cursor-pointer"
                        onClick={() => nav(`/admin/members/${w.user_id}`)}
                      >
                        <td className="p-2" onClick={(e) => e.stopPropagation()}>
                          <TxIdBadge publicNo={w.public_no} />
                        </td>
                        <td className="p-2 tabular-nums">{fmtTRY(Number(w.amount))}</td>
                        <td className="p-2 font-mono text-xs">
                          {sensitiveText(can, "withdrawals", "view_destination", w.iban ?? "", maskIban)}
                        </td>
                        <td className="p-2 text-xs">
                          {sensitiveText(can, "withdrawals", "view_destination", w.iban_holder ?? "", maskName)}
                        </td>
                        <td className="p-2">
                          <Badge variant="outline" className="text-[10px]">
                            {withdrawSessionStatusLabel(w.status)}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </Card>

      <Card className="p-4 mb-4">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex-1 min-w-0 w-full sm:min-w-[12rem]">
              <Input
                placeholder={
                  canViewFull
                    ? "İşlem no, üye, e-posta, merchant ref, external id…"
                    : "İşlem no, üye adı, açıklama…"
                }
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void refreshAll()}
                className="h-9"
              />
            </div>
            <Button variant="outline" size="sm" onClick={() => void refreshAll()} disabled={loading || withdrawLoading}>
              <RefreshCw className={`size-4 mr-1 ${loading || withdrawLoading ? "animate-spin" : ""}`} /> Yenile
            </Button>
            <Can do="transactions:export">
              <Button variant="outline" size="sm" onClick={exportCsvLoaded} disabled={txs.length === 0}>
                <Download className="size-4 mr-1" /> CSV (yüklenen)
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void exportCsvFull()}
                disabled={exportLoading || loading}
              >
                <Download className={`size-4 mr-1 ${exportLoading ? "animate-pulse" : ""}`} />
                {exportLoading ? "Aktarılıyor…" : "CSV (tüm filtre)"}
              </Button>
            </Can>
            {activeFilterCount > 0 && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                <X className="size-4 mr-1" /> Filtreleri temizle ({activeFilterCount})
              </Button>
            )}
          </div>

          <div className="flex flex-wrap gap-1">
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => { setStatuses(["pending"]); setTypes([]); }}>
              Bekleyen
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => {
                const today = new Date().toISOString().slice(0, 10);
                setDateFrom(today);
                setDateTo(today);
              }}
            >
              Bugün
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => {
                const d = new Date();
                d.setHours(d.getHours() - 24);
                setDateFrom(d.toISOString());
                setDateTo("");
                setStatuses(["failed"]);
              }}
            >
              Son 24s başarısız
            </Button>
          </div>

          <div>
            <Label className="text-xs flex items-center gap-1 mb-1">
              <Filter className="size-3" /> Tip
            </Label>
            <div className="flex flex-wrap gap-1">
              {TYPE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => toggleType(opt.value)}
                  className={`text-xs px-3 py-1.5 rounded-md transition-colors ${
                    types.includes(opt.value) ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/70"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label className="text-xs mb-1">Durum</Label>
            <div className="flex flex-wrap gap-1">
              {STATUS_OPTIONS.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => toggleStatus(s.value)}
                  className={`text-xs px-3 py-1.5 rounded-md transition-colors ${
                    statuses.includes(s.value) ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/70"
                  }`}
                >
                  {s.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setStatuses([])}
                className={`text-xs px-3 py-1.5 rounded-md transition-colors ${
                  statuses.length === 0 ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/70"
                }`}
              >
                Tümü
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2">
            <div className="col-span-2">
              <Label className="text-xs">Tarih aralığı</Label>
              <DateRangePicker
                value={{ from: dateFrom, to: dateTo }}
                onChange={(next) => {
                  setDateFrom(next.from ?? "");
                  setDateTo(next.to ?? "");
                }}
                buttonClassName="w-full h-9 text-xs"
              />
            </div>
            <div>
              <Label className="text-xs">Min tutar</Label>
              <Input
                type="number"
                value={amountMin}
                onChange={(e) => setAmountMin(e.target.value)}
                className="h-9 text-xs"
                placeholder="0"
              />
            </div>
            <div>
              <Label className="text-xs">Max tutar</Label>
              <Input
                type="number"
                value={amountMax}
                onChange={(e) => setAmountMax(e.target.value)}
                className="h-9 text-xs"
                placeholder="∞"
              />
            </div>
            <div>
              <Label className="text-xs">Merchant</Label>
              <select
                value={merchantId}
                onChange={(e) => setMerchantId(e.target.value)}
                className="w-full h-9 border rounded-md px-2 bg-background text-xs"
              >
                <option value="">Tümü</option>
                {merchants.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.merchant_scope === "child" ? "Bayi: " : m.merchant_scope === "parent" ? "Ana: " : ""}
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {txs.length > 0 && (
            <p className="text-[11px] text-muted-foreground">
              Yüklü {txs.length} satır · &quot;CSV (tüm filtre)&quot; en fazla {TX_EXPORT_MAX.toLocaleString("tr-TR")} kayıt indirir.
            </p>
          )}
        </div>
      </Card>

      <div className="bg-background border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="text-left p-3">Tarih</th>
              <th className="text-left p-3">İşlem No</th>
              <th className="text-left p-3">Üye</th>
              <th className="text-left p-3">Merchant</th>
              <th className="text-left p-3">Tip</th>
              <th className="text-right p-3">Tutar</th>
              <th className="text-right p-3">Ücret</th>
              <th className="text-right p-3">İşlenen Net</th>
              <th className="text-right p-3">Puan</th>
              <th className="text-center p-3">Durum</th>
              <th className="text-left p-3">Açıklama</th>
            </tr>
          </thead>
          <tbody>
            {txs.map((row) => (
              <tr
                key={row.id}
                className={`border-t hover:bg-muted/30 cursor-pointer ${
                  highlightPublicNo && row.public_no?.toUpperCase() === highlightPublicNo ? "bg-primary/5" : ""
                }`}
                onClick={() => openTxDetail(row)}
              >
                <td className="p-3 text-xs text-muted-foreground tabular-nums">
                  {new Date(row.created_at).toLocaleString("tr-TR")}
                </td>
                <td className="p-3" onClick={(e) => e.stopPropagation()}>
                  <TxIdBadge publicNo={row.public_no} />
                  {canViewFull && (row.merchant_ref || row.external_tx_id) && (
                    <div className="mt-1 flex flex-col gap-0.5 font-mono text-[10px] text-muted-foreground">
                      {row.merchant_ref && <span>M: {row.merchant_ref}</span>}
                      {row.external_tx_id && <span>X: {row.external_tx_id}</span>}
                    </div>
                  )}
                </td>
                <td className="p-3">
                  <div className="font-medium">
                    {canViewFull
                      ? `${row.profile?.first_name ?? ""} ${row.profile?.last_name ?? ""}`.trim()
                      : maskName(`${row.profile?.first_name ?? ""} ${row.profile?.last_name ?? ""}`.trim())}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {canViewFull ? row.profile?.email : maskEmail(row.profile?.email)}
                  </div>
                </td>
                <td className="p-3 text-xs max-w-[140px] truncate" title={merchantLabel(row, merchants)}>
                  {merchantLabel(row, merchants)}
                </td>
                <td className="p-3">
                  <Badge variant="outline">{txTypeLabel(row.type)}</Badge>
                </td>
                <td
                  className={`p-3 text-right tabular-nums font-medium ${
                    row.type === "spend" || row.type === "merchant_withdraw" ? "text-destructive" : "text-success"
                  }`}
                >
                  {row.type === "spend" || row.type === "merchant_withdraw" ? "−" : "+"}
                  {fmtTRY(Number(row.amount))}
                </td>
                <td className="p-3 text-right tabular-nums text-muted-foreground">
                  {Number(row.fee) > 0 ? fmtTRY(Number(row.fee)) : "—"}
                </td>
                <td
                  className={`p-3 text-right tabular-nums text-xs ${
                    postedAmount(row) === null
                      ? "text-muted-foreground"
                      : postedAmount(row)! < 0
                        ? "text-destructive"
                        : "text-success"
                  }`}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="inline-flex items-center justify-end gap-1">
                    <span>
                      {postedAmount(row) === null
                        ? "—"
                        : `${postedAmount(row)! < 0 ? "−" : "+"}${fmtTRY(Math.abs(postedAmount(row)!))}`}
                    </span>
                    {reconciliationUrl(row) && (
                      <Link
                        to={reconciliationUrl(row)!}
                        className="text-muted-foreground hover:text-primary"
                        title="Mutabakatta göster"
                      >
                        <Scale className="size-3.5" />
                      </Link>
                    )}
                  </div>
                </td>
                <td className="p-3 text-right tabular-nums">
                  {row.points && row.points !== 0 ? (
                    <span className={`text-xs font-medium ${row.points > 0 ? "text-success" : "text-destructive"}`}>
                      {row.points > 0 ? "+" : "−"}
                      {Math.abs(row.points)}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="p-3 text-center">
                  <Badge
                    variant={
                      row.status === "completed"
                        ? "secondary"
                        : row.status === "reversed" || row.status === "failed"
                          ? "destructive"
                          : "outline"
                    }
                  >
                    {txStatusLabel(row.status)}
                  </Badge>
                </td>
                <td className="p-3 text-muted-foreground text-xs max-w-[280px]">
                  <div className="truncate">{row.description ?? "—"}</div>
                  {row.merchant_note && (
                    <div
                      className="mt-0.5 italic text-[11px] text-muted-foreground/80 truncate"
                      title={row.merchant_note}
                    >
                      {t("common.merchantNote")}: {row.merchant_note}
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {txs.length === 0 && !loading && (
              <tr>
                <td colSpan={11} className="p-8 text-center text-muted-foreground">
                  Filtreyle eşleşen işlem yok
                </td>
              </tr>
            )}
            {loading && txs.length === 0 && (
              <tr>
                <td colSpan={11} className="p-8 text-center text-muted-foreground">
                  Yükleniyor…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {hasMore && txs.length > 0 && (
        <div className="flex justify-center mt-4">
          <Button variant="outline" onClick={() => void fetchPage(false)} disabled={loading}>
            {loading ? "Yükleniyor..." : "Daha fazla yükle"}
          </Button>
        </div>
      )}

      <TransactionDetailSheet
        tx={selectedTx}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        merchants={merchants}
        canViewFull={canViewFull}
      />
    </AdminLayout>
  );
}
