import MemberLayout from "@/components/MemberLayout";
import { useEffect, useMemo, useState } from "react";
import { rpc } from "@/lib/rpc";
import { dbSelectMaybeOne } from "@/lib/db";
import { invokeFunction } from "@/lib/fn";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ArrowLeft, ArrowRight, Banknote, CreditCard, Wallet as WalletIcon, Copy, Check,
  AlertTriangle, Clock, XCircle, Bitcoin, Layers,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { translateError } from "@/lib/i18n-errors";
import { fmtTRY } from "@/lib/format";
import { isEmbeddableTopupPaymentUrl } from "@/lib/topup-frame";
import TopupPaymentFrame from "@/components/TopupPaymentFrame";
import { useTranslation } from "react-i18next";

// list_active_topup_method_types catalog rows (`is_enabled=false` included so we can show "Yakında").
type ActiveType = {
  method_type: string;
  merchant_count: number;
  total_weight: number;
  label_tr: string;
  label_en: string;
  is_enabled: boolean;
  sort_order: number;
};

// method-type code → icon (member-facing dynamic tab grid)
const TYPE_ICON: Record<string, any> = {
  havale: Banknote,
  papara: WalletIcon,
  crypto: Bitcoin,
  credit_card: CreditCard,
};

const REDIRECT_TOPUP_METHODS = new Set(["havale", "papara", "crypto"]);

// Audit 3.3 — ortak DTO src/types/topup.ts'ten
import type { PendingTopup } from "@/types/topup";
type PendingSession = PendingTopup;

const QUICK_AMOUNTS = [1000, 2500, 5000, 10000, 25000, 50000];
const MIN_AMOUNT = 1000;

type Step = "loading" | "amount" | "details" | "pending";

export default function Topup() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const nav = useNavigate();

  const [step, setStep] = useState<Step>("loading");
  const [types, setTypes] = useState<ActiveType[]>([]);
  const [tab, setTab] = useState<string>("havale");
  const [amount, setAmount] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [session, setSession] = useState<PendingSession | null>(null);
  const [copied, setCopied] = useState(false);

  // Sayfa yüklenince: pending check + aktif yöntemler
  useEffect(() => {
    if (!user) return;
    (async () => {
      const [pendingData, typesData] = await Promise.all([
        rpc<PendingSession[]>("get_pending_topup").catch(() => [] as PendingSession[]),
        rpc<ActiveType[]>("list_active_topup_method_types").catch(() => [] as ActiveType[]),
      ]);
      const loaded = typesData ?? [];
      setTypes(loaded);
      const firstActive = loaded.find((tp) => tp.is_enabled && (tp.merchant_count ?? 0) > 0);
      if (firstActive) setTab(firstActive.method_type);
      const p = pendingData?.[0];
      if (p) {
        setSession(p);
        // status'a göre doğru ekran
        if (p.status === "redirected" && p.redirect_url) setStep("details");
        else if (p.status === "awaiting_member_action") setStep("details");
        else if (p.status === "member_confirmed") setStep("pending");
        else if (p.status === "pending") setStep("pending");
        else setStep("pending");
      } else {
        setStep("amount");
      }
    })();
  }, [user]);

  // Polling — Audit 9.1 fix: backoff + visibility-aware.
  // İlk 30sn: 5sn, 30-120sn: 10sn, >120sn: 20sn. Tab gizliyken atla.
  // Eski 3sn fixed → ~80 ms/req baz; sessizce 20 dk açık kalan tab'tan
  // 400+ istek geliyordu. Backoff hem rate-limit'e dost hem cache-eko.
  const isProviderFrame = Boolean(session?.redirect_url && !session?.iban);

  useEffect(() => {
    if (!session) return;
    const pollWhileIframe = step === "details" && isProviderFrame;
    if (step !== "pending" && !pollWhileIframe) return;
    const startedAt = Date.now();
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      if (typeof document !== "undefined" && document.hidden) {
        scheduleNext();
        return;
      }
      const data = await rpc<any[]>("get_topup_session_status", { _session_id: session.session_id }).catch(() => null);
      const row = data?.[0];
      if (!row) return scheduleNext();
      if (row.status === "success") {
        toast.success(t("member.topup.toast.success"));
        nav(`/topup/status?ref=${session.session_id}`);
        return;
      }
      if (row.status === "failed" || row.status === "cancelled" || row.status === "expired") {
        nav(`/topup/status?ref=${session.session_id}`);
        return;
      }
      scheduleNext();
    };
    function scheduleNext() {
      if (cancelled) return;
      const elapsed = Date.now() - startedAt;
      const interval = elapsed < 30_000 ? 5_000 : elapsed < 120_000 ? 10_000 : 20_000;
      setTimeout(tick, interval);
    }
    setTimeout(tick, 5_000);
    return () => { cancelled = true; };
  }, [session, step, nav, isProviderFrame, t]);

  const gross = parseFloat(amount) || 0;
  const isMethodAvailable = (mt: string) =>
    types.some((tp) => tp.method_type === mt && tp.is_enabled && (tp.merchant_count ?? 0) > 0);
  const tabAvailable = isMethodAvailable(tab);
  const tabSectionKey =
    tab === "papara" ? "member.topup.paparaSection"
    : tab === "crypto" ? "member.topup.cryptoSection"
    : "member.topup.havaleSection";

  // ─────────────────────────────────────────────────────────────────────
  // Adım 1 → 2: tutar onayı, session aç, iframe veya IBAN talimatı
  // ─────────────────────────────────────────────────────────────────────
  const startSession = async () => {
    if (!user) return;
    if (gross < MIN_AMOUNT) {
      toast.error(`Minimum ${fmtTRY(MIN_AMOUNT)} yatırılabilir`);
      return;
    }
    if (!REDIRECT_TOPUP_METHODS.has(tab) || !tabAvailable) {
      toast.error(t("member.topup.toast.methodNotAvailable"));
      return;
    }
    setSubmitting(true);
    try {
      const data = await rpc<any>("create_topup_session", {
        _method_type: tab,
        _amount: gross,
        _return_base: window.location.origin + "/topup/status",
      });
      const row = Array.isArray(data) ? data[0] : data;
      if (!row?.success) {
        if (row?.error_code === "PENDING_EXISTS") {
          // Yarış: başka sekmeden açılmış olabilir; pending'i tekrar yükle
          const pData = await rpc<PendingSession[]>("get_pending_topup").catch(() => [] as PendingSession[]);
          const p = pData?.[0];
          if (p) {
            setSession(p);
            setStep(p.status === "awaiting_member_action" ? "details" : "pending");
            return;
          }
        }
        toast.error(translateError({ error_code: row?.error_code }, t("member.topup.toast.startFailed")));
        return;
      }
      const sessionId = row.session_id;

      // topup-init dispatcher (merchant topup_init_url or MOCK_FNS_ENABLED for dev)
      let init: {
        success?: boolean;
        flow?: string;
        iban?: string;
        account_holder?: string;
        bank_name?: string | null;
        payment_reference?: string | null;
        redirect_url?: string;
        error?: string;
      } | null = null;
      let initErr: unknown = null;
      try {
        init = await invokeFunction<typeof init>("topup-init", { session_id: sessionId });
      } catch (e) {
        initErr = e;
      }
      if (initErr || !init?.success) {
        await rpc("cancel_topup_by_member", { _session_id: sessionId }).catch(() => {});
        const code = init?.error ?? "MERCHANT_INIT_FAILED";
        toast.error(translateError({ error_code: code }, t("member.topup.toast.providerInitFailed")));
        return;
      }
      const redirectUrl = init.redirect_url?.trim();
      if ((init.flow === "iframe" || init.flow === "redirect") && redirectUrl) {
        if (isEmbeddableTopupPaymentUrl(redirectUrl)) {
          const pData = await rpc<PendingSession[]>("get_pending_topup").catch(() => [] as PendingSession[]);
          const p = pData?.[0];
          if (p) {
            setSession(p);
            setStep("details");
          }
          return;
        }
        window.location.href = redirectUrl;
        return;
      }
      if (!init.iban || !init.account_holder) {
        await rpc("cancel_topup_by_member", { _session_id: sessionId }).catch(() => {});
        toast.error(translateError({ error_code: "MERCHANT_INIT_FAILED" }, t("member.topup.toast.providerInitFailed")));
        return;
      }

      // Session'a IBAN'ı yaz, status awaiting_member_action
      const setData = await rpc<any>("set_topup_session_payment_info", {
        _session_id: sessionId,
        _iban: init.iban!,
        _account_holder: init.account_holder!,
        _bank_name: init.bank_name ?? null,
        _payment_reference: init.payment_reference ?? null,
      });
      const setRow = Array.isArray(setData) ? setData[0] : setData;
      if (!setRow?.success) {
        toast.error(translateError({ error_code: setRow?.error_code }, t("member.topup.toast.savePaymentFailed")));
        return;
      }

      // Pending'i yeniden çek (üstte freshly stored)
      const pData = await rpc<PendingSession[]>("get_pending_topup").catch(() => [] as PendingSession[]);
      const p = pData?.[0];
      if (p) {
        setSession(p);
        setStep("details");
      }
    } catch (err: any) {
      toast.error(translateError(err, t("member.topup.toast.startFailed")));
    } finally {
      setSubmitting(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────────
  // Adım 2 → 3: "Yatırımı Yaptım"
  // ─────────────────────────────────────────────────────────────────────
  const confirmPaid = async () => {
    if (!session) return;
    setSubmitting(true);
    try {
      const data = await rpc<any>("confirm_topup_by_member", {
        _session_id: session.session_id,
      });
      const row = Array.isArray(data) ? data[0] : data;
      if (!row?.success) {
        toast.error(translateError({ error_code: row?.error_code }, t("member.topup.toast.confirmFailed")));
        return;
      }
      // Pending'i yenile
      const pData = await rpc<PendingSession[]>("get_pending_topup").catch(() => [] as PendingSession[]);
      const p = pData?.[0];
      if (p) {
        setSession(p);
        setStep("pending");
      }
    } catch (err: any) {
      toast.error(translateError(err, t("member.topup.toast.confirmFailed")));
    } finally {
      setSubmitting(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────────
  // İşlemi iptal et (pending step'inden)
  // ─────────────────────────────────────────────────────────────────────
  const cancelSession = async () => {
    if (!session) return;
    setSubmitting(true);
    try {
      const data = await rpc<any>("cancel_topup_by_member", {
        _session_id: session.session_id,
      });
      const row = Array.isArray(data) ? data[0] : data;
      if (!row?.success) {
        toast.error(translateError({ error_code: row?.error_code }, t("member.topup.toast.cancelFailed")));
        return;
      }
      toast.success(t("member.topup.toast.cancelled"));
      setSession(null);
      setStep("amount");
    } catch (err: any) {
      toast.error(translateError(err, t("member.topup.toast.cancelFailed")));
    } finally {
      setSubmitting(false);
    }
  };

  const copyIban = async () => {
    if (!session?.iban) return;
    try {
      await navigator.clipboard.writeText(session.iban);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  const formatTrDate = (iso: string) => {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };

  // ─────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────
  const Header = () => (
    <div className="pt-4 sm:pt-6 pb-3 flex items-center gap-3">
      <Link to="/" className="size-9 rounded-full bg-muted flex items-center justify-center">
        <ArrowLeft className="size-4" />
      </Link>
      <div>
        <h1 className="text-xl font-bold">{t("member.topup.title")}</h1>
        <p className="text-xs text-muted-foreground">{t("member.topup.subtitle")}</p>
      </div>
    </div>
  );

  if (step === "loading") {
    return (
      <MemberLayout>
        <Header />
        <div className="py-12 text-center text-muted-foreground text-sm">{t("member.topup.loading")}</div>
      </MemberLayout>
    );
  }

  // ── Ekran 3: Beklemede İşleminiz Var ────────────────────────────────
  if (step === "pending" && session) {
    return (
      <MemberLayout>
        <Header />
        <div className="space-y-4">
          <TopupSteps active="waiting" />
          <div className="soft-card rounded-2xl p-6 text-center">
            <div className="size-16 rounded-full bg-warning/10 flex items-center justify-center mx-auto mb-3">
              <AlertTriangle className="size-8 text-warning" />
            </div>
            <h2 className="text-xl font-bold mb-4">{t("member.topup.pending.title")}</h2>
            <div className="rounded-xl bg-warning/10 border border-warning/30 p-4 text-left space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-warning-foreground/80">{t("member.topup.pending.txType")}</span>
                <span className="font-medium">{t("member.topup.pending.txTypeValue")}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-warning-foreground/80">{t("member.topup.pending.amount")}</span>
                <span className="font-bold tabular-nums">{fmtTRY(session.amount)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-warning-foreground/80">{t("member.topup.pending.date")}</span>
                <span className="tabular-nums">{formatTrDate(session.created_at)}</span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-4">
              {t("member.topup.pending.note")}
            </p>
          </div>

          {(session.status === "awaiting_member_action" || session.status === "redirected") && (
            <Button className="w-full h-12" onClick={() => setStep("details")}>
              {session.status === "redirected"
                ? t("member.topup.frame.continuePayment")
                : t("member.topup.pending.viewDetails")}
            </Button>
          )}

          {session.status === "member_confirmed" && (
            <div className="rounded-xl bg-primary/5 border border-primary/30 p-3 text-xs text-center">
              <Clock className="size-4 inline mr-1 text-primary" />
              {t("member.topup.pending.providerWaiting")}
            </div>
          )}

          {session.status !== "member_confirmed" && (
            <Button
              variant="destructive"
              className="w-full h-12"
              onClick={cancelSession}
              disabled={submitting}
            >
              <XCircle className="size-4 mr-2" />
              {t("member.topup.pending.cancel")}
            </Button>
          )}

          <Button variant="outline" className="w-full h-12" onClick={() => nav("/")}>
            {t("member.topup.pending.backHome")}
          </Button>
        </div>
      </MemberLayout>
    );
  }

  // ── Ekran 2: IBAN/Detaylar ──────────────────────────────────────────
  if (step === "details" && session) {
    const expiresInMin = Math.max(0, Math.ceil((new Date(session.expires_at).getTime() - Date.now()) / 60000));

    if (session.redirect_url && !session.iban) {
      return (
        <MemberLayout>
          <Header />
          <div className="space-y-4 pb-6">
            <TopupSteps active="payment" />
            <div className="soft-card rounded-2xl p-4 text-center">
              <div className="text-xs text-muted-foreground">{t("member.topup.summaryAmount")}</div>
              <div className="text-2xl font-bold text-primary tabular-nums mt-1">{fmtTRY(session.amount)}</div>
              <p className="text-[11px] text-muted-foreground mt-2">{t("member.topup.frame.amountHint")}</p>
            </div>
            <TopupPaymentFrame paymentUrl={session.redirect_url} />
            <div className="rounded-xl bg-primary/5 border border-primary/30 p-3 text-xs text-center">
              <Clock className="size-4 inline mr-1 text-primary" />
              {t("member.topup.frame.waitingCallback")}
            </div>
            <div className="rounded-xl bg-warning/10 border border-warning/30 p-3 text-xs text-warning-foreground">
              <Clock className="size-4 inline mr-1" />
              {expiresInMin > 0
                ? t("member.topup.details.expiresIn", { min: expiresInMin })
                : t("member.topup.details.expiresSoon")}
            </div>
            <Button variant="destructive" className="w-full h-12" onClick={cancelSession} disabled={submitting}>
              <XCircle className="size-4 mr-2" />
              {t("member.topup.pending.cancel")}
            </Button>
            <Button variant="outline" className="w-full h-12" onClick={() => nav("/")}>
              {t("member.topup.pending.backHome")}
            </Button>
          </div>
        </MemberLayout>
      );
    }

    return (
      <MemberLayout>
        <Header />
        <div className="space-y-4">
          <TopupSteps active="details" />
          <div className="soft-card rounded-2xl p-5 text-center">
            <div className="text-xs text-muted-foreground">Tutar</div>
            <div className="text-3xl font-bold text-primary tabular-nums mt-1">{fmtTRY(session.amount)}</div>
            <div className="text-[11px] text-muted-foreground mt-1">{t("member.topup.details.amountHint")}</div>
          </div>

          <div className="soft-card rounded-2xl p-5 space-y-4">
            <h3 className="font-semibold">{t("member.topup.details.title")}</h3>
            <div className="rounded-xl bg-primary/5 border border-primary/20 p-3 text-xs text-muted-foreground space-y-1">
              <div className="font-medium text-foreground">{t("member.topup.details.checklistTitle")}</div>
              <div>1. {t("member.topup.details.checklistIban")}</div>
              <div>2. {t("member.topup.details.checklistAmount")}</div>
              <div>3. {t("member.topup.details.checklistConfirm")}</div>
            </div>

            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">{t("member.topup.details.iban")}</span>
                <button
                  type="button"
                  onClick={copyIban}
                  className="flex items-center gap-2 font-mono font-bold hover:text-primary transition"
                >
                  <span className="tabular-nums">{session.iban}</span>
                  {copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
                </button>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{t("member.topup.details.holder")}</span>
                <span className="font-bold">{session.account_holder}</span>
              </div>

              {session.bank_name && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">{t("member.topup.details.bank")}</span>
                  <span className="font-medium">{session.bank_name}</span>
                </div>
              )}

              {session.payment_reference && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">{t("member.topup.details.description")}</span>
                  <span className="font-mono text-xs">{session.payment_reference}</span>
                </div>
              )}

              <div className="flex items-center justify-between border-t pt-3">
                <span className="text-muted-foreground">{t("member.topup.details.amount")}</span>
                <span className="font-bold tabular-nums">{fmtTRY(session.amount)}</span>
              </div>
            </div>

            <div className="rounded-xl bg-warning/10 border border-warning/30 p-3 text-xs text-warning-foreground">
              <Clock className="size-4 inline mr-1" />
              {expiresInMin > 0
                ? t("member.topup.details.expiresIn", { min: expiresInMin })
                : t("member.topup.details.expiresSoon")}
            </div>
          </div>

          <Button className="w-full h-12 text-base" onClick={confirmPaid} disabled={submitting}>
            {submitting ? t("member.topup.details.confirming") : t("member.topup.details.confirm")}
          </Button>
          <Button
            variant="outline"
            className="w-full h-12"
            onClick={() => setStep("pending")}
            disabled={submitting}
          >
            <ArrowLeft className="size-4 mr-2" />
            {t("member.topup.details.back")}
          </Button>
        </div>
      </MemberLayout>
    );
  }

  // ── Ekran 1: Tutar formu ────────────────────────────────────────────
  return (
    <MemberLayout>
      <Header />
      <div className="space-y-4">
        <TopupSteps active="amount" />
        {/* Kullanılabilir Bakiye banner — opsiyonel görsel öğe */}
        <div className="rounded-2xl bg-primary/5 border border-primary/20 p-4 flex items-center gap-3">
          <div className="size-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <WalletIcon className="size-5 text-primary" />
          </div>
          <div className="flex-1">
            <div className="text-xs text-muted-foreground">{t("member.topup.balanceCard")}</div>
            <BalanceLine />
          </div>
        </div>

        {/* Method-type tab grid — driven by the catalog (havale + crypto + credit_card + …) */}
        {types.length > 0 && (
          <div
            className="grid gap-2 p-1 bg-muted rounded-xl"
            style={{ gridTemplateColumns: `repeat(${types.length}, minmax(0, 1fr))` }}
          >
            {types.map((tp) => {
              const Icon = TYPE_ICON[tp.method_type] ?? Layers;
              const active = tp.is_enabled && (tp.merchant_count ?? 0) > 0;
              const selected = tab === tp.method_type && active;
              return (
                <button
                  key={tp.method_type}
                  onClick={() => active && setTab(tp.method_type)}
                  disabled={!active}
                  title={!active ? t("member.topup.soon") : undefined}
                  className={`flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition relative ${
                    selected
                      ? "bg-background shadow-sm text-primary"
                      : active
                        ? "text-muted-foreground hover:text-foreground"
                        : "text-muted-foreground/50 cursor-not-allowed"
                  }`}
                >
                  <Icon className="size-4" />
                  <span className="truncate">{tp.label_tr}</span>
                  {!active && (
                    <span className="absolute -top-1 -right-1 text-[9px] bg-warning text-warning-foreground px-1.5 py-0.5 rounded-full font-semibold">
                      {t("member.topup.soon")}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {REDIRECT_TOPUP_METHODS.has(tab) && tabAvailable && (
          <>
            <div className="soft-card rounded-2xl p-5">
              <h3 className="font-semibold mb-1">{t(tabSectionKey)}</h3>
              <p className="text-xs text-muted-foreground mb-4">{t("member.topup.amountHelp")}</p>
              <label className="text-xs text-muted-foreground">{t("member.topup.amountLabel")}</label>
              <div className="flex items-center gap-2 mt-1 border rounded-xl px-3">
                {(() => {
                  const TabIcon = TYPE_ICON[tab] ?? Banknote;
                  return <TabIcon className="size-4 text-muted-foreground" />;
                })()}
                <Input
                  type="number"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0"
                  className="border-0 px-0 text-lg font-semibold focus-visible:ring-0 tabular-nums"
                />
                <span className="text-sm text-muted-foreground">TL</span>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                {t("member.topup.minHint", { amount: fmtTRY(MIN_AMOUNT) })}
              </p>

              <div className="flex flex-wrap gap-2 mt-4">
                {QUICK_AMOUNTS.map((a) => {
                  const selected = amount === String(a);
                  return (
                    <button
                      key={a}
                      onClick={() => setAmount(String(a))}
                      className={`px-4 py-2 rounded-full text-sm font-medium border transition ${
                        selected
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-background border-border hover:border-primary"
                      }`}
                    >
                      {a.toLocaleString("tr-TR")} ₺
                    </button>
                  );
                })}
              </div>
            </div>

            {gross >= MIN_AMOUNT && (
              <div className="soft-card rounded-2xl p-5 space-y-2 text-sm">
                <div className="font-semibold">{t("member.topup.summaryTitle")}</div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t("member.topup.summaryAmount")}</span>
                  <span className="font-medium tabular-nums">{fmtTRY(gross)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t("member.topup.summaryMethod")}</span>
                  <span>{t(tabSectionKey)}</span>
                </div>
                <p className="text-[11px] text-muted-foreground border-t pt-2">{t("member.topup.summaryNote")}</p>
              </div>
            )}

            <Button
              className="w-full h-12 text-base"
              onClick={startSession}
              disabled={submitting || gross < MIN_AMOUNT || !tabAvailable}
            >
              {submitting ? t("member.topup.preparing") : t("member.topup.next")}
              {!submitting && <ArrowRight className="size-4 ml-2" />}
            </Button>
          </>
        )}
      </div>
    </MemberLayout>
  );
}

// ─── küçük yardımcı: bakiye satırı ────────────────────────────────────
function BalanceLine() {
  const { user } = useAuth();
  const [bal, setBal] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!user) return;
    dbSelectMaybeOne<{ balance: number | null }>("accounts", {
      cols: "balance",
      where: { user_id: user.id },
    })
      .then((data) => {
        setBal(Number(data?.balance ?? 0));
        setLoaded(true);
      })
      .catch(() => {
        setBal(0);
        setLoaded(true);
      });
  }, [user]);
  if (!loaded) {
    // Y-04 (audit 2026-05-05): yüklenirken ₺0,00 yerine skeleton
    return <div className="h-6 w-24 bg-muted/60 animate-pulse rounded" aria-label="Yükleniyor..." />;
  }
  return <div className="text-lg font-bold tabular-nums">{fmtTRY(bal ?? 0)}</div>;
}

function TopupSteps({ active }: { active: "amount" | "details" | "payment" | "waiting" }) {
  const { t } = useTranslation();
  const steps: Array<{ id: "amount" | "details" | "waiting"; label: string }> = [
    { id: "amount", label: t("member.topup.steps.amount") },
    {
      id: "details",
      label: active === "payment" ? t("member.topup.steps.payment") : t("member.topup.steps.details"),
    },
    { id: "waiting", label: t("member.topup.steps.waiting") },
  ];
  const activeIndex = active === "payment" ? 1 : steps.findIndex((s) => s.id === active);
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
