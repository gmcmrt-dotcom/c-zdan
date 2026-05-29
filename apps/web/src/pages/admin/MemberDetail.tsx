import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import AdminLayout from "@/components/AdminLayout";
import DetailPage from "@/components/DetailPage";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { rpc } from "@/lib/rpc";
import { dbSelect, dbSelectMaybeOne, dbCount } from "@/lib/db";
import { fmtTRY, fmtRelative, fmtDate, txTypeLabel, pointReasonLabel, fmtNumber, maskBalance, kycStatusLabel, txStatusLabel } from "@/lib/format";
import { maskEmail, maskPhone, maskName } from "@/lib/mask";
import { useAuth } from "@/hooks/useAuth";
import { Can } from "@/components/Can";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Snowflake, Sun, ShieldCheck, ShieldX, MessageSquare, LogOut } from "lucide-react";
import { AdminAdjustBlock, MemberEditBlock, RecentTxPreview, ReferralsTab, SessionsTab } from "./MemberDetailExtras";
import { Link } from "react-router-dom";
import TxIdBadge from "@/components/TxIdBadge";
import { toast } from "sonner";
import { translateError } from "@/lib/i18n-errors";
import { auditActionLabel, errorCodeLabel, resourceLabel } from "@/lib/bo-labels";

type Member = {
  id: string; email: string; first_name: string; last_name: string;
  phone: string | null; is_frozen: boolean; kyc_status: string;
  member_no: string; created_at: string;
};
type Account = { balance: number; reserved_balance: number; total_points: number; current_tier_id: number | null };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default function AdminMemberDetail() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const { can } = useAuth();
  const [member, setMember] = useState<Member | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [tierName, setTierName] = useState<string | null>(null);
  const [txCount, setTxCount] = useState<number>(0);
  const [recent, setRecent] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [freezeOpen, setFreezeOpen] = useState(false);
  const [freezeReason, setFreezeReason] = useState("");
  const [freezeBusy, setFreezeBusy] = useState(false);
  const [kycDialog, setKycDialog] = useState<"verified" | "rejected" | "pending" | null>(null);
  const [kycReason, setKycReason] = useState("");
  const [kycBusy, setKycBusy] = useState(false);
  const [openChatCount, setOpenChatCount] = useState(0);
  const [lastLoginAt, setLastLoginAt] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState("info");
  const [loadError, setLoadError] = useState<string | null>(null);

  const idValid = !!id && UUID_RE.test(id);

  const fullPii = can("members.pii", "view_full");
  const fullBalance = can("members.balance", "view_full");
  const canManualAdjust = can("members", "manual_adjust");

  const load = async () => {
    if (!id || !idValid) {
      setLoading(false);
      setMember(null);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const [m, a, tx, count, chatCount, lastLogin] = await Promise.all([
        dbSelectMaybeOne<Member>("profiles", {
          cols: "id, email, first_name, last_name, phone, is_frozen, kyc_status, member_no, created_at",
          where: { id },
        }),
        dbSelectMaybeOne<Account & { loyalty_tiers?: { display_name: string } | null }>("accounts", {
          cols: "balance,reserved_balance,total_points,current_tier_id,loyalty_tiers(display_name)",
          where: { user_id: id },
        }),
        dbSelect<any>("transactions", {
          cols: "id,type,amount,status,created_at,public_no",
          where: { user_id: id },
          order: { col: "created_at", asc: false },
          limit: 5,
        }),
        dbCount("transactions", { where: { user_id: id } }),
        dbCount("chat_threads", {
          where: [
            { col: "user_id", op: "eq", val: id },
            { col: "status", op: "in", val: ["open", "pending_staff", "pending_user"] },
          ],
        }),
        dbSelectMaybeOne<{ created_at: string }>("user_login_ips", {
          cols: "created_at",
          where: { user_id: id },
          order: { col: "created_at", asc: false },
        }),
      ]);
      setMember(m);
      setAccount(a);
      setRecent(tx ?? []);
      setTxCount(count);
      setOpenChatCount(chatCount);
      setLastLoginAt(lastLogin?.created_at ?? null);
      const tier = (a as any)?.loyalty_tiers;
      setTierName(tier?.display_name ?? null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [id, idValid]);

  const confirmFreeze = async () => {
    if (!member) return;
    setFreezeBusy(true);
    const nextFrozen = !member.is_frozen;
    try {
      await rpc("admin_freeze_member", {
        _user_id: member.id,
        _frozen: nextFrozen,
        _reason: freezeReason.trim() || null,
      });
      toast.success(nextFrozen ? "Üye donduruldu" : "Üye aktif edildi");
      setFreezeOpen(false);
      setFreezeReason("");
      load();
    } catch (err) {
      toast.error(translateError(err, "İşlem başarısız"));
    } finally {
      setFreezeBusy(false);
    }
  };

  const confirmKyc = async () => {
    if (!member || !kycDialog) return;
    setKycBusy(true);
    try {
      await rpc("admin_set_member_kyc", {
        _user_id: member.id,
        _status: kycDialog,
        _reason: kycReason.trim() || null,
      });
      toast.success("KYC güncellendi");
      setKycDialog(null);
      setKycReason("");
      load();
    } catch (err) {
      toast.error(translateError(err, "KYC güncellenemedi"));
    } finally {
      setKycBusy(false);
    }
  };

  if (!idValid) {
    return (
      <AdminLayout title="Üye" requireAny={["members:view_full", "members:view_masked"]}>
        <div className="p-6 space-y-3">
          <p className="text-muted-foreground">Geçersiz üye kimliği.</p>
          <Button variant="outline" size="sm" onClick={() => nav("/admin/members")}>Üye listesine dön</Button>
        </div>
      </AdminLayout>
    );
  }

  if (loading) {
    return <AdminLayout title="Üye" requireAny={["members:view_full", "members:view_masked"]}><div className="p-6 text-muted-foreground">Yükleniyor…</div></AdminLayout>;
  }

  if (!member) {
    return (
      <AdminLayout title="Üye bulunamadı" requireAny={["members:view_full", "members:view_masked"]}>
        <div className="p-6 space-y-3">
          <p className="text-muted-foreground">{loadError ? `Üye yüklenemedi: ${loadError}` : "Bu kimliğe ait üye kaydı yok."}</p>
          <Button variant="outline" size="sm" onClick={() => nav("/admin/members")}>Üye listesine dön</Button>
        </div>
      </AdminLayout>
    );
  }

  const fullName = `${member.first_name} ${member.last_name}`;
  const displayName = fullPii ? fullName : maskName(fullName);
  const displayEmail = fullPii ? member.email : maskEmail(member.email);
  const displayPhone = fullPii ? (member.phone ?? "—") : maskPhone(member.phone);

  return (
    <AdminLayout title="Üye Detayı" requireAny={["members:view_full", "members:view_masked"]}>
      <DetailPage
        title={displayName}
        subtitle={[
          `Üye no: ${member.member_no}`,
          `Kayıt: ${fmtDate(member.created_at)}`,
          lastLoginAt ? `Son giriş: ${fmtRelative(lastLoginAt)}` : null,
        ].filter(Boolean).join(" · ")}
        onBack={() => nav("/admin/members")}
        lazyMount
        tab={detailTab}
        onTabChange={setDetailTab}
        actions={
          <>
            <Button variant="outline" size="sm" asChild>
              <Link to={`/admin/chat?user=${member.id}`}>
                <MessageSquare className="size-4 mr-1" />
                Destek{openChatCount > 0 ? ` (${openChatCount})` : ""}
              </Link>
            </Button>
            <Can do="members:freeze">
              <Button
                variant={member.is_frozen ? "default" : "outline"}
                size="sm"
                onClick={() => { setFreezeOpen(true); setFreezeReason(""); }}
              >
                {member.is_frozen ? <><Sun className="size-4 mr-1" />Aktif et</> : <><Snowflake className="size-4 mr-1" />Dondur</>}
              </Button>
              {/* K4 — Force logout this user (Q24). Same perm as freeze
                  because it's a session-only action; doesn't change account
                  state. Confirms before firing so an accidental click
                  doesn't kick a user out. */}
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  if (!confirm("Bu üyenin tüm aktif oturumlarını sonlandırmak istediğine emin misin?")) return;
                  try {
                    await rpc("admin_force_logout_member", {
                      _user_id: member.id,
                      _reason: "admin_action",
                    });
                    toast.success("Üyenin tüm oturumları sonlandırıldı");
                  } catch (err) {
                    toast.error(translateError(err, "Oturumlar sonlandırılamadı"));
                  }
                }}
              >
                <LogOut className="size-4 mr-1" />Oturumları kapat
              </Button>
            </Can>
            <Can do="members.kyc:approve">
              {member.kyc_status !== "verified" && (
                <Button variant="outline" size="sm" onClick={() => { setKycDialog("verified"); setKycReason(""); }}>
                  <ShieldCheck className="size-4 mr-1" />Onayla
                </Button>
              )}
              {member.kyc_status !== "rejected" && (
                <Button variant="outline" size="sm" onClick={() => { setKycDialog("rejected"); setKycReason(""); }}>
                  <ShieldX className="size-4 mr-1" />Reddet
                </Button>
              )}
              {member.kyc_status !== "pending" && member.kyc_status !== "none" && (
                <Button variant="outline" size="sm" onClick={() => { setKycDialog("pending"); setKycReason(""); }}>
                  Beklemeye al
                </Button>
              )}
            </Can>
          </>
        }
        stats={[
          { label: "Bakiye",   value: maskBalance(Number(account?.balance ?? 0), fullBalance), accent: "primary" },
          { label: "Rezerve",  value: maskBalance(Number(account?.reserved_balance ?? 0), fullBalance), accent: "warning" },
          { label: "Puan",     value: account?.total_points ?? 0, accent: "success" },
          { label: "Seviye",   value: tierName ?? "—" },
          { label: "Toplam tx", value: txCount },
        ]}
        tabs={[
          {
            value: "info",
            label: "Bilgiler",
            content: (
              <Card className="p-4 space-y-3 max-w-xl">
                <Row label="Ad Soyad" value={displayName} />
                <Row label="E-posta" value={displayEmail} />
                <Row label="Telefon" value={displayPhone} />
                <Row label="Üyelik no" value={<span className="font-mono">{member.member_no}</span>} />
                <Row label="KYC durumu" value={<Badge variant={member.kyc_status === "verified" ? "secondary" : "outline"}>{kycStatusLabel(member.kyc_status)}</Badge>} />
                <Row label="Hesap durumu" value={member.is_frozen ? <Badge variant="destructive">Donduruldu</Badge> : <Badge>Aktif</Badge>} />
                <Row label="Kayıt tarihi" value={fmtDate(member.created_at)} />
                <MemberEditBlock member={member} fullPii={fullPii} onSaved={load} />
                <RecentTxPreview rows={recent} onViewAll={() => setDetailTab("tx")} />
              </Card>
            ),
          },
          {
            value: "ops",
            label: "Operasyon",
            content: (
              <Card className="p-4 max-w-2xl">
                {canManualAdjust ? (
                  <AdminAdjustBlock userId={member.id} onDone={load} />
                ) : (
                  <p className="text-sm text-muted-foreground">Manuel bakiye/puan düzeltme yetkiniz yok.</p>
                )}
              </Card>
            ),
          },
          {
            value: "sessions",
            label: "Bekleyen işlemler",
            content: <SessionsTab userId={member.id} canFullBalance={fullBalance} />,
          },
          {
            value: "referrals",
            label: "Davetler",
            content: <ReferralsTab userId={member.id} />,
          },
          {
            value: "tx",
            label: `Hesap hareketleri (${txCount})`,
            content: <TxTab userId={member.id} canFullBalance={fullBalance} />,
          },
          {
            value: "points",
            label: "Puan geçmişi",
            content: <PointsTab userId={member.id} />,
          },
          {
            // "Sistem hareketleri" tab — provider concept was removed; data layer keeps `provider_ledger` for back-compat.
            value: "ledger",
            label: "Sistem hareketleri",
            content: <LedgerTab userId={member.id} />,
          },
          {
            value: "logins",
            label: "Login geçmişi",
            content: <LoginsTab userId={member.id} />,
          },
          {
            value: "risk",
            label: "Risk analizi",
            content: <RiskTab userId={member.id} />,
          },
          {
            value: "audit",
            label: "Audit log",
            content: <AuditTab userId={member.id} />,
          },
        ]}
      />

      <AlertDialog open={freezeOpen} onOpenChange={setFreezeOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{member.is_frozen ? "Üyeyi aktif et" : "Üyeyi dondur"}</AlertDialogTitle>
            <AlertDialogDescription>Hesap durumu değiştirilecek. İsteğe bağlı sebep ekleyebilirsiniz.</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="detail-freeze-reason">Sebep</Label>
            <Input id="detail-freeze-reason" value={freezeReason} onChange={(e) => setFreezeReason(e.target.value)} />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={freezeBusy}>Vazgeç</AlertDialogCancel>
            <AlertDialogAction disabled={freezeBusy} onClick={confirmFreeze}>
              {freezeBusy ? "İşleniyor…" : "Onayla"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!kycDialog} onOpenChange={(o) => !o && setKycDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              KYC {kycDialog === "verified" ? "onayı" : kycDialog === "rejected" ? "reddi" : "beklemeye alma"}
            </AlertDialogTitle>
            <AlertDialogDescription>Üyenin KYC durumu &quot;{kycStatusLabel(kycDialog ?? "")}&quot; olarak güncellenecek.</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="kyc-reason">Sebep (opsiyonel)</Label>
            <Input id="kyc-reason" value={kycReason} onChange={(e) => setKycReason(e.target.value)} />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={kycBusy}>Vazgeç</AlertDialogCancel>
            <AlertDialogAction disabled={kycBusy} onClick={confirmKyc}>
              {kycBusy ? "İşleniyor…" : "Onayla"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminLayout>
  );
}

function Row({ label, value }: { label: string; value: any }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm">{value}</span>
    </div>
  );
}

function AuditTab({ userId }: { userId: string }) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    dbSelect<any>("audit_log", {
      cols: "id,actor_email,actor_role,action,resource,context,created_at",
      or: [`resource_id.eq.${userId},context->>user_id.eq.${userId}`],
      order: { col: "created_at", asc: false },
      limit: 50,
    })
      .then((data) => { setRows(data); setLoading(false); })
      .catch(() => { setRows([]); setLoading(false); });
  }, [userId]);
  if (loading) return <div className="text-sm text-muted-foreground">Yükleniyor…</div>;
  if (rows.length === 0) return <div className="text-sm text-muted-foreground">Audit kaydı yok.</div>;
  return (
    <Card className="overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
          <tr><th className="text-left p-3">Tarih</th><th className="text-left p-3">Aktör</th><th className="text-left p-3">Eylem</th><th className="text-left p-3">Kaynak</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t">
              <td className="p-3 text-xs">{fmtRelative(r.created_at)}</td>
              <td className="p-3 text-xs">{r.actor_email ?? "system"} <span className="text-muted-foreground">({r.actor_role})</span></td>
              <td className="p-3 text-xs">
                <Badge variant="outline">{auditActionLabel(r.action)}</Badge>
              </td>
              <td className="p-3 text-xs">{resourceLabel(r.resource)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

// ============ HESAP HAREKETLERİ (transactions, paginated) ============
const TX_PAGE = 50;

function TxTab({ userId, canFullBalance }: { userId: string; canFullBalance: boolean }) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const offsetRef = useRef(0);

  const load = async (reset: boolean) => {
    if (reset) {
      setLoading(true);
      offsetRef.current = 0;
    } else {
      setLoadingMore(true);
    }
    const from = reset ? 0 : offsetRef.current;
    const list = await dbSelect<any>("transactions", {
      cols: "id,type,amount,fee,balance_after,status,description,merchant_note,public_no,created_at",
      where: { user_id: userId },
      order: { col: "created_at", asc: false },
      range: { from, to: from + TX_PAGE },
    }).catch(() => []);
    if (reset) setLoading(false);
    else setLoadingMore(false);
    setHasMore(list.length > TX_PAGE);
    const page = list.slice(0, TX_PAGE);
    offsetRef.current = from + page.length;
    setRows((prev) => (reset ? page : [...prev, ...page]));
  };

  useEffect(() => {
    load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);
  if (loading) return <div className="text-sm text-muted-foreground">Yükleniyor…</div>;
  if (rows.length === 0) return <div className="text-sm text-muted-foreground">Henüz hesap hareketi yok.</div>;
  return (
    <Card className="overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
          <tr>
            <th className="text-left p-3">Tip</th>
            <th className="text-left p-3">İşlem No</th>
            <th className="text-left p-3">Açıklama</th>
            <th className="text-right p-3">Tutar</th>
            <th className="text-right p-3">Komisyon</th>
            <th className="text-right p-3">Sonraki bakiye</th>
            <th className="text-center p-3">Durum</th>
            <th className="text-right p-3">Tarih</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const inflow = ["topup","refund","bonus","merchant_deposit","merchant_credit"].includes(r.type);
            return (
              <tr key={r.id} className="border-t hover:bg-muted/20">
                <td className="p-3"><Badge variant="outline">{txTypeLabel(r.type)}</Badge></td>
                <td className="p-3">
                  {r.public_no ? <TxIdBadge publicNo={r.public_no} /> : <span className="text-muted-foreground">—</span>}
                </td>
                <td className="p-3 text-xs text-muted-foreground max-w-[280px]">
                  <div className="truncate">{r.description ?? "—"}</div>
                  {r.merchant_note && (
                    <div
                      className="mt-0.5 italic text-[11px] text-muted-foreground/80 truncate"
                      title={r.merchant_note}
                    >
                      Not: {r.merchant_note}
                    </div>
                  )}
                </td>
                <td className={`p-3 text-right tabular-nums font-medium ${inflow ? "text-success" : "text-destructive"}`}>
                  {inflow ? "+" : "-"}{fmtTRY(Math.abs(Number(r.amount)))}
                </td>
                <td className="p-3 text-right text-xs text-muted-foreground tabular-nums">
                  {Number(r.fee) > 0 ? fmtTRY(Number(r.fee)) : "—"}
                </td>
                <td className="p-3 text-right tabular-nums text-xs">
                  {maskBalance(Number(r.balance_after ?? 0), canFullBalance)}
                </td>
                <td className="p-3 text-center">
                  <Badge variant={r.status === "completed" ? "secondary" : r.status === "failed" ? "destructive" : "outline"}>
                    {txStatusLabel(r.status)}
                  </Badge>
                </td>
                <td className="p-3 text-right text-xs text-muted-foreground whitespace-nowrap">{fmtDate(r.created_at)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {hasMore && (
        <div className="p-3 border-t flex justify-center">
          <Button size="sm" variant="outline" disabled={loadingMore} onClick={() => load(false)}>
            {loadingMore ? "Yükleniyor…" : "Daha fazla"}
          </Button>
        </div>
      )}
    </Card>
  );
}

// ============ PUAN GEÇMİŞİ ============
function PointsTab({ userId }: { userId: string }) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    dbSelect<any>("loyalty_points_log", {
      cols: "id,points,reason,reference_id,created_at",
      where: { user_id: userId },
      order: { col: "created_at", asc: false },
      limit: 100,
    })
      .then((data) => { setRows(data); setLoading(false); })
      .catch(() => { setRows([]); setLoading(false); });
  }, [userId]);
  if (loading) return <div className="text-sm text-muted-foreground">Yükleniyor…</div>;
  if (rows.length === 0) return <div className="text-sm text-muted-foreground">Henüz puan kazanılmamış.</div>;
  return (
    <Card className="overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
          <tr>
            <th className="text-left p-3">Sebep</th>
            <th className="text-right p-3">Puan</th>
            <th className="text-left p-3">Referans</th>
            <th className="text-right p-3">Tarih</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t">
              <td className="p-3">{pointReasonLabel(r.reason)}</td>
              <td className={`p-3 text-right tabular-nums font-semibold ${r.points >= 0 ? "text-success" : "text-destructive"}`}>
                {r.points >= 0 ? "+" : ""}{fmtNumber(r.points)}
              </td>
              <td className="p-3 text-xs font-mono text-muted-foreground">{r.reference_id ? r.reference_id.slice(0, 8) + "…" : "—"}</td>
              <td className="p-3 text-right text-xs text-muted-foreground">{fmtDate(r.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

// ============ PROVIDER LEDGER (external API call'lar) ============
function LedgerTab({ userId }: { userId: string }) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    dbSelect<any>("provider_ledger", {
      cols: "id,direction,status,amount_gross,provider_commission,amount_net,duration_ms,external_ref,error_code,api_request_at,finalized_at,provider_method_id",
      where: { user_id: userId },
      order: { col: "api_request_at", asc: false },
      limit: 100,
    })
      .then((data) => { setRows(data); setLoading(false); })
      .catch(() => { setRows([]); setLoading(false); });
  }, [userId]);
  if (loading) return <div className="text-sm text-muted-foreground">Yükleniyor…</div>;
  if (rows.length === 0) {
    return (
      <Card className="p-6">
        <div className="text-sm text-muted-foreground">
          Bu üye için henüz sistem hareketi kaydı yok.
          <span className="block text-xs mt-1">
            Akış C/D edge function'ları sistem defterine yazmaya başladığında burada görünür.
          </span>
        </div>
      </Card>
    );
  }
  return (
    <Card className="overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
          <tr>
            <th className="text-left p-3">Yön</th>
            <th className="text-right p-3">Brüt</th>
            <th className="text-right p-3">Komisyon</th>
            <th className="text-right p-3">Net</th>
            <th className="text-center p-3">Durum</th>
            <th className="text-right p-3">Süre</th>
            <th className="text-left p-3">Ref</th>
            <th className="text-right p-3">Tarih</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t">
              <td className="p-3"><Badge variant="outline">{r.direction === "deposit" ? "↓ Yatırma" : "↑ Çekim"}</Badge></td>
              <td className="p-3 text-right tabular-nums">{fmtTRY(Number(r.amount_gross))}</td>
              <td className="p-3 text-right tabular-nums text-xs text-muted-foreground">{fmtTRY(Number(r.provider_commission))}</td>
              <td className="p-3 text-right tabular-nums">{fmtTRY(Number(r.amount_net))}</td>
              <td className="p-3 text-center">
                <Badge variant={
                  r.status === "success" ? "secondary" :
                  r.status === "failed" || r.status === "cancelled" ? "destructive" :
                  "outline"
                }>{r.status}</Badge>
                {r.error_code && <div className="text-[10px] text-destructive mt-0.5">{errorCodeLabel(r.error_code)}</div>}
              </td>
              <td className="p-3 text-right text-xs text-muted-foreground">{r.duration_ms ? `${r.duration_ms} ms` : "—"}</td>
              <td className="p-3 text-xs font-mono text-muted-foreground">{r.external_ref ? r.external_ref.slice(0, 12) + "…" : "—"}</td>
              <td className="p-3 text-right text-xs text-muted-foreground">{fmtDate(r.api_request_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

// ============ RİSK ANALİZİ (round-trip farming) ============
function RiskTab({ userId }: { userId: string }) {
  const [windowH, setWindowH] = useState<number>(24);
  const [stats, setStats] = useState<{ spend: number; withdraw: number; spendCount: number; withdrawCount: number; pointsEarned: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    const since = new Date(Date.now() - windowH * 3600 * 1000).toISOString();
    type TxRow = { type: string; amount: number };
    type PtsRow = { points: number };
    const [tx, pts] = await Promise.all([
      dbSelect<TxRow>("transactions", {
        cols: "type,amount",
        where: [
          { col: "user_id", op: "eq", val: userId },
          { col: "status", op: "eq", val: "completed" },
          { col: "type", op: "in", val: ["spend", "merchant_withdraw"] },
          { col: "created_at", op: "gte", val: since },
        ],
      }).catch(() => [] as TxRow[]),
      dbSelect<PtsRow>("loyalty_points_log", {
        cols: "points",
        where: [
          { col: "user_id", op: "eq", val: userId },
          { col: "reason", op: "in", val: ["spend", "spend+cashback"] },
          { col: "created_at", op: "gte", val: since },
        ],
      }).catch(() => [] as PtsRow[]),
    ]);
    const spend    = tx.filter((r) => r.type === "spend").reduce((s: number, r) => s + Number(r.amount), 0);
    const withdraw = tx.filter((r) => r.type === "merchant_withdraw").reduce((s: number, r) => s + Number(r.amount), 0);
    const spendCount    = tx.filter((r) => r.type === "spend").length;
    const withdrawCount = tx.filter((r) => r.type === "merchant_withdraw").length;
    const pointsEarned = pts.reduce((s: number, r) => s + Number(r.points), 0);
    setStats({ spend, withdraw, spendCount, withdrawCount, pointsEarned });
    setLoading(false);
  };

  useEffect(() => { load(); }, [userId, windowH]);

  const ratio = stats && stats.spend > 0 && stats.withdraw > 0
    ? Math.min(stats.spend, stats.withdraw) / Math.max(stats.spend, stats.withdraw)
    : 0;
  const suspicious = stats != null && stats.spend >= 500 && stats.withdraw >= 500 && ratio >= 0.8 && ratio <= 1.25;
  const sevColor = !stats ? "" :
    stats.spend >= 5000 && suspicious ? "text-destructive" :
    stats.spend >= 1500 && suspicious ? "text-warning" :
    suspicious ? "text-muted-foreground" : "text-success";

  const cancelPoints = async () => {
    if (!stats || stats.pointsEarned <= 0) return;
    setBusy(true);
    try {
      const start = new Date(Date.now() - windowH * 3600 * 1000).toISOString();
      const end = new Date().toISOString();
      const data = await rpc<{ success: boolean; error_code?: string; points_cancelled?: number } | Array<{ success: boolean; error_code?: string; points_cancelled?: number }>>("cancel_user_window_points", {
        _user_id: userId,
        _window_start: start,
        _window_end: end,
        _reason: "round_trip_farming",
      });
      const row = Array.isArray(data) ? data[0] : data;
      if (!row?.success) {
        toast.error(translateError({ error_code: row?.error_code }, "Puan iptali başarısız"));
        return;
      }
      toast.success(`${row.points_cancelled} puan iptal edildi`);
      setConfirmOpen(false);
      load();
    } catch (err: any) {
      toast.error(translateError(err, "Puan iptali başarısız"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-sm font-medium">Pencere:</span>
          {[24, 168, 720].map((h) => (
            <Button
              key={h}
              size="sm"
              variant={windowH === h ? "default" : "outline"}
              onClick={() => setWindowH(h)}
            >
              {h === 24 ? "24 saat" : h === 168 ? "7 gün" : "30 gün"}
            </Button>
          ))}
          <Button size="sm" variant="ghost" onClick={load} className="ml-auto">Yenile</Button>
        </div>

        {loading || !stats ? (
          <div className="text-sm text-muted-foreground py-6 text-center">Yükleniyor…</div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <Stat label="Harcama (spend)"   value={fmtTRY(stats.spend)}    sub={`${stats.spendCount} işlem`} />
            <Stat label="Çekim (withdraw)"  value={fmtTRY(stats.withdraw)} sub={`${stats.withdrawCount} işlem`} />
            <Stat label="Eşleşme oranı"      value={ratio > 0 ? ratio.toFixed(3) : "—"} sub={suspicious ? "Şüpheli" : "Normal"} />
            <Stat label="Pencerede kazanılan puan" value={stats.pointsEarned.toString()} accent={sevColor} />
          </div>
        )}
      </Card>

      {stats && suspicious && (
        <Card className="p-4 border-warning/40 bg-warning/5 space-y-2">
          <div className="text-sm font-medium">⚠️ Round-trip farming şüphesi</div>
          <p className="text-xs text-muted-foreground">
            Üye seçilen pencerede yaklaşık aynı hacimde harcama ve çekim yapmış (oran {ratio.toFixed(3)}). Bu pattern aynı parayı içeride döndürerek puan biriktirme şüphesi taşır.
          </p>
        </Card>
      )}

      <Can do="loyalty:update">
        <Card className="p-4 space-y-3">
          <div className="text-sm font-medium">Puan iptali (manuel)</div>
          <p className="text-xs text-muted-foreground">
            Seçili pencerede kazanılan toplam <strong>spend + cashback</strong> puanı geri alınır. <code>loyalty_points_log</code>'a negatif satır + <code>audit_log</code>'a kayıt yazılır. Tier yeniden hesaplanır.
          </p>
          {confirmOpen ? (
            <div className="flex items-center gap-2">
              <Button size="sm" variant="destructive" disabled={busy} onClick={cancelPoints}>
                {busy ? "İşleniyor…" : `Onayla — ${stats?.pointsEarned ?? 0} puanı iptal et`}
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmOpen(false)}>Vazgeç</Button>
            </div>
          ) : (
            <Button
              size="sm"
              variant="outline"
              disabled={!stats || stats.pointsEarned <= 0}
              onClick={() => setConfirmOpen(true)}
            >
              Pencere puanını iptal et
            </Button>
          )}
        </Card>
      </Can>
    </div>
  );
}

function Stat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-[11px] uppercase text-muted-foreground tracking-wider">{label}</div>
      <div className={`text-lg font-semibold tabular-nums mt-1 ${accent ?? ""}`}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

// ============ LOGIN GEÇMİŞİ ============
// Geo + cihaz bilgisi ile zenginleşmiş login geçmişi.
// admin_get_member_login_history RPC içinde has_permission(members, view_login_ips)
// kontrolü var — yetki yoksa boş dizi döner. Frontend de Can ile gate eder.
type LoginRow = {
  id: string;
  ip_address: string | null;
  user_agent: string | null;
  country: string | null;
  country_code: string | null;
  city: string | null;
  region: string | null;
  device_type: string | null;
  browser: string | null;
  browser_version: string | null;
  os: string | null;
  os_version: string | null;
  created_at: string;
};

// ISO-3166 alpha-2 → emoji bayrak (regional indicator codepoint'leri)
function flagEmoji(cc: string | null): string {
  if (!cc || cc.length !== 2) return "🌐";
  const A = 0x1f1e6;
  const codePoints = cc.toUpperCase().split("").map((c) => A + c.charCodeAt(0) - 65);
  return String.fromCodePoint(...codePoints);
}

function LoginsTab({ userId }: { userId: string }) {
  const { can } = useAuth();
  const allowed = can?.("members", "view_login_ips") ?? false;
  const [rows, setRows] = useState<LoginRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!allowed) { setLoading(false); return; }
    rpc<LoginRow[]>("admin_get_member_login_history", { _user_id: userId, _limit: 100 })
      .then((data) => { setRows(data ?? []); setLoading(false); })
      .catch(() => { setRows([]); setLoading(false); });
  }, [userId, allowed]);

  if (!allowed) {
    return (
      <Card className="p-6 text-center text-sm text-muted-foreground">
        Login geçmişini görmek için <code className="font-mono text-xs">members:view_login_ips</code> yetkisi gerekli.
      </Card>
    );
  }
  if (loading) return <div className="text-sm text-muted-foreground">Yükleniyor…</div>;
  if (rows.length === 0) return <div className="text-sm text-muted-foreground">Login kaydı yok.</div>;

  return (
    <Card className="overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
          <tr>
            <th className="text-left p-3">Tarih</th>
            <th className="text-left p-3">IP</th>
            <th className="text-left p-3">Konum</th>
            <th className="text-left p-3">Cihaz</th>
            <th className="text-left p-3">Tarayıcı</th>
            <th className="text-left p-3">OS</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const loc = [r.city, r.region].filter(Boolean).join(", ");
            return (
              <tr key={r.id} className="border-t">
                <td className="p-3 text-xs whitespace-nowrap">{fmtDate(r.created_at)}</td>
                <td className="p-3 text-xs font-mono">{r.ip_address ?? "—"}</td>
                <td className="p-3 text-xs">
                  <span className="mr-1">{flagEmoji(r.country_code)}</span>
                  <span>{r.country ?? "—"}</span>
                  {loc && <span className="text-muted-foreground"> · {loc}</span>}
                </td>
                <td className="p-3 text-xs">
                  <Badge variant="outline" className="font-normal">
                    {r.device_type === "mobile" ? "📱 Mobil"
                     : r.device_type === "tablet" ? "📱 Tablet"
                     : r.device_type === "desktop" ? "🖥️ Masaüstü"
                     : r.device_type === "bot" ? "🤖 Bot"
                     : "—"}
                  </Badge>
                </td>
                <td className="p-3 text-xs">
                  {r.browser ? (
                    <span>{r.browser}{r.browser_version && <span className="text-muted-foreground"> {r.browser_version.split(".")[0]}</span>}</span>
                  ) : "—"}
                </td>
                <td className="p-3 text-xs">
                  {r.os ? (
                    <span>{r.os}{r.os_version && <span className="text-muted-foreground"> {r.os_version}</span>}</span>
                  ) : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}
