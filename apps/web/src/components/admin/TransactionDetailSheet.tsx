import { Link } from "react-router-dom";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TxIdBadge } from "@/components/TxIdBadge";
import { fmtDate, fmtTRY, txStatusLabel, txTypeLabel } from "@/lib/format";
import {
  type AdminTx,
  merchantLabel,
  postedAmount,
  reconciliationUrl,
} from "@/lib/admin-transactions";
import type { AdminMerchantPicker } from "@/contexts/AdminReferenceDataContext";
import { maskEmail, maskName } from "@/lib/mask";
import { ExternalLink, User } from "lucide-react";
import { useTranslation } from "react-i18next";

type Props = {
  tx: AdminTx | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  merchants: AdminMerchantPicker[];
  canViewFull: boolean;
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-2 border-b border-border/60 text-sm">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="text-right font-medium break-all">{children}</span>
    </div>
  );
}

export default function TransactionDetailSheet({ tx, open, onOpenChange, merchants, canViewFull }: Props) {
  const { t } = useTranslation();
  if (!tx) return null;

  const memberName = `${tx.profile?.first_name ?? ""} ${tx.profile?.last_name ?? ""}`.trim();
  const reconLink = reconciliationUrl(tx);
  const net = postedAmount(tx);
  const mid = tx.metadata?.merchant_id as string | undefined;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline">{txTypeLabel(tx.type)}</Badge>
            <Badge variant={tx.status === "completed" ? "secondary" : "outline"}>{txStatusLabel(tx.status)}</Badge>
          </SheetTitle>
          <SheetDescription asChild>
            <div>
              <TxIdBadge publicNo={tx.public_no} />
            </div>
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-1">
          <Row label="Tarih">{fmtDate(tx.created_at)}</Row>
          <Row label="Tutar">
            <span className={tx.type === "spend" || tx.type === "merchant_withdraw" ? "text-destructive" : "text-success"}>
              {tx.type === "spend" || tx.type === "merchant_withdraw" ? "−" : "+"}
              {fmtTRY(Number(tx.amount))}
            </span>
          </Row>
          <Row label="Ücret">{Number(tx.fee) > 0 ? fmtTRY(Number(tx.fee)) : "—"}</Row>
          <Row label="İşlenen net">
            {net === null ? "—" : `${net < 0 ? "−" : "+"}${fmtTRY(Math.abs(net))}`}
          </Row>
          {tx.points !== undefined && tx.points !== 0 && (
            <Row label="Puan">
              <span className={tx.points > 0 ? "text-success" : "text-destructive"}>
                {tx.points > 0 ? "+" : "−"}
                {Math.abs(tx.points)}
              </span>
            </Row>
          )}
          <Row label="Üye">
            {canViewFull ? memberName || "—" : maskName(memberName) || "—"}
          </Row>
          {canViewFull && <Row label="E-posta">{tx.profile?.email ?? "—"}</Row>}
          <Row label="Merchant">{merchantLabel(tx, merchants)}</Row>
          {canViewFull && tx.merchant_ref && <Row label="Merchant ref">{tx.merchant_ref}</Row>}
          {canViewFull && tx.external_tx_id && <Row label="External ID">{tx.external_tx_id}</Row>}
          {tx.description && <Row label="Açıklama">{tx.description}</Row>}
          {tx.merchant_note && (
            <Row label={t("common.merchantNote")}>
              <span className="italic font-normal">{tx.merchant_note}</span>
            </Row>
          )}
          {tx.reference_id && canViewFull && (
            <Row label="Referans ID">
              <span className="font-mono text-xs">{tx.reference_id}</span>
            </Row>
          )}
        </div>

        <div className="mt-6 flex flex-col gap-2">
          <Button variant="default" size="sm" className="w-full justify-start" asChild>
            <Link to={`/admin/members/${tx.user_id}`} onClick={() => onOpenChange(false)}>
              <User className="size-4 mr-2" />
              Üye detayına git
            </Link>
          </Button>
          {mid && (
            <Button variant="outline" size="sm" className="w-full justify-start" asChild>
              <Link to={`/admin/merchants/${mid}`} onClick={() => onOpenChange(false)}>
                <ExternalLink className="size-4 mr-2" />
                Merchant detayı
              </Link>
            </Button>
          )}
          {reconLink && (
            <Button variant="outline" size="sm" className="w-full justify-start" asChild>
              <Link to={reconLink} onClick={() => onOpenChange(false)}>
                <ExternalLink className="size-4 mr-2" />
                Mutabakatta göster
              </Link>
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
