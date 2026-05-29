import { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export type StatValueSize = "sm" | "md" | "lg" | "hero";

const VALUE_SIZE: Record<StatValueSize, string> = {
  sm: "stat-value stat-value--sm",
  md: "stat-value stat-value--md",
  lg: "stat-value stat-value--lg",
  hero: "stat-value stat-value--hero",
};

/** Rakamlar kart genişliğine göre otomatik küçülür (container query + clamp). */
export function StatValue({
  children,
  size = "md",
  className,
  wrap,
}: {
  children: ReactNode;
  size?: StatValueSize;
  className?: string;
  /** Uzun metinler için satır kır (para birimi kartlarında genelde false) */
  wrap?: boolean;
}) {
  return (
    <div className={cn("stat-value-wrap", wrap && "stat-value-wrap--wrap", className)}>
      <div className={cn(VALUE_SIZE[size], wrap && "stat-value--wrap")}>{children}</div>
    </div>
  );
}

export function StatCard({
  label,
  value,
  loading,
  accent,
  valueSize = "md",
  className,
  hint,
  headerRight,
  valueClassName,
}: {
  label: ReactNode;
  value: ReactNode;
  loading?: boolean;
  accent?: "destructive" | "success" | "warning" | "primary";
  valueSize?: StatValueSize;
  className?: string;
  hint?: ReactNode;
  headerRight?: ReactNode;
  valueClassName?: string;
}) {
  return (
    <Card
      className={cn(
        "stat-card p-3 sm:p-4",
        accent === "destructive" && "border-destructive/30",
        accent === "success" && "border-success/30",
        accent === "warning" && "border-warning/30",
        accent === "primary" && "border-primary/30",
        className,
      )}
    >
      <div className={cn("flex items-start justify-between gap-2", headerRight && "mb-0.5")}>
        <div className="stat-card__label flex-1">{label}</div>
        {headerRight}
      </div>
      {loading ? (
        <Skeleton className="h-7 w-20 mt-2 max-w-full" />
      ) : (
        <StatValue size={valueSize} className={cn("mt-1", valueClassName)}>
          {value}
        </StatValue>
      )}
      {hint && <div className="text-[11px] text-muted-foreground mt-1 line-clamp-2">{hint}</div>}
    </Card>
  );
}
