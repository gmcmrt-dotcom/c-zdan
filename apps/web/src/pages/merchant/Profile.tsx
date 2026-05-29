// Merchant BO — Profil sayfası (her kullanıcı kendi profilini görür).
// Şifre değiştir + MFA setup link + temel kişisel bilgiler.
import MerchantLayout from "@/components/MerchantLayout";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { dbSelectMaybeOne } from "@/lib/db";
import { changePassword, listMfaFactors } from "@/lib/authClient";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { translateError } from "@/lib/i18n-errors";
import { Eye, EyeOff, KeyRound, ShieldCheck, ArrowRight } from "lucide-react";

type MerchantUserSelf = {
  email: string;
  full_name: string | null;
  phone: string | null;
  role: "owner" | "accountant" | "support" | "viewer";
  merchant_name: string;
};

const ROLE_LABEL: Record<MerchantUserSelf["role"], string> = {
  owner: "Sahip",
  accountant: "Muhasebe",
  support: "Destek",
  viewer: "Görüntüleyici",
};

export default function MerchantProfile() {
  const { user } = useAuth();
  const [self, setSelf] = useState<MerchantUserSelf | null>(null);
  const [loading, setLoading] = useState(true);

  // Şifre formu
  const [currentPw, setCurrentPw] = useState("");
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [savingPw, setSavingPw] = useState(false);

  // MFA durumu
  const [mfaCount, setMfaCount] = useState<number | null>(null);

  useEffect(() => {
    if (!user) return;
    (async () => {
      // Bu user'ın merchant_users + merchants join'i
      const data = await dbSelectMaybeOne<any>("merchant_users", {
        cols: "email, full_name, phone, role, merchants!inner(name)",
        where: { user_id: user.id, is_active: true },
      }).catch(() => null);
      if (data) {
        setSelf({
          email: data.email,
          full_name: data.full_name,
          phone: data.phone,
          role: data.role,
          merchant_name: data.merchants?.name ?? "—",
        });
      }
      // MFA factor sayısı
      const factors = await listMfaFactors().catch(() => []);
      setMfaCount(factors.length);
      setLoading(false);
    })();
  }, [user]);

  async function handleChangePassword() {
    if (!currentPw) {
      toast({ title: "Mevcut şifrenizi girin", variant: "destructive" as any });
      return;
    }
    if (pw1.length < 8) {
      toast({ title: "Şifre en az 8 karakter olmalı", variant: "destructive" as any });
      return;
    }
    if (pw1 !== pw2) {
      toast({ title: "Şifreler eşleşmiyor", variant: "destructive" as any });
      return;
    }
    setSavingPw(true);
    try {
      await changePassword(currentPw, pw1);
      setCurrentPw(""); setPw1(""); setPw2("");
      toast({ title: "Şifreniz güncellendi" });
    } catch (err) {
      toast({ title: translateError(err, "Şifre güncellenemedi"), variant: "destructive" as any });
    } finally {
      setSavingPw(false);
    }
  }

  if (loading) {
    return (
      <MerchantLayout title="Profil">
        <div className="text-muted-foreground text-sm">Yükleniyor…</div>
      </MerchantLayout>
    );
  }

  if (!self) {
    return (
      <MerchantLayout title="Profil">
        <Card className="p-6 text-center">
          <p className="text-sm text-muted-foreground">Profil bilgileriniz bulunamadı. Yöneticiyle iletişime geçin.</p>
        </Card>
      </MerchantLayout>
    );
  }

  return (
    <MerchantLayout title="Profil">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Kişisel bilgiler (read-only) */}
        <Card className="p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Kişisel bilgilerim</h3>
            <Badge variant="default" className="text-[10px]">{ROLE_LABEL[self.role]}</Badge>
          </div>
          <div className="space-y-2 text-sm">
            <Field label="Ad-Soyad" value={self.full_name || "—"} />
            <Field label="E-posta" value={self.email} mono />
            <Field label="Telefon" value={self.phone || "—"} />
            <Field label="İş yeri" value={self.merchant_name} />
          </div>
          <p className="text-[11px] text-muted-foreground italic pt-2 border-t">
            Bu bilgileri değiştirmek için iş yeri sahibinizle (owner) iletişime geçin.
          </p>
        </Card>

        {/* Şifre değiştir */}
        <Card className="p-5 space-y-3">
          <div className="flex items-center gap-2">
            <KeyRound className="size-4 text-primary" />
            <h3 className="text-sm font-semibold">Şifre değiştir</h3>
          </div>
          <div className="space-y-2">
            <div>
              <Label className="text-xs">Mevcut şifre</Label>
              <Input
                type={showPw ? "text" : "password"}
                value={currentPw}
                onChange={(e) => setCurrentPw(e.target.value)}
                placeholder="••••••••"
              />
            </div>
            <div>
              <Label className="text-xs">Yeni şifre (en az 8 karakter)</Label>
              <div className="flex gap-2">
                <Input
                  type={showPw ? "text" : "password"}
                  value={pw1}
                  onChange={(e) => setPw1(e.target.value)}
                  placeholder="••••••••"
                />
                <Button type="button" variant="ghost" size="icon" onClick={() => setShowPw((v) => !v)}>
                  {showPw ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </Button>
              </div>
            </div>
            <div>
              <Label className="text-xs">Yeni şifre (tekrar)</Label>
              <Input
                type={showPw ? "text" : "password"}
                value={pw2}
                onChange={(e) => setPw2(e.target.value)}
                placeholder="••••••••"
              />
            </div>
            <Button onClick={handleChangePassword} disabled={savingPw} className="w-full">
              {savingPw ? "Güncelleniyor…" : "Şifreyi güncelle"}
            </Button>
          </div>
        </Card>

        {/* MFA */}
        <Card className="p-5 space-y-3 md:col-span-2">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-success" />
            <h3 className="text-sm font-semibold">İki Aşamalı Doğrulama (TOTP)</h3>
          </div>
          <p className="text-xs text-muted-foreground">
            {mfaCount && mfaCount > 0
              ? "Hesabınızda iki aşamalı doğrulama aktif. Yeni cihaz veya QR yenilemek için kuruluma gidin."
              : "Authenticator uygulaması (Google Authenticator, Microsoft Authenticator, 1Password vb.) ile hesabınızı koruyun. Her girişte 6 haneli kod istenecek."}
          </p>
          <div className="flex items-center gap-2">
            <Badge variant={mfaCount && mfaCount > 0 ? "default" : "outline"}>
              {mfaCount && mfaCount > 0 ? `${mfaCount} kayıtlı cihaz` : "Henüz kurulmamış"}
            </Badge>
            <Button asChild size="sm" variant="outline">
              <Link to="/profile/mfa">
                {mfaCount && mfaCount > 0 ? "QR yenile / cihaz ekle" : "TOTP kur"} <ArrowRight className="ml-1 size-3" />
              </Link>
            </Button>
          </div>
        </Card>
      </div>
    </MerchantLayout>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`text-sm ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}
