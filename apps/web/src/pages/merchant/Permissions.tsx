// Merchant BO Yetkiler — rol bazlı modül erişimi info sayfası (owner only).
// Phase 1: bilgi-amaçlı görünüm (kim ne yapabilir). Phase 2'de per-user override.
import MerchantLayout from "@/components/MerchantLayout";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { dbSelectMaybeOne } from "@/lib/db";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ShieldCheck, ShieldAlert, Check, X, ArrowRight,
  LayoutDashboard, Receipt, Network, Settings, Users as UsersIcon, User as UserIcon, Coins,
} from "lucide-react";

type Role = "owner" | "accountant" | "read_only";
const ROLE_LABEL: Record<Role, string> = {
  owner: "Sahip",
  accountant: "Muhasebe",
  read_only: "Görüntüleyici",
};
const ROLE_COLOR: Record<Role, string> = {
  owner: "bg-amber-500",
  accountant: "bg-blue-500",
  read_only: "bg-slate-500",
};

type PermItem = {
  module: string;
  label: string;
  icon: any;
  permissions: { action: string; label: string; description: string; roles: Record<Role, boolean> }[];
};

// Wallet Merchant BO yetkileri — şu anki kod tabanına göre türetildi
const PERMISSIONS_MAP: PermItem[] = [
  {
    module: "dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
    permissions: [
      { action: "view", label: "Dashboard görüntüle", description: "Hesap özeti, hareketler, hacim", roles: { owner: true, accountant: true, read_only: true } },
    ],
  },
  {
    module: "transactions",
    label: "Üye İşlemleri",
    icon: Receipt,
    permissions: [
      { action: "view", label: "Üye işlemlerini görüntüle", description: "Anonim üye ID + işlem detayları", roles: { owner: true, accountant: true, read_only: true } },
      { action: "export_pdf", label: "PDF dökümü indir", description: "Settlement / kasa hareketleri PDF", roles: { owner: true, accountant: true, read_only: false } },
    ],
  },
  {
    module: "cashout",
    label: "Tahsilat",
    icon: Coins,
    permissions: [
      { action: "view", label: "Tahsilat sayfasını görüntüle", description: "Çekilebilir bakiye, rezerv ve tahsilat geçmişi", roles: { owner: true, accountant: true, read_only: true } },
      { action: "create", label: "Kasa tahsilatı başlat", description: "Hassas yetki; owner veya kişi-bazlı izin gerekir", roles: { owner: true, accountant: false, read_only: false } },
    ],
  },
  {
    module: "api_calls",
    label: "API Çağrıları",
    icon: Network,
    permissions: [
      { action: "view", label: "API çağrı log'larını görüntüle", description: "HMAC verify hataları, BAD_SIGNATURE kayıtları", roles: { owner: true, accountant: true, read_only: false } },
    ],
  },
  {
    module: "users",
    label: "Kullanıcılar",
    icon: UsersIcon,
    permissions: [
      { action: "view", label: "Kullanıcı listesi görüntüle", description: "İş yerinin BO kullanıcıları", roles: { owner: true, accountant: false, read_only: false } },
      { action: "invite", label: "Yeni kullanıcı davet et", description: "E-posta + rol ile ekleme", roles: { owner: true, accountant: false, read_only: false } },
      { action: "set_role", label: "Rol değiştir", description: "Mevcut kullanıcının rolünü güncelle", roles: { owner: true, accountant: false, read_only: false } },
      { action: "set_active", label: "Aktif/Pasif değiştir", description: "Kullanıcı erişimini açıp kapatma", roles: { owner: true, accountant: false, read_only: false } },
    ],
  },
  {
    module: "settings",
    label: "Ayarlar",
    icon: Settings,
    permissions: [
      { action: "view", label: "Ayarlar sayfasını görüntüle", description: "API key, webhook, IP whitelist görür", roles: { owner: true, accountant: false, read_only: false } },
      { action: "edit_ip", label: "IP whitelist düzenle", description: "İzinli IP listesini günceller", roles: { owner: true, accountant: false, read_only: false } },
      { action: "edit_webhook", label: "Webhook URL düzenle", description: "Bildirim URL'sini günceller", roles: { owner: true, accountant: false, read_only: false } },
      { action: "rotate_secret", label: "Signing secret yenile", description: "HMAC secret'ı rotate eder (eski derhal geçersiz)", roles: { owner: true, accountant: false, read_only: false } },
    ],
  },
  {
    module: "profile",
    label: "Profil",
    icon: UserIcon,
    permissions: [
      { action: "view", label: "Kendi profilini görüntüle", description: "Kişisel bilgiler ve role", roles: { owner: true, accountant: true, read_only: true } },
      { action: "change_password", label: "Şifre değiştir", description: "Kendi auth şifresi", roles: { owner: true, accountant: true, read_only: true } },
      { action: "setup_mfa", label: "İki Aşamalı Doğrulama (TOTP) kur", description: "Authenticator uygulaması ile QR kod", roles: { owner: true, accountant: true, read_only: true } },
    ],
  },
];

export default function MerchantPermissions() {
  const { user } = useAuth();
  const [myRole, setMyRole] = useState<Role | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const data = await dbSelectMaybeOne<{ role: Role }>("merchant_users", {
        cols: "role",
        where: { user_id: user.id, is_active: true },
      }).catch(() => null);
      setMyRole((data?.role ?? null) as Role | null);
      setLoading(false);
    })();
  }, [user]);

  if (loading) {
    return <MerchantLayout title="Yetkiler"><div className="text-muted-foreground">Yükleniyor…</div></MerchantLayout>;
  }

  if (myRole !== "owner") {
    return (
      <MerchantLayout title="Yetkiler">
        <Card className="p-8 text-center">
          <ShieldAlert className="size-10 mx-auto text-warning mb-2" />
          <p className="text-sm text-muted-foreground">Bu sayfayı yalnızca iş yeri sahibi (owner) görüntüleyebilir.</p>
        </Card>
      </MerchantLayout>
    );
  }

  return (
    <MerchantLayout title="Yetkiler">
      <div className="mb-6">
        <p className="text-sm text-muted-foreground">
          İş yerinizdeki rollerin sayfa bazında yetki dağılımı. Tek bir kişiye özel yetki vermek için
          <Link to="/merchant/users" className="text-primary mx-1 underline">Kullanıcılar</Link>
          sayfasından rol değiştir.
        </p>
      </div>

      {/* Rol kartları */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
        {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
          <Card key={r} className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className={`size-8 rounded-full ${ROLE_COLOR[r]} text-white flex items-center justify-center`}>
                <ShieldCheck className="size-4" />
              </div>
              <div>
                <div className="text-sm font-bold">{ROLE_LABEL[r]}</div>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {r === "owner" && "Tüm yetkilere sahip; ayarlar, secret rotate, kullanıcı yönetimi."}
              {r === "accountant" && "Finansal raporlar + işlem listesi + PDF export."}
              {r === "read_only" && "Sadece okuma; aksiyon almaz."}
            </p>
          </Card>
        ))}
      </div>

      {/* Modül × Rol matrisi */}
      <Card className="p-0 overflow-hidden">
        <div className="p-4 border-b bg-muted/30">
          <h3 className="text-sm font-semibold">Modül × Rol erişimi</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Her sayfada hangi rolün ne yapabileceği. Yeşil ✓ = yetki var, kırmızı ✗ = yetki yok.
          </p>
        </div>
        <div className="divide-y">
          {PERMISSIONS_MAP.map((m) => {
            const Icon = m.icon;
            return (
              <div key={m.module} className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Icon className="size-4 text-primary" />
                  <h4 className="text-sm font-semibold">{m.label}</h4>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs uppercase text-muted-foreground">
                        <th className="text-left py-2 pr-4">İzin</th>
                        <th className="text-center py-2 px-2 w-20">Sahip</th>
                        <th className="text-center py-2 px-2 w-24">Muhasebe</th>
                        <th className="text-center py-2 px-2 w-28">Görüntüleyici</th>
                      </tr>
                    </thead>
                    <tbody>
                      {m.permissions.map((p) => (
                        <tr key={p.action} className="border-t">
                          <td className="py-3 pr-4">
                            <div className="text-sm font-medium">{p.label}</div>
                            <div className="text-[11px] text-muted-foreground">{p.description}</div>
                            <div className="font-mono text-[10px] text-muted-foreground mt-0.5">{m.module}:{p.action}</div>
                          </td>
                          {(["owner", "accountant", "read_only"] as Role[]).map((r) => (
                            <td key={r} className="text-center py-3 px-2">
                              {p.roles[r] ? (
                                <span className="inline-flex items-center justify-center size-6 rounded-full bg-green-100 dark:bg-green-950/40 text-green-700 dark:text-green-300">
                                  <Check className="size-3.5" />
                                </span>
                              ) : (
                                <span className="inline-flex items-center justify-center size-6 rounded-full bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300">
                                  <X className="size-3.5" />
                                </span>
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* CTA */}
      <Card className="p-4 mt-4 bg-amber-50/40 dark:bg-amber-950/20 border-amber-200/50 dark:border-amber-900/40">
        <div className="flex items-start gap-3">
          <ShieldCheck className="size-5 text-amber-600 mt-0.5" />
          <div className="flex-1">
            <div className="text-sm font-semibold">Bir kullanıcının rolünü değiştirmek istiyorum</div>
            <p className="text-xs text-muted-foreground mt-1">
              Kullanıcılar sayfasında ilgili kişiyi seç, sağ panelden yeni rolü işaretle. Owner rolü
              kaldırılırken en az bir aktif owner kalmalıdır.
            </p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link to="/merchant/users">
              Kullanıcılar <ArrowRight className="size-3 ml-1" />
            </Link>
          </Button>
        </div>
      </Card>
    </MerchantLayout>
  );
}
