import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, Coins, Star, TrendingUp, Wallet, Zap } from "lucide-react";
import { fmtNumber, fmtTRY } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

export type LoyaltyTierRow = {
  id: number;
  level_name: string;
  display_name: string;
  min_points: number;
  min_turnover: number;
  point_multiplier: number;
  sort_order: number;
};

type TierFamilyKey = "rookie" | "silver" | "gold" | "platinum" | "diamond" | "elite";

const FAMILY_ORDER: TierFamilyKey[] = ["rookie", "silver", "gold", "platinum", "diamond", "elite"];

const FAMILY_STYLE: Record<
  TierFamilyKey,
  { header: string; block: string; chip: string; icon: string }
> = {
  rookie: {
    header: "bg-slate-500/10 text-slate-700 dark:text-slate-200 border-slate-500/20",
    block: "border-slate-500/15 bg-slate-500/[0.03]",
    chip: "bg-slate-500/10 text-slate-700 dark:text-slate-200",
    icon: "text-slate-500",
  },
  silver: {
    header: "bg-zinc-400/15 text-zinc-700 dark:text-zinc-200 border-zinc-400/25",
    block: "border-zinc-400/20 bg-zinc-400/[0.04]",
    chip: "bg-zinc-400/15 text-zinc-700 dark:text-zinc-200",
    icon: "text-zinc-500",
  },
  gold: {
    header: "bg-amber-500/15 text-amber-800 dark:text-amber-200 border-amber-500/25",
    block: "border-amber-500/20 bg-amber-500/[0.04]",
    chip: "bg-amber-500/15 text-amber-800 dark:text-amber-200",
    icon: "text-amber-600",
  },
  platinum: {
    header: "bg-sky-500/15 text-sky-800 dark:text-sky-200 border-sky-500/25",
    block: "border-sky-500/20 bg-sky-500/[0.04]",
    chip: "bg-sky-500/15 text-sky-800 dark:text-sky-200",
    icon: "text-sky-600",
  },
  diamond: {
    header: "bg-violet-500/15 text-violet-800 dark:text-violet-200 border-violet-500/25",
    block: "border-violet-500/20 bg-violet-500/[0.04]",
    chip: "bg-violet-500/15 text-violet-800 dark:text-violet-200",
    icon: "text-violet-600",
  },
  elite: {
    header: "bg-rose-500/15 text-rose-800 dark:text-rose-200 border-rose-500/25",
    block: "border-rose-500/20 bg-rose-500/[0.04]",
    chip: "bg-rose-500/15 text-rose-800 dark:text-rose-200",
    icon: "text-rose-600",
  },
};

function familyKey(levelName: string): TierFamilyKey {
  const key = levelName.toLowerCase() as TierFamilyKey;
  return FAMILY_ORDER.includes(key) ? key : "rookie";
}

function groupByFamily(tiers: LoyaltyTierRow[]): Array<{ family: TierFamilyKey; tiers: LoyaltyTierRow[] }> {
  const map = new Map<TierFamilyKey, LoyaltyTierRow[]>();
  for (const tier of tiers) {
    const family = familyKey(tier.level_name);
    const list = map.get(family) ?? [];
    list.push(tier);
    map.set(family, list);
  }
  return FAMILY_ORDER.filter((f) => map.has(f)).map((family) => ({
    family,
    tiers: map.get(family)!,
  }));
}

function StatChip({
  icon: Icon,
  label,
  className,
}: {
  icon: typeof Star;
  label: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums",
        className,
      )}
    >
      <Icon className="size-3 shrink-0 opacity-80" />
      {label}
    </span>
  );
}

function TierCard({
  tier,
  family,
  isCurrent,
  isPast,
}: {
  tier: LoyaltyTierRow;
  family: TierFamilyKey;
  isCurrent?: boolean;
  isPast?: boolean;
}) {
  const { t } = useTranslation();
  const style = FAMILY_STYLE[family];
  const subLabel = tier.display_name.replace(/^(Rookie|Silver|Gold|Platinum|Diamond|Elite)\s+/i, "");

  return (
    <div
      className={cn(
        "rounded-xl border px-2.5 py-2 transition-colors",
        isCurrent
          ? "border-primary bg-primary/8 ring-2 ring-primary/30 shadow-sm"
          : isPast
            ? "border-border/50 bg-muted/20 opacity-75"
            : "border-border/60 bg-card",
      )}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className={cn("text-sm font-semibold shrink-0", isPast && "text-muted-foreground")}>
          {subLabel}
        </span>
        {isCurrent && (
          <Badge className="h-5 px-2 text-[10px] uppercase tracking-wide shrink-0">
            {t("member.loyalty.current")}
          </Badge>
        )}
        <StatChip
          icon={Coins}
          label={`${fmtNumber(tier.min_points)} ${t("member.loyalty.pointsSuffix")}`}
          className={style.chip}
        />
        <StatChip
          icon={Wallet}
          label={fmtTRY(tier.min_turnover)}
          className={style.chip}
        />
        <StatChip
          icon={Zap}
          label={`×${Number(tier.point_multiplier).toFixed(2)}`}
          className={style.chip}
        />
      </div>
    </div>
  );
}

function FamilyBlock({
  family,
  tiers,
  currentTierId,
  currentSortOrder,
}: {
  family: TierFamilyKey;
  tiers: LoyaltyTierRow[];
  currentTierId: number;
  currentSortOrder?: number;
}) {
  const { t } = useTranslation();
  const style = FAMILY_STYLE[family];

  return (
    <div className={cn("rounded-2xl border overflow-hidden", style.block)}>
      <div className={cn("flex items-center gap-2 border-b px-3 py-2.5", style.header)}>
        <Star className={cn("size-4 fill-current", style.icon)} />
        <div className="min-w-0">
          <div className="text-sm font-semibold">{t(`member.loyalty.family.${family}`)}</div>
          <div className="text-[11px] opacity-80 leading-snug">
            {t(`member.loyalty.familyDesc.${family}`)}
          </div>
        </div>
      </div>
      <div className="space-y-1.5 p-2">
        {tiers.map((tier) => (
          <TierCard
            key={tier.id}
            tier={tier}
            family={family}
            isCurrent={tier.id === currentTierId}
            isPast={currentSortOrder != null && tier.sort_order < currentSortOrder}
          />
        ))}
      </div>
    </div>
  );
}

function TierGroups({
  tiers,
  mode,
}: {
  tiers: LoyaltyTierRow[];
  mode: "past" | "future";
}) {
  const { t } = useTranslation();
  const groups = useMemo(() => groupByFamily(tiers), [tiers]);

  return (
    <div className="space-y-3 p-3">
      {groups.map(({ family, tiers: familyTiers }) => (
        <div key={family} className={cn("rounded-2xl border overflow-hidden", FAMILY_STYLE[family].block)}>
          <div className={cn("flex items-center gap-2 border-b px-3 py-2", FAMILY_STYLE[family].header)}>
            <Star className={cn("size-3.5 fill-current", FAMILY_STYLE[family].icon)} />
            <span className="text-xs font-semibold">{t(`member.loyalty.family.${family}`)}</span>
          </div>
          <div className="space-y-1.5 p-2">
            {familyTiers.map((tier) => (
              <TierCard
                key={tier.id}
                tier={tier}
                family={family}
                isPast={mode === "past"}
                isCurrent={false}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

type LoyaltyTierListProps = {
  tiers: LoyaltyTierRow[];
  currentTierId: number;
};

export function LoyaltyTierList({ tiers, currentTierId }: LoyaltyTierListProps) {
  const { t } = useTranslation();
  const [prevOpen, setPrevOpen] = useState(false);
  const [nextOpen, setNextOpen] = useState(true);
  const [legendOpen, setLegendOpen] = useState(false);

  const currentTier = tiers.find((tier) => tier.id === currentTierId);
  if (!currentTier) {
    return (
      <div className="soft-card rounded-2xl p-3 space-y-3">
        {groupByFamily(tiers).map(({ family, tiers: familyTiers }) => (
          <FamilyBlock key={family} family={family} tiers={familyTiers} currentTierId={currentTierId} />
        ))}
      </div>
    );
  }

  const previousTiers = tiers.filter((tier) => tier.sort_order < currentTier.sort_order);
  const nextTiers = tiers.filter((tier) => tier.sort_order > currentTier.sort_order);
  const currentFamily = familyKey(currentTier.level_name);

  return (
    <div className="space-y-3">
      <Collapsible open={legendOpen} onOpenChange={setLegendOpen}>
        <div className="soft-card rounded-2xl overflow-hidden">
          <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 p-3 text-left hover:bg-muted/30 transition-colors [&[data-state=open]_svg]:rotate-180">
            <div className="flex items-start gap-2 min-w-0">
              <TrendingUp className="size-4 text-primary mt-0.5 shrink-0" />
              <p className="text-xs text-muted-foreground leading-relaxed">
                {t("member.loyalty.tiersLegendShort")}
              </p>
            </div>
            <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform" />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="border-t border-border px-3 pb-3 pt-2 space-y-2 text-xs text-muted-foreground">
              <p>{t("member.loyalty.tiersLegendPoints")}</p>
              <p>{t("member.loyalty.tiersLegendTurnover")}</p>
              <p>{t("member.loyalty.tiersLegendMultiplier")}</p>
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>

      <div className="soft-card rounded-2xl p-3">
        <FamilyBlock
          family={currentFamily}
          tiers={[currentTier]}
          currentTierId={currentTierId}
          currentSortOrder={currentTier.sort_order}
        />
      </div>

      {previousTiers.length > 0 && (
        <Collapsible open={prevOpen} onOpenChange={setPrevOpen}>
          <div className="soft-card rounded-2xl overflow-hidden">
            <CollapsibleTrigger className="flex w-full items-center justify-between p-3 text-left hover:bg-muted/40 transition-colors [&[data-state=open]_svg]:rotate-180">
              <span className="text-sm font-medium">
                {t("member.loyalty.previousTiersCount", { n: previousTiers.length })}
              </span>
              <ChevronDown className="size-4 text-muted-foreground transition-transform" />
            </CollapsibleTrigger>
            <CollapsibleContent className="border-t border-border">
              <TierGroups tiers={previousTiers} mode="past" />
            </CollapsibleContent>
          </div>
        </Collapsible>
      )}

      {nextTiers.length > 0 && (
        <Collapsible open={nextOpen} onOpenChange={setNextOpen}>
          <div className="soft-card rounded-2xl overflow-hidden">
            <CollapsibleTrigger className="flex w-full items-center justify-between p-3 text-left hover:bg-muted/40 transition-colors [&[data-state=open]_svg]:rotate-180">
              <span className="text-sm font-medium">
                {t("member.loyalty.nextTiersCount", { n: nextTiers.length })}
              </span>
              <ChevronDown className="size-4 text-muted-foreground transition-transform" />
            </CollapsibleTrigger>
            <CollapsibleContent className="border-t border-border">
              <TierGroups tiers={nextTiers} mode="future" />
            </CollapsibleContent>
          </div>
        </Collapsible>
      )}
    </div>
  );
}
