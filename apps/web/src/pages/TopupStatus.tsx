import MemberLayout from "@/components/MemberLayout";
import { useEffect, useState } from "react";
import { useSearchParams, useNavigate, Link } from "react-router-dom";
import { rpc } from "@/lib/rpc";
import { Button } from "@/components/ui/button";
import { fmtTRY } from "@/lib/format";
import { CheckCircle2, XCircle, Clock, ArrowLeft, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { TxIdBadge } from "@/components/TxIdBadge";

// Audit 3.3 — ortak DTO src/types/topup.ts'ten
import type { TopupSessionFull } from "@/types/topup";
import { PENDING_STATES } from "@/types/topup";
type Session = TopupSessionFull;

const TYPE_KEYS: Record<string, string> = {
  havale: "havale",
  card:   "card",
  crypto: "crypto",
};

export default function TopupStatus() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const ref = params.get("ref");
  const nav = useNavigate();
  const [s, setS] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStatus = async () => {
    if (!ref) return;
    const data = await rpc<Session[]>("get_topup_session_status", { _session_id: ref }).catch(() => null);
    const row = data?.[0] ?? null;
    setS(row);
    setLoading(false);
  };

  useEffect(() => { fetchStatus(); }, [ref]);

  // Polling — Audit 9.1 fix: backoff + visibility-aware (5/10/20sn)
  useEffect(() => {
    if (!s) return;
    if (!(PENDING_STATES as readonly string[]).includes(s.status)) return;
    let cancelled = false;
    const startedAt = Date.now();
    const tick = async () => {
      if (cancelled) return;
      if (typeof document !== "undefined" && document.hidden) return scheduleNext();
      await fetchStatus();
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
  }, [s?.status, ref]);

  if (!ref) {
    return (
      <MemberLayout>
        <div className="py-12 text-center text-muted-foreground">{t("member.topupStatus.invalidRef")}</div>
      </MemberLayout>
    );
  }

  if (loading || !s) {
    return (
      <MemberLayout>
        <div className="py-12 flex flex-col items-center gap-3">
          <Loader2 className="size-10 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">{t("member.topupStatus.loading")}</p>
        </div>
      </MemberLayout>
    );
  }

  const typeLabel = TYPE_KEYS[s.method_type] ? t(`member.withdraw.methodTypes.${TYPE_KEYS[s.method_type]}`) : s.method_type;
  const elapsedMs = Date.now() - new Date(s.expires_at).getTime();
  const timeLeftSec = Math.max(0, -Math.floor(elapsedMs / 1000));

  const Header = () => (
    <div className="pt-4 sm:pt-6 pb-3 flex items-center gap-3">
      <Link to="/" className="size-9 rounded-full bg-muted flex items-center justify-center">
        <ArrowLeft className="size-4" />
      </Link>
      <div>
        <h1 className="text-xl font-bold">{t("member.topupStatus.title")}</h1>
        {s?.public_no ? (
          <TxIdBadge publicNo={s.public_no} className="mt-0.5" />
        ) : (
          <p className="text-xs text-muted-foreground font-mono">{ref.slice(0, 8)}…</p>
        )}
      </div>
    </div>
  );

  if (s.status === "success") {
    return (
      <MemberLayout>
        <Header />
        <div className="px-5 pt-6 flex flex-col items-center text-center gap-4">
          <div className="size-20 rounded-full bg-success/10 flex items-center justify-center">
            <CheckCircle2 className="size-12 text-success" />
          </div>
          <h2 className="text-2xl font-bold">{t("member.topupStatus.successTitle")}</h2>
          <p className="text-muted-foreground">{t("member.topupStatus.successBody", { amount: fmtTRY(s.amount) })}</p>
          <Button className="w-full mt-4" onClick={() => nav("/")}>{t("member.topupStatus.homeButton")}</Button>
        </div>
      </MemberLayout>
    );
  }

  if (s.status === "failed" || s.status === "cancelled" || s.status === "expired") {
    return (
      <MemberLayout>
        <Header />
        <div className="px-5 pt-6 flex flex-col items-center text-center gap-4">
          <div className="size-20 rounded-full bg-destructive/10 flex items-center justify-center">
            <XCircle className="size-12 text-destructive" />
          </div>
          <h2 className="text-2xl font-bold">
            {t(s.status === "expired" ? "member.topupStatus.expiredTitle" : s.status === "cancelled" ? "member.topupStatus.cancelledTitle" : "member.topupStatus.failedTitle")}
          </h2>
          <p className="text-muted-foreground">{fmtTRY(s.amount)} · {typeLabel}</p>
          <div className="flex gap-3 w-full mt-4">
            <Button variant="outline" className="flex-1" onClick={() => nav("/topup")}>{t("member.topupStatus.tryAgain")}</Button>
            <Button className="flex-1" onClick={() => nav("/")}>{t("member.topupStatus.homeButton")}</Button>
          </div>
        </div>
      </MemberLayout>
    );
  }

  // pending / awaiting_member_action / member_confirmed / redirected
    return (
    <MemberLayout>
      <Header />
      <div className="px-5 pt-6 flex flex-col items-center text-center gap-4">
        <div className="size-20 rounded-full bg-primary/10 flex items-center justify-center">
          <Loader2 className="size-12 text-primary animate-spin" />
        </div>
        <h2 className="text-2xl font-bold">{t(
          s.status === "pending" ? "member.topupStatus.headlines.pending" :
          s.status === "awaiting_member_action" ? "member.topupStatus.headlines.awaitingMember" :
          s.status === "member_confirmed" ? "member.topupStatus.headlines.memberConfirmed" :
          s.status === "redirected" ? "member.topupStatus.headlines.redirected" :
          "member.topupStatus.headlines.default"
        )}</h2>
        <p className="text-muted-foreground">{fmtTRY(s.amount)} · {typeLabel}</p>

        {s.status === "awaiting_member_action" && (
          <Button onClick={() => nav("/topup")}>{t("member.topupStatus.openDetails")}</Button>
        )}

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Clock className="size-4" />
          <span>{timeLeftSec > 0 ? t("member.topupStatus.timeLeft", { m: Math.floor(timeLeftSec / 60), s: String(timeLeftSec % 60).padStart(2, "0") }) : t("member.topupStatus.expiringSoon")}</span>
        </div>

        <p className="text-[11px] text-muted-foreground max-w-xs">
          {t("member.topupStatus.autoUpdate")}
        </p>

        <Button variant="ghost" className="mt-2" onClick={() => fetchStatus()}>{t("member.topupStatus.refresh")}</Button>
      </div>
    </MemberLayout>
  );
}
