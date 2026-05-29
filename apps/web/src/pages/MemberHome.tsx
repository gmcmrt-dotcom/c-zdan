import type { ProfitShareReward } from "@wallet/shared/dto/member";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { rpc } from "@/lib/rpc";
import { dbSelectMaybeOne } from "@/lib/db";
import { useAuth } from "@/hooks/useAuth";
import MemberLayout from "@/components/MemberLayout";
import { fmtTRY, fmtRelative, txTypeLabel } from "@/lib/format";
import {
  ArrowDownLeft, ArrowUpRight, Plus, Star, Sparkles, ScanLine, Minus,
  Clock, ChevronRight, ShieldCheck, History, Gift,
} from "lucide-react";
import { CopyButton } from "@/components/CopyButton";
import { cn } from "@/lib/utils";
import { TxIdBadge } from "@/components/TxIdBadge";
import { fetchPointsForTxs } from "@/lib/points";
import { memberCardPadLg, memberGrid2 } from "@/lib/member-layout";
import { StatValue } from "@/components/ui/stat-card";

export default function MemberHome() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [profile, setProfile] = useState<{ first_name: string; last_name: string; member_no: string } | null>(null);
  const [account, setAccount] = useState<{ balance: number; reserved_balance: number; total_points: number; current_tier_id: number | null } | null>(null);
  const [tier, setTier] = useState<{ display_name: string; commission_discount_pct: number } | null>(null);
  const [recent, setRecent] = useState<Array<{ id: string; type: string; amount: number; created_at: string; public_no: string | null }>>([]);
  const [pointsMap, setPointsMap] = useState<Map<string, number>>(new Map());
  const [pendingTopup, setPendingTopup] = useState<{ session_id: string; status: string; amount: number; expires_at: string } | null>(null);
  const [pendingProfitShare, setPendingProfitShare] = useState<Pick<ProfitShareReward, "id" | "allocatedAmount" | "campaign"> | null>(null);
  const [, setTick] = useState(0);
  const devMockEnabled = import.meta.env.VITE_DEV_MOCK_MERCHANT === "true";

  useEffect(() => {
    if (!user) return;
    (async () => {
      const [pr, ac, tx] = await Promise.all([
        dbSelectMaybeOne<{ first_name: string; last_name: string; member_no: string }>("profiles", {
          cols: "first_name, last_name, member_no",
          where: { id: user.id },
        }).catch(() => null),
        dbSelectMaybeOne<{ balance: number; reserved_balance: number; total_points: number; current_tier_id: number | null }>("accounts", {
          cols: "balance, reserved_balance, total_points, current_tier_id",
          where: { user_id: user.id },
        }).catch(() => null),
        rpc<Array<{ id: string; type: string; amount: number; created_at: string; public_no: string | null }>>("my_transactions", { _limit: 5 }).catch(() => []),
      ]);
      setProfile(pr);
      setAccount(ac as any);
      const list = tx ?? [];
      setRecent(list);
      if (ac?.current_tier_id) {
        const tr2 = await dbSelectMaybeOne<{ display_name: string; commission_discount_pct: number }>("loyalty_tiers", {
          cols: "display_name, commission_discount_pct",
          where: { id: ac.current_tier_id },
        }).catch(() => null);
        setTier(tr2 as any);
      }
      const pm = await fetchPointsForTxs(list);
      setPointsMap(pm);

      const pt = await rpc<Array<{ session_id: string; status: string; amount: number; expires_at: string }>>("get_pending_topup").catch(() => []);
      const row = pt?.[0];
      setPendingTopup(row ?? null);

      const rewards = await rpc<ProfitShareReward[]>("my_profit_share_rewards").catch(() => []);
      const pendingReward = (rewards ?? []).find((r) => r.status === "pending");
      setPendingProfitShare(pendingReward ? {
        id: pendingReward.id,
        allocatedAmount: Number(pendingReward.allocatedAmount),
        campaign: pendingReward.campaign,
      } : null);
    })();
  }, [user]);

  // Pending banner kalan süreyi 30 sn'de bir refresh
  useEffect(() => {
    if (!pendingTopup) return;
    const t = setInterval(() => setTick((x) => x + 1), 30000);
    return () => clearInterval(t);
  }, [pendingTopup]);

  const available = (account?.balance ?? 0) - (account?.reserved_balance ?? 0);
  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return t("member.home.greetingMorning");
    if (h < 18) return t("member.home.greetingDay");
    return t("member.home.greetingEvening");
  })();

  return (
    <MemberLayout>
      {/* Header */}
      <div className="pt-2 pb-3 flex items-center justify-between gap-2 min-w-0">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{greeting},</p>
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-foreground">
              {profile?.first_name ?? ""} {profile?.last_name ?? ""}
            </p>
            {tier?.display_name && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[11px] font-medium">
                <Star className="size-3 fill-current" />
                {tier.display_name}
              </span>
            )}
          </div>
          {profile?.member_no && (
            <div className="flex items-center gap-1 mt-0.5">
              <span className="text-[11px] text-muted-foreground tabular">
                {t("member.home.memberNoLabel")} {profile.member_no}
              </span>
              <CopyButton value={profile.member_no} label={t("member.home.copyMemberNoAria")} />
            </div>
          )}
        </div>
      </div>

      {/* Bank card */}
      <div>
        <div className={cn("bank-card rounded-2xl animate-fade-in relative overflow-hidden", memberCardPadLg)}>
          <div className="absolute -right-8 -top-8 size-40 rounded-full bg-white/10 blur-2xl" />
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs uppercase tracking-wider opacity-80">
              {t("member.home.availableBalance")}
            </span>
            <Sparkles className="size-4 opacity-80" />
          </div>
          <StatValue size="hero" className="mb-3 text-primary-foreground">{fmtTRY(available)}</StatValue>
          <div className="grid grid-cols-3 gap-2 sm:gap-3 text-[10px] sm:text-xs opacity-90">
            <div>
              <div className="opacity-70">{t("member.home.totalLabel")}</div>
              <StatValue size="sm" className="text-primary-foreground opacity-90">{fmtTRY(account?.balance ?? 0)}</StatValue>
            </div>
            <div>
              <div className="opacity-70">{t("member.home.reservedLabel")}</div>
              <StatValue size="sm" className="text-primary-foreground opacity-90">{fmtTRY(account?.reserved_balance ?? 0)}</StatValue>
            </div>
            <div className="text-right">
              <div className="opacity-70">{t("member.home.loyaltyLabel")}</div>
              <div className="font-medium flex items-center gap-1 justify-end">
                <Star className="size-3 fill-current" /> {tier?.display_name ?? "-"}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Pending topup banner */}
      {pendingTopup && (
        <div className="mt-4">
          <Link
            to="/topup"
            className="flex items-center gap-3 rounded-2xl bg-warning/10 border border-warning/40 p-4 active:scale-[0.98] transition-transform"
          >
            <div className="size-10 rounded-full bg-warning/20 flex items-center justify-center shrink-0">
              <Clock className="size-5 text-warning-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold">
                {pendingTopup.status === "member_confirmed"
                  ? t("member.home.pendingTopupConfirming")
                  : t("member.home.pendingTopupAwaiting")}
              </div>
              <div className="text-xs text-muted-foreground tabular-nums">
                {fmtTRY(pendingTopup.amount)} ·{" "}
                {(() => {
                  const ms = new Date(pendingTopup.expires_at).getTime() - Date.now();
                  const min = Math.max(0, Math.ceil(ms / 60000));
                  return min > 0 ? t("member.home.minLeft", { min }) : t("member.home.expiringSoon");
                })()}
              </div>
            </div>
            <ChevronRight className="size-4 text-muted-foreground shrink-0" />
          </Link>
          {devMockEnabled && (
            <Link
              to={`/mock-pay?ref=${pendingTopup.session_id}&amount=${pendingTopup.amount}&return=/`}
              className="mt-2 block text-center text-[11px] text-muted-foreground underline"
            >
              {t("member.home.devMockSimulate")}
            </Link>
          )}
        </div>
      )}

      {/* Pending profit share banner */}
      {pendingProfitShare && (
        <div className="mt-4">
          <Link
            to="/profit-share"
            className="flex items-center gap-3 rounded-2xl bg-success/10 border border-success/30 p-4 active:scale-[0.98] transition-transform"
          >
            <div className="size-10 rounded-full bg-success/15 flex items-center justify-center shrink-0">
              <Gift className="size-5 text-success" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold">{t("member.home.pendingProfitShareTitle")}</div>
              <div className="text-xs text-muted-foreground tabular-nums">
                +{fmtTRY(pendingProfitShare.allocatedAmount)} · {t("member.home.pendingProfitShareCta")}
              </div>
            </div>
            <ChevronRight className="size-4 text-muted-foreground shrink-0" />
          </Link>
        </div>
      )}

      {/* Primary actions */}
      <div className="mt-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-foreground">{t("member.home.primaryQuestion")}</h2>
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <ShieldCheck className="size-3.5 text-success" />
            {t("member.home.secureHint")}
          </span>
        </div>
        <div className={memberGrid2}>
          <Link
            to="/topup"
            className="rounded-2xl p-4 bg-primary text-primary-foreground shadow-lg shadow-primary/20 active:scale-[0.98] transition-transform"
          >
            <div className="size-10 rounded-xl bg-white/15 flex items-center justify-center mb-4">
              <Plus className="size-5" />
            </div>
            <div className="font-semibold">{t("member.home.topupAction")}</div>
            <div className="text-[11px] opacity-80 mt-1 leading-snug">{t("member.home.topupActionHint")}</div>
          </Link>
          <Link
            to="/withdraw"
            className="rounded-2xl p-4 bg-card border border-border shadow-sm active:scale-[0.98] transition-transform"
          >
            <div className="size-10 rounded-xl bg-destructive/10 flex items-center justify-center mb-4">
              <Minus className="size-5 text-destructive" />
            </div>
            <div className="font-semibold">{t("member.home.withdrawAction")}</div>
            <div className="text-[11px] text-muted-foreground mt-1 leading-snug">{t("member.home.withdrawActionHint")}</div>
          </Link>
        </div>
        <div className={cn(memberGrid2, "mt-3")}>
          <Link to="/payment" className="soft-card rounded-2xl p-3 flex items-center gap-3 active:scale-[0.98] transition-transform">
            <div className="size-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <ScanLine className="size-5 text-primary" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-medium">{t("member.home.paymentAction")}</div>
              <div className="text-[11px] text-muted-foreground truncate">{t("member.home.paymentActionHint")}</div>
            </div>
          </Link>
          <Link to="/transactions" className="soft-card rounded-2xl p-3 flex items-center gap-3 active:scale-[0.98] transition-transform">
            <div className="size-10 rounded-xl bg-muted flex items-center justify-center">
              <History className="size-5 text-muted-foreground" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-medium">{t("member.home.transactionsAction")}</div>
              <div className="text-[11px] text-muted-foreground truncate">{t("member.home.transactionsActionHint")}</div>
            </div>
          </Link>
        </div>
      </div>

      {/* Recent transactions */}
      <div className="mt-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-foreground">
            {t("member.home.lastTransactions")}
          </h2>
          <Link to="/transactions" className="text-xs text-primary font-medium">
            {t("member.home.viewAll")}
          </Link>
        </div>
        <div className="soft-card rounded-2xl divide-y divide-border overflow-hidden">
          {recent.length === 0 && (
            <div className="p-6 text-center text-sm text-muted-foreground">
              {t("member.home.emptyTransactions")}{" "}
              <Link to="/topup" className="text-primary font-medium">
                {t("member.home.emptyCta")}
              </Link>{" "}
              {t("member.home.emptyCtaSuffix")}
            </div>
          )}
          {recent.map((tx) => {
            const inflow = tx.type === "topup" || tx.type === "refund" || tx.type === "bonus" || tx.type === "merchant_deposit" || tx.type === "merchant_credit" || tx.type === "referral_bonus" || tx.type === "affiliate_payout" || tx.type === "profit_share";
            return (
              <div key={tx.id} className="flex items-center gap-3 p-4">
                <div className={`size-9 rounded-full flex items-center justify-center ${inflow ? "bg-success/10" : "bg-destructive/10"}`}>
                  {inflow ? <ArrowDownLeft className="size-4 text-success" /> : <ArrowUpRight className="size-4 text-destructive" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{txTypeLabel(tx.type)}</div>
                  <div className="text-xs text-muted-foreground">{fmtRelative(tx.created_at)}</div>
                  {tx.public_no && (
                    <TxIdBadge publicNo={tx.public_no} className="mt-0.5" />
                  )}
                </div>
                <div className="text-right">
                  <div className={`text-sm font-semibold tabular ${inflow ? "text-success" : "text-destructive"}`}>
                    {inflow ? "+" : "-"}{fmtTRY(Math.abs(Number(tx.amount)))}
                  </div>
                  {pointsMap.get(tx.id) !== undefined && pointsMap.get(tx.id) !== 0 && (
                    <div className={`text-[10px] tabular ${(pointsMap.get(tx.id) ?? 0) > 0 ? "text-success" : "text-destructive"}`}>
                      {(pointsMap.get(tx.id) ?? 0) > 0 ? "+" : "-"}
                      {Math.abs(pointsMap.get(tx.id) ?? 0)} {t("member.home.pointsSuffix")}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="h-6" />
    </MemberLayout>
  );
}
