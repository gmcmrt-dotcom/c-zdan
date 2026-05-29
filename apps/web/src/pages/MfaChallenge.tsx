/**
 * MFA Challenge — verify TOTP code, upgrade JWT from aal1 to aal2.
 *
 * Calls POST /api/auth/mfa/challenge which returns a fresh token pair with
 * aal=aal2 if the 6-digit code matches.
 */
import { useEffect, useRef, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ShieldCheck, Loader2, LogOut } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { apiPost, ApiError, type Tokens } from "@/lib/api";

export default function MfaChallenge() {
  const { t } = useTranslation();
  const { user, loading, mfaFactorsCount, mfaReady, currentAal, signOut, setTokensAndLoad } =
    useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // I1 — Allowlist the post-MFA destination. `location.state.from` is
  // attacker-controllable (anyone who can craft a Navigate to /auth/mfa
  // can pass any value). Restrict to same-origin same-app pathnames:
  // must start with "/" and must NOT start with "//" (protocol-relative)
  // or "\\" (Windows-style). Anything else falls back to "/".
  const rawFrom = (location.state as { from?: { pathname?: string } } | undefined)?.from?.pathname;
  const from =
    typeof rawFrom === "string" &&
    rawFrom.startsWith("/") &&
    !rawFrom.startsWith("//") &&
    !rawFrom.startsWith("/\\")
      ? rawFrom
      : "/";

  useEffect(() => {
    if (!verifying) inputRef.current?.focus();
  }, [verifying]);

  if (loading || !mfaReady) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    );
  }
  if (!user) return <Navigate to="/auth" replace />;
  if (mfaFactorsCount === 0) {
    return <Navigate to="/profile/mfa" replace state={{ from: location, force: true }} />;
  }
  if (currentAal === "aal2") return <Navigate to={from} replace />;

  const verify = async () => {
    if (code.length !== 6) return;
    setVerifying(true);
    try {
      const tokens = await apiPost<Tokens>("/auth/mfa/challenge", { code });
      await setTokensAndLoad(tokens);
      toast.success(t("auth.mfaChallenge.success"));
      navigate(from, { replace: true });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.code : t("auth.mfaChallenge.invalidCode"));
      setCode("");
      inputRef.current?.focus();
    } finally {
      setVerifying(false);
    }
  };

  const onLogout = async () => {
    await signOut();
    navigate("/auth", { replace: true });
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-muted/20">
      <Card className="w-full max-w-md p-6 space-y-5">
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="size-12 rounded-full bg-primary/10 flex items-center justify-center">
            <ShieldCheck className="size-6 text-primary" />
          </div>
          <h1 className="text-xl font-bold">{t("auth.mfaChallenge.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("auth.mfaChallenge.subtitle")}</p>
        </div>

        <div className="space-y-3">
          <div>
            <Label className="text-xs">{t("auth.mfaChallenge.codeLabel")}</Label>
            <Input
              ref={inputRef}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && code.length === 6 && !verifying) void verify();
              }}
              inputMode="numeric"
              maxLength={6}
              placeholder="000000"
              className="text-center text-2xl tracking-widest h-14"
              autoComplete="one-time-code"
            />
          </div>
          <Button className="w-full" onClick={() => void verify()} disabled={verifying || code.length !== 6}>
            {verifying ? (
              <>
                <Loader2 className="size-4 animate-spin mr-2" /> {t("auth.mfaChallenge.verifying")}
              </>
            ) : (
              t("auth.mfaChallenge.verifyBtn")
            )}
          </Button>
        </div>

        <div className="pt-3 border-t flex justify-center">
          <Button variant="ghost" size="sm" onClick={() => void onLogout()}>
            <LogOut className="size-4 mr-2" /> {t("auth.mfaChallenge.logout")}
          </Button>
        </div>
      </Card>
    </div>
  );
}
