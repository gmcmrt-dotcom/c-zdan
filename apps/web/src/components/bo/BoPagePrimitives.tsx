import { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/** Özet kartları — mobil 1, sm 2, md+ 4 sütun */
export function BoStatGrid({
  children,
  cols = 4,
  className,
}: {
  children: ReactNode;
  cols?: 2 | 4 | 5;
  className?: string;
}) {
  const colClass =
    cols === 2
      ? "grid-cols-1 sm:grid-cols-2"
      : cols === 5
        ? "grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-5"
        : "grid-cols-1 sm:grid-cols-2 md:grid-cols-4";
  return <div className={cn("grid gap-3 [&>*]:min-w-0", colClass, className)}>{children}</div>;
}

export function BoFilterCard({ children, className }: { children: ReactNode; className?: string }) {
  return <Card className={cn("p-3 sm:p-4 space-y-3 sm:space-y-4", className)}>{children}</Card>;
}

/** Arama + tarih + aksiyonlar — sm+ yatay, mobilde dikey; butonlar tam genişlik değil */
export function BoToolbarRow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2 sm:gap-3", className)}>
      {children}
    </div>
  );
}

export function BoToolbarGrow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex-1 min-w-0 w-full sm:min-w-[200px]", className)}>{children}</div>;
}

export function BoToolbarActions({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-row flex-wrap gap-2 w-full sm:w-auto sm:shrink-0", className)}>
      {children}
    </div>
  );
}

export function BoFilterRow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col sm:flex-row flex-wrap gap-2 sm:gap-3 items-stretch sm:items-end", className)}>
      {children}
    </div>
  );
}

export function BoFilterField({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1 w-full sm:w-auto sm:min-w-[8.75rem] sm:max-w-[12rem]", className)}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

/** Tablo kaydırma — dar ekranda yatay scroll; geniş ekranda tam genişlik */
export function BoDataTable({
  children,
  minWidth,
  className,
}: {
  children: ReactNode;
  minWidth?: number;
  className?: string;
}) {
  return (
    <div className={cn("bg-background border rounded-xl overflow-x-auto -mx-0", className)}>
      <table
        className="w-full text-sm"
        style={minWidth ? { minWidth: `${minWidth}px` } : undefined}
      >
        {children}
      </table>
    </div>
  );
}

/** Sayfa kökü — tutarlı dikey boşluk */
export function BoPageStack({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("space-y-4 min-w-0 w-full", className)}>{children}</div>;
}

export { StatCard, StatValue } from "@/components/ui/stat-card";
