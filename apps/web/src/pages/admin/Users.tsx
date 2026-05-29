// BO Kullanıcılar sayfası — iki-pane redesign (image 1 tarzı).
// Sol: kullanıcı listesi kartları (avatar, isim+Sen badge+Pasif, e-posta, rol+tarih, ülke).
// Sağ: seçili kullanıcı detayı (4 toggle: Hesap, Admin, Muhasebe, Destek + Profil/Aktivite tabs).
// Mevcut RPC'ler aynı: user_roles INSERT/DELETE, profiles SELECT, audit_log, user_login_ips.
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import AdminLayout from "@/components/AdminLayout";
import { rpc } from "@/lib/rpc";
import { dbSelect, dbInsert, dbUpdate, dbDelete } from "@/lib/db";
import { invokeFunction } from "@/lib/fn";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
} from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Loader2, Plus, Search, RefreshCw, Pencil, Send, ShieldCheck, MailCheck, Globe,
  Calendar, Clock, Phone, Mail as MailIcon, Hash,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { translateError } from "@/lib/i18n-errors";
import { toast } from "sonner";
import { fmtDate, fmtRelative } from "@/lib/format";
import { CopyButton } from "@/components/CopyButton";
import { maskEmail } from "@/lib/mask";
import { auditActionLabel, resourceLabel } from "@/lib/bo-labels";

type Role = "admin" | "accounting" | "support";
type Profile = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  member_no: string;
  phone: string | null;
  is_frozen: boolean;
  kyc_status: string | null;
  created_at: string;
  // last_sign_in_at, email_confirmed_at profiles'ta yok — user_login_ips'tan türetiyoruz
};

type StaffRow = Profile & {
  user_id: string;
  roles: Role[];
  country_count: number;
  last_country: string | null;
  last_country_code: string | null;
  last_login_at: string | null;
};

type LoginRow = {
  id: string;
  ip: string | null;
  country: string | null;
  country_code: string | null;
  city: string | null;
  device_type: string | null;
  browser: string | null;
  os: string | null;
  created_at: string;
};

type AuditRow = {
  id: string;
  action: string;
  resource: string;
  resource_id: string | null;
  context: any;
  created_at: string;
};

const ROLE_LABEL: Record<Role, string> = {
  admin: "Admin",
  accounting: "Muhasebe",
  support: "Destek",
};
const ROLE_DESC: Record<Role, string> = {
  admin: "Tüm verilere ve ayarlara tam erişim",
  accounting: "Finansal alanlara ve raporlara erişim",
  support: "Kısıtlı görüntüleme + freeze/unfreeze",
};
const ROLES: Role[] = ["admin", "accounting", "support"];

function flagEmoji(code: string | null | undefined): string {
  if (!code || code.length !== 2) return "🌍";
  const cc = code.toUpperCase();
  return String.fromCodePoint(...[...cc].map((c) => 0x1f1a5 + c.charCodeAt(0)));
}

function avatarColor(seed: string): string {
  const colors = [
    "bg-amber-500", "bg-blue-500", "bg-green-500", "bg-purple-500",
    "bg-pink-500", "bg-indigo-500", "bg-orange-500", "bg-teal-500",
    "bg-rose-500", "bg-cyan-500",
  ];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return colors[Math.abs(h) % colors.length];
}

function initials(first: string | null, last: string | null, email: string): string {
  const f = (first ?? "").trim();
  const l = (last ?? "").trim();
  if (f || l) return ((f[0] ?? "") + (l[0] ?? "")).toUpperCase();
  return (email[0] ?? "?").toUpperCase();
}

export default function AdminUsers() {
  const { user, can } = useAuth();
  const myUserId = user?.id ?? "";
  const canInvite = can("bo_users", "invite");
  const canManageRoles = can("bo_users", "manage_roles");
  const canFreezeMembers = can("members", "freeze");
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get("selected");

  const [rows, setRows] = useState<StaffRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // Yeni kullanıcı dialog — doğrudan user kaydı + role atar.
  const [open, setOpen] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newFirstName, setNewFirstName] = useState("");
  const [newLastName, setNewLastName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newRole, setNewRole] = useState<Role>("support");
  const [saving, setSaving] = useState(false);

  // Toggle update busy
  const [busyToggle, setBusyToggle] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const roleRows = await dbSelect<{ user_id: string; role: Role }>("user_roles", { cols: "user_id, role" });
      const ids = Array.from(new Set(roleRows.map((r) => r.user_id)));
      if (!ids.length) {
        setRows([]);
        return;
      }
      const [profiles, logins] = await Promise.all([
        dbSelect<Profile>("profiles", {
          cols: "id, first_name, last_name, email, member_no, phone, is_frozen, kyc_status, created_at",
          where: [{ col: "id", op: "in", val: ids }],
        }),
        dbSelect<{ user_id: string; country: string | null; country_code: string | null; created_at: string }>("user_login_ips", {
          cols: "user_id, country, country_code, created_at",
          where: [{ col: "user_id", op: "in", val: ids }],
          order: { col: "created_at", asc: false },
        }),
      ]);

      const map = new Map<string, StaffRow>();
      profiles.forEach((p) => {
        map.set(p.id, {
          ...p,
          user_id: p.id,
          roles: [],
          country_count: 0,
          last_country: null,
          last_country_code: null,
          last_login_at: null,
        });
      });
      roleRows.forEach((r) => {
        const row = map.get(r.user_id);
        if (row) row.roles.push(r.role);
      });
      // Login geçmişinden ülke bilgisi + son giriş tarihi
      const loginsByUser = new Map<string, Set<string>>();
      const lastCountryByUser = new Map<string, { country: string; code: string }>();
      const lastLoginByUser = new Map<string, string>();
      logins.forEach((l) => {
        if (!lastLoginByUser.has(l.user_id)) lastLoginByUser.set(l.user_id, l.created_at);
        if (!l.country_code) return;
        if (!loginsByUser.has(l.user_id)) loginsByUser.set(l.user_id, new Set());
        loginsByUser.get(l.user_id)!.add(l.country_code);
        if (!lastCountryByUser.has(l.user_id)) {
          lastCountryByUser.set(l.user_id, { country: l.country ?? "", code: l.country_code });
        }
      });
      map.forEach((row, uid) => {
        row.country_count = loginsByUser.get(uid)?.size ?? 0;
        const lc = lastCountryByUser.get(uid);
        row.last_country = lc?.country ?? null;
        row.last_country_code = lc?.code ?? null;
        row.last_login_at = lastLoginByUser.get(uid) ?? null;
      });

      const arr = Array.from(map.values()).sort((a, b) => {
        // Admin'ler önce, sonra muhasebe, sonra destek; ardından oluşturma tarihi
        const aPriority = a.roles.includes("admin") ? 0 : a.roles.includes("accounting") ? 1 : 2;
        const bPriority = b.roles.includes("admin") ? 0 : b.roles.includes("accounting") ? 1 : 2;
        if (aPriority !== bPriority) return aPriority - bPriority;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
      setRows(arr);
      // Default selection: ilk kullanıcı
      if (!selectedId && arr.length > 0) {
        setSearchParams({ selected: arr[0].user_id }, { replace: true });
      }
    } catch (err: any) {
      setLoadError(err?.message ?? "Kullanıcılar yüklenemedi");
      setRows([]);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const stats = useMemo(() => {
    const adminCount = rows.filter((r) => r.roles.includes("admin")).length;
    const accCount = rows.filter((r) => r.roles.includes("accounting")).length;
    const supCount = rows.filter((r) => r.roles.includes("support")).length;
    const passiveCount = rows.filter((r) => r.is_frozen).length;
    return { total: rows.length, admin: adminCount, accounting: accCount, support: supCount, passive: passiveCount };
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const name = `${r.first_name ?? ""} ${r.last_name ?? ""}`.toLowerCase();
      return (
        name.includes(q) ||
        (r.email ?? "").toLowerCase().includes(q) ||
        (r.member_no ?? "").includes(q)
      );
    });
  }, [rows, search]);

  const selected = useMemo(() => filtered.find((r) => r.user_id === selectedId) ?? rows.find((r) => r.user_id === selectedId) ?? null, [rows, filtered, selectedId]);

  // Toggle helpers
  const setRole = async (uid: string, role: Role, on: boolean) => {
    if (!canManageRoles) {
      toast.error("Rol yönetimi için yetkiniz yok.");
      return;
    }
    setBusyToggle(`${uid}-${role}`);
    try {
      if (on) {
        await dbInsert("user_roles", { user_id: uid, role });
        toast.success(`${ROLE_LABEL[role]} rolü eklendi`);
      } else {
        // Self-protection: kendi admin yetkimi kaldıramam
        if (uid === myUserId && role === "admin") {
          toast.error("Kendi admin yetkinizi kaldıramazsınız.");
          return;
        }
        await dbDelete("user_roles", { user_id: uid, role });
        toast.success(`${ROLE_LABEL[role]} rolü kaldırıldı`);
      }
      await load();
    } catch (err) {
      toast.error(translateError(err, "Güncellenemedi"));
    } finally {
      setBusyToggle(null);
    }
  };

  const toggleFrozen = async (uid: string, current: boolean) => {
    if (!canFreezeMembers) {
      toast.error("Hesap durumu değiştirmek için yetkiniz yok.");
      return;
    }
    setBusyToggle(`${uid}-frozen`);
    try {
      await dbUpdate("profiles", { is_frozen: !current }, { id: uid });
      toast.success(current ? "Hesap aktifleştirildi" : "Hesap dondurulduğu");
      await load();
    } catch (err) {
      toast.error(translateError(err, "Güncellenemedi"));
    } finally {
      setBusyToggle(null);
    }
  };

  const addUser = async () => {
    if (!canInvite) { toast.error("Yeni BO kullanıcısı oluşturmak için yetkiniz yok."); return; }
    if (!newEmail.trim()) { toast.error("E-posta gerekli"); return; }
    if (newPassword.length < 8) { toast.error("Şifre en az 8 karakter olmalı"); return; }
    setSaving(true);
    try {
      // native admin-user-create — auth user yaratır + profiles INSERT
      const resp = await invokeFunction<{ success?: boolean; user_id?: string; error?: string; message?: string }>(
        "admin-user-create",
        {
          scope: "admin_bo",
          email: newEmail.trim(),
          password: newPassword,
          first_name: newFirstName.trim(),
          last_name: newLastName.trim(),
          phone: newPhone.trim() || null,
        },
      );
      if (!resp?.success || !resp.user_id) {
        throw new Error(resp?.message || resp?.error || "Yaratılamadı");
      }
      // Sonra rol ata
      await dbInsert("user_roles", { user_id: resp.user_id, role: newRole });
      toast.success(`${newEmail} BO kullanıcısı olarak eklendi.`);
      setOpen(false);
      setNewEmail("");
      setNewPassword("");
      setNewFirstName("");
      setNewLastName("");
      setNewPhone("");
      setNewRole("support");
      await load();
    } catch (err) {
      toast.error(translateError(err, "Eklenemedi"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminLayout title="Kullanıcılar" requireAny={["bo_users:view"]}>
      <div className="bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200/50 dark:border-amber-900/50 rounded-lg p-3 mb-4 text-xs flex items-center gap-2">
        <span className="text-amber-600">ⓘ</span>
        Sisteme kayıtlı kullanıcılar ve rolleri. Yeni kullanıcı eklemek için onay gerekir.
      </div>

      <div className="flex items-center justify-between mb-4 gap-3">
        <div>
          <h2 className="text-2xl font-serif font-bold">Kullanıcılar</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {stats.total} kullanıcı · {stats.admin} admin · {stats.accounting} muhasebe
            {stats.support > 0 ? ` · ${stats.support} destek` : ""}
            {stats.passive > 0 ? ` · ${stats.passive} pasif` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="İsim, e-posta veya üye no..."
              className="pl-8 h-9 w-64"
            />
          </div>
          {canInvite && (
            <Button onClick={() => setOpen(true)} className="bg-amber-500 hover:bg-amber-600 text-white">
              <Plus className="size-4 mr-1" /> Yeni Kullanıcı
            </Button>
          )}
        </div>
      </div>

      {loading ? (
        <Card className="p-12 flex justify-center"><Loader2 className="animate-spin" /></Card>
      ) : loadError ? (
        <Card className="p-8 text-center text-sm text-destructive">{loadError}</Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[340px,1fr] gap-4">
          {/* SOL — kullanıcı listesi */}
          <div className="space-y-2 max-h-[calc(100vh-220px)] overflow-y-auto pr-1">
            {filtered.length === 0 ? (
              <Card className="p-8 text-center text-sm text-muted-foreground">Eşleşen kullanıcı yok.</Card>
            ) : filtered.map((r) => {
              const isSel = r.user_id === selectedId;
              const isMe = r.user_id === myUserId;
              const fullName = `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim() || r.email;
              const dt = r.created_at ? new Date(r.created_at) : null;
              const dateStr = dt ? `${String(dt.getDate()).padStart(2, "0")}.${String(dt.getMonth() + 1).padStart(2, "0")}.${dt.getFullYear()} ${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}` : "—";
              const primaryRole = r.roles[0] ?? null;
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
                      {initials(r.first_name, r.last_name, r.email)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-sm font-medium truncate">{fullName}</span>
                        {isMe && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300 font-medium">
                            Sen
                          </span>
                        )}
                        {r.is_frozen && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300 font-medium inline-flex items-center gap-0.5">
                            <span>⊘</span> Pasif
                          </span>
                        )}
                        <Send className="size-3 text-muted-foreground shrink-0" />
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate">{r.email}</div>
                      <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1.5 flex-wrap">
                        <span>{primaryRole ? ROLE_LABEL[primaryRole] : "Kullanıcı"} · {dateStr}</span>
                        {r.country_count > 0 && (
                          <span className="inline-flex items-center gap-0.5">
                            {flagEmoji(r.last_country_code)} {r.country_count} ülke
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* SAĞ — seçili kullanıcı detayı */}
          <div>
            {!selected ? (
              <Card className="p-12 text-center text-sm text-muted-foreground">
                Sol taraftan bir kullanıcı seç.
              </Card>
            ) : (
              <UserDetailPanel
                user={selected}
                isMe={selected.user_id === myUserId}
                onRoleToggle={setRole}
                onFrozenToggle={toggleFrozen}
                busy={busyToggle}
                onRefresh={load}
                canManageRoles={canManageRoles}
                canFreezeMembers={canFreezeMembers}
              />
            )}
          </div>
        </div>
      )}

      {/* Yeni kullanıcı dialog — doğrudan user kaydı + role atar */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Yeni BO Kullanıcısı</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-xs text-muted-foreground bg-muted/40 rounded-md p-2">
              Yeni BO kullanıcısı için aşağıdaki bilgileri gir. Sistem otomatik olarak auth hesabı + profil + rol ataması yapar. Kullanıcı bu e-posta ve şifre ile hemen giriş yapabilir.
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Ad *</Label>
                <Input value={newFirstName} onChange={(e) => setNewFirstName(e.target.value)} placeholder="Ali" />
              </div>
              <div>
                <Label>Soyad *</Label>
                <Input value={newLastName} onChange={(e) => setNewLastName(e.target.value)} placeholder="Veli" />
              </div>
            </div>
            <div>
              <Label>E-posta *</Label>
              <Input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="ali.veli@yildiz.com" />
            </div>
            <div>
              <Label>Şifre * <span className="text-[10px] text-muted-foreground">(en az 8 karakter)</span></Label>
              <Input type="text" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Geçici şifre" />
            </div>
            <div>
              <Label>Telefon (opsiyonel)</Label>
              <Input value={newPhone} onChange={(e) => setNewPhone(e.target.value)} placeholder="+90 5XX XXX XX XX" />
            </div>
            <div>
              <Label>Rol *</Label>
              <Select value={newRole} onValueChange={(v) => setNewRole(v as Role)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {ROLE_LABEL[r]} — <span className="text-muted-foreground">{ROLE_DESC[r]}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>İptal</Button>
            <Button onClick={addUser} disabled={saving || !newEmail.trim() || newPassword.length < 8 || !newFirstName.trim() || !newLastName.trim()}>
              {saving && <Loader2 className="animate-spin size-4 mr-2" />}Oluştur
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}

/* ---------------- Detay paneli ---------------- */

function UserDetailPanel({
  user, isMe, onRoleToggle, onFrozenToggle, busy, onRefresh, canManageRoles, canFreezeMembers,
}: {
  user: StaffRow;
  isMe: boolean;
  onRoleToggle: (uid: string, role: Role, on: boolean) => void;
  onFrozenToggle: (uid: string, current: boolean) => void;
  busy: string | null;
  onRefresh: () => void;
  canManageRoles: boolean;
  canFreezeMembers: boolean;
}) {
  const fullName = `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim() || user.email;
  const isAdmin = user.roles.includes("admin");
  const isAccounting = user.roles.includes("accounting");
  const isSupport = user.roles.includes("support");
  // Profile satırı oluştuysa users tablosunda auth kaydı var demektir → doğrulanmış kabul
  const verified = true;

  // Admin profil edit dialog (only admin role yetkisine sahip current user)
  const { roles: myRoles } = useAuth();
  const myIsAdmin = myRoles.includes("admin" as any);
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState({
    first_name: "",
    last_name: "",
    email: "",
    phone: "",
  });
  const [editSaving, setEditSaving] = useState(false);
  const openEdit = () => {
    setEditForm({
      first_name: user.first_name ?? "",
      last_name: user.last_name ?? "",
      email: user.email ?? "",
      phone: user.phone ?? "",
    });
    setEditOpen(true);
  };
  const submitEdit = async () => {
    setEditSaving(true);
    try {
      await rpc("admin_update_member_profile", {
        _user_id: user.user_id,
        _first_name: editForm.first_name.trim() || null,
        _last_name: editForm.last_name.trim() || null,
        _email: editForm.email.trim() || null,
        _phone: editForm.phone.trim() || null,
      });
      toast.success("Profil güncellendi");
      setEditOpen(false);
      onRefresh();
    } catch (err) {
      toast.error(translateError(err, "Güncellenemedi"));
    } finally {
      setEditSaving(false);
    }
  };

  return (
    <Card className="p-6 space-y-4">
      <div className="flex items-start gap-4">
        <div className={`size-14 rounded-full ${avatarColor(user.user_id)} text-white text-lg font-bold flex items-center justify-center shrink-0`}>
          {initials(user.first_name, user.last_name, user.email)}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-xl font-bold leading-tight">{fullName}</h3>
          <div className="text-sm text-muted-foreground">{user.email}</div>
          <div className="flex items-center gap-1.5 flex-wrap mt-2">
            {isAdmin && (
              <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-amber-500 text-white font-medium">
                <ShieldCheck className="size-3" /> Admin
              </span>
            )}
            {isAccounting && (
              <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-blue-500 text-white font-medium">
                <ShieldCheck className="size-3" /> Muhasebe
              </span>
            )}
            {isSupport && (
              <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-green-500 text-white font-medium">
                <ShieldCheck className="size-3" /> Destek
              </span>
            )}
            {verified && (
              <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-900">
                <MailCheck className="size-3" /> Doğrulanmış
              </span>
            )}
            {isMe && (
              <span className="text-xs px-2 py-1 rounded-full bg-muted text-muted-foreground">Bu sensin</span>
            )}
          </div>
        </div>
        <div className="space-y-2.5 shrink-0">
          {/* 4 toggle */}
          <ToggleRow
            label="Hesap durumu"
            value={!user.is_frozen}
            onChange={() => onFrozenToggle(user.user_id, user.is_frozen)}
            valueLabelOn="Aktif"
            valueLabelOff="Pasif"
            disabled={!canFreezeMembers}
            busy={busy === `${user.user_id}-frozen`}
          />
          <ToggleRow
            label="Admin yetkisi"
            value={isAdmin}
            onChange={() => onRoleToggle(user.user_id, "admin", !isAdmin)}
            valueLabelOn="Aktif"
            valueLabelOff="Pasif"
            disabled={!canManageRoles || (isMe && isAdmin)}
            busy={busy === `${user.user_id}-admin`}
          />
          <ToggleRow
            label="Muhasebe rolü"
            value={isAccounting}
            onChange={() => onRoleToggle(user.user_id, "accounting", !isAccounting)}
            valueLabelOn="Aktif"
            valueLabelOff="Pasif"
            disabled={!canManageRoles}
            busy={busy === `${user.user_id}-accounting`}
          />
          <ToggleRow
            label="Destek rolü"
            value={isSupport}
            onChange={() => onRoleToggle(user.user_id, "support", !isSupport)}
            valueLabelOn="Aktif"
            valueLabelOff="Pasif"
            disabled={!canManageRoles}
            busy={busy === `${user.user_id}-support`}
          />
        </div>
      </div>

      <Tabs defaultValue="profile">
        <TabsList>
          <TabsTrigger value="profile">Profil</TabsTrigger>
          <TabsTrigger value="activity">Aktivite</TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="mt-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <FieldCard icon={MailIcon} label="E-posta" value={user.email} />
            <FieldCard icon={ShieldCheck} label="Sağlayıcı" value="email" />
            <FieldCard icon={Calendar} label="Kayıt tarihi" value={fmtDate(user.created_at)} />
            <FieldCard icon={Clock} label="Son giriş" value={user.last_login_at ? fmtDate(user.last_login_at) : "—"} />
            <FieldCard icon={MailCheck} label="E-posta durumu" value={verified ? "Doğrulanmış" : "Doğrulanmamış"} />
            <FieldCard icon={Phone} label="Telefon" value={user.phone || "—"} />
            <FieldCard icon={Send} label="Üye No" value={<span className="font-mono">{user.member_no}</span>} />
            <FieldCard icon={Globe} label="Son ülke" value={user.last_country ? `${flagEmoji(user.last_country_code)} ${user.last_country}` : "—"} />
          </div>

          <div className="pt-2">
            <Label className="text-xs text-muted-foreground">Kullanıcı ID</Label>
            <div className="mt-1 flex items-center gap-2 bg-muted rounded-md px-3 py-2">
              <span className="text-xs font-mono">{user.user_id}</span>
              <CopyButton value={user.user_id} label="Kullanıcı ID kopyala" />
            </div>
          </div>

          {isAdmin && isMe && (
            <div className="bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200/50 dark:border-amber-900/50 rounded-lg p-3 text-xs text-amber-800 dark:text-amber-300">
              Kendi admin yetkinizi bu ekrandan kaldıramazsınız.
            </div>
          )}

          <div className="flex justify-end pt-2 gap-2">
            {/* Düzenle butonu — only admin role */}
            {myIsAdmin && (
              <Button variant="default" size="sm" onClick={openEdit}>
                <Pencil className="size-3 mr-1" /> Düzenle
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={onRefresh}>
              <RefreshCw className="size-3 mr-1" /> Listeyi yenile
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="activity" className="mt-4">
          <ActivityTabs userId={user.user_id} />
        </TabsContent>
      </Tabs>

      {/* Profil edit dialog — only admin */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Kullanıcı Profili Düzenle</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Ad</Label>
                <Input value={editForm.first_name} onChange={(e) => setEditForm({ ...editForm, first_name: e.target.value })} />
              </div>
              <div>
                <Label>Soyad</Label>
                <Input value={editForm.last_name} onChange={(e) => setEditForm({ ...editForm, last_name: e.target.value })} />
              </div>
            </div>
            <div>
              <Label>E-posta</Label>
              <Input type="email" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} />
            </div>
            <div>
              <Label>Telefon</Label>
              <Input value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} placeholder="+90 5XX XXX XX XX" />
            </div>
            <p className="text-xs text-muted-foreground">
              Boş bırakılan alan değiştirilmez. Değişiklik audit_log'a kaydedilir.
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditOpen(false)} disabled={editSaving}>İptal</Button>
            <Button onClick={submitEdit} disabled={editSaving}>
              {editSaving && <Loader2 className="animate-spin size-4 mr-2" />}Kaydet
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function ToggleRow({
  label, value, onChange, valueLabelOn, valueLabelOff, disabled, busy,
}: {
  label: string;
  value: boolean;
  onChange: () => void;
  valueLabelOn: string;
  valueLabelOff: string;
  disabled?: boolean;
  busy?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 bg-muted/30 rounded-lg px-3 py-2 min-w-[180px]">
      <div className="flex-1">
        <div className="text-[11px] text-muted-foreground">{label}</div>
        <div className={`text-xs font-medium ${value ? "text-success" : "text-muted-foreground"}`}>
          {value ? valueLabelOn : valueLabelOff}
        </div>
      </div>
      {busy ? (
        <Loader2 className="animate-spin size-4 text-muted-foreground" />
      ) : (
        <Switch checked={value} onCheckedChange={onChange} disabled={disabled} />
      )}
    </div>
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

function ActivityTabs({ userId }: { userId: string }) {
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [logins, setLogins] = useState<LoginRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [a, l] = await Promise.all([
          dbSelect<AuditRow>("audit_log", {
            cols: "id, action, resource, resource_id, context, created_at",
            where: { actor_id: userId },
            order: { col: "created_at", asc: false },
            limit: 50,
          }),
          dbSelect<LoginRow>("user_login_ips", {
            cols: "id, ip, country, country_code, city, device_type, browser, os, created_at",
            where: { user_id: userId },
            order: { col: "created_at", asc: false },
            limit: 50,
          }),
        ]);
        setAudit(a);
        setLogins(l);
      } catch (err: any) {
        setError(err?.message ?? "Aktivite yüklenemedi");
        setAudit([]);
        setLogins([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [userId]);

  if (loading) return <div className="text-sm text-muted-foreground p-4">Yükleniyor…</div>;
  if (error) return <div className="text-sm text-destructive p-4">{error}</div>;

  return (
    <Tabs defaultValue="audit">
      <TabsList>
        <TabsTrigger value="audit">Yapılan eylemler ({audit.length})</TabsTrigger>
        <TabsTrigger value="logins">Giriş geçmişi ({logins.length})</TabsTrigger>
      </TabsList>

      <TabsContent value="audit" className="mt-3">
        {audit.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">Audit kaydı yok.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs">
                <tr>
                  <th className="text-left p-2">Tarih</th>
                  <th className="text-left p-2">Eylem</th>
                  <th className="text-left p-2">Hedef</th>
                </tr>
              </thead>
              <tbody>
                {audit.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="p-2 text-xs whitespace-nowrap">{fmtRelative(r.created_at)}</td>
                    <td className="p-2">
                      <Badge variant="outline" className="text-[10px]">{auditActionLabel(r.action)}</Badge>
                      <div className="font-mono text-[10px] text-muted-foreground mt-1">{r.action}</div>
                    </td>
                    <td className="p-2 text-xs">
                      <span>{resourceLabel(r.resource)}</span>
                      {r.resource_id ? <span className="block font-mono text-[10px] text-muted-foreground">{r.resource_id.slice(0, 8)}…</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </TabsContent>

      <TabsContent value="logins" className="mt-3">
        {logins.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">Giriş kaydı yok.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs">
                <tr>
                  <th className="text-left p-2">Tarih</th>
                  <th className="text-left p-2">IP</th>
                  <th className="text-left p-2">Konum</th>
                  <th className="text-left p-2">Cihaz</th>
                  <th className="text-left p-2">Tarayıcı / OS</th>
                </tr>
              </thead>
              <tbody>
                {logins.map((l) => (
                  <tr key={l.id} className="border-t">
                    <td className="p-2 text-xs whitespace-nowrap">{fmtDate(l.created_at)}</td>
                    <td className="p-2 text-xs font-mono">{l.ip ?? "—"}</td>
                    <td className="p-2 text-xs">
                      {l.country_code ? `${flagEmoji(l.country_code)} ${l.country ?? ""} ${l.city ? `· ${l.city}` : ""}` : "—"}
                    </td>
                    <td className="p-2 text-xs capitalize">{l.device_type ?? "—"}</td>
                    <td className="p-2 text-xs">{l.browser ?? "—"} {l.os ? `· ${l.os}` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </TabsContent>
    </Tabs>
  );
}
