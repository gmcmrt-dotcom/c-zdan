import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom" ;
import { dbSelectMaybeOne } from "@/lib/db";
import { invokeFunction } from "@/lib/fn";
import { changePassword as authChangePassword } from "@/lib/authClient";
import { useAuth } from "@/hooks/useAuth" ;
import MemberLayout from "@/components/MemberLayout" ;
import { Button } from "@/components/ui/button" ;
import { Input } from "@/components/ui/input" ;
import { Label } from "@/components/ui/label" ;
import { InputOTP, InputOTPGroup , InputOTPSlot } from "@/components/ui/input-otp" ;
import { toast } from "sonner";
import { translateError } from "@/lib/i18n-errors" ;
import { formatTrPhone , isValidTrMobile , digitsOnly } from "@/lib/phone";
import { Eye, EyeOff, KeyRound, LogOut, Mail, Phone, User as UserIcon, IdCard } from "lucide-react" ;
import { CopyButton } from "@/components/CopyButton";
import { useTranslation } from "react-i18next";

type ChangeType = "email" | "phone";

function fmtCountdown(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m.toString().padStart(2, "0")}:${r.toString().padStart(2, "0")}`;
}

function OtpChange({
  changeType,
  inputLabel,
  placeholder,
  inputType = "text",
  inputMode,
  maxLength,
  mask,
  validate,
  onApplied,
  icon,
  title,
}: {
  changeType: ChangeType;
  inputLabel: string;
  placeholder: string;
  inputType?: string;
  inputMode?: "text" | "numeric" | "email";
  maxLength?: number;
  mask?: (v: string) => string;
  validate: (v: string) => string | null; // returns error message or null
  onApplied: (newValue: string) => void;
  icon: React.ReactNode ;
  title: string;
}) {
  const { t } = useTranslation();
  const [step, setStep] = useState<1 | 2>(1);
  const [value, setValue] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const intervalRef = useRef<number | null>(null);

 useEffect(() => {
   if (!expiresAt) return;
   intervalRef .current = window.setInterval(() => setNow(Date.now()), 1000);
   return () => {
      if (intervalRef.current) window.clearInterval(intervalRef.current);
   };
 }, [expiresAt]);

  const remainingMs = expiresAt ? expiresAt - now : 0;
  const expired = !!expiresAt && remainingMs <= 0;

  const sendCode = async () => {
     const errMsg = validate(value);
     if (errMsg) return toast.error(errMsg);
    setBusy(true);
     const payloadValue = changeType === "phone" ? digitsOnly(value) : value.trim().toLowerCase();
     try {
       const data = await invokeFunction<any>("profile-change-otp", {
         action: "request", change_type: changeType, new_value: payloadValue,
       });
       setBusy(false);
       if (data?.error_code) {
         return toast.error(translateError(data));
       }
       setStep(2);
       setCode("");
       setExpiresAt(Date.now() + 10 * 60_000);
       toast.success(t("member.profile.otpSent"));
     } catch (err) {
       setBusy(false);
       return toast.error(translateError(err));
     }
  };

  const verify = async () => {
    if (code.length !== 6) return toast.error(t("member.profile.otp.label"));
    setBusy(true);
      const payloadValue = changeType === "phone" ? digitsOnly(value) : value.trim().toLowerCase();
      try {
        const data = await invokeFunction<any>("profile-change-otp", {
          action: "verify", change_type: changeType, new_value: payloadValue, code,
        });
        setBusy(false);
        if (data?.error_code) {
          return toast.error(translateError(data));
        }
        toast.success(t(changeType === "email" ? "member.profile.changeEmailCard.title" : "member.profile.changePhoneCard.title"));
        onApplied(payloadValue);
        setStep(1);
        setValue("");
        setCode("");
        setExpiresAt(null);
      } catch (err) {
        setBusy(false);
        return toast.error(translateError(err));
      }
   };

   return (
      <div className="soft-card rounded-2xl p-5 space-y-3" >
        <div className="flex items-center gap-2" >
           {icon}
           <div className="font-semibold" >{title}</div>
        </div>

        {step === 1 ? (
           <>
              <Label>{inputLabel}</Label>
              <Input
                 type={inputType}
                 inputMode={inputMode}
                 maxLength={maxLength}
                 value={value}
                 onChange={(e) => setValue(mask ? mask(e.target.value) : e.target.value)}
                 placeholder={placeholder}
              />
              <Button onClick={sendCode} disabled={busy} className="w-full rounded-xl" >
                {t("member.profile.sendOtp")}
              </Button>
           </>
        ) : (
           <>
              <div className="text-sm text-muted-foreground" >
                {t("member.profile.otp.newValueLabel")} : <span className="font-medium text-foreground" >{value}</span>
              </div>
              <Label>{t("member.profile.otp.label")}</Label>
              <div className="flex justify-center" >
                 <InputOTP maxLength={6} value={code} onChange={setCode}>
                    <InputOTPGroup>
                      {[0, 1, 2, 3, 4, 5].map((i) => (
                        <InputOTPSlot key={i} index={i} />
                      ))}
                    </InputOTPGroup>
                 </InputOTP>
              </div>
              <div className="text-xs text-muted-foreground text-center" >
                 {expired ? t("member.profile.otp.expired") : t("member.profile.otp.remaining", { time: fmtCountdown(remainingMs) })}
              </div>
              <Button onClick={verify} disabled={busy || expired} className="w-full rounded-xl" >
                {t("member.profile.otp.confirm")}
              </Button>
              <Button
                 variant="outline"
                 onClick={sendCode}
                 disabled={busy || (!expired && remainingMs > 9 * 60_000)}
                 className="w-full rounded-xl"
              >
                 {t(expired ? "member.profile.otp.resendExpired" : "member.profile.otp.resend")}
              </Button>
              <Button
                 variant="ghost"
                 onClick={() => {
                   setStep (1);
                   setCode ("");
                   setExpiresAt (null);
                 }}
                 className="w-full rounded-xl"
              >
                {t("member.profile.otp.giveUp")}
              </Button>
           </>
        )}
      </div>
   );
}

export default function Profile() {
   const { t } = useTranslation();
   const navigate = useNavigate();
   const { user, signOut } = useAuth();
   const [profile, setProfile] = useState<any>(null);

   // Password change state.
   const [currentPassword, setCurrentPassword] = useState("");
   const [newPassword, setNewPassword ] = useState("");
   const [confirmPassword , setConfirmPassword ] = useState("");
   const [pwBusy, setPwBusy] = useState(false);
const [showPw, setShowPw] = useState(false);

const loadProfile = async () => {
   if (!user) return;
   const data = await dbSelectMaybeOne<any>("profiles", { where: { id: user.id } }).catch(() => null);
  setProfile (data);
};

useEffect(() => {
  loadProfile ();
   // eslint-disable-next-line react-hooks/exhaustive-deps
}, [user]);

const phoneFormatted = useMemo(
   () => (profile?.phone ? formatTrPhone (profile.phone) : "—"),
   [profile?.phone],
);

const changePassword = async () => {
   if (!currentPassword) return toast.error(t("member.profile.password.tooShort"));
   if (newPassword.length < 8) return toast.error(t("member.profile.password.tooShort"));
   if (!/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
     return toast.error(t("member.profile.password.weak"));
   }
   if (newPassword !== confirmPassword ) return toast.error(t("member.profile.password.mismatch"));
  setPwBusy(true);
   try {
     await authChangePassword(currentPassword, newPassword);
   } catch (err) {
     setPwBusy(false);
     return toast.error(translateError(err));
   }
  setPwBusy(false);
  setCurrentPassword("");
  setNewPassword ("");
  setConfirmPassword ("");
  toast.success(t("member.profile.password.success"));
};

const handleSignOut = async () => {
   await signOut();
  navigate("/auth", { replace: true });
};

// H5 — Log out everywhere: revoke every refresh token for this user on the
// server (NOT just the one this tab is holding). Used after suspected
// credential compromise or before disposing of a shared device.
const handleSignOutAllDevices = async () => {
  if (!window.confirm(t("member.profile.signOutAll.confirm", "Sign out of all devices?"))) return;
  await signOut({ allDevices: true });
  navigate("/auth", { replace: true });
};

return (
   <MemberLayout>
     <div className="pt-4 sm:pt-6 pb-3" >
       <h1 className="text-2xl font-bold">{t("member.profile.title")}</h1>
     </div>

     <div className="space-y-4" >
       <div className="soft-card rounded-2xl p-5 flex items-center gap-4" >
          <div className="size-14 rounded-full bg-primary/10 flex items-center justify-center" >
            <UserIcon className="size-7 text-primary" />
          </div>
          <div className="flex-1 min-w-0" >
            <div className="font-semibold" >
               {profile?.first_name} {profile?.last_name}
            </div>
            <div className="text-sm text-muted-foreground truncate" >{user?.email}</div>
            <div className="text-sm text-muted-foreground truncate" >{phoneFormatted }</div>
          </div>
       </div>

       {/* Üyelik numarası */ }
       {profile?.member_no && (
          <div className="soft-card rounded-2xl p-5" >
            <div className="flex items-center gap-2 mb-2" >
               <IdCard className="size-5 text-primary" />
               <div className="font-semibold">{t("member.profile.memberNoCard.title")}</div>
            </div>
            <div className="flex items-center gap-3" >
               <div className="font-mono text-2xl tracking-widest tabular flex-1" >{profile.member_no}</div>
               <CopyButton value={profile.member_no} label={t("member.profile.memberNoCard.copyAria")} size="md" />
            </div>
            <p className="text-xs text-muted-foreground mt-2" >
               {t("member.profile.memberNoCard.hint")}
            </p>
          </div>
       )}

       {/* Şifre değiştir */}
       <div className="soft-card rounded-2xl p-5 space-y-3">
          <div className="flex items-center gap-2">
            <KeyRound className="size-5 text-primary" />
            <div className="font-semibold">{t("member.profile.password.title")}</div>
          </div>
          <Label htmlFor="current-pw">{t("member.profile.password.currentLabel", "Mevcut şifre")}</Label>
          <Input
             id="current-pw"
             type={showPw ? "text" : "password"}
             value={currentPassword}
             onChange={(e) => setCurrentPassword(e.target.value)}
             placeholder={t("member.profile.password.currentPlaceholder", "Mevcut şifreniz")}
             autoComplete="current-password"
          />
          <Label htmlFor="new-pw">{t("member.profile.password.newLabel")}</Label>
          <div className="relative">
            <Input
               id="new-pw"
               type={showPw ? "text" : "password"}
               value={newPassword}
               onChange={(e) => setNewPassword(e.target.value)}
               placeholder={t("member.profile.password.placeholder")}
               className="pr-10"
            />
            <button
               type="button"
onClick={() => setShowPw((s) => !s)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground"
                  aria-label={showPw ? t("common.close") : t("common.confirm")}
                >
                  {showPw ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
             </div>
             <Label htmlFor="confirm-pw">{t("member.profile.password.confirmLabel")}</Label>
             <Input
                id="confirm-pw"
                type={showPw ? "text" : "password"}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder={t("member.profile.password.confirmPlaceholder")}
             />
             <Button onClick={changePassword} disabled={pwBusy} className="w-full rounded-xl">
                {t("member.profile.password.update")}
             </Button>
          </div>

          {/* MFA */}
          <Link to="/profile/mfa" className="soft-card rounded-2xl p-4 flex items-center justify-between hover:bg-muted/30 transition">
            <div>
              <div className="font-medium text-sm">{t("member.profile.mfaCard.title")}</div>
              <div className="text-xs text-muted-foreground">{t("member.profile.mfaCard.subtitle")}</div>
            </div>
            <span className="text-primary text-sm">{t("member.profile.mfaCard.action")} →</span>
          </Link>

          {/* Referral */}
          <Link to="/referrals" className="soft-card rounded-2xl p-4 flex items-center justify-between hover:bg-muted/30 transition">
            <div>
              <div className="font-medium text-sm">{t("member.profile.referralCard.title")}</div>
              <div className="text-xs text-muted-foreground">{t("member.profile.referralCard.subtitle")}</div>
            </div>
            <span className="text-primary text-sm">{t("member.profile.referralCard.action")} →</span>
          </Link>

          {/* E-posta değiştir (OTP) */}
          <OtpChange
             changeType="email"
             title={t("member.profile.changeEmailCard.title")}
             icon={<Mail className="size-5 text-primary" />}
             inputLabel={t("member.profile.changeEmailCard.label")}
             placeholder={t("member.profile.changeEmailCard.placeholder")}
             inputType="email"
             inputMode="email"
             maxLength={255}
             validate={(v) => {
                const trimmed = v.trim().toLowerCase();
                if (!trimmed) return t("errors.emailInvalid");
                if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return t("errors.emailInvalid");
                if (trimmed === (user?.email ?? "").toLowerCase()) return t("errors.emailInvalid");
                return null;
             }}
             onApplied={() => loadProfile()}
          />

          {/* Telefon değiştir (OTP) */}
          <OtpChange
             changeType="phone"
             title={t("member.profile.changePhoneCard.title")}
             icon={<Phone className="size-5 text-primary" />}
             inputLabel={t("member.profile.changePhoneCard.label")}
             placeholder={t("member.profile.changePhoneCard.placeholder")}
             inputType="tel"
             inputMode="numeric"
             maxLength={15}
             mask={formatTrPhone}
             validate={(v) =>
                isValidTrMobile(v) ? null : t("errors.phoneInvalid")
             }
             onApplied={() => loadProfile()}
          />

          <Button variant="outline" className="w-full rounded-xl h-12" onClick={handleSignOut}>
             <LogOut className="size-4" /> {t("member.profile.signOut")}
          </Button>
          {/* H5 — Log out everywhere */}
          <Button
            variant="ghost"
            className="w-full rounded-xl h-10 text-muted-foreground"
            onClick={handleSignOutAllDevices}
          >
             <LogOut className="size-4" /> {t("member.profile.signOutAll", "Sign out of all devices")}
          </Button>
        </div>

        <div className="h-6" />
      </MemberLayout>
   );
}
