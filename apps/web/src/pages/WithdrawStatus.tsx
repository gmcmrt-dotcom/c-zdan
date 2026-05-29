import MemberLayout from "@/components/MemberLayout";
import { useEffect, useState } from "react";
import { useSearchParams, useNavigate, Link } from "react-router-dom";
import { rpc } from "@/lib/rpc";
import { Button } from "@/components/ui/button";
import { fmtTRY } from "@/lib/format";
import { CheckCircle2, XCircle, Clock, ArrowLeft, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { TxIdBadge } from "@/components/TxIdBadge";

type Session = {
  session_id: string;
  public_no: string | null;
  status: "pending" | "sent_to_merchant" | "success" | "failed" | "timeout" | "expired" | "cancelled";
  amount: number;
  method_type: string;
  finalized_at: string | null;
  failure_reason: string | null;
  expires_at: string;
};

const TYPE_KEYS: Record<string, string> = {
  havale: "havale",
  card:   "card",
  crypto: "crypto",
};

export default function WithdrawStatus() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const ref = params.get("ref");
  const nav = useNavigate();
  const [s, setS] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStatus = async () => {
    if (!ref) return;
    const data = await rpc<Session[]>("get_withdraw_session_status", { _session_id: ref }).catch(() => null);
    const row = data?.[0] ?? null;
    setS(row);
    setLoading(false);
  };

  useEffect(() => { fetchStatus(); }, [ref]);

  useEffect(() => {
    if (!s) return;
    if (["success","failed","expired","cancelled","timeout"].includes(s.status)) return;
    const t = setInterval(fetchStatus, 3000);
    return () => clearInterval(t);
  }, [s?.status, ref]);

  if (!ref) {
    return <MemberLayout><div className="py-12 text-center text-muted-foreground">{t("member.withdrawStatus.invalidRef")}</div></MemberLayout>;
  }
  if (loading || !s) {
    return (
      <MemberLayout>
        <div className="py-12 flex flex-col items-center gap-3">
          <Loader2 className="size-10 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">{t("member.withdrawStatus.loading")}</p>
        </div>
      </MemberLayout>
    );
  }

  const typeLabel = TYPE_KEYS[s.method_type] ? t(`member.withdraw.methodTypes.${TYPE_KEYS[s.method_type]}`) : s.method_type;
  const Header = () => (
    <div className="pt-4 sm:pt-6 pb-3 flex items-center gap-3">
      <Link to="/" className="size-9 rounded-full bg-muted flex items-center justify-center">
        <ArrowLeft className="size-4" />
      </Link>
      <div>
        <h1 className="text-xl font-bold">{t("member.withdrawStatus.title")}</h1>
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
          <h2 className="text-2xl font-bold">{t("member.withdrawStatus.successTitle")}</h2>
          <p className="text-muted-foreground">{fmtTRY(s.amount)} · {typeLabel}</p>
          <Button className="w-full mt-4" onClick={() => nav("/")}>{t("member.withdrawStatus.homeButton")}</Button>
        </div>
      </MemberLayout>
    );
  }

  if (["failed","cancelled","expired","timeout"].includes(s.status)) {
    return (
      <MemberLayout>
        <Header />
        <div className="px-5 pt-6 flex flex-col items-center text-center gap-4">
          <div className="size-20 rounded-full bg-destructive/10 flex items-center justify-center">
            <XCircle className="size-12 text-destructive" />
          </div>
          <h2 className="text-2xl font-bold">
            {t(
              s.status === "expired" ? "member.withdrawStatus.expiredTitle" :
              s.status === "timeout" ? "member.withdrawStatus.timeoutTitle" :
              s.status === "cancelled" ? "member.withdrawStatus.cancelledTitle" :
              "member.withdrawStatus.failedTitle"
            )}
          </h2>
          <p className="text-muted-foreground">{fmtTRY(s.amount)} · {typeLabel}</p>
          {s.failure_reason && (
            <p className="text-xs text-muted-foreground bg-muted px-3 py-2 rounded-md">{s.failure_reason}</p>
          )}
          <p className="text-xs text-success">{t("member.withdrawStatus.autoRefund")}</p>
          <div className="flex gap-3 w-full mt-4">
            <Button variant="outline" className="flex-1" onClick={() => nav("/withdraw")}>{t("member.withdrawStatus.tryAgain")}</Button>
            <Button className="flex-1" onClick={() => nav("/")}>{t("member.withdrawStatus.homeButton")}</Button>
          </div>
        </div>
      </MemberLayout>
    );
  }

  return (
    <MemberLayout>
      <Header />
      <div className="px-5 pt-6 flex flex-col items-center text-center gap-4">
        <div className="size-20 rounded-full bg-primary/10 flex items-center justify-center">
          <Loader2 className="size-12 text-primary animate-spin" />
        </div>
        <h2 className="text-2xl font-bold">{t("member.withdrawStatus.providerProcessing")}</h2>
        <p className="text-muted-foreground">{fmtTRY(s.amount)} · {typeLabel}</p>
        <div className="soft-card rounded-2xl p-4 w-full text-xs text-muted-foreground space-y-1">
          <p>
            {t("member.withdrawStatus.noteReservedPrefix")}
            <strong>{t("member.withdrawStatus.noteReservedEmphasis")}</strong>
            {t("member.withdrawStatus.noteReservedSuffix")}
          </p>
          <p>{t("member.withdrawStatus.noteAutoDeduct")}</p>
          <p>{t("member.withdrawStatus.noteAutoReturn")}</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Clock className="size-4" />
          <span>{t("member.withdrawStatus.providerTime")}</span>
        </div>
        <Button variant="ghost" onClick={fetchStatus}>{t("member.withdrawStatus.refresh")}</Button>
      </div>
    </MemberLayout>
  );
}
