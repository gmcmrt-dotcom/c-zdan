import { useState, useEffect } from "react";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import { z } from "zod";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { translateError } from "@/lib/i18n-errors";
import { formatTrPhone, isValidTrMobile, digitsOnly } from "@/lib/phone";
import { toTitleCaseTr } from "@/lib/format";
import { Loader2, Wallet } from "lucide-react";
import { useTranslation } from "react-i18next";
import { apiPost, ApiError, type Tokens } from "@/lib/api";

const loginSchema = z.object({
  email: z.string().trim().email("Geçerli bir e-posta gir"),
  password: z.string().min(6, "Şifre en az 6 karakter olmalı"),
});

/**
 * Normalize referral input from URL/paste:
 *  - Extracts `?ref=R-XXXX` from full URLs
 *  - Uppercases, max 12 chars
 *  - Replaces smart dashes with ASCII hyphens
 */
function parseReferralInput(raw: string): string {
  if (raw == null) return "";
  const dashRe = /[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g;
  const dashNormalized = String(raw).replace(dashRe, "-");
  const trimmed = dashNormalized.trim();
  if (trimmed === "") return "";
  const urlMatch = trimmed.match(/[?&]ref=([^&\s#]+)/i);
  if (urlMatch && urlMatch[1]) {
    let v = urlMatch[1];
    try {
      v = decodeURIComponent(v);
    } catch {
      /* keep raw */
    }
    v = v.replace(dashRe, "-");
    return v.toUpperCase().slice(0, 12);
  }
  if (/:\/\//.test(trimmed)) return "";
  return trimmed.toUpperCase().slice(0, 12);
}

const signupSchema = z.object({
  email: z.string().trim().email("Geçerli bir e-posta gir").max(255),
  password: z.string().min(8, "Şifre en az 8 karakter olmalı").max(72),
  firstName: z.string().trim().min(1, "Ad zorunlu").max(50),
  lastName: z.string().trim().min(1, "Soyad zorunlu").max(50),
  phone: z
    .string()
    .trim()
    .max(20)
    .optional()
    .or(z.literal(""))
    .refine((v) => !v || isValidTrMobile(v), {
      message: "Telefon (5XX) XXX XX XX biçiminde olmalı",
    }),
});

export default function AuthPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, loading, setTokensAndLoad } = useAuth();
  const [busy, setBusy] = useState(false);
  const [searchParams] = useSearchParams();

  useEffect(() => {
    if (!loading && user) navigate("/", { replace: true });
  }, [user, loading, navigate]);

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [referralCode, setReferralCode] = useState("");

  const refFromUrl = parseReferralInput(searchParams.get("ref") || "");
  const refLocked = refFromUrl !== "";

  useEffect(() => {
    if (refLocked && referralCode === "") setReferralCode(refFromUrl);
  }, [refLocked, refFromUrl, referralCode]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = loginSchema.safeParse({ email: loginEmail, password: loginPassword });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setBusy(true);
    try {
      const tokens = await apiPost<Tokens & { requiresMfa: boolean }>(
        "/auth/login",
        { email: parsed.data.email, password: parsed.data.password },
        { anonymous: true },
      );
      await setTokensAndLoad(tokens);
      toast.success(t("auth.loginSuccess"));
      // If MFA enrolled, push the user through the challenge before granting full access.
      if (tokens.requiresMfa) {
        navigate("/auth/mfa-challenge", { replace: true });
      } else {
        navigate("/", { replace: true });
      }
    } catch (err) {
      if (err instanceof ApiError) toast.error(translateError({ code: err.code }));
      else toast.error(translateError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = signupSchema.safeParse({
      email: signupEmail,
      password: signupPassword,
      firstName,
      lastName,
      phone,
    });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setBusy(true);
    try {
      const normalizedFirst = toTitleCaseTr(parsed.data.firstName);
      const normalizedLast = toTitleCaseTr(parsed.data.lastName);
      const phoneE164 = parsed.data.phone ? digitsOnly(parsed.data.phone) : null;
      const codeToApply = parseReferralInput(referralCode || "");

      // Pre-check uniqueness (server still enforces; this is for UX).
      const exists = await apiPost<{ email_exists: boolean; phone_exists: boolean }>(
        "/auth/identifier-exists",
        { email: parsed.data.email, phone: phoneE164 ?? undefined },
        { anonymous: true },
      );
      if (exists.email_exists) {
        setBusy(false);
        toast.error(t("auth.duplicateEmail"));
        return;
      }
      if (exists.phone_exists) {
        setBusy(false);
        toast.error(t("auth.duplicatePhone"));
        return;
      }

      const tokens = await apiPost<Tokens>(
        "/auth/signup",
        {
          email: parsed.data.email,
          password: parsed.data.password,
          firstName: normalizedFirst,
          lastName: normalizedLast,
          phone: phoneE164,
          referralCode: codeToApply || undefined,
          userAgent: navigator.userAgent ?? null,
        },
        { anonymous: true },
      );
      await setTokensAndLoad(tokens);
      toast.success(t("auth.signupSuccessWelcome"));
      navigate("/", { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === "EMAIL_EXISTS") toast.error(t("auth.duplicateEmail"));
        else if (err.code === "PHONE_EXISTS") toast.error(t("auth.duplicatePhone"));
        else toast.error(translateError({ code: err.code }));
      } else {
        toast.error(translateError(err));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-4 py-8"
      style={{ background: "var(--gradient-bg)" }}
    >
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-6 animate-fade-in">
          <div className="size-16 rounded-2xl bank-card flex items-center justify-center mb-3">
            <Wallet className="size-8 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">{t("auth.title")}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t("auth.subtitle")}</p>
        </div>

        <Card className="rounded-2xl shadow-[var(--shadow-card)] animate-scale-in">
          <CardContent className="p-6">
            <Tabs defaultValue="login" className="w-full">
              <TabsList className="grid grid-cols-2 mb-6 w-full">
                <TabsTrigger value="login">{t("auth.loginTab")}</TabsTrigger>
                <TabsTrigger value="signup">{t("auth.registerTab")}</TabsTrigger>
              </TabsList>

              <TabsContent value="login" className="space-y-4">
                <form onSubmit={handleLogin} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="li-email">E-posta</Label>
                    <Input
                      id="li-email"
                      type="email"
                      autoComplete="email"
                      value={loginEmail}
                      onChange={(e) => setLoginEmail(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="li-pw">{t("auth.passwordLabel")}</Label>
                    <Input
                      id="li-pw"
                      type="password"
                      autoComplete="current-password"
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      required
                    />
                  </div>
                  <Button type="submit" className="w-full h-12 rounded-xl" disabled={busy}>
                    {busy && <Loader2 className="animate-spin" />} {t("auth.loginSubmit")}
                  </Button>
                </form>
              </TabsContent>

              <TabsContent value="signup" className="space-y-4">
                <form onSubmit={handleSignup} className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label htmlFor="su-fn">{t("auth.firstNameLabel")}</Label>
                      <Input
                        id="su-fn"
                        value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                        onBlur={(e) => setFirstName(toTitleCaseTr(e.target.value))}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="su-ln">{t("auth.lastNameLabel")}</Label>
                      <Input
                        id="su-ln"
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                        onBlur={(e) => setLastName(toTitleCaseTr(e.target.value))}
                        required
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="su-email">{t("auth.emailLabel")}</Label>
                    <Input
                      id="su-email"
                      type="email"
                      autoComplete="email"
                      value={signupEmail}
                      onChange={(e) => setSignupEmail(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="su-phone">{t("auth.phoneLabel")}</Label>
                    <Input
                      id="su-phone"
                      type="tel"
                      autoComplete="tel"
                      inputMode="numeric"
                      maxLength={15}
                      value={phone}
                      onChange={(e) => setPhone(formatTrPhone(e.target.value))}
                      placeholder={t("auth.phonePlaceholder")}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="su-pw">{t("auth.passwordLabelStar")}</Label>
                    <Input
                      id="su-pw"
                      type="password"
                      autoComplete="new-password"
                      value={signupPassword}
                      onChange={(e) => setSignupPassword(e.target.value)}
                      required
                    />
                    <p className="text-xs text-muted-foreground">{t("auth.passwordHint")}</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="su-ref">{t("auth.referralLabel")}</Label>
                    <Input
                      id="su-ref"
                      type="text"
                      maxLength={120}
                      placeholder={t("auth.referralPlaceholder")}
                      value={referralCode}
                      autoCapitalize="characters"
                      autoCorrect="off"
                      autoComplete="off"
                      spellCheck={false}
                      onChange={(e) => setReferralCode(parseReferralInput(e.target.value))}
                      onPaste={(e) => {
                        const pasted = e.clipboardData.getData("text");
                        const parsed = parseReferralInput(pasted);
                        if (parsed !== "") {
                          e.preventDefault();
                          setReferralCode(parsed);
                        }
                      }}
                      disabled={refLocked}
                      style={{
                        fontVariantLigatures: "none",
                        fontFamily:
                          "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
                        letterSpacing: "0.05em",
                      }}
                      className={refLocked ? "bg-muted" : ""}
                    />
                    {refLocked && (
                      <p className="text-xs text-success">{t("auth.referralLocked")}</p>
                    )}
                    {!refLocked && (
                      <p className="text-xs text-muted-foreground">{t("auth.referralHint")}</p>
                    )}
                  </div>
                  <Button type="submit" className="w-full h-12 rounded-xl" disabled={busy}>
                    {busy && <Loader2 className="animate-spin" />} {t("auth.signupSubmit")}
                  </Button>
                </form>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground mt-6">
          <Link to="/" className="hover:underline">
            {t("auth.backHome")}
          </Link>
        </p>
      </div>
    </div>
  );
}
