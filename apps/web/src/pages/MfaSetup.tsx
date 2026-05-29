import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import MemberLayout from "@/components/MemberLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, ShieldCheck, ShieldX, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { apiGet, apiPost, ApiError } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";

interface MeMfa {
  mfa: { enabled: boolean; factorsCount: number };
}

interface EnrollResponse {
  factorId: string;
  secret: string;
  uri: string;
  qrDataUrl: string;
}

export default function MfaSetup() {
  const { t } = useTranslation();
  const { refreshMfa } = useAuth();
  const [loading, setLoading] = useState(true);
  const [hasFactor, setHasFactor] = useState(false);

  const [enrolling, setEnrolling] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const me = await apiGet<MeMfa>("/auth/me");
      setHasFactor(me.mfa.enabled && me.mfa.factorsCount > 0);
    } catch {
      setHasFactor(false);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const startEnroll = async () => {
    setEnrolling(true);
    try {
      const out = await apiPost<EnrollResponse>("/auth/mfa/enroll", {
        friendlyName: `Wallet TOTP ${new Date().toLocaleDateString()}`,
      });
      // J3 — Defence in depth: only accept QR images that are clearly a
      // `data:image/...` payload. The server uses `qrcode` to render a
      // self-generated `otpauth://` URI so this should always hold; if
      // an attacker ever swaps the API response (e.g. via a compromised
      // CDN or a malicious 3rd-party reverse proxy) and tries to point
      // the <img src> at a `javascript:` / external URL, we refuse to
      // render it and abort the enrollment.
      const safeQr = typeof out.qrDataUrl === "string" && out.qrDataUrl.startsWith("data:image/")
        ? out.qrDataUrl
        : null;
      if (!safeQr) {
        throw new Error("INVALID_QR_RESPONSE");
      }
      setQr(safeQr);
      setSecret(out.secret);
      setFactorId(out.factorId);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.code : t("member.mfa.setupFailed"));
    } finally {
      setEnrolling(false);
    }
  };

  const verifyEnroll = async () => {
    if (!factorId || !code) return;
    setVerifying(true);
    try {
      // K3 — Server returns 8 one-time backup codes on first successful
      // verify. We surface them in a modal so the user can print/copy
      // before the page navigates away. We never get a second chance.
      const out = await apiPost<{ success: true; backupCodes: string[] }>(
        "/auth/mfa/verify-enroll",
        { factorId, code },
      );
      toast.success(t("member.mfa.successEnabled"));
      setBackupCodes(out.backupCodes ?? []);
      setQr(null);
      setSecret(null);
      setFactorId(null);
      setCode("");
      await refreshMfa();
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.code : t("member.mfa.verifyFailed"));
    } finally {
      setVerifying(false);
    }
  };

  // K3 — Backup codes recovery flow.
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const regenerateBackupCodes = async () => {
    if (!confirm(t("member.mfa.confirmRegenBackup", { defaultValue: "Yeni yedek kodlar üretilecek; eski kodlar geçersiz olacak. Devam edilsin mi?" }))) return;
    try {
      const out = await apiPost<{ backupCodes: string[] }>("/auth/mfa/backup-codes/regenerate", {});
      setBackupCodes(out.backupCodes ?? []);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.code : t("member.mfa.backupRegenFailed", { defaultValue: "Yedek kodlar üretilemedi" }));
    }
  };

  const removeFactor = async () => {
    if (!confirm(t("member.mfa.confirmRemove"))) return;
    try {
      // Fetch the current factor id from /auth/me — we only need one.
      // The unenroll endpoint requires a factorId; reuse current one if visible.
      // For simplicity we call a tiny helper that lists factors via /auth/me's MFA count.
      // Backend exposes /auth/mfa/unenroll which takes factorId, so we need it.
      // Fetch via a dedicated factors call if we add one later; for now require enrollment refresh first.
      const me = await apiGet<{ mfa: { factorsCount: number } } & Record<string, unknown>>(
        "/auth/me",
      );
      if (me.mfa.factorsCount === 0) {
        await refreshMfa();
        return;
      }
      // Without a factors-list endpoint, we cannot unenroll a specific factor by id here.
      // Phase 2 limitation — exposed in next iteration.
      toast.error(t("member.mfa.removeUnsupported", "Removal unavailable in this build"));
    } catch {
      /* ignore */
    }
  };

  return (
    <MemberLayout>
      <div className="px-5 pt-6 pb-3 flex items-center gap-3">
        <Link to="/profile" className="size-9 rounded-full bg-muted flex items-center justify-center">
          <ArrowLeft className="size-4" />
        </Link>
        <div>
          <h1 className="text-xl font-bold">{t("member.mfa.title")}</h1>
          <p className="text-xs text-muted-foreground">{t("member.mfa.subtitle")}</p>
        </div>
      </div>

      <div className="px-5 space-y-4">
        {/* K3 — One-shot backup codes display. Shown after verify-enroll or
            regenerate; the user must save them now because they're not
            recoverable. */}
        {backupCodes.length > 0 && (
          <Card className="p-4 space-y-3 border-warning bg-warning/10">
            <div className="flex items-center gap-2">
              <ShieldCheck className="size-5 text-warning" />
              <span className="text-sm font-semibold">{t("member.mfa.backupCodesTitle", { defaultValue: "Yedek kurtarma kodları" })}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("member.mfa.backupCodesBody", {
                defaultValue: "Telefonun kayıp / bozuk olursa hesaba erişmek için kullanacağın tek seferlik kodlar. Şimdi yazdır veya güvenli bir yere kopyala — bir daha gösterilmez.",
              })}
            </p>
            <ul className="grid grid-cols-2 gap-2 font-mono text-sm">
              {backupCodes.map((c) => (
                <li key={c} className="bg-card px-2 py-1.5 rounded border tracking-wider text-center">{c}</li>
              ))}
            </ul>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  navigator.clipboard.writeText(backupCodes.join("\n"));
                  toast.success(t("member.mfa.backupCopied", { defaultValue: "Kodlar panoya kopyalandı" }));
                }}
              >
                {t("common.copy", { defaultValue: "Kopyala" })}
              </Button>
              <Button size="sm" onClick={() => setBackupCodes([])}>
                {t("member.mfa.backupSaved", { defaultValue: "Kaydettim" })}
              </Button>
            </div>
          </Card>
        )}
        {loading ? (
          <Card className="p-6 text-center text-muted-foreground">{t("member.mfa.loading")}</Card>
        ) : hasFactor && !qr ? (
          <Card className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="size-5 text-success" />
              <span className="text-sm font-medium">{t("member.mfa.active")}</span>
            </div>
            <p className="text-xs text-muted-foreground">{t("member.mfa.activeBody")}</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="ghost" onClick={() => void removeFactor()}>
                <ShieldX className="size-4 text-destructive" />
                <span className="ml-2">{t("member.mfa.remove", "Kaldır")}</span>
              </Button>
              {/* K3 — Regenerate backup codes. Requires aal2 (server enforces). */}
              <Button size="sm" variant="outline" onClick={() => void regenerateBackupCodes()}>
                <span>{t("member.mfa.regenBackup", { defaultValue: "Yedek kodları yenile" })}</span>
              </Button>
            </div>
          </Card>
        ) : (
          <Card className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Smartphone className="size-5 text-primary" />
              <span className="text-sm font-medium">{t("member.mfa.inactive")}</span>
            </div>
            <p className="text-xs text-muted-foreground">{t("member.mfa.inactiveBody")}</p>

            {!qr ? (
              <Button onClick={startEnroll} disabled={enrolling}>
                {enrolling ? t("member.mfa.preparing") : t("member.mfa.setup")}
              </Button>
            ) : (
              <div className="space-y-3">
                <div className="bg-muted/30 p-4 rounded-lg flex flex-col items-center gap-2">
                  <img src={qr} alt="MFA QR" className="size-48 bg-white p-2 rounded" />
                  <div className="text-xs text-muted-foreground">{t("member.mfa.manualCode")}</div>
                  <code className="text-xs font-mono bg-card px-2 py-1 rounded">{secret}</code>
                </div>

                <div>
                  <Label className="text-xs">{t("member.mfa.codeLabel")}</Label>
                  <Input
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="000000"
                    className="text-center text-2xl tracking-widest"
                  />
                </div>

                <div className="flex gap-2">
                  <Button onClick={verifyEnroll} disabled={verifying || code.length !== 6}>
                    {verifying ? t("member.mfa.verifying") : t("member.mfa.verify")}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setQr(null);
                      setSecret(null);
                      setFactorId(null);
                      setCode("");
                    }}
                  >
                    {t("member.mfa.cancel")}
                  </Button>
                </div>
              </div>
            )}
          </Card>
        )}

        <Card className="p-4 bg-info/10 border-info/30 text-xs space-y-1">
          <strong>{t("member.mfa.deviceLostTitle")}</strong>
          <p>{t("member.mfa.deviceLostBody")}</p>
        </Card>
      </div>
    </MemberLayout>
  );
}
