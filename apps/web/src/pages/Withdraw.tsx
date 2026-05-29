import MemberLayout from "@/components/MemberLayout";
import { useEffect, useState } from "react";
import { rpc } from "@/lib/rpc";
import { dbSelectMaybeOne } from "@/lib/db";
import { invokeFunction } from "@/lib/fn";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { fmtTRY } from "@/lib/format";
import { StatValue } from "@/components/ui/stat-card";
import { ArrowLeft, Wallet, Banknote, CreditCard, Bitcoin, Coins, Building2, Check, AlertCircle, Clock } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { translateError } from "@/lib/i18n-errors";
import { cleanIban, formatIban, isValidTrIban, ibanLengthOk } from "@/lib/iban";
import { useTranslation } from "react-i18next";

const TYPE_META: Record<string, { i18nKey: string; icon: any }> = {
  havale:  { i18nKey: "havale", icon: Banknote },
  papara:  { i18nKey: "papara", icon: Wallet },
  card:    { i18nKey: "card",   icon: CreditCard },
  crypto:  { i18nKey: "crypto", icon: Bitcoin },
};
const FALLBACK_ICON = Coins;

const QUICK_AMOUNTS = [100, 250, 500, 1000];

const REQUIRES_IBAN = (m: string) => m === "havale" || m === "eft";
const REQUIRES_CRYPTO = (m: string) => m === "crypto";
const REQUIRES_PAPARA = (m: string) => m === "papara";

type CryptoToken = { CryptoType: string; Name: string };

// list_active_withdraw_method_types artık katalog satırlarını döner
type ActiveType = {
  method_type: string;
  merchant_count: number;
  total_weight?: number;
  label_tr?: string;
  label_en?: string;
  is_enabled?: boolean;
  sort_order?: number;
  withdraw_eta_min?: number;
  withdraw_eta_max?: number;
  withdraw_eta_unit?: "minute" | "hour" | "business_day";
};

export default function Withdraw() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const nav = useNavigate();
  const [types, setTypes] = useState<ActiveType[]>([]);
  const [methodType, setMethodType] = useState<string>("");
  const [amount, setAmount] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [iban, setIban] = useState<string>("");
  const [ibanHolder, setIbanHolder] = useState<string>("");
  const [cryptoType, setCryptoType] = useState<string>("");
  const [payoutAddress, setPayoutAddress] = useState<string>("");
  const [cryptoTokens, setCryptoTokens] = useState<CryptoToken[]>([]);
  const [available, setAvailable] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    rpc<ActiveType[]>("list_active_withdraw_method_types").then((data) => {
      const list = data ?? [];
      setTypes(list);
      // ilk seçim sadece is_enabled + merchant_count>0 olan tipler arasından
      if (!methodType) {
        const firstActive = list.find((tp) => tp.is_enabled !== false && (tp.merchant_count ?? 0) > 0);
        if (firstActive) setMethodType(firstActive.method_type);
      }
    }).catch(() => {});
    dbSelectMaybeOne<{ balance: number; reserved_balance: number }>("accounts", {
      cols: "balance, reserved_balance",
      where: { user_id: user.id },
    }).then((data) => {
      if (data) setAvailable(Number(data.balance) - Number(data.reserved_balance));
    }).catch(() => {});
    // Profil ad/soyad → varsayılan holder
    dbSelectMaybeOne<{ first_name: string | null; last_name: string | null }>("profiles", {
      cols: "first_name, last_name",
      where: { id: user.id },
    }).then((data) => {
      if (data && (data.first_name || data.last_name)) {
        const full = `${data.first_name ?? ""} ${data.last_name ?? ""}`.trim();
        if (full) setIbanHolder((prev) => prev || full);
      }
    }).catch(() => {});
    invokeFunction<{ tokens?: CryptoToken[] }>("aninda-kripto-tokens").then((data) => {
      const tokens = data?.tokens;
      if (tokens?.length) {
        setCryptoTokens(tokens);
        setCryptoType((prev) => prev || tokens[0].CryptoType);
      }
    }).catch(() => {
      setCryptoTokens([
        { CryptoType: "BTC", Name: "Bitcoin" },
        { CryptoType: "ETH", Name: "Ethereum" },
        { CryptoType: "TRX", Name: "TRX" },
        { CryptoType: "TRC20", Name: "USDT (TRC20)" },
      ]);
    });
  }, [user]);

  const amt = parseFloat(amount) || 0;
  const selectedType = types.find((tp) => tp.method_type === methodType);
  const ibanRequired = REQUIRES_IBAN(methodType);
  const cryptoRequired = REQUIRES_CRYPTO(methodType);
  const paparaRequired = REQUIRES_PAPARA(methodType);
  const ibanClean = cleanIban(iban);
  const ibanLen = ibanClean.length;
  const ibanFmtOk = /^TR\d{0,24}$/.test(ibanClean) || ibanClean === "" || /^T?$/.test(ibanClean);
  const ibanComplete = ibanLengthOk(ibanClean);
  const ibanChecksumOk = ibanComplete && isValidTrIban(ibanClean);
  const ibanError =
    !ibanRequired ? null
    : ibanLen === 0 ? t("member.withdraw.ibanErrors.required")
    : !ibanFmtOk ? t("member.withdraw.ibanErrors.format")
    : !ibanComplete ? t("member.withdraw.ibanErrors.incomplete", { n: 26 - ibanLen })
    : !ibanChecksumOk ? t("member.withdraw.ibanErrors.checksum")
    : null;

  const holderError = ibanRequired
    ? (ibanHolder.trim().length < 2 ? t("member.withdraw.ibanHolderRequired") : null)
    : null;

  const cryptoTypeError = cryptoRequired && !cryptoType.trim()
    ? t("member.withdraw.cryptoTypeRequired")
    : null;
  const paparaDigits = payoutAddress.replace(/\D/g, "");
  const paparaError = paparaRequired
    ? (paparaDigits.length < 10 ? t("member.withdraw.paparaAccountRequired") : null)
    : null;
  const payoutError = cryptoRequired && payoutAddress.trim().length < 10
    ? t("member.withdraw.payoutAddressRequired")
    : null;

  const setMax = () => setAmount(String(Math.floor(available)));

  const onIbanChange = (raw: string) => {
    const cleaned = cleanIban(raw).replace(/[^A-Z0-9]/g, "");
    // TR + 24 hane → max 26
    setIban(cleaned.slice(0, 26));
  };

  const submit = async () => {
    if (!user || !methodType) return;
    setSubmitError(null);
    if (amt <= 0) { const msg = t("member.withdraw.invalidAmount"); setSubmitError(msg); toast.error(msg); return; }
    if (amt > available) { const msg = t("member.withdraw.insufficientBalance"); setSubmitError(msg); toast.error(msg); return; }
    if (ibanError) { setSubmitError(ibanError); toast.error(ibanError); return; }
    if (holderError) { setSubmitError(holderError); toast.error(holderError); return; }
    if (cryptoTypeError) { setSubmitError(cryptoTypeError); toast.error(cryptoTypeError); return; }
    if (payoutError) { setSubmitError(payoutError); toast.error(payoutError); return; }
    if (paparaError) { setSubmitError(paparaError); toast.error(paparaError); return; }

    setLoading(true);
    try {
      const data = await rpc<{ success: boolean; session_id?: string; error_code?: string } | Array<{ success: boolean; session_id?: string; error_code?: string }>>("request_withdraw_v3", {
        _method_type: methodType,
        _amount: amt,
        _iban: ibanRequired ? ibanClean : null,
        _iban_holder: ibanRequired ? ibanHolder.trim() : null,
        _notes: notes || null,
        _crypto_type: cryptoRequired ? cryptoType.trim() : null,
        _payout_address: (cryptoRequired || paparaRequired) ? (paparaRequired ? paparaDigits : payoutAddress.trim()) : null,
      });
      const row = Array.isArray(data) ? data[0] : data;
      if (!row?.success) {
        const msg = translateError({ error_code: row?.error_code }, t("member.withdraw.startFailed"));
        setSubmitError(msg);
        toast.error(msg);
        return;
      }
      if (row.session_id && (cryptoRequired || ibanRequired || paparaRequired)) {
        try {
          const pushData = await invokeFunction<{ error?: string }>("aninda-withdraw-push", {
            session_id: row.session_id,
          });
          const pushErrCode = pushData?.error;
          if (pushErrCode === "NOT_ANINDA_MERCHANT" && (ibanRequired || paparaRequired)) {
            // Standart finance merchant — async merchant push; session pending kalır
          } else if (pushErrCode) {
            const msg = translateError(pushData, t("member.withdraw.pushFailed"));
            setSubmitError(msg);
            toast.error(msg);
            return;
          }
        } catch (pushErr) {
          const msg = translateError(pushErr, t("member.withdraw.pushFailed"));
          setSubmitError(msg);
          toast.error(msg);
          return;
        }
      }
      toast.success(t("member.withdraw.successMessage", {
        ref: String(row.session_id).slice(0, 8) + "…",
        eta: formatEta(selectedType),
      }), { duration: 6000 });
      nav("/", { replace: true });
    } catch (err: any) {
      const msg = translateError(err, t("member.withdraw.startFailed"));
      setSubmitError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const metaInfo = (mt: string) => {
    const found = TYPE_META[mt];
    if (!found) return { label: mt, icon: FALLBACK_ICON };
    return { label: t(`member.withdraw.methodTypes.${found.i18nKey}`, mt), icon: found.icon };
  };

  const formatEta = (tp?: ActiveType | null) => {
    if (!tp?.withdraw_eta_min || !tp?.withdraw_eta_max || !tp.withdraw_eta_unit) {
      return t("member.withdraw.etaUnknown");
    }
    const unit = t(`member.withdraw.etaUnits.${tp.withdraw_eta_unit}`);
    if (tp.withdraw_eta_min === tp.withdraw_eta_max) return `${tp.withdraw_eta_min} ${unit}`;
    return `${tp.withdraw_eta_min}-${tp.withdraw_eta_max} ${unit}`;
  };

  return (
    <MemberLayout>
      <div className="px-5 pt-6 pb-3 flex items-center gap-3">
        <Link to="/" className="size-9 rounded-full bg-muted flex items-center justify-center">
          <ArrowLeft className="size-4" />
        </Link>
        <div>
          <h1 className="text-xl font-bold">{t("member.withdraw.title")}</h1>
          <p className="text-xs text-muted-foreground">{t("member.withdraw.subtitle")}</p>
        </div>
      </div>

      <div className="px-5 space-y-4">
        <WithdrawSteps active={amt > 0 && methodType ? "confirm" : methodType ? "method" : "amount"} />

        <div className="bank-card rounded-2xl p-5">
          <div className="text-xs uppercase tracking-wider opacity-80">{t("member.withdraw.balanceCard")}</div>
          <StatValue size="lg" className="mt-1 text-primary-foreground">{fmtTRY(available)}</StatValue>
          <div className="text-xs opacity-80 mt-1">{t("member.withdraw.balanceHint")}</div>
        </div>

        <div className="soft-card rounded-2xl p-5">
          <div className="flex items-center justify-between">
            <Label className="text-xs text-muted-foreground">{t("member.withdraw.amount")}</Label>
            <button onClick={setMax} className="text-xs font-medium text-primary hover:underline" type="button">{t("member.withdraw.amountAll")}</button>
          </div>
          <Input
            type="number"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
            className="text-3xl font-bold border-0 px-0 h-14 focus-visible:ring-0 tabular-nums"
          />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
            {QUICK_AMOUNTS.map((a) => (
              <button
                key={a}
                onClick={() => setAmount(String(a))}
                className="py-2 rounded-lg bg-muted text-xs font-medium hover:bg-muted/70 transition"
                type="button"
              >
                {a}₺
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-3">{t("member.withdraw.amountHelp")}</p>

          {amt > 0 && (
            <div className="mt-3 rounded-xl border p-3 text-xs bg-success/10 border-success/30">
              <div className="font-medium">{t("member.withdraw.freeNoticeTitle")}</div>
              <div className="text-muted-foreground mt-1">{t("member.withdraw.freeNoticeBody")}</div>
            </div>
          )}
        </div>

        <div className="soft-card rounded-2xl p-5">
          <Label className="text-xs text-muted-foreground mb-1 block">{t("member.withdraw.selectProvider")}</Label>
          <p className="text-xs text-muted-foreground mb-3">{t("member.withdraw.methodHelp")}</p>
          <div className="space-y-2">
            {types.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">{t("member.withdraw.noProviders")}</p>
            )}
            {types.map((tp) => {
              const m = metaInfo(tp.method_type);
              const Icon = m.icon;
              // katalog'tan label_tr varsa onu kullan, yoksa eski metaInfo
              const label = (i18n.language === "en" ? tp.label_en : tp.label_tr) ?? m.label;
              // aktif kriteri = is_enabled !== false && merchant_count > 0
              const active = (tp.is_enabled ?? true) && (tp.merchant_count ?? 0) > 0;
              const selected = active && methodType === tp.method_type;
              return (
                <button
                  key={tp.method_type}
                  onClick={() => active && setMethodType(tp.method_type)}
                  disabled={!active}
                  title={!active ? t("member.topup.soon") : undefined}
                  className={`w-full flex items-center justify-between p-3 rounded-xl border-2 transition relative ${
                    selected ? "border-primary bg-primary/5"
                    : active ? "border-border"
                    : "border-border opacity-60 cursor-not-allowed"
                  }`}
                  type="button"
                >
                  <div className="flex items-center gap-3">
                    <div className={`size-10 rounded-lg flex items-center justify-center ${active ? "bg-primary/10" : "bg-muted"}`}>
                      <Icon className={`size-5 ${active ? "text-primary" : "text-muted-foreground"}`} />
                    </div>
                    <div className="text-left">
                      <div className="font-medium text-sm">{label}</div>
                      {active ? (
                        <div className="space-y-0.5">
                          <div className="text-xs text-success">{t("member.withdraw.freeBadge")}</div>
                          <div className="text-xs text-muted-foreground flex items-center gap-1">
                            <Clock className="size-3" />
                            <span>{t("member.withdraw.etaLabel")}: {formatEta(tp)}</span>
                          </div>
                        </div>
                      ) : (
                        <div className="text-xs text-muted-foreground">{t("member.topup.soon")}</div>
                      )}
                    </div>
                  </div>
                  {selected && <Building2 className="size-5 text-primary" />}
                  {!active && (
                    <span className="text-[10px] bg-warning text-warning-foreground px-2 py-0.5 rounded-full font-semibold">
                      {t("member.topup.soon")}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {cryptoRequired && (
          <div className="soft-card rounded-2xl p-5 space-y-3">
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">{t("member.withdraw.cryptoType")}</Label>
              <select
                value={cryptoType}
                onChange={(e) => setCryptoType(e.target.value)}
                className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                {(cryptoTokens.length ? cryptoTokens : [{ CryptoType: "BTC", Name: "Bitcoin" }]).map((tok) => (
                  <option key={tok.CryptoType} value={tok.CryptoType}>
                    {tok.Name} ({tok.CryptoType})
                  </option>
                ))}
              </select>
              {cryptoTypeError && (
                <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-destructive">
                  <AlertCircle className="size-3" />
                  <span>{cryptoTypeError}</span>
                </div>
              )}
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">{t("member.withdraw.payoutAddress")}</Label>
              <Input
                value={payoutAddress}
                onChange={(e) => setPayoutAddress(e.target.value.trim())}
                placeholder={t("member.withdraw.payoutAddressPlaceholder")}
                className={`font-mono text-xs ${payoutError ? "border-destructive" : ""}`}
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
              />
              {payoutError ? (
                <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-destructive">
                  <AlertCircle className="size-3" />
                  <span>{payoutError}</span>
                </div>
              ) : (
                <p className="text-[11px] text-muted-foreground mt-1.5">{t("member.withdraw.payoutAddressHint")}</p>
              )}
            </div>
          </div>
        )}

        {paparaRequired && (
          <div className="soft-card rounded-2xl p-5 space-y-3">
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">{t("member.withdraw.paparaAccount")}</Label>
              <Input
                type="text"
                inputMode="numeric"
                value={payoutAddress}
                onChange={(e) => setPayoutAddress(e.target.value.replace(/\D/g, "").slice(0, 16))}
                placeholder={t("member.withdraw.paparaAccountPlaceholder")}
                className={`font-mono text-sm tabular-nums ${paparaError ? "border-destructive" : ""}`}
              />
              {paparaError ? (
                <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-destructive">
                  <AlertCircle className="size-3" />
                  <span>{paparaError}</span>
                </div>
              ) : (
                <p className="text-[11px] text-muted-foreground mt-1.5">{t("member.withdraw.paparaAccountHint")}</p>
              )}
            </div>
          </div>
        )}

        {ibanRequired && (
          <div className="soft-card rounded-2xl p-5 space-y-3">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <Label className="text-xs text-muted-foreground">IBAN</Label>
                <span className={`text-[11px] tabular-nums ${ibanComplete && ibanChecksumOk ? "text-success" : "text-muted-foreground"}`}>
                  {ibanLen} / 26
                </span>
              </div>
              <Input
                type="text"
                inputMode="text"
                autoCapitalize="characters"
                value={formatIban(iban)}
                onChange={(e) => onIbanChange(e.target.value)}
                placeholder="TR00 0000 0000 0000 0000 0000 00"
                className={`tabular-nums tracking-wider ${ibanError ? "border-destructive focus-visible:ring-destructive/30" : ibanChecksumOk ? "border-success focus-visible:ring-success/30" : ""}`}
                maxLength={32}
              />
              {ibanError ? (
                <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-destructive">
                  <AlertCircle className="size-3" />
                  <span>{ibanError}</span>
                </div>
              ) : ibanChecksumOk ? (
                <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-success">
                  <Check className="size-3" />
                  <span>{t("member.withdraw.ibanValid")}</span>
                </div>
              ) : null}
            </div>

            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">{t("member.withdraw.ibanHolder")}</Label>
              <Input
                type="text"
                value={ibanHolder}
                readOnly
                placeholder={t("member.withdraw.ibanHolderPlaceholder")}
                maxLength={120}
                className={`bg-muted cursor-not-allowed ${holderError ? "border-destructive focus-visible:ring-destructive/30" : ""}`}
              />
              {holderError && (
                <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-destructive">
                  <AlertCircle className="size-3" />
                  <span>{holderError}</span>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="soft-card rounded-2xl p-5">
          <Label className="text-xs text-muted-foreground mb-2 block">{t("member.withdraw.notesLabel")}</Label>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={t("member.withdraw.notesPlaceholder")}
            rows={2}
            maxLength={300}
          />
        </div>

        {amt > 0 && methodType && (
          <div className="soft-card rounded-2xl p-5 space-y-2 text-sm">
            <div className="font-semibold">{t("member.withdraw.summaryTitle")}</div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t("member.withdraw.summaryAmount")}</span>
              <span className="tabular-nums">{fmtTRY(amt)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t("member.withdraw.etaLabel")}</span>
              <span className="tabular-nums">{formatEta(selectedType)}</span>
            </div>
            <div className="border-t pt-2 flex justify-between font-bold">
              <span>{t("member.withdraw.summaryDeduct")}</span>
              <span className="tabular-nums text-destructive">−{fmtTRY(amt)}</span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {t("member.withdraw.summaryNote")}
            </p>
          </div>
        )}

        {submitError && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive flex items-start gap-2">
            <AlertCircle className="size-4 mt-0.5 shrink-0" />
            <span>{submitError}</span>
          </div>
        )}

        <Button
          className="w-full h-12 text-base sticky bottom-24 z-30 shadow-lg"
          onClick={submit}
          disabled={loading || !methodType || amt <= 0 || amt > available || !!ibanError || !!holderError || !!cryptoTypeError || !!payoutError || !!paparaError}
        >
          <Wallet className="size-4" />
          {loading ? t("member.withdraw.submitting") : t("member.withdraw.submitButton", { amount: fmtTRY(amt) })}
        </Button>
      </div>
    </MemberLayout>
  );
}

function WithdrawSteps({ active }: { active: "amount" | "method" | "confirm" }) {
  const { t } = useTranslation();
  const steps: Array<{ id: "amount" | "method" | "confirm"; label: string }> = [
    { id: "amount", label: t("member.withdraw.steps.amount") },
    { id: "method", label: t("member.withdraw.steps.method") },
    { id: "confirm", label: t("member.withdraw.steps.confirm") },
  ];
  const activeIndex = steps.findIndex((s) => s.id === active);
  return (
    <div className="soft-card rounded-2xl p-3 grid grid-cols-3 gap-2">
      {steps.map((s, idx) => {
        const done = idx < activeIndex;
        const current = idx === activeIndex;
        return (
          <div key={s.id} className="flex items-center gap-2 min-w-0">
            <div className={`size-7 rounded-full flex items-center justify-center text-xs font-bold ${
              done ? "bg-success text-success-foreground" : current ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
            }`}>
              {done ? <Check className="size-3.5" /> : idx + 1}
            </div>
            <span className={`text-[11px] truncate ${current ? "font-semibold text-foreground" : "text-muted-foreground"}`}>{s.label}</span>
          </div>
        );
      })}
    </div>
  );
}
