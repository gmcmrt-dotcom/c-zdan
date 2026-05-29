import { useEffect, useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import { rpc } from "@/lib/rpc";
import { dbSelect, dbSelectMaybeOne } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Loader2, Save, Ban, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { translateError } from "@/lib/i18n-errors";
import { fmtTRY } from "@/lib/format";
import { useAuth } from "@/hooks/useAuth";

type ReferralRow = {
  id: string;
  referrer_user_id: string;
  referee_user_id: string;
  referral_code: string;
  status: "pending" | "qualified" | "rewarded" | "expired" | "cancelled";
  qualifying_amount: number | null;
  qualified_at: string | null;
  rewarded_at: string | null;
  cancelled_reason: string | null;
  created_at: string;
  meta: Record<string, unknown> | null;
};

type ReferralConfig = {
  id: boolean;
  referrer_points: number;
  referrer_balance: number;
  referee_points: number;
  referee_balance: number;
  min_spend_to_qualify: number;
  monthly_referral_cap: number;
  monthly_reward_cap: number;
  ip_rate_limit_per_24h: number;
  expire_after_days: number;
  is_active: boolean;
  updated_at: string;
};

// i18n audit — TR status label haritası
const STATUS_LABEL: Record<ReferralRow["status"], string> = {
  pending: "Bekliyor",
  qualified: "Hak kazandı",
  rewarded: "Ödüllendi",
  expired: "Süresi doldu",
  cancelled: "İptal edildi",
};

const STATUS_VARIANT: Record<ReferralRow["status"], "default" | "secondary" | "outline" | "destructive"> = {
  pending: "outline",
  qualified: "secondary",
  rewarded: "default",
  expired: "destructive",
  cancelled: "destructive",
};

function fmtDateTime(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("tr-TR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function AdminReferrals() {
  const { can } = useAuth();
  const canManage = can("referrals", "manage");

  const [rows, setRows] = useState<ReferralRow[]>([]);
  const [config, setConfig] = useState<ReferralConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingConfig, setSavingConfig] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"all" | ReferralRow["status"]>("all");
  const [cancelBusy, setCancelBusy] = useState<string | null>(null);
  const [qualifyBusy, setQualifyBusy] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [refRows, cfgRow] = await Promise.all([
        dbSelect<ReferralRow>("referrals", {
          cols: "id, referrer_user_id, referee_user_id, referral_code, status, qualifying_amount, qualified_at, rewarded_at, cancelled_reason, created_at, meta",
          order: { col: "created_at", asc: false },
          limit: 200,
        }),
        dbSelectMaybeOne<ReferralConfig>("referral_config", { where: { id: true } }),
      ]);

      setRows(refRows);
      setConfig(cfgRow);
    } catch (err) {
      toast.error(translateError(err, "Veriler yüklenemedi"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const filtered = statusFilter === "all" ? rows : rows.filter((r) => r.status === statusFilter);

  // manuel onay (admin) — pending davete spend beklemeden hak kazandı işaretler
  const qualifyOne = async (id: string) => {
    if (!canManage) return;
    const reason = window.prompt(
      "Bu daveti manuel onaylamak istediğine emin misin?\nSebep (audit izi için zorunlu):",
      "manual_admin_qualify",
    );
    if (!reason || reason.trim().length < 3) {
      toast.error("Geçerli bir sebep girilmedi.");
      return;
    }
    setQualifyBusy(id);
    try {
      await rpc("admin_qualify_referral_manual", {
        _referral_id: id,
        _reason: reason.trim(),
      });
      toast.success("Davet manuel onaylandı.");
      await load();
    } catch (err) {
      toast.error(translateError(err, "Manuel onay başarısız"));
    } finally {
      setQualifyBusy(null);
    }
  };

  const cancelOne = async (id: string) => {
    if (!canManage) return;
    const reason = window.prompt("İptal sebebi (audit izi için zorunlu):", "manual_review");
    if (!reason || reason.trim().length < 3) {
      toast.error("Geçerli bir sebep girilmedi.");
      return;
    }
    setCancelBusy(id);
    try {
      await rpc("admin_cancel_referral", {
        _referral_id: id,
        _reason: reason.trim(),
      });
      toast.success("Davet iptal edildi.");
      await load();
    } catch (err) {
      toast.error(translateError(err, "İptal başarısız"));
    } finally {
      setCancelBusy(null);
    }
  };

  const saveConfig = async () => {
    if (!config || !canManage) return;
    setSavingConfig(true);
    try {
      const payload = {
        referrer_points: config.referrer_points,
        referrer_balance: config.referrer_balance,
        referee_points: config.referee_points,
        referee_balance: config.referee_balance,
        min_spend_to_qualify: config.min_spend_to_qualify,
        monthly_referral_cap: config.monthly_referral_cap,
        monthly_reward_cap: config.monthly_reward_cap,
        ip_rate_limit_per_24h: config.ip_rate_limit_per_24h,
        expire_after_days: config.expire_after_days,
        is_active: config.is_active,
      };
      await rpc("admin_set_referral_config", { _payload: payload });
      toast.success("Konfigürasyon güncellendi.");
      await load();
    } catch (err) {
      toast.error(translateError(err, "Kaydedilemedi"));
    } finally {
      setSavingConfig(false);
    }
  };

  const stats = {
    total: rows.length,
    pending: rows.filter((r) => r.status === "pending").length,
    qualified: rows.filter((r) => r.status === "qualified").length,
    rewarded: rows.filter((r) => r.status === "rewarded").length,
    cancelled: rows.filter((r) => r.status === "cancelled").length,
    flagged: rows.filter((r) => (r.meta as Record<string, unknown> | null)?.flag_farming === true).length,
  };

  return (
    <AdminLayout title="Davetler" requireAny={["referrals:view"]}>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Üye Davetleri (Referral)</h1>
          <p className="text-sm text-muted-foreground">
            Üye-üye davet kayıtları, anti-fraud yönetimi ve ödül konfigürasyonu.
          </p>
        </div>

        {/* İstatistik kartları */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
          <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Toplam</div><div className="text-xl font-bold tabular-nums">{stats.total}</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Bekleyen</div><div className="text-xl font-bold tabular-nums">{stats.pending}</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Hak kazandı</div><div className="text-xl font-bold tabular-nums">{stats.qualified}</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Ödüllendi</div><div className="text-xl font-bold tabular-nums text-success">{stats.rewarded}</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">İptal</div><div className="text-xl font-bold tabular-nums text-destructive">{stats.cancelled}</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">⚠️ Flag</div><div className="text-xl font-bold tabular-nums text-orange-500">{stats.flagged}</div></CardContent></Card>
        </div>

        <Tabs defaultValue="list">
          <TabsList>
            <TabsTrigger value="list">Davet Listesi</TabsTrigger>
            <TabsTrigger value="config" disabled={!canManage}>Konfigürasyon</TabsTrigger>
          </TabsList>

          {/* LİSTE */}
          <TabsContent value="list" className="space-y-3 mt-4">
            <div className="flex items-center gap-2">
              <Label className="text-xs">Durum:</Label>
              {(["all", "pending", "qualified", "rewarded", "expired", "cancelled"] as const).map((s) => (
                <Button
                  key={s}
                  size="sm"
                  variant={statusFilter === s ? "default" : "outline"}
                  onClick={() => setStatusFilter(s)}
                >
                  {s === "all" ? "Hepsi" : (STATUS_LABEL[s as ReferralRow["status"]] ?? s)}
                </Button>
              ))}
            </div>

            <Card>
              <CardContent className="p-0 overflow-x-auto">
                {loading ? (
                  <div className="p-8 flex items-center justify-center"><Loader2 className="animate-spin" /></div>
                ) : filtered.length === 0 ? (
                  <div className="p-8 text-center text-sm text-muted-foreground">Kayıt bulunamadı.</div>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40 border-b text-xs">
                      <tr>
                        <th className="text-left p-3">Kod</th>
                        <th className="text-left p-3">Davet eden</th>
                        <th className="text-left p-3">Davet edilen</th>
                        <th className="text-left p-3">Durum</th>
                        <th className="text-right p-3">Spend</th>
                        <th className="text-left p-3">Tarih</th>
                        <th className="text-left p-3">Flag</th>
                        <th className="text-right p-3">Aksiyon</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((r) => {
                        const flagged = (r.meta as Record<string, unknown> | null)?.flag_farming === true;
                        return (
                          <tr key={r.id} className="border-b hover:bg-muted/20 transition">
                            <td className="p-3 font-mono text-xs">{r.referral_code}</td>
                            <td className="p-3 font-mono text-[11px] truncate max-w-[150px]">{r.referrer_user_id.slice(0, 8)}…</td>
                            <td className="p-3 font-mono text-[11px] truncate max-w-[150px]">{r.referee_user_id.slice(0, 8)}…</td>
                            <td className="p-3"><Badge variant={STATUS_VARIANT[r.status]} className="text-[10px]">{STATUS_LABEL[r.status] ?? r.status}</Badge></td>
                            <td className="p-3 text-right tabular-nums">{r.qualifying_amount != null ? fmtTRY(r.qualifying_amount) : "—"}</td>
                            <td className="p-3 text-xs">{fmtDateTime(r.created_at)}</td>
                            <td className="p-3">{flagged ? <Badge variant="destructive" className="text-[10px]">⚠️</Badge> : "—"}</td>
                            <td className="p-3 text-right space-x-1">
                              {/* pending davet için manuel onay butonu */}
                              {canManage && r.status === "pending" ? (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="text-success"
                                  title="Manuel onayla"
                                  onClick={() => qualifyOne(r.id)}
                                  disabled={qualifyBusy === r.id}
                                >
                                  {qualifyBusy === r.id ? <Loader2 className="size-3 animate-spin" /> : <CheckCircle2 className="size-3" />}
                                </Button>
                              ) : null}
                              {canManage && (r.status === "pending" || r.status === "qualified") ? (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="text-destructive"
                                  title="İptal et"
                                  onClick={() => cancelOne(r.id)}
                                  disabled={cancelBusy === r.id}
                                >
                                  {cancelBusy === r.id ? <Loader2 className="size-3 animate-spin" /> : <Ban className="size-3" />}
                                </Button>
                              ) : null}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* KONFİGÜRASYON */}
          <TabsContent value="config" className="space-y-3 mt-4">
            {!config ? (
              <Card><CardContent className="p-8 text-center"><Loader2 className="animate-spin inline-block" /></CardContent></Card>
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Switch
                      checked={config.is_active}
                      onCheckedChange={(v) => setConfig({ ...config, is_active: v })}
                      disabled={!canManage}
                    />
                    <span>Sistem {config.is_active ? "aktif" : "kapalı"}</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="space-y-1">
                      <Label className="text-xs">Davet eden — puan</Label>
                      <Input type="number" min={0} value={config.referrer_points}
                        onChange={(e) => setConfig({ ...config, referrer_points: Number(e.target.value) })}
                        disabled={!canManage}/>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Davet eden — bakiye (₺)</Label>
                      <Input type="number" step="0.01" min={0} value={config.referrer_balance}
                        onChange={(e) => setConfig({ ...config, referrer_balance: Number(e.target.value) })}
                        disabled={!canManage}/>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Davet edilen — puan</Label>
                      <Input type="number" min={0} value={config.referee_points}
                        onChange={(e) => setConfig({ ...config, referee_points: Number(e.target.value) })}
                        disabled={!canManage}/>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Davet edilen — bakiye (₺)</Label>
                      <Input type="number" step="0.01" min={0} value={config.referee_balance}
                        onChange={(e) => setConfig({ ...config, referee_balance: Number(e.target.value) })}
                        disabled={!canManage}/>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-2 border-t">
                    <div className="space-y-1">
                      <Label className="text-xs">Min. spend (₺) — qualify gate</Label>
                      <Input type="number" step="0.01" min={1} value={config.min_spend_to_qualify}
                        onChange={(e) => setConfig({ ...config, min_spend_to_qualify: Number(e.target.value) })}
                        disabled={!canManage}/>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Aylık davet cap</Label>
                      <Input type="number" min={1} value={config.monthly_referral_cap}
                        onChange={(e) => setConfig({ ...config, monthly_referral_cap: Number(e.target.value) })}
                        disabled={!canManage}/>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Aylık ödül cap (₺)</Label>
                      <Input type="number" step="0.01" min={1} value={config.monthly_reward_cap}
                        onChange={(e) => setConfig({ ...config, monthly_reward_cap: Number(e.target.value) })}
                        disabled={!canManage}/>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">IP rate limit / 24h</Label>
                      <Input type="number" min={1} value={config.ip_rate_limit_per_24h}
                        onChange={(e) => setConfig({ ...config, ip_rate_limit_per_24h: Number(e.target.value) })}
                        disabled={!canManage}/>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-2 border-t">
                    <div className="space-y-1">
                      <Label className="text-xs">Pending expire (gün)</Label>
                      <Input type="number" min={1} value={config.expire_after_days}
                        onChange={(e) => setConfig({ ...config, expire_after_days: Number(e.target.value) })}
                        disabled={!canManage}/>
                    </div>
                  </div>

                  {canManage && (
                    <div className="pt-3 border-t">
                      <Button onClick={saveConfig} disabled={savingConfig} className="rounded-xl">
                        {savingConfig ? <Loader2 className="size-4 animate-spin mr-1" /> : <Save className="size-4 mr-1" />}
                        Konfigürasyonu kaydet
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </AdminLayout>
  );
}
