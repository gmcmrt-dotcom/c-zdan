// "Cüzdan Döngüsü" loyalty
// Yeni metrikler: streak gün, aylık spend sayısı, lifetime turnover,
// puan çarpanı, cooldown durumu. Cashback şimdilik kapalı.

import { useEffect, useState } from "react";
import { rpc } from "@/lib/rpc";
import { dbSelect } from "@/lib/db";
import { useAuth } from "@/hooks/useAuth";
import MemberLayout from "@/components/MemberLayout";
import { StatValue } from "@/components/ui/stat-card";
import { memberCardPadLg, memberGrid2 } from "@/lib/member-layout";
import { cn } from "@/lib/utils";
import { Star, Flame, ShoppingBag, TrendingUp, AlertTriangle } from "lucide-react";
import { LoyaltyTierList } from "@/components/loyalty/LoyaltyTierList";
import { fmtNumber, fmtTRY, pointReasonLabel } from "@/lib/format";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { useTranslation } from "react-i18next";

type LoyaltySummary = {
  user_id: string;
  balance: number;
  total_points: number;
  current_tier_id: number;
  tier_name: string;
  point_multiplier: number;
  cashback_pct: number;
  tier_min_points: number;
  tier_min_turnover: number;
  next_tier_id: number | null;
  next_tier_name: string | null;
  next_tier_min_points: number | null;
  next_tier_min_turnover: number | null;
  streak_days: number;
  monthly_spend_count: number;
  lifetime_turnover: number;
  in_cooldown: boolean;
  cooldown_until: string | null;
  cooldown_reason: string | null;
};

export default function Loyalty() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const [summary, setSummary] = useState<LoyaltySummary | null>(null);
  const [tiers, setTiers] = useState<any[]>([]);
  const [points, setPoints] = useState<any[]>([]);
  useEffect(() => {
    if (!user) return;
    (async () => {
      const [ls, ts, pl] = await Promise.all([
        rpc<LoyaltySummary[]>("my_loyalty_summary").catch(() => [] as LoyaltySummary[]),
        dbSelect<any>("loyalty_tiers", {
          cols: "id, level_name, display_name, min_points, min_turnover, point_multiplier, cashback_pct, sort_order, is_archived",
          where: { is_archived: false },
          order: { col: "sort_order", asc: true },
        }).catch(() => [] as any[]),
        dbSelect<any>("loyalty_points_log", {
          where: { user_id: user.id },
          order: { col: "created_at", asc: false },
          limit: 20,
        }).catch(() => [] as any[]),
      ]);
      const row = ls?.[0] ?? null;
      setSummary(row);
      setTiers(ts);
      setPoints(pl);
    })();
  }, [user]);

  if (!summary) {
    return (
      <MemberLayout>
        <div className="px-5 pt-6">
          <div className="h-32 bg-muted/40 animate-pulse rounded-2xl" />
        </div>
      </MemberLayout>
    );
  }

  const total = summary.total_points;
  const turnover = Number(summary.lifetime_turnover);

  // Sıradaki tier için progress (hem puan hem turnover'ın kendi yüzdesi, en küçüğü göster)
  const nextPts = summary.next_tier_min_points ?? 0;
  const nextTurnover = Number(summary.next_tier_min_turnover ?? 0);
  const ptsProgress = nextPts > summary.tier_min_points
    ? Math.min(100, ((total - summary.tier_min_points) / (nextPts - summary.tier_min_points)) * 100)
    : 100;
  const turnoverProgress = nextTurnover > summary.tier_min_turnover
    ? Math.min(100, ((turnover - summary.tier_min_turnover) / (nextTurnover - summary.tier_min_turnover)) * 100)
    : 100;
  const overallProgress = Math.min(ptsProgress, turnoverProgress);

  const ptsRemaining = Math.max(0, nextPts - total);
  const turnoverRemaining = Math.max(0, nextTurnover - turnover);

  const effectiveMul = summary.in_cooldown
    ? Number(summary.point_multiplier) * 0.5
    : Number(summary.point_multiplier);

  return (
    <MemberLayout>
      <div className="pt-4 sm:pt-6 pb-3">
        <h1 className="text-2xl font-bold">{t("member.loyalty.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("member.loyalty.subtitle")}</p>
      </div>

      {/* Cooldown banner */}
      {summary.in_cooldown && (
        <div className="pb-2">
          <div className="rounded-xl bg-warning/10 border border-warning/30 p-3 flex items-start gap-2">
            <AlertTriangle className="size-4 text-warning mt-0.5 shrink-0" />
            <div className="text-xs">
              <div className="font-medium">{t("member.loyalty.cooldownTitle")}</div>
              <div className="text-muted-foreground mt-0.5">
                {t("member.loyalty.cooldownBody")}
              </div>
            </div>
          </div>
        </div>
      )}

      <div>
        <div className={cn("bank-card rounded-2xl animate-fade-in", memberCardPadLg)}>
          <div className="flex items-center gap-2 mb-2 opacity-90">
            <Star className="size-5 fill-current" />
            <span className="text-sm font-medium">{summary.tier_name ?? "—"}</span>
          </div>
          <div className="mb-1 flex flex-wrap items-baseline gap-x-2 gap-y-0 min-w-0">
            <StatValue size="hero" className="text-primary-foreground inline">
              {fmtNumber(total)}
            </StatValue>
            <span className="text-sm sm:text-base font-medium opacity-80 shrink-0">{t("member.loyalty.pointsSuffix")}</span>
          </div>
          <div className="text-xs opacity-80 mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>×{effectiveMul.toFixed(2)} {t("member.loyalty.multiplierSuffix")}</span>
            {summary.in_cooldown && <><span>·</span><span className="text-warning-foreground">⚠ %50 cooldown</span></>}
          </div>
          {summary.next_tier_name && (
            <>
              <div className="h-2 bg-white/20 rounded-full overflow-hidden mb-2">
                <div className="h-full bg-white rounded-full transition-all" style={{ width: `${overallProgress}%` }} />
              </div>
              <div className="text-xs opacity-90">
                <strong>{summary.next_tier_name}</strong>{" "}
                {t("member.loyalty.requires")}: {ptsRemaining > 0 && <span>{fmtNumber(ptsRemaining)} {t("member.loyalty.morePoints")}</span>}
                {ptsRemaining > 0 && turnoverRemaining > 0 && " · "}
                {turnoverRemaining > 0 && <span>{fmtTRY(turnoverRemaining)} {t("member.loyalty.moreTurnover")}</span>}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Aktif metrikler — streak / monthly spend / lifetime turnover */}
      <div className={cn("mt-4", memberGrid2)}>
        <div className="soft-card rounded-2xl p-3 flex items-center gap-3">
          <div className="size-10 rounded-full bg-warning/10 flex items-center justify-center">
            <Flame className="size-5 text-warning" />
          </div>
          <div>
            <div className="text-[10px] uppercase text-muted-foreground tracking-wide">{t("member.loyalty.streakLabel")}</div>
            <StatValue size="lg">{summary.streak_days}<span className="text-xs font-normal text-muted-foreground"> {t("member.loyalty.days")}</span></StatValue>
          </div>
        </div>
        <div className="soft-card rounded-2xl p-3 flex items-center gap-3">
          <div className="size-10 rounded-full bg-primary/10 flex items-center justify-center">
            <ShoppingBag className="size-5 text-primary" />
          </div>
          <div>
            <div className="text-[10px] uppercase text-muted-foreground tracking-wide">{t("member.loyalty.monthlySpend")}</div>
            <StatValue size="lg">{summary.monthly_spend_count}</StatValue>
          </div>
        </div>
        <div className="soft-card rounded-2xl p-3 col-span-2 flex items-center gap-3">
          <div className="size-10 rounded-full bg-success/10 flex items-center justify-center">
            <TrendingUp className="size-5 text-success" />
          </div>
          <div>
            <div className="text-[10px] uppercase text-muted-foreground tracking-wide">{t("member.loyalty.lifetimeTurnover")}</div>
            <StatValue size="lg">{fmtTRY(turnover)}</StatValue>
          </div>
        </div>
      </div>

      {/* Puan geçmişi */}
      <div className="mt-4">
        <h2 className="text-sm font-semibold mb-3">{t("member.loyalty.pointsHistory")}</h2>
        <div className="soft-card rounded-2xl divide-y divide-border overflow-hidden">
          {points.length === 0 && <div className="p-6 text-center text-sm text-muted-foreground">{t("member.loyalty.noPoints")}</div>}
          {points.map((p) => (
            <div key={p.id} className="flex items-center gap-3 p-4">
              <div className="flex-1">
                <div className="text-sm font-medium">{pointReasonLabel(p.reason)}</div>
                <div className="text-xs text-muted-foreground">{new Date(p.created_at).toLocaleDateString(i18n.language?.startsWith("en") ? "en-US" : "tr-TR")}</div>
              </div>
              <div className={`text-sm font-semibold tabular ${p.points >= 0 ? "text-success" : "text-destructive"}`}>
                {p.points >= 0 ? "+" : ""}{fmtNumber(p.points)}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Nasıl puan kazanırım? */}
      <div className="mt-6">
        <div className="soft-card rounded-2xl overflow-hidden">
          <Accordion type="single" collapsible>
            <AccordionItem value="how" className="border-b-0">
              <AccordionTrigger className="px-4 hover:no-underline">
                <span className="text-sm font-semibold">{t("member.loyalty.howToTitle")}</span>
              </AccordionTrigger>
              <AccordionContent className="px-4">
                <div className="space-y-2 text-sm">
                  <div className="flex items-start gap-3 py-2 border-b border-border/50">
                    <span className="text-lg">🛒</span>
                    <div>
                      <div className="font-medium">{t("member.loyalty.howToSpend")}</div>
                      <div className="text-xs text-muted-foreground">{t("member.loyalty.howToSpendDesc")}</div>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 py-2 border-b border-border/50">
                    <span className="text-lg">🔥</span>
                    <div>
                      <div className="font-medium">{t("member.loyalty.howToStreak")}</div>
                      <div className="text-xs text-muted-foreground">{t("member.loyalty.howToStreakDesc")}</div>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 py-2 border-b border-border/50">
                    <span className="text-lg">💵</span>
                    <div>
                      <div className="font-medium">{t("member.loyalty.howToCashback")}</div>
                      <div className="text-xs text-muted-foreground">{t("member.loyalty.howToCashbackDesc")}</div>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 py-2">
                    <span className="text-lg">⭐</span>
                    <div>
                      <div className="font-medium">{t("member.loyalty.howToTier")}</div>
                      <div className="text-xs text-muted-foreground">{t("member.loyalty.howToTierDesc")}</div>
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground pt-2 border-t border-border/50 mt-2">
                    {t("member.loyalty.howToFee")}
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      </div>

      {/* Tüm tier'lar */}
      <div className="mt-6">
        <h2 className="text-sm font-semibold mb-3">{t("member.loyalty.allTiers")}</h2>
        <LoyaltyTierList tiers={tiers} currentTierId={summary.current_tier_id} />
      </div>

      <div className="h-6" />
    </MemberLayout>
  );
}
