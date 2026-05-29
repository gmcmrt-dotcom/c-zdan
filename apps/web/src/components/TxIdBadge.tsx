// TxIdBadge — Insan-okur islem ID gosterimi (public_no)
// Format: <PREFIX>-YYYYMMDD-NNNNNN (orn. T-20260505-001234)
// Click-to-copy + monospace font + prefix renk vurgusu
import { useTranslation } from "react-i18next";
import { CopyButton } from "@/components/CopyButton";
import { cn } from "@/lib/utils";

interface TxIdBadgeProps {
  publicNo?: string | null;
  /** "compact" sadece kod, "full" "ID:" prefix'li */
  variant?: "compact" | "full";
  className?: string;
  /** Click-to-copy butonunu gizle (sadece label) */
  noCopy?: boolean;
}

export function TxIdBadge({
  publicNo,
  variant = "compact",
  className,
  noCopy = false,
}: TxIdBadgeProps) {
  const { t } = useTranslation();

  if (!publicNo) {
    return (
      <span className={cn("text-xs text-muted-foreground italic", className)}>
        {t("common.txId.pending", "—")}
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 font-mono text-xs",
        variant === "full" && "px-2 py-0.5 rounded-md bg-muted",
        className,
      )}
    >
      {variant === "full" && (
        <span className="text-muted-foreground select-none">
          {t("common.txId.label", "İşlem No")}:
        </span>
      )}
      <span className="tabular-nums tracking-tight font-medium">{publicNo}</span>
      {!noCopy && <CopyButton value={publicNo} label={t("common.copy", "Kopyala")} size="sm" />}
    </span>
  );
}

export default TxIdBadge;
