// Yetkiler paneli — tek sayfa.
// Sol: kullanıcı seç (search + list).
// Sağ: Roller (3 toggle) + Modül erişimi (Wallet sayfaları) + Hassas veri (sayfa bazında accordion).
// RPC shim'leri: admin_set_role_permission, admin_set_user_override, admin_remove_user_override.
import { useEffect, useMemo, useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { dbSelect, dbInsert, dbDelete } from "@/lib/db";
import { rpc } from "@/lib/rpc";
import { useAuth } from "@/hooks/useAuth";
import { translateError } from "@/lib/i18n-errors";
import { toast } from "sonner";
import { Loader2, Search, ShieldCheck, Check, ChevronDown, ChevronRight } from "lucide-react";
import {
  getPermissionModules,
  getSensitiveByPage,
  getModuleViewPerm,
} from "@/lib/admin-bo-registry";

type Role = "admin" | "accounting" | "support";
const ROLES: Role[] = ["admin", "accounting", "support"];
const ROLE_LABEL: Record<Role, string> = {
  admin: "Admin",
  accounting: "Muhasebe",
  support: "Destek",
};
const ROLE_DESC: Record<Role, string> = {
  admin: "Tüm verilere ve ayarlara tam erişim, silme yetkisi",
  accounting: "Tüm verilere erişim, finansal alanları görür",
  support: "Kısıtlı görüntüleme + freeze/unfreeze",
};

const MODULES = getPermissionModules();
const SENSITIVE_BY_PAGE = getSensitiveByPage();

type RolePerm = { role: Role; resource: string; action: string; granted: boolean };
type UserOverride = {
  id: string; user_id: string; resource: string; action: string;
  granted: boolean; reason: string | null; created_at: string;
};
type StaffUser = {
  id: string; first_name: string; last_name: string; member_no: string;
  email: string; roles: Role[];
};

function avatarColor(seed: string): string {
  const colors = ["bg-amber-500", "bg-blue-500", "bg-green-500", "bg-purple-500", "bg-pink-500", "bg-indigo-500", "bg-orange-500", "bg-teal-500"];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return colors[Math.abs(h) % colors.length];
}

export default function AdminPermissions() {
  const { roles: myRoles } = useAuth();
  const isAdmin = myRoles.includes("admin" as any);

  const [staffUsers, setStaffUsers] = useState<StaffUser[]>([]);
  const [rolePerms, setRolePerms] = useState<RolePerm[]>([]);
  const [overrides, setOverrides] = useState<UserOverride[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [pageSearch, setPageSearch] = useState("");
  const [openPages, setOpenPages] = useState<Record<string, boolean>>({});

  const load = async () => {
    setLoading(true);
    // user_roles ↔ profiles arasında doğrudan FK yok (her ikisi de users.id'ye bağlı).
    // !inner join çalışmıyor → ayrı sorgu + client-side merge yap.
    const [roleRows, perms, ovs] = await Promise.all([
      dbSelect<{ user_id: string; role: Role }>("user_roles", {
        cols: "user_id, role",
        order: { col: "role" },
      }).catch(() => [] as { user_id: string; role: Role }[]),
      dbSelect<RolePerm>("bo_permissions", {
        cols: "role, resource, action, granted",
        order: { col: "resource" },
      }).catch(() => [] as RolePerm[]),
      dbSelect<UserOverride>("user_permission_overrides", {
        cols: "id, user_id, resource, action, granted, reason, created_at",
      }).catch(() => [] as UserOverride[]),
    ]);

    const ids = Array.from(new Set(roleRows.map((r) => r.user_id)));
    const profileMap = new Map<string, any>();
    if (ids.length > 0) {
      const profs = await dbSelect<any>("profiles", {
        cols: "id, first_name, last_name, member_no, email",
        where: [{ col: "id", op: "in", val: ids }],
      }).catch(() => [] as any[]);
      profs.forEach((p: any) => profileMap.set(p.id, p));
    }

    // Aynı user için multi-role'leri grupla
    const userMap = new Map<string, StaffUser>();
    roleRows.forEach((r) => {
      const uid = r.user_id;
      if (!userMap.has(uid)) {
        const p = profileMap.get(uid);
        userMap.set(uid, {
          id: uid,
          first_name: p?.first_name ?? "",
          last_name: p?.last_name ?? "",
          member_no: p?.member_no ?? "",
          email: p?.email ?? "(profil yok)",
          roles: [],
        });
      }
      userMap.get(uid)!.roles.push(r.role as Role);
    });
    const arr = Array.from(userMap.values());
    setStaffUsers(arr);
    if (!selectedUserId && arr.length > 0) setSelectedUserId(arr[0].id);
    setRolePerms(perms);
    setOverrides(ovs);
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return staffUsers;
    return staffUsers.filter((u) => {
      const name = `${u.first_name} ${u.last_name}`.toLowerCase();
      return name.includes(q) || u.email.toLowerCase().includes(q) || u.member_no.includes(q);
    });
  }, [staffUsers, search]);

  const selected = useMemo(
    () => staffUsers.find((u) => u.id === selectedUserId) ?? null,
    [staffUsers, selectedUserId]
  );

  // (resource, action) → granted (selected user için: önce override, yoksa rol matrisi)
  const isPermGranted = (resource: string, action: string): boolean => {
    if (!selected) return false;
    const ov = overrides.find((o) => o.user_id === selected.id && o.resource === resource && o.action === action);
    if (ov) return ov.granted;
    // Rol matrisinden — kullanıcının herhangi bir rolünde granted=true varsa
    return selected.roles.some((r) =>
      rolePerms.some((rp) => rp.role === r && rp.resource === resource && rp.action === action && rp.granted)
    );
  };

  // Modül erişimi artık doğrudan isPermGranted(moduleKey, "view") + override mekanizması ile yönetiliyor.
  // Global rol matrisi düzenleme bu sayfadan kaldırıldı (kullanıcı-bazlı odak).

  const setUserOverride = async (resource: string, action: string, granted: boolean | null) => {
    if (!selected) return;
    setBusyKey(`ov-${resource}-${action}`);
    try {
      if (granted === null) {
        await rpc("admin_remove_user_override", {
          _user_id: selected.id, _resource: resource, _action: action,
        });
        toast.success("Override kaldırıldı (rol matrisine döner)");
      } else {
        await rpc("admin_set_user_override", {
          _user_id: selected.id, _resource: resource, _action: action, _granted: granted, _reason: null,
        });
        toast.success(granted ? "Yetki eklendi (kişi-bazlı override)" : "Yetki kaldırıldı (kişi-bazlı override)");
      }
      await load();
    } catch (err) {
      toast.error(translateError(err, "Güncellenemedi"));
    } finally {
      setBusyKey(null);
    }
  };

  const toggleUserRole = async (role: Role, on: boolean) => {
    if (!selected) return;
    setBusyKey(`role-${role}`);
    try {
      if (on) {
        await dbInsert("user_roles", { user_id: selected.id, role });
        toast.success(`${ROLE_LABEL[role]} rolü eklendi`);
      } else {
        await dbDelete("user_roles", { user_id: selected.id, role });
        toast.success(`${ROLE_LABEL[role]} rolü kaldırıldı`);
      }
      await load();
    } catch (err) {
      toast.error(translateError(err, "Güncellenemedi"));
    } finally {
      setBusyKey(null);
    }
  };

  const filteredPages = useMemo(() => {
    const q = pageSearch.trim().toLowerCase();
    if (!q) return Object.entries(SENSITIVE_BY_PAGE);
    return Object.entries(SENSITIVE_BY_PAGE).filter(([page, items]) => {
      if (page.toLowerCase().includes(q)) return true;
      return items.some((it) =>
        it.label.toLowerCase().includes(q) ||
        (it.description ?? "").toLowerCase().includes(q) ||
        it.resource.includes(q) ||
        it.action.includes(q)
      );
    });
  }, [pageSearch]);

  if (!isAdmin) return null;

  return (
    <AdminLayout title="Yetkiler" requireAny={["permissions:view"]}>
      <div className="mb-6">
        <h2 className="text-2xl font-serif font-bold">Yetkiler</h2>
        <p className="text-sm text-muted-foreground">
          Roller, modül ve hassas veri görünürlüğü — sol menü ile aynı kaynaktan (`apps/web/src/lib/admin-bo-registry.ts`). Yeni menü eklerken orayı güncelleyin (bkz. `docs/ADMIN_BO_REGISTRY.md`).
        </p>
      </div>

      {loading ? (
        <Card className="p-12 flex justify-center"><Loader2 className="animate-spin" /></Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[300px,1fr] gap-4">
          {/* SOL — kullanıcı seç */}
          <Card className="p-4 h-fit lg:sticky lg:top-4">
            <div className="text-sm font-semibold mb-3">Kullanıcı seç</div>
            <div className="relative mb-3">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="İsim veya e-posta..."
                className="pl-8 h-9"
              />
            </div>
            <div className="space-y-1 max-h-[600px] overflow-y-auto">
              {filteredUsers.length === 0 ? (
                <div className="p-4 text-center text-sm text-muted-foreground">Eşleşen kullanıcı yok.</div>
              ) : filteredUsers.map((u) => {
                const isSel = u.id === selectedUserId;
                const fullName = `${u.first_name} ${u.last_name}`.trim() || u.email;
                const primaryRole = u.roles[0];
                return (
                  <button
                    key={u.id}
                    onClick={() => setSelectedUserId(u.id)}
                    className={`w-full text-left rounded-lg p-2.5 transition flex items-center gap-2.5 ${
                      isSel ? "bg-amber-50 dark:bg-amber-950/20" : "hover:bg-muted/30"
                    }`}
                  >
                    <div className={`size-8 rounded-full ${avatarColor(u.id)} text-white text-[10px] font-bold flex items-center justify-center shrink-0`}>
                      {((u.first_name[0] ?? "") + (u.last_name[0] ?? "")).toUpperCase() || u.email[0]?.toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{fullName}</div>
                      <div className="text-[10px] text-muted-foreground truncate">{u.email}</div>
                    </div>
                    {primaryRole && (
                      <Badge variant="outline" className="text-[9px] py-0 shrink-0">
                        <ShieldCheck className="size-2.5 mr-0.5" /> {ROLE_LABEL[primaryRole]}
                      </Badge>
                    )}
                  </button>
                );
              })}
            </div>
          </Card>

          {/* SAĞ — yetki paneli */}
          <div className="space-y-4">
            {!selected ? (
              <Card className="p-12 text-center text-sm text-muted-foreground">Bir kullanıcı seç.</Card>
            ) : (
              <>
                {/* Üst: kullanıcı bilgisi + Roller */}
                <Card className="p-5">
                  <div className="mb-4">
                    <h3 className="text-lg font-bold">{(`${selected.first_name} ${selected.last_name}`).trim() || selected.email}</h3>
                    <div className="text-sm text-muted-foreground">{selected.email}</div>
                  </div>

                  <div className="space-y-3">
                    {ROLES.map((role) => {
                      const has = selected.roles.includes(role);
                      const busy = busyKey === `role-${role}`;
                      return (
                        <div key={role} className="flex items-start justify-between gap-3 p-3 rounded-lg border">
                          <div className="flex-1">
                            <div className="text-sm font-semibold">{ROLE_LABEL[role]}</div>
                            <div className="text-xs text-muted-foreground">{ROLE_DESC[role]}</div>
                          </div>
                          {busy ? (
                            <Loader2 className="animate-spin size-4 mt-1" />
                          ) : (
                            <Switch checked={has} onCheckedChange={(v) => toggleUserRole(role, v)} />
                          )}
                        </div>
                      );
                    })}

                    {selected.roles.includes("admin") && (
                      <div className="text-xs bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200/50 dark:border-amber-900/50 rounded-lg p-3">
                        <strong>Admin</strong> rolü aktif — aşağıdaki modül ve hassas alan izinleri bu rol için zaten tam açık.
                        Admin rolü kaldırılırsa aşağıdaki seçimler devreye girer.
                      </div>
                    )}
                  </div>
                </Card>

                {/* Modül erişimi grid — toggle ile override */}
                <Card className="p-5">
                  <div className="mb-3">
                    <h3 className="text-sm font-semibold">Modül erişimi</h3>
                    <p className="text-xs text-muted-foreground">
                      Hangi sayfaları görebilir? Açıp kapadığınız her toggle yalnızca <strong>bu kullanıcı</strong> için override oluşturur.
                    </p>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {MODULES.map((m) => {
                      const viewPerm = getModuleViewPerm(m.key);
                      const isAdminUser = selected.roles.includes("admin");
                      const has = isAdminUser ? true : isPermGranted(viewPerm.resource, viewPerm.action);
                      const ovRow = overrides.find(
                        (o) => o.user_id === selected.id && o.resource === viewPerm.resource && o.action === viewPerm.action,
                      );
                      const hasOverride = !!ovRow;
                      const busy = busyKey === `ov-${viewPerm.resource}-${viewPerm.action}`;
                      const Icon = m.icon;
                      return (
                        <div
                          key={m.key}
                          className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${
                            has ? "bg-amber-50/40 dark:bg-amber-950/10 border-amber-200/50 dark:border-amber-900/40" : "bg-muted/20"
                          }`}
                        >
                          <div className={`size-6 rounded-full flex items-center justify-center shrink-0 ${has ? "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300" : "bg-muted text-muted-foreground"}`}>
                            <Icon className="size-3" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className={`text-sm ${has ? "" : "text-muted-foreground"}`}>{m.label}</div>
                            {m.description && (
                              <div className="text-[10px] text-muted-foreground">{m.description}</div>
                            )}
                            {hasOverride && (
                              <div className="text-[9px] text-amber-700 dark:text-amber-300 mt-0.5">
                                Kişi-bazlı override
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setUserOverride(viewPerm.resource, viewPerm.action, null);
                                  }}
                                  className="ml-1 underline hover:no-underline"
                                >
                                  sıfırla
                                </button>
                              </div>
                            )}
                          </div>
                          {busy ? (
                            <Loader2 className="animate-spin size-4 shrink-0" />
                          ) : (
                            <Switch
                              checked={has}
                              onCheckedChange={(v) => setUserOverride(viewPerm.resource, viewPerm.action, v)}
                              disabled={isAdminUser}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {selected.roles.includes("admin") && (
                    <div className="text-[11px] text-muted-foreground mt-3">
                      Admin rolü aktif — bu kullanıcı tüm modülleri görür. Modül-bazlı kısıt için önce admin rolünü kaldırın.
                    </div>
                  )}
                </Card>

                {/* Hassas veri (sayfa bazında) */}
                <Card className="p-5">
                  <div className="mb-3">
                    <h3 className="text-sm font-semibold">Hassas veri (sayfa bazında)</h3>
                    <p className="text-xs text-muted-foreground">
                      Toplam sayılar, finansal özetler ve hassas butonlar — ait oldukları sayfaya göre gruplandı.
                    </p>
                  </div>
                  <div className="relative mb-3">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
                    <Input
                      value={pageSearch}
                      onChange={(e) => setPageSearch(e.target.value)}
                      placeholder="Sayfa, izin veya açıklama ara..."
                      className="pl-8 h-9"
                    />
                  </div>
                  <div className="space-y-2">
                    {filteredPages.map(([pageName, items]) => {
                      // admin: tümü granted say
                      const isAdminUser = selected.roles.includes("admin");
                      const grantedCount = isAdminUser
                        ? items.length
                        : items.filter((it) => isPermGranted(it.resource, it.action)).length;
                      const isOpen = openPages[pageName] ?? false;
                      return (
                        <div key={pageName} className="border rounded-lg overflow-hidden">
                          <button
                            onClick={() => setOpenPages((p) => ({ ...p, [pageName]: !isOpen }))}
                            className={`w-full flex items-center justify-between p-3 text-left transition ${
                              isOpen ? "bg-blue-50/40 dark:bg-blue-950/10 border-b" : "hover:bg-muted/30"
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              {isOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                              <span className="text-sm font-medium">{pageName}</span>
                            </div>
                            <span className="text-xs text-muted-foreground">{grantedCount}/{items.length}</span>
                          </button>
                          {isOpen && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 p-3 bg-muted/10">
                              {items.map((it) => {
                                // admin: tümü granted
                                const granted = isAdminUser ? true : isPermGranted(it.resource, it.action);
                                const ovRow = overrides.find((o) => o.user_id === selected.id && o.resource === it.resource && o.action === it.action);
                                const hasOverride = !!ovRow;
                                const busy = busyKey === `ov-${it.resource}-${it.action}`;
                                return (
                                  <div
                                    key={`${it.resource}.${it.action}`}
                                    className={`rounded-lg border p-3 ${granted ? "bg-amber-50/30 dark:bg-amber-950/10" : "bg-background"}`}
                                  >
                                    <div className="flex items-start gap-2">
                                      <div className={`size-5 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${granted ? "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300" : "bg-muted text-muted-foreground"}`}>
                                        {granted ? <Check className="size-3" /> : null}
                                      </div>
                                      <div className="flex-1 min-w-0">
                                        <div className="text-sm font-medium">{it.label}</div>
                                        {it.description && (
                                          <div className="text-[11px] text-muted-foreground mt-0.5">{it.description}</div>
                                        )}
                                        <div className="font-mono text-[10px] text-muted-foreground mt-1">
                                          {it.resource}:{it.action}
                                        </div>
                                      </div>
                                      <div className="shrink-0">
                                        {busy ? (
                                          <Loader2 className="animate-spin size-4" />
                                        ) : (
                                          <Switch
                                            checked={granted}
                                            onCheckedChange={(v) => setUserOverride(it.resource, it.action, v)}
                                            disabled={isAdminUser}
                                          />
                                        )}
                                      </div>
                                    </div>
                                    {hasOverride && (
                                      <div className="mt-2 flex items-center justify-between text-[10px] text-amber-700 dark:text-amber-300">
                                        <span>Kişi-bazlı override</span>
                                        <button
                                          onClick={() => setUserOverride(it.resource, it.action, null)}
                                          className="underline hover:no-underline"
                                        >
                                          Sıfırla (rol matrisine dön)
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </Card>

                {/* "Rol matrisi (global)" kart'ı yok — bu sayfa kullanıcı-bazlı override yönetir. */}

                <Card className="p-3 bg-muted/30">
                  <p className="text-[11px] text-muted-foreground">
                    💡 Bu sayfadaki <strong>tüm değişiklikler yalnızca bu kullanıcıyı etkiler</strong>. Roller +
                    modül + hassas veri toggle'ları kullanıcı-bazlı override oluşturur. Override sıfırlanırsa
                    kullanıcının rolünden gelen varsayılan izin geri döner.
                  </p>
                </Card>
              </>
            )}
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
