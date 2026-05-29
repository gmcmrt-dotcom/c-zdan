import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom" ;
import { rpc } from "@/lib/rpc";
import { dbSelect, dbSelectMaybeOne } from "@/lib/db";
import { useAuth } from "@/hooks/useAuth" ;
import MemberLayout from "@/components/MemberLayout" ;
import { Button } from "@/components/ui/button" ;
import { Input } from "@/components/ui/input" ;
import { fmtTRY } from "@/lib/format" ;
import { StatValue } from "@/components/ui/stat-card";
import { translateError } from "@/lib/i18n-errors" ;
import { toast } from "@/hooks/use-toast" ;
import { copyToClipboard } from "@/lib/clipboard" ;
import { Copy, X, ScanLine, Clock, CheckCircle2, ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";

const QUICK_AMOUNTS = [50, 100, 250, 500, 1000];
const TTL_MIN_OPTIONS = [5, 15, 30, 60];

type ActiveCode = {
   id: string;
   code: string;
   amount: number;
   expires_at: string;
   created_at: string;
   reserved_spend_points?: number;
   reserved_cashback_points?: number; // DEPRECATED: cashback kapalı, 0 kalır
};

function useCountdown(target: string | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!target) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval (t);
  }, [target]);
  if (!target) return { mmss: "00:00", expired: true, secondsLeft: 0 };
  const diff = Math.max(0, new Date(target).getTime() - now);
  const secondsLeft = Math.floor(diff / 1000);
  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, "0");
  const ss = String(secondsLeft % 60).padStart(2, "0");
  return { mmss: `${mm}:${ss}`, expired: secondsLeft === 0, secondsLeft };
}

export default function Payment() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [account, setAccount] = useState<{ balance: number; reserved_balance : number } | null>(null);
  const [amount, setAmount] = useState<string>("");
  const [ttl, setTtl] = useState<number>(15 * 60);
  // K5 — customerName mandatory (Q19). Snapshot is saved on the
  // payment_code at create-time and compared (case-insensitive) at
  // merchant consume-time so the wrong wallet can't pay for a code that
  // wasn't issued to them.
  const [customerName, setCustomerName] = useState<string>("");
  const [creating, setCreating] = useState(false);

  const [generated, setGenerated] = useState<{ id: string; code: string; expires_at: string; amount: number } | null>(null);
  const [active, setActive] = useState<ActiveCode[]>([]);

  const available = useMemo(
     () => Math.max(0, (account?.balance ?? 0) - (account?.reserved_balance ?? 0)),
     [account],
  );
  const numAmount = Number(amount.replace(",", "."));
  const isValidAmount = !isNaN(numAmount) && numAmount > 0;

  // Loyalty preview: harcama puanı. Cashback şimdilik kapalı; contract alanı geriye uyumluluk için durur.
  const [spendPreview, setSpendPreview] = useState<{ spend_points: number; cashback_points: number; cashback_amount: number; tier_label: string; turnover: number } | null>(null);
  useEffect(() => {
    if (!isValidAmount) { setSpendPreview(null); return; }
    const t = setTimeout(() => {
      rpc<any[]>("preview_spend", { _amount: numAmount })
        .then((data) => {
          if (data && data[0]) setSpendPreview(data[0]);
        })
        .catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [numAmount, isValidAmount]);

  const countdown = useCountdown(generated?.expires_at ?? null);

  async function loadAccount() {
    if (!user) return;
    const data = await dbSelectMaybeOne<{ balance: number; reserved_balance: number }>("accounts", {
      cols: "balance, reserved_balance",
      where: { user_id: user.id },
    }).catch(() => null);
    setAccount(data as any);
  }
  async function loadActive() {
    if (!user) return;
    const data = await dbSelect<ActiveCode>("payment_codes", {
      cols: "id, code, amount, expires_at, created_at, reserved_spend_points, reserved_cashback_points",
      where: { user_id: user.id, status: "active" },
      order: { col: "created_at", asc: false },
      limit: 20,
    }).catch(() => [] as ActiveCode[]);
    setActive(data);
  }

  useEffect(() => {
    loadAccount ();
    loadActive ();
    // eslint-disable-next-line react-hooks/exhaustive-deps
}, [user]);

async function handleGenerate () {
  if (!isValidAmount) return;
  if (numAmount > available) {
    toast({ title: translateError ({ message: "insufficient balance" }), variant: "destructive" as any });
    return;
  }
  // K5 — customerName mandatory.
  const name = customerName.trim();
  if (name.length < 2) {
    toast({ title: t("payment.nameRequired", { defaultValue: "İsim Soyisim alanı zorunludur." }), variant: "destructive" as any });
    return;
  }
  setCreating (true);
  let data: Array<{ id: string; code: string; expires_at: string }> | null = null;
  try {
    data = await rpc<Array<{ id: string; code: string; expires_at: string }>>("create_payment_code", {
      _amount: numAmount,
      _ttl_seconds: ttl,
      _customer_name: name,
    });
  } catch (err) {
    setCreating(false);
    toast({ title: translateError(err), variant: "destructive" as any });
    return;
  }
  setCreating(false);
  const row = data?.[0];
  if (row) {
    setGenerated ({ ...row, amount: numAmount });
    setAmount ("");
    setCustomerName("");
    await Promise.all([loadAccount(), loadActive()]);
  }
}

async function handleCancel(id: string) {
  try {
    await rpc("cancel_payment_code", { _code_id: id });
  } catch (err) {
    toast({ title: translateError(err), variant: "destructive" as any });
    return;
  }
  toast({ title: t("member.payment.cancelled") });
  if (generated?.id === id) setGenerated(null);
  await Promise.all([loadAccount(), loadActive()]);
}

async function handleCopy(code: string) {
  const ok = await copyToClipboard (code);
  if (ok) {
    toast({ title: t("member.payment.copied") });
  } else {
    toast({ title: t("member.payment.copyFailed"), variant: "destructive" as any });
  }
}

return (
  <MemberLayout>
    <div className="pt-4 sm:pt-6 pb-3 flex items-center gap-3" >
       <Link to="/" className="size-9 rounded-full bg-card border border-border flex items-center justify-center"   aria-label={t("common.back")}>
         <ArrowLeft className="size-4" />
       </Link>
       <div>
         <h1 className="text-lg font-semibold">{t("member.payment.title")}</h1>
         <p className="text-xs text-muted-foreground">{t("member.payment.subtitle")}</p>
       </div>
    </div>

    {/* Available balance */ }
    <div className="mt-2">
       <div className="soft-card rounded-2xl p-4" >
         <div className="text-xs text-muted-foreground">{t("member.payment.balanceCard")}</div>
         <StatValue size="lg" className="text-primary-foreground">{fmtTRY(available)}</StatValue>
       </div>
    </div>

    {/* Generator or generated code */ }
    {!generated || countdown.expired ? (
       <div className="mt-4 space-y-4" >
         {/* K5 — Mandatory name field (Q19). Stored as `customer_name_snapshot`
            on the payment code and compared (case-insensitive, tr-locale) at
            merchant consume-time. Prevents code-share fraud. */}
         <div className="soft-card rounded-2xl p-4 space-y-3" >
           <label className="text-xs font-medium text-muted-foreground">{t("member.payment.customerName", { defaultValue: "İsim Soyisim" })}</label>
           <Input
              type="text"
              autoComplete="name"
              maxLength={80}
              placeholder={t("member.payment.customerNamePlaceholder", { defaultValue: "Kart üzerindeki ad-soyad" })}
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              className="h-11"
           />
         </div>

        {/* Amount input */ }
         <div className="soft-card rounded-2xl p-4 space-y-3" >
           <label className="text-xs font-medium text-muted-foreground">{t("member.payment.amount")}</label>
           <Input
              inputMode="decimal"
              placeholder={t("member.payment.amountPlaceholder")}
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9,.]/g, ""))}
              className="text-xl font-semibold tabular h-12"
           />
           <div className="flex flex-wrap gap-2" >
              {QUICK_AMOUNTS.map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setAmount(String(a))}
                  className="px-3 py-1.5 rounded-full bg-muted text-xs font-medium hover:bg-muted/80"
                >
                  {a} ₺
                </button>
              ))}
           </div>

           {/* Loyalty preview: kazanılacak harcama puanı */}
           {spendPreview && isValidAmount && (
             <div className="mt-3 rounded-xl bg-success/10 border border-success/30 p-3 text-xs">
               <div className="font-medium text-success mb-1">{t("member.payment.loyaltyPreview.title")}</div>
               <div className="flex items-center justify-between">
                 <span>{t("member.payment.loyaltyPreview.spendPts")}{spendPreview.turnover > 0 && ` ${t("member.payment.loyaltyPreview.turnoverBonus", { n: spendPreview.turnover + 1 })}`}</span>
                 <span className="font-semibold tabular-nums">+{spendPreview.spend_points} {t("member.home.pointsSuffix")}</span>
               </div>
               <div className="mt-1 text-[11px] text-muted-foreground">
                 {t("member.payment.loyaltyPreview.cashback")}
               </div>
             </div>
           )}
         </div>

             {/* TTL */}
             <div className="soft-card rounded-2xl p-4 space-y-3" >
                <label className="text-xs font-medium text-muted-foreground">{t("member.payment.validity")}</label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" >
                  {TTL_MIN_OPTIONS.map((min) => {
                    const seconds = min * 60;
                    return (
                      <button
                        key={seconds}
                        type="button"
                        onClick={() => setTtl(seconds)}
                        className={`py-2 rounded-xl text-sm font-medium border transition ${
                          ttl === seconds
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border bg-card text-muted-foreground hover:bg-muted"
                        }`}
                      >
                        {t("member.payment.minutes", { min })}
                      </button>
                    );
                  })}
                </div>
             </div>

             <Button
                className="w-full h-12 text-base"
                disabled={!isValidAmount || creating || numAmount > available}
                onClick={handleGenerate }
             >
                <ScanLine className="mr-2 size-4" />
                {creating ? t("member.payment.creating") : t("member.payment.createCode")}
             </Button>
           </div>
        ) : (
           <div className="mt-4">
             <div className="bank-card rounded-2xl p-6 relative overflow-hidden" >
                <div className="absolute -right-8 -top-8 size-40 rounded-full bg-white/10 blur-2xl" />
                <div className="text-xs uppercase tracking-wider opacity-80 mb-1">{t("member.payment.codeCard.title")}</div>
                <div className="text-4xl font-bold tabular tracking-[0.3em] mb-4 break-all" >
                  {generated.code}
                </div>
                <div className="flex items-center justify-between text-sm" >
                  <div>
                    <div className="opacity-70 text-xs">{t("member.payment.codeCard.amount")}</div>
                    <div className="tabular font-semibold" >{fmtTRY(generated.amount)}</div>
                  </div>
                  <div className="text-right">
                    <div className="opacity-70 text-xs flex items-center gap-1 justify-end" >
                       <Clock className="size-3" /> {t("member.payment.codeCard.timeLeft")}
                    </div>
                    <div className="tabular font-semibold" >{countdown.mmss}</div>
                  </div>
                </div>
                <div className="flex gap-2 mt-5" >
                  <Button variant="secondary" className="flex-1" onClick={() => handleCopy(generated.code)}>
                    <Copy className="mr-2 size-4" /> {t("member.payment.codeCard.copy")}
                  </Button>
                  <Button variant="destructive" className="flex-1" onClick={() => handleCancel(generated.id)}>
                    <X className="mr-2 size-4" /> {t("member.payment.codeCard.cancel")}
                  </Button>
                </div>
             </div>
             <Button variant="ghost" className="w-full mt-3" onClick={() => setGenerated(null)}>
               {t("member.payment.codeCard.newCode")}
             </Button>
           </div>
        )}

        {/* Active codes list */ }
        <div className="mt-6">
           <div className="flex items-center justify-between mb-3" >
             <h2 className="text-sm font-semibold text-foreground">{t("member.payment.activeCodes")}</h2>
             <span className="text-xs text-muted-foreground">{t("member.payment.activeCount", { count: active.length })}</span>
           </div>
           <div className="soft-card rounded-2xl divide-y divide-border overflow-hidden" >
             {active.length === 0 && (
                <div className="p-6 text-center text-sm text-muted-foreground" >
                  {t("member.payment.noActiveCodes")}
                </div>
             )}
             {active.map((c) => (
                <ActiveCodeRow key={c.id} c={c} onCancel={() => handleCancel(c.id)} onCopy={() => handleCopy(c.code)} />
             ))}
           </div>
        </div>

        <div className="h-6" />
      </MemberLayout>
   );
}

function ActiveCodeRow ({ c, onCancel, onCopy }: { c: ActiveCode; onCancel: () => void; onCopy: () => void }) {
   const { t } = useTranslation();
   const cd = useCountdown(c.expires_at);
   // Cashback kapalı; aktif kod satırında sadece rezerve harcama puanı gösterilir.
   const reservedTotal = c.reserved_spend_points ?? 0;
   return (
      <div className="p-4 flex items-center gap-3" >
        <div className="size-9 rounded-full bg-primary/10 flex items-center justify-center" >
          {cd.expired ? <CheckCircle2 className="size-4 text-muted-foreground" /> : <ScanLine className="size-4 text-primary" />}
        </div>
        <div className="flex-1 min-w-0" >
          <div className="font-mono font-semibold tracking-widest text-sm" >{c.code}</div>
          <div className="text-xs text-muted-foreground" >
             {fmtTRY(Number(c.amount))} · {cd.expired ? t("member.payment.activeRow.expired") : t("member.payment.activeRow.remaining", { time: cd.mmss })}
          </div>
          {reservedTotal > 0 && !cd.expired && (
            <div className="text-[10px] text-success mt-0.5">
              {t("member.payment.activeRow.reservedHint", { n: reservedTotal })}
            </div>
          )}
        </div>
        <button onClick={onCopy} className="p-2 hover:bg-muted rounded-lg" aria-label={t("member.payment.activeRow.copyAria")}>
          <Copy className="size-4 text-muted-foreground" />
        </button>
        <button onClick={onCancel} className="p-2 hover:bg-destructive/10 rounded-lg" aria-label={t("member.payment.activeRow.cancelAria")}>
          <X className="size-4 text-destructive" />
        </button>
      </div>
   );
}
