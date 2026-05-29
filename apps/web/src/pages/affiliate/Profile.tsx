// Affiliate BO Profil sayfası — kişisel bilgi + şifre + MFA.
import AffiliateLayout from "@/components/AffiliateLayout";
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
import { Eye, EyeOff, KeyRound, ShieldCheck, ArrowRight, User } from "lucide-react";

type AffiliateSelf = {
  affiliate_id: string;
  code: string;
  name: string;
  email: string;
  phone: string | null;
  iban: string | null;
  kind: "external" | "internal_member";
  status: "active" | "paused" | "terminated";
};

const KIND_LABEL: Record<AffiliateSelf["kind"], string> = {
  external: "Dış kişi/kurum",
  internal_member: "Sistem üyesi",
};
const STATUS_LABEL: Record<AffiliateSelf["status"], string> = {
  active: "Aktif",
  paused: "Duraklatıldı",
  terminated: "Sonlandırıldı",
};

export default function AffiliateProfile() {
  const { user } = useAuth();
  const [self, setSelf] = useState<AffiliateSelf | null>(null);
  const [loading, setLoading] = useState(true);

  // Şifre formu — yeni native auth API current password gerektirir
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
      const row = await dbSelectMaybeOne<{
        id: string; code: string; name: string; email: string;
        phone: string | null; iban: string | null;
        kind: AffiliateSelf["kind"]; status: AffiliateSelf["status"];
      }>("merchant_affiliates", {
        cols: "id, code, name, email, phone, iban, kind, status",
        or: [`auth_user_id.eq.${user.id},linked_user_id.eq.${user.id}`],
        where: { status: "active" },
      }).catch(() => null);
      if (row) {
        setSelf({
          affiliate_id: row.id,
          code: row.code,
          name: row.name,
          email: row.email,
          phone: row.phone,
          iban: row.iban,
          kind: row.kind,
          status: row.status,
        });
      }
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
      <AffiliateLayout title="Profil">
        <div className="text-muted-foreground text-sm">Yükleniyor…</div>
      </AffiliateLayout>
    );
  }

  if (!self) {
    return (
      <AffiliateLayout title="Profil">
        <Card className="p-6 text-center">
          <p className="text-sm text-muted-foreground">Profil bilgileriniz bulunamadı.</p>
        </Card>
      </AffiliateLayout>
    );
  }

  return (
    <AffiliateLayout title="Profil">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Kişisel bilgiler (read-only) */}
        <Card className="p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <User className="size-4 text-primary" />
              Affiliate bilgilerim
            </h3>
            <Badge variant="default" className="text-[10px]">{STATUS_LABEL[self.status]}</Badge>
          </div>
          <div className="space-y-2 text-sm">
            <Field label="Ad / Şirket" value={self.name} />
            <Field label="Affiliate Kodu" value={<span className="font-mono">{self.code}</span>} />
            <Field label="Tip" value={KIND_LABEL[self.kind]} />
            <Field label="E-posta" value={self.email} mono />
            <Field label="Telefon" value={self.phone || "—"} />
            <Field label="IBAN" value={self.iban ? <span className="font-mono">{self.iban}</span> : "—"} />
          </div>
          <p className="text-[11px] text-muted-foreground italic pt-2 border-t">
            Bu bilgileri değiştirmek için yöneticiyle (Yıldız Cüzdan ekibi) iletişime geçin.
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
              <Input type={showPw ? "text" : "password"} value={currentPw} onChange={(e) => setCurrentPw(e.target.value)} placeholder="••••••••" />
            </div>
            <div>
              <Label className="text-xs">Yeni şifre (en az 8 karakter)</Label>
              <div className="flex gap-2">
                <Input type={showPw ? "text" : "password"} value={pw1} onChange={(e) => setPw1(e.target.value)} placeholder="••••••••" />
                <Button type="button" variant="ghost" size="icon" onClick={() => setShowPw((v) => !v)}>
                  {showPw ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </Button>
              </div>
            </div>
            <div>
              <Label className="text-xs">Yeni şifre (tekrar)</Label>
              <Input type={showPw ? "text" : "password"} value={pw2} onChange={(e) => setPw2(e.target.value)} placeholder="••••••••" />
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
              ? "Hesabınızda iki aşamalı doğrulama aktif."
              : "Authenticator uygulaması (Google Authenticator, Microsoft Authenticator vb.) ile hesabınızı koruyun."}
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
    </AffiliateLayout>
  );
}

function Field({ label, value, mono }: { label: string; value: any; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`text-sm ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}
