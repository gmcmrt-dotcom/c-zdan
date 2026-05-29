import AdminLayout from "@/components/AdminLayout";
import {
  BoDataTable,
  BoFilterCard,
  BoFilterField,
  BoFilterRow,
  BoPageStack,
  BoStatGrid,
  StatCard,
  BoToolbarActions,
  BoToolbarGrow,
  BoToolbarRow,
} from "@/components/bo/BoPagePrimitives";
import DateRangePicker from "@/components/DateRangePicker";
import { CopyButton } from "@/components/CopyButton";
import { Can } from "@/components/Can";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/hooks/useAuth";
import { translateError } from "@/lib/i18n-errors";
import {
  type AdminMemberRow,
  type MemberListFilters,
  exportMembersCsv,
  formatMemberBalance,
  formatMemberEmail,
  formatMemberName,
  memberListRpcParams,
} from "@/lib/member-bo";
import { fmtDate, fmtNumber, kycStatusLabel } from "@/lib/format";
import { rpc } from "@/lib/rpc";
import {
  Download,
  MessageSquare,
  RefreshCw,
  Search,
  Snowflake,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";

const PAGE_SIZE = 50;

type Summary = {
  total_members: number;
  frozen_count: number;
  registered_today: number;
  total_balance: number | null;
};

const defaultFilters: MemberListFilters = {
  search: "",
  frozenFilter: "all",
  kycFilter: "all",
  createdFrom: undefined,
  createdTo: undefined,
  reservedOnly: false,
  sortBy: "created_at",
  sortDir: "desc",
};

export default function AdminMembers() {
  const { can } = useAuth();
  const nav = useNavigate();
  const showFullPii = can("members.pii", "view_full");
  const showFullBalance = can("members.balance", "view_full");
  const pii = useMemo(() => ({ showFullPii, showFullBalance }), [showFullPii, showFullBalance]);

  const [filters, setFilters] = useState<MemberListFilters>(defaultFilters);
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [members, setMembers] = useState<AdminMemberRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const offsetRef = useRef(0);

  const [freezeTarget, setFreezeTarget] = useState<AdminMemberRow | null>(null);
  const [freezeReason, setFreezeReason] = useState("");
  const [freezeBusy, setFreezeBusy] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(filters.search.trim()), 350);
    return () => window.clearTimeout(t);
  }, [filters.search]);

  const activeFilters = useMemo(
    () => ({ ...filters, search: debouncedSearch }),
    [filters, debouncedSearch],
  );

  const loadSummary = useCallback(async () => {
    try {
      const data = await rpc<Summary | Summary[]>("admin_members_summary", {
        _search: activeFilters.search || null,
        _frozen_filter: activeFilters.frozenFilter,
        _kyc_filter: activeFilters.kycFilter,
        _created_from: activeFilters.createdFrom || null,
        _created_to: activeFilters.createdTo || null,
        _reserved_only: activeFilters.reservedOnly,
      });
      const row = Array.isArray(data) ? data[0] : data;
      if (row) {
        setSummary({
          total_members: Number(row.total_members ?? 0),
          frozen_count: Number(row.frozen_count ?? 0),
          registered_today: Number(row.registered_today ?? 0),
          total_balance: row.total_balance != null ? Number(row.total_balance) : null,
        });
      }
    } catch {
      // surface no toast — summary is supplementary
    }
  }, [activeFilters]);

  const loadPage = useCallback(
    async (reset: boolean) => {
      if (reset) {
        setLoading(true);
        offsetRef.current = 0;
      } else {
        setLoadingMore(true);
      }
      const offset = reset ? 0 : offsetRef.current;
      try {
        const data = await rpc<AdminMemberRow[]>(
          "admin_list_members",
          memberListRpcParams(activeFilters, offset, PAGE_SIZE),
        );
        const rows = data ?? [];
        const more = rows.length > PAGE_SIZE;
        const page = more ? rows.slice(0, PAGE_SIZE) : rows;
        setHasMore(more);
        offsetRef.current = offset + page.length;
        setMembers((prev) => (reset ? page : [...prev, ...page]));
      } catch (err) {
        toast.error(translateError(err, "Üye listesi yüklenemedi"));
      } finally {
        if (reset) setLoading(false);
        else setLoadingMore(false);
      }
    },
    [activeFilters],
  );

  const refresh = useCallback(async () => {
    await Promise.all([loadSummary(), loadPage(true)]);
  }, [loadSummary, loadPage]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const toggleSort = (col: MemberListFilters["sortBy"]) => {
    setFilters((f) => {
      if (f.sortBy === col) {
        return { ...f, sortDir: f.sortDir === "desc" ? "asc" : "desc" };
      }
      return { ...f, sortBy: col, sortDir: "desc" };
    });
  };

  const confirmFreeze = async () => {
    if (!freezeTarget) return;
    setFreezeBusy(true);
    const nextFrozen = !freezeTarget.is_frozen;
    try {
      await rpc("admin_freeze_member", {
        _user_id: freezeTarget.id,
        _frozen: nextFrozen,
        _reason: freezeReason.trim() || null,
      });
      toast.success(nextFrozen ? "Üye donduruldu" : "Üye aktif edildi");
      setFreezeTarget(null);
      setFreezeReason("");
      refresh();
    } catch (err) {
      toast.error(translateError(err, "İşlem başarısız"));
    } finally {
      setFreezeBusy(false);
    }
  };

  const sortMark = (col: MemberListFilters["sortBy"]) =>
    filters.sortBy === col ? (filters.sortDir === "desc" ? " ↓" : " ↑") : "";

  return (
    <AdminLayout title="Üyeler" requireAny={["members:view_full", "members:view_masked"]}>
      <BoPageStack>
      <BoStatGrid>
        <StatCard label="Toplam üye" value={summary ? fmtNumber(summary.total_members) : "—"} loading={loading && !summary} />
        <StatCard label="Dondurulmuş" value={summary ? fmtNumber(summary.frozen_count) : "—"} loading={loading && !summary} accent="destructive" />
        <StatCard label="Bugün kayıt" value={summary ? fmtNumber(summary.registered_today) : "—"} loading={loading && !summary} />
        <StatCard
          label="Toplam bakiye"
          valueSize="lg"
          value={
            summary?.total_balance != null
              ? formatMemberBalance(summary.total_balance, pii)
              : showFullBalance
                ? "—"
                : "Gizli"
          }
          loading={loading && !summary}
        />
      </BoStatGrid>

      <BoFilterCard>
        <BoToolbarRow>
          <BoToolbarGrow>
            <div className="relative w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                value={filters.search}
                onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
                placeholder="E-posta, isim, telefon veya üyelik no..."
                className="pl-9 w-full"
              />
            </div>
          </BoToolbarGrow>
          <DateRangePicker
            value={{ from: filters.createdFrom, to: filters.createdTo }}
            onChange={(v) => setFilters((f) => ({ ...f, createdFrom: v.from, createdTo: v.to }))}
            placeholder="Kayıt tarihi"
            className="w-full sm:w-auto shrink-0"
          />
          <BoToolbarActions>
            <Button variant="outline" size="sm" className="flex-1 sm:flex-none" onClick={refresh} disabled={loading}>
              <RefreshCw className={`size-4 mr-1 ${loading ? "animate-spin" : ""}`} />
              Yenile
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="flex-1 sm:flex-none"
              onClick={() => exportMembersCsv(members, pii)}
              disabled={members.length === 0}
            >
              <Download className="size-4 mr-1" />
              CSV
            </Button>
          </BoToolbarActions>
        </BoToolbarRow>

        <BoFilterRow>
          <FilterSelect
            label="Durum"
            value={filters.frozenFilter}
            onChange={(v) => setFilters((f) => ({ ...f, frozenFilter: v as MemberListFilters["frozenFilter"] }))}
            options={[
              { value: "all", label: "Tümü" },
              { value: "active", label: "Aktif" },
              { value: "frozen", label: "Dondurulmuş" },
            ]}
          />
          <FilterSelect
            label="KYC"
            value={filters.kycFilter}
            onChange={(v) => setFilters((f) => ({ ...f, kycFilter: v as MemberListFilters["kycFilter"] }))}
            options={[
              { value: "all", label: "Tümü" },
              { value: "pending", label: "Bekliyor" },
              { value: "verified", label: "Onaylı" },
              { value: "rejected", label: "Reddedildi" },
            ]}
          />
          <label className="flex items-center gap-2 text-sm cursor-pointer sm:pb-2 w-full sm:w-auto">
            <input
              type="checkbox"
              checked={filters.reservedOnly}
              onChange={(e) => setFilters((f) => ({ ...f, reservedOnly: e.target.checked }))}
              className="rounded border"
            />
            Sadece rezerve &gt; 0
          </label>
        </BoFilterRow>
      </BoFilterCard>

      <BoDataTable minWidth={720}>
          <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="text-left p-2 sm:p-3 cursor-pointer select-none min-w-[8rem]" onClick={() => toggleSort("name")}>
                İsim{sortMark("name")}
              </th>
              <th className="text-left p-2 sm:p-3 whitespace-nowrap">Üyelik No</th>
              <th className="text-left p-2 sm:p-3 min-w-[10rem] hidden md:table-cell">E-posta</th>
              <th className="text-left p-2 sm:p-3 hidden lg:table-cell">KYC</th>
              <th className="text-left p-2 sm:p-3 hidden xl:table-cell">Seviye</th>
              <th className="text-right p-2 sm:p-3 cursor-pointer select-none whitespace-nowrap" onClick={() => toggleSort("balance")}>
                Bakiye{sortMark("balance")}
              </th>
              <th className="text-right p-2 sm:p-3 hidden sm:table-cell whitespace-nowrap">Rezerve</th>
              <th className="text-right p-2 sm:p-3 cursor-pointer select-none hidden lg:table-cell" onClick={() => toggleSort("points")}>
                Puan{sortMark("points")}
              </th>
              <th className="text-left p-2 sm:p-3 cursor-pointer select-none hidden xl:table-cell whitespace-nowrap" onClick={() => toggleSort("last_login")}>
                Son giriş{sortMark("last_login")}
              </th>
              <th className="text-left p-2 sm:p-3 cursor-pointer select-none hidden md:table-cell whitespace-nowrap" onClick={() => toggleSort("created_at")}>
                Kayıt{sortMark("created_at")}
              </th>
              <th className="text-center p-2 sm:p-3">Durum</th>
              <th className="text-right p-2 sm:p-3">İşlem</th>
            </tr>
          </thead>
          <tbody>
            {loading &&
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={`sk-${i}`} className="border-t">
                  <td colSpan={12} className="p-3">
                    <Skeleton className="h-6 w-full" />
                  </td>
                </tr>
              ))}
            {!loading &&
              members.map((m) => (
                <tr
                  key={m.id}
                  className="border-t hover:bg-muted/40 cursor-pointer transition-colors"
                  onClick={() => nav(`/admin/members/${m.id}`)}
                >
                  <td className="p-2 sm:p-3 font-medium max-w-[12rem] truncate">{formatMemberName(m, pii)}</td>
                  <td className="p-2 sm:p-3" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-1">
                      <span className="font-mono text-xs tabular-nums">{m.member_no}</span>
                      <CopyButton value={m.member_no} label="Üyelik no kopyala" />
                    </div>
                  </td>
                  <td className="p-2 sm:p-3 text-muted-foreground max-w-[14rem] truncate hidden md:table-cell">{formatMemberEmail(m, pii)}</td>
                  <td className="p-2 sm:p-3 hidden lg:table-cell">
                    <KycBadge status={m.kyc_status} />
                  </td>
                  <td className="p-2 sm:p-3 text-xs text-muted-foreground hidden xl:table-cell">{m.tier_name ?? "—"}</td>
                  <td className="p-2 sm:p-3 text-right tabular-nums whitespace-nowrap">{formatMemberBalance(Number(m.balance), pii)}</td>
                  <td
                    className={`p-2 sm:p-3 text-right tabular-nums whitespace-nowrap hidden sm:table-cell ${
                      Number(m.reserved_balance) > 0 ? "text-warning" : "text-muted-foreground"
                    }`}
                  >
                    {formatMemberBalance(Number(m.reserved_balance), pii)}
                  </td>
                  <td className="p-2 sm:p-3 text-right tabular-nums hidden lg:table-cell">{fmtNumber(m.total_points)}</td>
                  <td className="p-2 sm:p-3 text-xs text-muted-foreground whitespace-nowrap hidden xl:table-cell">
                    {m.last_login_at ? fmtDate(m.last_login_at) : "—"}
                  </td>
                  <td className="p-2 sm:p-3 text-xs text-muted-foreground whitespace-nowrap hidden md:table-cell">{fmtDate(m.created_at)}</td>
                  <td className="p-2 sm:p-3 text-center">
                    {m.is_frozen ? (
                      <Badge variant="destructive">Donduruldu</Badge>
                    ) : (
                      <Badge variant="secondary">Aktif</Badge>
                    )}
                  </td>
                  <td className="p-2 sm:p-3 text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-end gap-1 items-center">
                      {m.open_chat_count > 0 && (
                        <Link
                          to={`/admin/chat?user=${m.id}`}
                          className="inline-flex"
                          title="Açık destek talepleri"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Badge variant="outline" className="gap-1 text-xs">
                            <MessageSquare className="size-3" />
                            {m.open_chat_count}
                          </Badge>
                        </Link>
                      )}
                      <Can do="members:freeze">
                        <Button
                          size="sm"
                          variant="ghost"
                          title={m.is_frozen ? "Aktif et" : "Dondur"}
                          onClick={() => {
                            setFreezeTarget(m);
                            setFreezeReason("");
                          }}
                        >
                          <Snowflake className={`size-4 ${m.is_frozen ? "text-destructive" : ""}`} />
                        </Button>
                      </Can>
                    </div>
                  </td>
                </tr>
              ))}
            {!loading && members.length === 0 && (
              <tr>
                <td colSpan={12} className="p-10 text-center text-muted-foreground">
                  <Users className="size-8 mx-auto mb-2 opacity-40" />
                  Üye bulunamadı. Arama veya filtreleri genişletmeyi deneyin.
                </td>
              </tr>
            )}
          </tbody>
      </BoDataTable>

      {hasMore && !loading && (
        <div className="flex justify-center mt-4">
          <Button variant="outline" disabled={loadingMore} onClick={() => loadPage(false)}>
            {loadingMore ? "Yükleniyor…" : "Daha fazla yükle"}
          </Button>
        </div>
      )}

      <AlertDialog open={!!freezeTarget} onOpenChange={(o) => !o && setFreezeTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {freezeTarget?.is_frozen ? "Üyeyi aktif et" : "Üyeyi dondur"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {freezeTarget && (
                <>
                  <strong>{formatMemberName(freezeTarget, pii)}</strong> ({freezeTarget.member_no}) için hesap
                  durumu değiştirilecek.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="freeze-reason">Sebep (opsiyonel)</Label>
            <Input
              id="freeze-reason"
              value={freezeReason}
              onChange={(e) => setFreezeReason(e.target.value)}
              placeholder="Operasyon notu"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={freezeBusy}>Vazgeç</AlertDialogCancel>
            <AlertDialogAction disabled={freezeBusy} onClick={confirmFreeze}>
              {freezeBusy ? "İşleniyor…" : "Onayla"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      </BoPageStack>
    </AdminLayout>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <BoFilterField label={label}>
      <select
        className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </BoFilterField>
  );
}

function KycBadge({ status }: { status: string }) {
  const variant =
    status === "verified" ? "secondary" : status === "rejected" ? "destructive" : "outline";
  return <Badge variant={variant}>{kycStatusLabel(status)}</Badge>;
}