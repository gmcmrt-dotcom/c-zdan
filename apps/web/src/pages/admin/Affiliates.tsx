import { useEffect, useMemo, useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import { useAdminMerchantsPicker } from "@/contexts/AdminReferenceDataContext";
import { rpc } from "@/lib/rpc";
import { dbSelect, dbSelectMaybeOne } from "@/lib/db";
import { invokeFunction } from "@/lib/fn";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Plus, Link as LinkIcon, Check, X, CheckCircle2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { translateError } from "@/lib/i18n-errors";
import { fmtTRY } from "@/lib/format";
import { useAuth } from "@/hooks/useAuth";
import { maskEmail, maskIban, maskPhone, sensitiveText } from "@/lib/mask";

type Affiliate = {
  id: string;
  kind: "external" | "internal_member";
  code: string;
  name: string;
  email: string;
  phone: string | null;
  linked_user_id: string | null;
  tax_id: string | null;
  iban: string | null;
  status: "active" | "paused" | "terminated";
  created_at: string;
};

type Link = {
  id: string;
  affiliate_id: string;
  merchant_id: string;
  commission_basis: "our_commission" | "merchant_volume" | "fixed_per_tx";
  commission_pct: number | null;
  fixed_amount_per_tx: number | null;
  status: "active" | "paused" | "terminated";
  valid_from: string;
  valid_to: string | null;
  created_at: string;
};

type Payout = {
  id: string;
  affiliate_id: string;
  total_amount: number;
  ledger_count: number;
  status: "requested" | "approved" | "paid" | "rejected" | "cancelled";
  requested_at: string;
  approved_at: string | null;
  paid_at: string | null;
  rejected_reason: string | null;
  transfer_ref: string | null;
};

type Merchant = { id: string; name: string; merchant_type: "commerce" | "finance"; is_active: boolean };

const KIND_LABEL: Record<Affiliate["kind"], string> = {
  external: "Dış kişi/kurum",
  internal_member: "Sistem üyesi",
};

const BASIS_LABEL: Record<Link["commission_basis"], string> = {
  our_commission: "Platform komisyonundan %",
  merchant_volume: "İş yeri cirosundan %",
  fixed_per_tx: "Sabit ₺ / işlem",
};

// status label haritaları (i18n audit)
const AFFILIATE_STATUS_LABEL: Record<Affiliate["status"], string> = {
  active: "Aktif",
  paused: "Duraklatıldı",
  terminated: "Sonlandırıldı",
};
const LINK_STATUS_LABEL: Record<Link["status"], string> = {
  active: "Aktif",
  paused: "Duraklatıldı",
  terminated: "Sonlandırıldı",
};
const PAYOUT_STATUS_LABEL: Record<Payout["status"], string> = {
  requested: "Talep edildi",
  approved: "Onaylandı",
  paid: "Ödendi",
  rejected: "Reddedildi",
  cancelled: "İptal edildi",
};

function fmtDateTime(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("tr-TR", {
      day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch { return iso; }
}

export default function AdminAffiliates() {
  const { can } = useAuth();
  const canManage = can("affiliates", "manage");
  const [affiliates, setAffiliates] = useState<Affiliate[]>([]);
  const [links, setLinks] = useState<Link[]>([]);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const { merchants: cachedMerchants } = useAdminMerchantsPicker();
  const merchants = useMemo<Merchant[]>(
    () => cachedMerchants.map((m) => ({
      id: m.id,
      name: m.name,
      merchant_type: m.merchant_type as Merchant["merchant_type"],
      is_active: m.is_active,
    })),
    [cachedMerchants],
  );
  const [loading, setLoading] = useState(true);

  // Yeni affiliate form
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newKind, setNewKind] = useState<"external" | "internal_member">("external");
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPhone, setNewPhone] = useState("");
  // TC/vergi no input kaldırıldı
  const [newIban, setNewIban] = useState("");
  const [newLinkedUserId, setNewLinkedUserId] = useState("");
  const [newAuthUserId, setNewAuthUserId] = useState("");
  const [newAuthPassword, setNewAuthPassword] = useState("Test12345!");
  const [creatingAuthUser, setCreatingAuthUser] = useState(false);

  // merchant tipi + multi-merchant seçim + komisyon
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3 | 4>(1);
  const [wizardMerchantType, setWizardMerchantType] = useState<"commerce" | "finance">("commerce");
  const [wizardMerchantIds, setWizardMerchantIds] = useState<string[]>([]);
  const [wizardBasis, setWizardBasis] = useState<Link["commission_basis"]>("our_commission");
  const [wizardPct, setWizardPct] = useState("20");
  const [wizardFixed, setWizardFixed] = useState("");

  // Yeni link form
  const [linkOpen, setLinkOpen] = useState(false);
  const [linking, setLinking] = useState(false);
  const [linkAffiliateId, setLinkAffiliateId] = useState("");
  const [linkMerchantId, setLinkMerchantId] = useState("");
  const [linkBasis, setLinkBasis] = useState<Link["commission_basis"]>("our_commission");
  const [linkPct, setLinkPct] = useState("20");
  const [linkFixed, setLinkFixed] = useState("");

  const merchantNameMap = useMemo(() => {
    const m = new Map<string, string>();
    merchants.forEach((x) => m.set(x.id, x.name));
    return m;
  }, [merchants]);

  const affiliateNameMap = useMemo(() => {
    const m = new Map<string, string>();
    affiliates.forEach((a) => m.set(a.id, `${a.name} (${a.code})`));
    return m;
  }, [affiliates]);

  const load = async () => {
    setLoading(true);
    try {
      const [a, l, p] = await Promise.all([
        dbSelect<Affiliate>("merchant_affiliates", { order: { col: "created_at", asc: false }, limit: 200 }),
        dbSelect<Link>("merchant_affiliate_links", { order: { col: "created_at", asc: false }, limit: 200 }),
        dbSelect<Payout>("merchant_affiliate_payouts", { order: { col: "requested_at", asc: false }, limit: 200 }),
      ]);
      setAffiliates(a);
      setLinks(l);
      setPayouts(p);
    } catch (err) {
      toast.error(translateError(err, "Veriler yüklenemedi"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const createAffiliateAuthUser = async () => {
    if (!canManage) return;
    if (!newName.trim() || !newEmail.trim()) {
      toast.error("Önce ad/şirket ve e-posta gir.");
      return;
    }
    if (newAuthPassword.length < 8) {
      toast.error("Şifre en az 8 karakter olmalı.");
      return;
    }
    setCreatingAuthUser(true);
    try {
      const email = newEmail.trim().toLowerCase();
      const [firstName, ...rest] = newName.trim().split(/\s+/);
      try {
        const data = await invokeFunction<{ user_id?: string; error?: string; message?: string }>("admin-user-create", {
          scope: "affiliate",
          email,
          password: newAuthPassword,
          first_name: firstName || newName.trim(),
          last_name: rest.join(" "),
          phone: newPhone.trim() || null,
        });
        if (data?.error) throw new Error(data.message || data.error);
        const userId = data?.user_id;
        if (!userId) throw new Error("Auth user oluşturuldu ama user_id alınamadı.");
        setNewAuthUserId(userId);
        toast.success("Affiliate auth user oluşturuldu ve UUID dolduruldu.");
      } catch (err) {
        // Already exists? Try to look up the existing profile via ilike search.
        const profile = await dbSelectMaybeOne<{ id: string }>("profiles", {
          cols: "id",
          or: [`email.ilike.${email}`],
        }).catch(() => null);
        if (profile?.id) {
          setNewAuthUserId(profile.id);
          toast.success("Affiliate auth user bulundu ve UUID dolduruldu.");
          return;
        }
        throw err;
      }
    } catch (err) {
      toast.error(translateError(err, "Auth user oluşturulamadı"));
    } finally {
      setCreatingAuthUser(false);
    }
  };

  const createAffiliate = async () => {
    if (!canManage) return;
    if (!newName.trim() || !newEmail.trim()) {
      toast.error("Ad ve e-posta zorunlu.");
      return;
    }
    if (newKind === "external" && !newAuthUserId.trim()) {
      toast.error("External için auth user_id zorunlu (önce auth user oluştur).");
      return;
    }
    if (newKind === "internal_member" && !newLinkedUserId.trim()) {
      toast.error("Internal member için linked_user_id zorunlu.");
      return;
    }
    // wizard adım 2 — en az 1 merchant seçili olmalı
    if (wizardMerchantIds.length === 0) {
      toast.error("En az 1 iş yeri seç.");
      return;
    }
    setCreating(true);
    try {
      const payload: Record<string, unknown> = {
        kind: newKind,
        name: newName.trim(),
        email: newEmail.trim(),
        phone: newPhone.trim() || null,
        // tax_id artık form'dan gönderilmiyor (UI'dan kaldırıldı)
        iban: newIban.trim() || null,
      };
      if (newKind === "external") payload.auth_user_id = newAuthUserId.trim();
      else payload.linked_user_id = newLinkedUserId.trim();

      const createRes = await rpc<{ id?: string } | null>("create_merchant_affiliate", { _payload: payload });
      const affId: string | null = createRes?.id ?? null;
      if (!affId) throw new Error("İş ortağı oluşturuldu ama ID alınamadı.");

      // seçilen tüm merchant'lara batch-link
      const errs: string[] = [];
      for (const mid of wizardMerchantIds) {
        try {
          await rpc("attach_merchant_to_affiliate", {
            _affiliate_id: affId,
            _merchant_id: mid,
            _commission_basis: wizardBasis,
            _commission_pct: wizardBasis === "fixed_per_tx" ? null : (wizardPct === "" ? null : Number(wizardPct)),
            _fixed_amount_per_tx: wizardBasis === "fixed_per_tx" ? (wizardFixed === "" ? null : Number(wizardFixed)) : null,
          });
        } catch (linkErr) {
          errs.push(`${mid.slice(0, 8)}: ${linkErr instanceof Error ? linkErr.message : String(linkErr)}`);
        }
      }

      if (errs.length > 0) {
        toast.error(`İş ortağı oluştu ama ${errs.length} bağlama başarısız: ${errs.join("; ")}`);
      } else {
        toast.success(`İş ortağı ve ${wizardMerchantIds.length} iş yeri bağlaması oluşturuldu.`);
      }
      setCreateOpen(false);
      setWizardStep(1);
      setWizardMerchantIds([]);
      setNewName(""); setNewEmail(""); setNewPhone(""); setNewIban("");
      setNewLinkedUserId(""); setNewAuthUserId("");
      setNewAuthPassword("Test12345!");
      await load();
    } catch (err) {
      toast.error(translateError(err, "Oluşturulamadı"));
    } finally {
      setCreating(false);
    }
  };

  const createLink = async () => {
    if (!canManage) return;
    if (!linkAffiliateId || !linkMerchantId) {
      toast.error("İş ortağı ve iş yeri seçimi zorunlu.");
      return;
    }
    if (linkBasis !== "fixed_per_tx" && (!linkPct || Number(linkPct) <= 0 || Number(linkPct) > 100)) {
      toast.error("Yüzde 0 ile 100 arasında olmalı.");
      return;
    }
    if (linkBasis === "fixed_per_tx" && (!linkFixed || Number(linkFixed) <= 0)) {
      toast.error("Sabit tutar pozitif olmalı.");
      return;
    }
    setLinking(true);
    try {
      await rpc("attach_merchant_to_affiliate", {
        _merchant_id: linkMerchantId,
        _affiliate_id: linkAffiliateId,
        _commission_basis: linkBasis,
        _commission_pct: linkBasis !== "fixed_per_tx" ? Number(linkPct) : null,
        _fixed_amount_per_tx: linkBasis === "fixed_per_tx" ? Number(linkFixed) : null,
      });
      toast.success("Bağlama tamamlandı.");
      setLinkOpen(false);
      setLinkAffiliateId(""); setLinkMerchantId(""); setLinkPct("20"); setLinkFixed("");
      await load();
    } catch (err) {
      toast.error(translateError(err, "Bağlanamadı"));
    } finally {
      setLinking(false);
    }
  };

  const detachLink = async (id: string) => {
    if (!canManage) return;
    const reason = window.prompt("Sonlandırma sebebi:", "manuel kapatma");
    if (!reason) return;
    try {
      await rpc("detach_merchant_affiliate_link", { _link_id: id, _reason: reason });
      toast.success("Bağ sonlandırıldı.");
      await load();
    } catch (err) {
      toast.error(translateError(err, "Sonlandırılamadı"));
    }
  };

  const approvePayout = async (id: string) => {
    if (!canManage) return;
    try {
      await rpc("admin_approve_affiliate_payout", { _payout_id: id });
      toast.success("Onaylandı. Ödeme yapılınca 'Ödendi' işaretle.");
      await load();
    } catch (err) {
      toast.error(translateError(err, "Onaylanamadı"));
    }
  };

  const rejectPayout = async (id: string) => {
    if (!canManage) return;
    const reason = window.prompt("Red sebebi:");
    if (!reason || reason.trim().length < 3) return;
    try {
      await rpc("admin_reject_affiliate_payout", { _payout_id: id, _reason: reason });
      toast.success("Red edildi.");
      await load();
    } catch (err) {
      toast.error(translateError(err, "Red edilemedi"));
    }
  };

  const markPaid = async (id: string) => {
    if (!canManage) return;
    const ref = window.prompt("Banka transfer referansı (boş bırakırsan internal wallet ödemesi olarak kayıt edilir):") ?? "";
    try {
      await rpc("admin_mark_affiliate_payout_paid", {
        _payout_id: id,
        _transfer_ref: ref.trim() || null,
      });
      toast.success("Ödeme tamamlandı.");
      await load();
    } catch (err) {
      toast.error(translateError(err, "İşaretlenemedi"));
    }
  };

  return (
    <AdminLayout title="Affiliate Yönetimi" requireAny={["affiliates:view"]}>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">İş Ortakları</h1>
            <p className="text-sm text-muted-foreground">
              Dış iş ortakları ve sistem üyesi iş ortaklarının yönetimi, iş yeri bağlama ve ödeme talepleri.
            </p>
          </div>
        </div>

        <Tabs defaultValue="affiliates">
          <TabsList>
            <TabsTrigger value="affiliates">İş Ortakları ({affiliates.length})</TabsTrigger>
            <TabsTrigger value="links">Bağlamalar ({links.filter((l) => l.status === "active").length})</TabsTrigger>
            <TabsTrigger value="payouts">
              Ödemeler ({payouts.filter((p) => p.status === "requested").length} bekleyen)
            </TabsTrigger>
          </TabsList>

          {/* AFFILIATES */}
          <TabsContent value="affiliates" className="space-y-3 mt-4">
            {canManage && (
              <Button variant="outline" onClick={() => setCreateOpen((v) => !v)}>
                <UserPlus className="size-4 mr-1" /> Yeni İş Ortağı
              </Button>
            )}
            {createOpen && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    Yeni İş Ortağı
                    <span className="text-xs font-normal text-muted-foreground">— Adım {wizardStep}/4</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* Adım 1: Merchant tipi */}
                  {wizardStep === 1 && (
                    <div className="space-y-3">
                      <div className="text-sm font-medium">1. İş ortağı hangi tip iş yeri için çalışacak?</div>
                      <div className="grid grid-cols-2 gap-3">
                        <button
                          type="button"
                          onClick={() => { setWizardMerchantType("commerce"); setWizardMerchantIds([]); }}
                          className={`p-4 rounded-lg border-2 text-left transition ${wizardMerchantType === "commerce" ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40"}`}
                        >
                          <div className="font-semibold">Ticari İş Yeri</div>
                          <div className="text-xs text-muted-foreground mt-1">Üyenin ödeme yaptığı iş yeri</div>
                        </button>
                        <button
                          type="button"
                          onClick={() => { setWizardMerchantType("finance"); setWizardMerchantIds([]); }}
                          className={`p-4 rounded-lg border-2 text-left transition ${wizardMerchantType === "finance" ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40"}`}
                        >
                          <div className="font-semibold">Finans İş Yeri</div>
                          <div className="text-xs text-muted-foreground mt-1">Para yatırma/çekme iş yeri</div>
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Adım 2: Merchant multi-select */}
                  {wizardStep === 2 && (
                    <div className="space-y-3">
                      <div className="text-sm font-medium">
                        2. {wizardMerchantType === "commerce" ? "Ticari" : "Finans"} iş yerlerini seç (1+)
                      </div>
                      {(() => {
                        const filtered = merchants.filter((m) => m.merchant_type === wizardMerchantType && m.is_active);
                        if (filtered.length === 0) {
                          return <div className="text-xs text-muted-foreground p-4 bg-muted/30 rounded-lg">Bu tipte aktif iş yeri yok.</div>;
                        }
                        return (
                          <div className="space-y-1 max-h-64 overflow-y-auto border rounded-lg p-2">
                            {filtered.map((m) => {
                              const checked = wizardMerchantIds.includes(m.id);
                              return (
                                <label key={m.id} className="flex items-center gap-2 p-2 rounded hover:bg-muted/40 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => {
                                      setWizardMerchantIds((prev) =>
                                        checked ? prev.filter((x) => x !== m.id) : [...prev, m.id]
                                      );
                                    }}
                                  />
                                  <span className="text-sm">{m.name}</span>
                                </label>
                              );
                            })}
                          </div>
                        );
                      })()}
                      <div className="text-xs text-muted-foreground">
                        {wizardMerchantIds.length} iş yeri seçili.
                      </div>
                    </div>
                  )}

                  {/* Adım 3: Affiliate bilgileri */}
                  {wizardStep === 3 && (
                    <div className="space-y-3">
                      <div className="text-sm font-medium">3. İş ortağı bilgileri</div>
                      <div className="flex gap-3">
                        <label className="flex items-center gap-2 text-sm">
                          <input type="radio" checked={newKind === "external"} onChange={() => setNewKind("external")} />
                          Dış kişi/kurum
                        </label>
                        <label className="flex items-center gap-2 text-sm">
                          <input type="radio" checked={newKind === "internal_member"} onChange={() => setNewKind("internal_member")} />
                          Sistem üyesi
                        </label>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1"><Label>Ad/Şirket *</Label><Input value={newName} onChange={(e) => setNewName(e.target.value)} /></div>
                        <div className="space-y-1"><Label>E-posta *</Label><Input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} /></div>
                        <div className="space-y-1"><Label>Telefon</Label><Input value={newPhone} onChange={(e) => setNewPhone(e.target.value)} /></div>
                        <div className="space-y-1"><Label>IBAN (external için ödeme)</Label><Input value={newIban} onChange={(e) => setNewIban(e.target.value)} /></div>
                        {newKind === "external" ? (
                          <div className="space-y-1 col-span-2">
                            <Label>auth.users.id (external)</Label>
                            <Input value={newAuthUserId} onChange={(e) => setNewAuthUserId(e.target.value)} placeholder="UUID" />
                            <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2">
                              <Input
                                type="text"
                                value={newAuthPassword}
                                onChange={(e) => setNewAuthPassword(e.target.value)}
                                placeholder="Affiliate giriş şifresi"
                              />
                              <Button
                                type="button"
                                variant="outline"
                                onClick={createAffiliateAuthUser}
                                disabled={creatingAuthUser || !newEmail.trim() || !newName.trim()}
                              >
                                {creatingAuthUser ? <Loader2 className="size-4 mr-1 animate-spin" /> : <UserPlus className="size-4 mr-1" />}
                                Auth user oluştur
                              </Button>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              External affiliate portala bu e-posta ve şifreyle girer; buton UUID'yi otomatik doldurur.
                            </p>
                          </div>
                        ) : (
                          <div className="space-y-1 col-span-2">
                            <Label>linked_user_id (üye)</Label>
                            <Input value={newLinkedUserId} onChange={(e) => setNewLinkedUserId(e.target.value)} placeholder="UUID" />
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Adım 4: Komisyon yapısı */}
                  {wizardStep === 4 && (
                    <div className="space-y-3">
                      <div className="text-sm font-medium">4. Komisyon yapısı (iş ortağına ne ödenecek)</div>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                        <button
                          type="button"
                          onClick={() => setWizardBasis("our_commission")}
                          className={`p-3 rounded-lg border-2 text-left transition ${wizardBasis === "our_commission" ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40"}`}
                        >
                          <div className="font-semibold text-sm">Bizim komisyon yüzdesi</div>
                          <div className="text-[11px] text-muted-foreground mt-1">Sistemin iş yerinden aldığı komisyonun %X'i</div>
                        </button>
                        <button
                          type="button"
                          onClick={() => setWizardBasis("merchant_volume")}
                          className={`p-3 rounded-lg border-2 text-left transition ${wizardBasis === "merchant_volume" ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40"}`}
                        >
                          <div className="font-semibold text-sm">İş yeri cirosundan</div>
                          <div className="text-[11px] text-muted-foreground mt-1">İş yerinin tüm hacminin %X'i</div>
                        </button>
                        <button
                          type="button"
                          onClick={() => setWizardBasis("fixed_per_tx")}
                          className={`p-3 rounded-lg border-2 text-left transition ${wizardBasis === "fixed_per_tx" ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40"}`}
                        >
                          <div className="font-semibold text-sm">Sabit / işlem</div>
                          <div className="text-[11px] text-muted-foreground mt-1">Her işlem için sabit ₺ tutar</div>
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        {wizardBasis !== "fixed_per_tx" ? (
                          <div className="space-y-1">
                            <Label>Komisyon yüzdesi (%)</Label>
                            <Input inputMode="decimal" value={wizardPct} onChange={(e) => setWizardPct(e.target.value)} placeholder="örn: 20" />
                          </div>
                        ) : (
                          <div className="space-y-1">
                            <Label>Sabit ₺ / işlem</Label>
                            <Input inputMode="decimal" value={wizardFixed} onChange={(e) => setWizardFixed(e.target.value)} placeholder="örn: 5" />
                          </div>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground p-2 bg-muted/30 rounded">
                        <strong>Özet:</strong> {wizardMerchantIds.length} {wizardMerchantType === "commerce" ? "ticari" : "finans"} iş yerine bağlanacak. Her tamamlanan işlem için komisyon iş ortağı defterine düşecek. Manuel ödeme sonrası kapanır.
                      </div>
                    </div>
                  )}

                  {/* Wizard navigasyon */}
                  <div className="flex gap-2 pt-2 border-t">
                    {wizardStep > 1 && (
                      <Button variant="ghost" onClick={() => setWizardStep((s) => (s - 1) as any)}>
                        ← Geri
                      </Button>
                    )}
                    {wizardStep < 4 ? (
                      <Button
                        onClick={() => setWizardStep((s) => (s + 1) as any)}
                        disabled={
                          (wizardStep === 2 && wizardMerchantIds.length === 0) ||
                          (wizardStep === 3 && (!newName.trim() || !newEmail.trim()))
                        }
                      >
                        İleri →
                      </Button>
                    ) : (
                      <Button onClick={createAffiliate} disabled={creating}>
                        {creating ? <Loader2 className="size-4 animate-spin mr-1" /> : <Plus className="size-4 mr-1" />}
                        Oluştur ve Bağla
                      </Button>
                    )}
                    <Button variant="ghost" onClick={() => { setCreateOpen(false); setWizardStep(1); setWizardMerchantIds([]); }}>Vazgeç</Button>
                  </div>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardContent className="p-0 overflow-x-auto">
                {loading ? (
                  <div className="p-8 flex items-center justify-center"><Loader2 className="animate-spin" /></div>
                ) : affiliates.length === 0 ? (
                  <div className="p-8 text-center text-sm text-muted-foreground">Henüz iş ortağı yok.</div>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40 border-b text-xs">
                      <tr>
                        <th className="text-left p-3">Kod</th>
                        <th className="text-left p-3">Tip</th>
                        <th className="text-left p-3">Ad</th>
                        <th className="text-left p-3">E-posta</th>
                        <th className="text-left p-3">Telefon</th>
                        <th className="text-left p-3">IBAN</th>
                        <th className="text-left p-3">Durum</th>
                        <th className="text-left p-3">Tarih</th>
                      </tr>
                    </thead>
                    <tbody>
                      {affiliates.map((a) => (
                        <tr key={a.id} className="border-b hover:bg-muted/20 transition">
                          <td className="p-3 font-mono text-xs">{a.code}</td>
                          <td className="p-3 text-xs">{KIND_LABEL[a.kind]}</td>
                          <td className="p-3">{a.name}</td>
                          <td className="p-3 text-xs">
                            {sensitiveText(can, "affiliates", "contact", a.email, maskEmail)}
                          </td>
                          <td className="p-3 text-xs">
                            {sensitiveText(can, "affiliates", "contact", a.phone ?? "", maskPhone)}
                          </td>
                          <td className="p-3 text-xs font-mono">
                            {sensitiveText(can, "affiliates", "contact", a.iban ?? "", maskIban)}
                          </td>
                          <td className="p-3"><Badge variant={a.status === "active" ? "default" : "outline"} className="text-[10px]">{AFFILIATE_STATUS_LABEL[a.status] ?? a.status}</Badge></td>
                          <td className="p-3 text-xs">{fmtDateTime(a.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* LINKS */}
          <TabsContent value="links" className="space-y-3 mt-4">
            {canManage && (
              <Button variant="outline" onClick={() => setLinkOpen((v) => !v)}>
                <LinkIcon className="size-4 mr-1" /> Yeni Bağlama
              </Button>
            )}
            {linkOpen && (
              <Card>
                <CardHeader><CardTitle className="text-base">İş Yeri ↔ İş Ortağı Bağla</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label>İş ortağı</Label>
                      <select className="w-full h-10 rounded-md border bg-background px-3 text-sm" value={linkAffiliateId} onChange={(e) => setLinkAffiliateId(e.target.value)}>
                        <option value="">Seç...</option>
                        {affiliates.filter((a) => a.status === "active").map((a) => (
                          <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <Label>İş yeri</Label>
                      <select className="w-full h-10 rounded-md border bg-background px-3 text-sm" value={linkMerchantId} onChange={(e) => setLinkMerchantId(e.target.value)}>
                        <option value="">Seç...</option>
                        {merchants.map((m) => (
                          <option key={m.id} value={m.id}>{m.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <Label>Komisyon tabanı</Label>
                      <select className="w-full h-10 rounded-md border bg-background px-3 text-sm" value={linkBasis} onChange={(e) => setLinkBasis(e.target.value as Link["commission_basis"])}>
                        <option value="our_commission">Bizim komisyondan %</option>
                        <option value="merchant_volume">Hacimden %</option>
                        <option value="fixed_per_tx">Sabit ₺/işlem</option>
                      </select>
                    </div>
                    {linkBasis !== "fixed_per_tx" ? (
                      <div className="space-y-1">
                        <Label>Yüzde (%)</Label>
                        <Input type="number" step="0.01" min="0.01" max="100" value={linkPct} onChange={(e) => setLinkPct(e.target.value)} />
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <Label>Sabit tutar (₺)</Label>
                        <Input type="number" step="0.01" min="0.01" value={linkFixed} onChange={(e) => setLinkFixed(e.target.value)} />
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button onClick={createLink} disabled={linking}>
                      {linking ? <Loader2 className="size-4 animate-spin mr-1" /> : <LinkIcon className="size-4 mr-1" />}
                      Bağla
                    </Button>
                    <Button variant="ghost" onClick={() => setLinkOpen(false)}>Vazgeç</Button>
                  </div>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardContent className="p-0 overflow-x-auto">
                {loading ? (
                  <div className="p-8 flex items-center justify-center"><Loader2 className="animate-spin" /></div>
                ) : links.length === 0 ? (
                  <div className="p-8 text-center text-sm text-muted-foreground">Henüz bağlama yok.</div>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40 border-b text-xs">
                      <tr>
                        <th className="text-left p-3">İş ortağı</th>
                        <th className="text-left p-3">İş yeri</th>
                        <th className="text-left p-3">Hesap</th>
                        <th className="text-right p-3">Değer</th>
                        <th className="text-left p-3">Durum</th>
                        <th className="text-left p-3">Geçerlilik</th>
                        <th className="text-right p-3">Aksiyon</th>
                      </tr>
                    </thead>
                    <tbody>
                      {links.map((l) => (
                        <tr key={l.id} className="border-b hover:bg-muted/20 transition">
                          <td className="p-3 text-xs">{affiliateNameMap.get(l.affiliate_id) ?? l.affiliate_id.slice(0, 8)}</td>
                          <td className="p-3 text-xs">{merchantNameMap.get(l.merchant_id) ?? l.merchant_id.slice(0, 8)}</td>
                          <td className="p-3 text-xs">{BASIS_LABEL[l.commission_basis]}</td>
                          <td className="p-3 text-right tabular-nums">
                            {l.commission_pct != null ? `%${l.commission_pct}` : fmtTRY(l.fixed_amount_per_tx ?? 0)}
                          </td>
                          <td className="p-3">
                            <Badge variant={l.status === "active" ? "default" : "outline"} className="text-[10px]">{LINK_STATUS_LABEL[l.status] ?? l.status}</Badge>
                          </td>
                          <td className="p-3 text-xs">{fmtDateTime(l.valid_from)} → {fmtDateTime(l.valid_to)}</td>
                          <td className="p-3 text-right">
                            {canManage && l.status === "active" ? (
                              <Button size="sm" variant="ghost" className="text-destructive" onClick={() => detachLink(l.id)}>
                                Sonlandır
                              </Button>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* PAYOUTS */}
          <TabsContent value="payouts" className="mt-4">
            <Card>
              <CardContent className="p-0 overflow-x-auto">
                {loading ? (
                  <div className="p-8 flex items-center justify-center"><Loader2 className="animate-spin" /></div>
                ) : payouts.length === 0 ? (
                  <div className="p-8 text-center text-sm text-muted-foreground">Talep yok.</div>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40 border-b text-xs">
                      <tr>
                        <th className="text-left p-3">Talep</th>
                        <th className="text-left p-3">İş ortağı</th>
                        <th className="text-right p-3">Adet</th>
                        <th className="text-right p-3">Tutar</th>
                        <th className="text-left p-3">Durum</th>
                        <th className="text-right p-3">Aksiyon</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payouts.map((p) => (
                        <tr key={p.id} className="border-b hover:bg-muted/20 transition">
                          <td className="p-3 text-xs">{fmtDateTime(p.requested_at)}</td>
                          <td className="p-3 text-xs">{affiliateNameMap.get(p.affiliate_id) ?? p.affiliate_id.slice(0, 8)}</td>
                          <td className="p-3 text-right tabular-nums">{p.ledger_count}</td>
                          <td className="p-3 text-right tabular-nums font-medium">{fmtTRY(p.total_amount)}</td>
                          <td className="p-3">
                            <Badge variant={p.status === "paid" ? "default" : p.status === "rejected" ? "destructive" : "outline"} className="text-[10px]">
                              {PAYOUT_STATUS_LABEL[p.status] ?? p.status}
                            </Badge>
                          </td>
                          <td className="p-3 text-right space-x-1">
                            {canManage && p.status === "requested" && (
                              <>
                                <Button size="sm" variant="outline" onClick={() => approvePayout(p.id)}>
                                  <Check className="size-3 mr-1" /> Onayla
                                </Button>
                                <Button size="sm" variant="ghost" className="text-destructive" onClick={() => rejectPayout(p.id)}>
                                  <X className="size-3" />
                                </Button>
                              </>
                            )}
                            {canManage && p.status === "approved" && (
                              <Button size="sm" variant="default" onClick={() => markPaid(p.id)}>
                                <CheckCircle2 className="size-3 mr-1" /> Ödendi
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AdminLayout>
  );
}
