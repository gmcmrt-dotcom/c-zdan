// Merchant BO Kullanıcılar — iki-pane redesign + davet/role/aktiflik (owner only).
// Sol: kullanıcı listesi (avatar, isim, rol, aktiflik). Sağ: detay panel + 2 toggle (rol, aktiflik).
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import MerchantLayout from "@/components/MerchantLayout";
import { rpc } from "@/lib/rpc";
import { dbSelect } from "@/lib/db";
import { invokeFunction } from "@/lib/fn";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { translateError } from "@/lib/i18n-errors";
import { toast } from "sonner";
import { fmtDate } from "@/lib/format";
import { CopyButton } from "@/components/CopyButton";
import {
  Loader2, UserPlus, Search, ShieldAlert, Mail as MailIcon, Phone,
  Calendar, Clock, Hash, ShieldCheck, Coins,
} from "lucide-react";

type Role = "owner" | "accountant" | "read_only";
type MerchantUser = {
  id: string;
  user_id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  role: Role;
  can_cashout_create?: boolean;
  is_active: boolean;
  last_login_at: string | null;
  created_at: string;
};

const ROLE_LABEL: Record<Role, string> = {
  owner: "Sahip",
  accountant: "Muhasebe",
  read_only: "Görüntüleyici",
};
const ROLE_DESC: Record<Role, string> = {
  owner: "Tüm yetkilere sahip; ayarlar + secret rotate + kullanıcı yönetimi yapar.",
  accountant: "Finansal rapor + işlem listesi + settlement görüntüler.",
  read_only: "Sadece okuma; aksiyon almaz.",
};
const ROLES: Role[] = ["owner", "accountant", "read_only"];

function avatarColor(seed: string): string {
  const colors = ["bg-amber-500", "bg-blue-500", "bg-green-500", "bg-purple-500", "bg-pink-500", "bg-indigo-500", "bg-orange-500", "bg-teal-500"];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return colors[Math.abs(h) % colors.length];
}
function initialsOf(full: string | null, email: string): string {
  if (full) {
    const parts = full.trim().split(/\s+/);
    return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || email[0].toUpperCase();
  }
  return (email[0] ?? "?").toUpperCase();
}

export default function MerchantUsers() {
  const { user } = useAuth();
  const myUserId = user?.id ?? "";
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get("selected");

  const [rows, setRows] = useState<MerchantUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [myRole, setMyRole] = useState<Role | null>(null);

  // Yeni kullanıcı dialog — doğrudan user kaydı + merchant_users INSERT.
  const [open, setOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [invitePassword, setInvitePassword] = useState("");
  const [inviteFullName, setInviteFullName] = useState("");
  const [invitePhone, setInvitePhone] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("accountant");
  const [saving, setSaving] = useState(false);

  // Toggle busy
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    // NOTE: dbSelect doesn't support multi-column order; primary sort by role,
    // secondary by created_at desc done client-side after the response.
    let arr: MerchantUser[] = [];
    try {
      const data = await dbSelect<MerchantUser>("merchant_users", {
        cols: "id, user_id, email, full_name, phone, role, is_active, last_login_at, created_at",
        order: { col: "role", asc: true },
      });
      arr = data;
      arr.sort((a, b) => {
        if (a.role !== b.role) return a.role < b.role ? -1 : 1;
        return (b.created_at ?? "").localeCompare(a.created_at ?? "");
      });
    } catch (err) {
      toast.error(translateError(err, "Yüklenemedi"));
    }
    const roleData = await rpc<Array<{ merchant_id: string }>>("merchant_self_role").catch(() => [] as Array<{ merchant_id: string }>);
    const merchantId = ((roleData as Array<{ merchant_id: string }>)?.[0]?.merchant_id) ?? null;
    const overrides = merchantId
      ? await dbSelect<{ user_id: string; is_allowed: boolean }>("merchant_user_permission_overrides", {
          cols: "user_id, is_allowed",
          where: { merchant_id: merchantId, permission_key: "merchant_cashout:create" },
        }).catch(() => [] as Array<{ user_id: string; is_allowed: boolean }>)
      : ([] as Array<{ user_id: string; is_allowed: boolean }>);
    const cashoutMap = new Map((overrides ?? []).map((p) => [p.user_id, !!p.is_allowed]));
    arr.forEach((r) => { r.can_cashout_create = r.role === "owner" || cashoutMap.get(r.user_id) === true; });
    setRows(arr);
    const me = arr.find((r) => r.user_id === myUserId);
    setMyRole(me?.role ?? null);
    if (!selectedId && arr.length > 0) setSearchParams({ selected: arr[0].user_id }, { replace: true });
    setLoading(false);
  };
  useEffect(() => { load(); }, [myUserId]);

  const isOwner = myRole === "owner";

  const stats = useMemo(() => {
    const total = rows.length;
    const owners = rows.filter((r) => r.role === "owner").length;
    const accs = rows.filter((r) => r.role === "accountant").length;
    const ros = rows.filter((r) => r.role === "read_only").length;
    const passive = rows.filter((r) => !r.is_active).length;
    return { total, owners, accs, ros, passive };
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      (r.email ?? "").toLowerCase().includes(q) ||
      (r.full_name ?? "").toLowerCase().includes(q)
    );
  }, [rows, search]);

  const selected = useMemo(() => filtered.find((r) => r.user_id === selectedId) ?? rows.find((r) => r.user_id === selectedId) ?? null, [rows, filtered, selectedId]);

  // Actions
  const inviteUser = async () => {
    if (!inviteEmail.trim()) { toast.error("E-posta gerekli"); return; }
    if (invitePassword.length < 8) { toast.error("Şifre en az 8 karakter olmalı"); return; }
    setSaving(true);
    try {
      // önce edge fn ile auth user yarat (yoksa) — sonra merchant_invite_user
      const fullName = inviteFullName.trim() || inviteEmail.trim();
      const [first, ...rest] = fullName.split(/\s+/);
      const last = rest.join(" ");
      const resp = await invokeFunction<{ success?: boolean; user_id?: string; error?: string; message?: string }>(
        "admin-user-create",
        {
          scope: "merchant_user",
          email: inviteEmail.trim(),
          password: invitePassword,
          first_name: first || inviteEmail.trim(),
          last_name: last || "",
          phone: invitePhone.trim() || null,
        },
      );
      if (!resp?.success || !resp.user_id) {
        throw new Error(resp?.message || resp?.error || "Yaratılamadı");
      }
      // Sonra merchant_invite_user RPC ile merchant_users'a ekle
      await rpc("merchant_invite_user", {
        _email: inviteEmail.trim(),
        _role: inviteRole,
        _full_name: inviteFullName.trim() || null,
      });
      toast.success(`${inviteEmail} eklendi.`);
      setOpen(false);
      setInviteEmail("");
      setInvitePassword("");
      setInviteFullName("");
      setInvitePhone("");
      setInviteRole("accountant");
      await load();
    } catch (err) {
      toast.error(translateError(err, "Eklenemedi"));
    } finally {
      setSaving(false);
    }
  };

  const setRole = async (uid: string, role: Role) => {
    setBusy(`${uid}-role`);
    try {
      await rpc("merchant_set_user_role", {
        _target_user_id: uid,
        _new_role: role,
      });
      toast.success("Rol güncellendi");
      await load();
    } catch (err) {
      toast.error(translateError(err, "Güncellenemedi"));
    } finally {
      setBusy(null);
    }
  };

  const setActive = async (uid: string, current: boolean) => {
    setBusy(`${uid}-active`);
    try {
      await rpc("merchant_set_user_active", {
        _target_user_id: uid,
        _active: !current,
      });
      toast.success(current ? "Pasifleştirildi" : "Aktifleştirildi");
      await load();
    } catch (err) {
      toast.error(translateError(err, "Güncellenemedi"));
    } finally {
      setBusy(null);
    }
  };

  const setCashoutPermission = async (uid: string, allowed: boolean) => {
    setBusy(`${uid}-cashout`);
    try {
      const data = await rpc<{ success?: boolean; error_code?: string }>("merchant_set_user_permission", {
        _target_user_id: uid,
        _permission_key: "merchant_cashout:create",
        _is_allowed: allowed,
      });
      if (!data?.success) throw new Error(data?.error_code ?? "UNKNOWN");
      toast.success("Hassas yetki güncellendi");
      await load();
    } catch (err) {
      toast.error(translateError(err, "Yetki güncellenemedi"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <MerchantLayout title="Kullanıcılar">
      {!loading && !isOwner ? (
        <Card className="p-8 text-center">
          <ShieldAlert className="size-10 mx-auto text-warning mb-2" />
          <p className="text-sm text-muted-foreground">Bu sayfayı yalnızca iş yeri sahibi (owner) görüntüleyebilir.</p>
        </Card>
      ) : (
        <>
          <div className="bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200/50 dark:border-amber-900/50 rounded-lg p-3 mb-4 text-xs flex items-center gap-2">
            <span className="text-amber-600">ⓘ</span>
            İş yerine kayıtlı kullanıcılar ve rolleri. Yeni kullanıcı eklemek için kişinin önce Wallet'a üye olması gerekir.
          </div>

          <div className="flex items-center justify-between mb-4 gap-3">
            <div>
              <h2 className="text-2xl font-serif font-bold">Kullanıcılar</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {stats.total} kullanıcı
                {stats.owners > 0 ? ` · ${stats.owners} sahip` : ""}
                {stats.accs > 0 ? ` · ${stats.accs} muhasebe` : ""}
                {stats.ros > 0 ? ` · ${stats.ros} görüntüleyici` : ""}
                {stats.passive > 0 ? ` · ${stats.passive} pasif` : ""}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="İsim veya e-posta..."
                  className="pl-8 h-9 w-64"
                />
              </div>
              <Button onClick={() => setOpen(true)} className="bg-amber-500 hover:bg-amber-600 text-white">
                <UserPlus className="size-4 mr-1" /> Yeni Kullanıcı
              </Button>
            </div>
          </div>

          {loading ? (
            <Card className="p-12 flex justify-center"><Loader2 className="animate-spin" /></Card>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-[320px,1fr] gap-4">
              {/* SOL — kullanıcı listesi */}
              <div className="space-y-2 max-h-[calc(100vh-220px)] overflow-y-auto pr-1">
                {filtered.length === 0 ? (
                  <Card className="p-8 text-center text-sm text-muted-foreground">Eşleşen kullanıcı yok.</Card>
                ) : filtered.map((r) => {
                  const isSel = r.user_id === selectedId;
                  const isMe = r.user_id === myUserId;
                  return (
                    <button
                      key={r.user_id}
                      onClick={() => setSearchParams({ selected: r.user_id }, { replace: true })}
                      className={`w-full text-left rounded-xl border p-3 transition ${
                        isSel
                          ? "bg-amber-50 dark:bg-amber-950/20 border-amber-300 dark:border-amber-800 shadow-sm"
                          : "bg-card hover:bg-muted/30 border-border"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div className={`size-9 rounded-full ${avatarColor(r.user_id)} text-white text-xs font-bold flex items-center justify-center shrink-0`}>
                          {initialsOf(r.full_name, r.email)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-sm font-medium truncate">{r.full_name || r.email}</span>
                            {isMe && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300 font-medium">
                                Sen
                              </span>
                            )}
                            {!r.is_active && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300 font-medium">
                                Pasif
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-muted-foreground truncate">{r.email}</div>
                          <div className="text-[11px] text-muted-foreground mt-0.5">
                            {ROLE_LABEL[r.role]} · {fmtDate(r.created_at)}
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* SAĞ — detay paneli */}
              <div>
                {!selected ? (
                  <Card className="p-12 text-center text-sm text-muted-foreground">Sol taraftan bir kullanıcı seç.</Card>
                ) : (
                  <UserDetailPanel
                    user={selected}
                    isMe={selected.user_id === myUserId}
                    onSetRole={setRole}
                    onSetActive={setActive}
                    onSetCashoutPermission={setCashoutPermission}
                    busy={busy}
                  />
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* Yeni kullanıcı dialog — doğrudan user kaydı + merchant_users INSERT */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Yeni Kullanıcı</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="text-xs text-muted-foreground bg-muted/40 rounded-md p-2">
              Yeni iş yeri kullanıcısı için aşağıdaki bilgileri gir. Sistem hesabı + profili + role atamasını otomatik yapar.
            </div>
            <div>
              <Label>Ad-Soyad *</Label>
              <Input value={inviteFullName} onChange={(e) => setInviteFullName(e.target.value)} placeholder="Ali Veli" />
            </div>
            <div>
              <Label>E-posta *</Label>
              <Input type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="ali.veli@firma.com" />
            </div>
            <div>
              <Label>Şifre * <span className="text-[10px] text-muted-foreground">(en az 8 karakter)</span></Label>
              <Input type="text" value={invitePassword} onChange={(e) => setInvitePassword(e.target.value)} placeholder="Geçici şifre" />
            </div>
            <div>
              <Label>Telefon (opsiyonel)</Label>
              <Input value={invitePhone} onChange={(e) => setInvitePhone(e.target.value)} placeholder="+90 5XX XXX XX XX" />
            </div>
            <div>
              <Label>Rol</Label>
              <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as Role)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      <div className="flex flex-col">
                        <span>{ROLE_LABEL[r]}</span>
                        <span className="text-[10px] text-muted-foreground">{ROLE_DESC[r]}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>İptal</Button>
            <Button onClick={inviteUser} disabled={saving || !inviteEmail.trim() || invitePassword.length < 8 || !inviteFullName.trim()}>
              {saving && <Loader2 className="animate-spin size-4 mr-2" />}Oluştur
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MerchantLayout>
  );
}

function UserDetailPanel({
  user, isMe, onSetRole, onSetActive, onSetCashoutPermission, busy,
}: {
  user: MerchantUser;
  isMe: boolean;
  onSetRole: (uid: string, role: Role) => void;
  onSetActive: (uid: string, current: boolean) => void;
  onSetCashoutPermission: (uid: string, allowed: boolean) => void;
  busy: string | null;
}) {
  return (
    <Card className="p-6 space-y-4">
      <div className="flex items-start gap-4">
        <div className={`size-14 rounded-full ${avatarColor(user.user_id)} text-white text-lg font-bold flex items-center justify-center shrink-0`}>
          {initialsOf(user.full_name, user.email)}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-xl font-bold leading-tight">{user.full_name || user.email}</h3>
          <div className="text-sm text-muted-foreground">{user.email}</div>
          <div className="flex items-center gap-1.5 flex-wrap mt-2">
            <Badge variant={user.role === "owner" ? "default" : "secondary"} className="text-[10px]">
              <ShieldCheck className="size-3 mr-1" /> {ROLE_LABEL[user.role]}
            </Badge>
            {!user.is_active && (
              <Badge variant="destructive" className="text-[10px]">Pasif</Badge>
            )}
            {isMe && (
              <span className="text-xs px-2 py-1 rounded-full bg-muted text-muted-foreground">Bu sensin</span>
            )}
          </div>
        </div>

        {/* 2 toggle */}
        <div className="space-y-2.5 shrink-0">
          {/* Aktiflik */}
          <div className="flex items-center gap-3 bg-muted/30 rounded-lg px-3 py-2 min-w-[180px]">
            <div className="flex-1">
              <div className="text-[11px] text-muted-foreground">Hesap durumu</div>
              <div className={`text-xs font-medium ${user.is_active ? "text-success" : "text-destructive"}`}>
                {user.is_active ? "Aktif" : "Pasif"}
              </div>
            </div>
            {busy === `${user.user_id}-active` ? (
              <Loader2 className="animate-spin size-4 text-muted-foreground" />
            ) : (
              <Switch
                checked={user.is_active}
                onCheckedChange={() => onSetActive(user.user_id, user.is_active)}
                disabled={isMe}
              />
            )}
          </div>
        </div>
      </div>

      {/* Role değiştirici */}
      <div className="border-t pt-4">
        <div className="text-sm font-semibold mb-2">Rol</div>
        <div className="space-y-2">
          {ROLES.map((r) => {
            const has = user.role === r;
            return (
              <button
                key={r}
                onClick={() => !has && !isMe && onSetRole(user.user_id, r)}
                disabled={isMe || busy === `${user.user_id}-role`}
                className={`w-full text-left rounded-lg border p-3 flex items-start gap-3 transition ${
                  has ? "border-amber-300 bg-amber-50/40 dark:bg-amber-950/20" : "hover:bg-muted/30"
                } ${(isMe || busy === `${user.user_id}-role`) ? "opacity-60 cursor-not-allowed" : ""}`}
              >
                <div className={`size-5 rounded-full mt-0.5 flex items-center justify-center shrink-0 ${has ? "bg-amber-500 text-white" : "bg-muted"}`}>
                  {has && <span className="text-[10px]">✓</span>}
                </div>
                <div className="flex-1">
                  <div className="text-sm font-medium">{ROLE_LABEL[r]}</div>
                  <div className="text-[11px] text-muted-foreground">{ROLE_DESC[r]}</div>
                </div>
              </button>
            );
          })}
        </div>
        {isMe && (
          <p className="text-[11px] text-amber-700 dark:text-amber-300 mt-2">
            Kendi rolünüzü bu ekrandan değiştiremezsiniz. Başka bir owner sizi düzenleyebilir.
          </p>
        )}
      </div>

      <div className="border-t pt-4">
        <div className="text-sm font-semibold mb-2">Hassas Yetkiler</div>
        <div className="rounded-lg border p-3 flex items-center gap-3">
          <div className="size-9 rounded-full bg-amber-100 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 flex items-center justify-center shrink-0">
            <Coins className="size-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium">Kasa tahsilatı başlatabilir</div>
            <div className="text-[11px] text-muted-foreground">
              Ticari merchant settlement bakiyesinden kripto tahsilat talebi oluşturma izni.
              Owner rolünde bu yetki zaten vardır.
            </div>
          </div>
          {busy === `${user.user_id}-cashout` ? (
            <Loader2 className="animate-spin size-4 text-muted-foreground" />
          ) : (
            <Switch
              checked={!!user.can_cashout_create}
              disabled={user.role === "owner" || !user.is_active}
              onCheckedChange={(v) => onSetCashoutPermission(user.user_id, v)}
            />
          )}
        </div>
      </div>

      {/* Profil alanları */}
      <div className="border-t pt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
        <FieldCard icon={MailIcon} label="E-posta" value={user.email} />
        <FieldCard icon={Phone} label="Telefon" value={user.phone || "—"} />
        <FieldCard icon={Calendar} label="Eklenme tarihi" value={fmtDate(user.created_at)} />
        <FieldCard icon={Clock} label="Son giriş" value={user.last_login_at ? fmtDate(user.last_login_at) : "—"} />
      </div>

      <div className="border-t pt-3">
        <Label className="text-xs text-muted-foreground">Kullanıcı ID</Label>
        <div className="mt-1 flex items-center gap-2 bg-muted rounded-md px-3 py-2">
          <span className="text-xs font-mono">{user.user_id}</span>
          <CopyButton value={user.user_id} label="Kullanıcı ID kopyala" />
        </div>
      </div>
    </Card>
  );
}

function FieldCard({ icon: Icon, label, value }: { icon: any; label: string; value: any }) {
  return (
    <div className="border rounded-xl px-3 py-2.5 flex items-start gap-2.5">
      <Icon className="size-4 text-muted-foreground mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-[11px] text-muted-foreground">{label}</div>
        <div className="text-sm break-all">{value}</div>
      </div>
    </div>
  );
}
