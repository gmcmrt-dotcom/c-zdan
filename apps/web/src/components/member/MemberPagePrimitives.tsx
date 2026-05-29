import { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  memberCardPad,
  memberCardPadLg,
  memberGrid2,
  memberGrid3,
  memberGrid4,
  memberPageBlock,
  memberPageHeader,
  memberPageTitle,
} from "@/lib/member-layout";

export function MemberPageTitle({
  title,
  subtitle,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn(memberPageTitle, className)}>
      <h1 className="text-xl sm:text-2xl font-bold break-words">{title}</h1>
      {subtitle && <p className="text-sm text-muted-foreground mt-0.5 break-words">{subtitle}</p>}
    </div>
  );
}

export function MemberPageHeader({
  title,
  subtitle,
  backTo = "/",
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  backTo?: string;
  className?: string;
}) {
  return (
    <div className={cn(memberPageHeader, className)}>
      <Link
        to={backTo}
        className="size-9 shrink-0 rounded-full bg-muted flex items-center justify-center"
        aria-label="Geri"
      >
        <ArrowLeft className="size-4" />
      </Link>
      <div className="min-w-0">
        <h1 className="text-lg sm:text-xl font-bold break-words">{title}</h1>
        {subtitle && <p className="text-xs text-muted-foreground break-words">{subtitle}</p>}
      </div>
    </div>
  );
}

export function MemberPageBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn(memberPageBlock, className)}>{children}</div>;
}

export function MemberSection({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn("mt-4 sm:mt-5", className)}>{children}</section>;
}

export function MemberActionGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn(memberGrid2, className)}>{children}</div>;
}

export function MemberQuickAmountGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn(memberGrid4, className)}>{children}</div>;
}

export function MemberSegmentGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn(memberGrid3, className)}>{children}</div>;
}

export { memberCardPad, memberCardPadLg, memberGrid2, memberGrid4, memberGrid3 };
export { StatValue, StatCard } from "@/components/ui/stat-card";
