import { useEffect, useState } from "react";
import AffiliateLayout from "@/components/AffiliateLayout";
import { rpc } from "@/lib/rpc";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import { fmtTRY } from "@/lib/format";
import { translateError } from "@/lib/i18n-errors";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

type Payout = {
  id: string;
  period_from: string;
  period_to: string;
  ledger_count: number;
  total_amount: number;
  status: "requested" | "approved" | "paid" | "rejected" | "cancelled";
  requested_at: string;
  approved_at: string | null;
  paid_at: string | null;
  rejected_reason: string | null;
  transfer_ref: string | null;
};

const STATUS_VARIANT: Record<Payout["status"], "default" | "secondary" | "outline" | "destructive"> = {
  requested: "outline",
  approved: "secondary",
  paid: "default",
  rejected: "destructive",
  cancelled: "destructive",
};



function fmtDate(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("tr-TR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

export default function AffiliatePayouts() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<Payout[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const data = await rpc<Payout[]>("get_my_affiliate_payouts");
        setRows(data ?? []);
      } catch (err) {
        toast.error(translateError(err, t("affiliate.payoutsTable.loadFailed")));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <AffiliateLayout title={t("affiliate.page.payoutsTitle")}>
      <div className="max-w-5xl">
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            {loading ? (
              <div className="p-8 flex items-center justify-center"><Loader2 className="animate-spin" /></div>
            ) : rows.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">{t("affiliate.payoutsTable.empty")}</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-muted/40 border-b text-xs">
                  <tr>
                    <th className="text-left p-3">{t("affiliate.payoutsTable.headerRequested")}</th>
                    <th className="text-left p-3">{t("affiliate.payoutsTable.headerPeriod")}</th>
                    <th className="text-right p-3">{t("affiliate.payoutsTable.headerCount")}</th>
                    <th className="text-right p-3">{t("affiliate.payoutsTable.headerAmount")}</th>
                    <th className="text-left p-3">{t("affiliate.payoutsTable.headerStatus")}</th>
                    <th className="text-left p-3">{t("affiliate.payoutsTable.headerApproval")}</th>
                    <th className="text-left p-3">{t("affiliate.payoutsTable.headerPayment")}</th>
                    <th className="text-left p-3">{t("affiliate.payoutsTable.headerRef")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={p.id} className="border-b hover:bg-muted/20 transition">
                      <td className="p-3 text-xs">{fmtDate(p.requested_at)}</td>
                      <td className="p-3 text-xs">{fmtDate(p.period_from)} – {fmtDate(p.period_to)}</td>
                      <td className="p-3 text-right tabular-nums">{p.ledger_count}</td>
                      <td className="p-3 text-right tabular-nums font-medium">{fmtTRY(p.total_amount)}</td>
                      <td className="p-3"><Badge variant={STATUS_VARIANT[p.status]} className="text-[10px]">{t(`affiliate.payoutsTable.status.${p.status}`)}</Badge></td>
                      <td className="p-3 text-xs">{fmtDate(p.approved_at)}</td>
                      <td className="p-3 text-xs">{fmtDate(p.paid_at)}</td>
                      <td className="p-3 text-xs font-mono truncate max-w-[200px]" title={p.transfer_ref ?? ""}>
                        {p.transfer_ref ?? (p.rejected_reason ? t("affiliate.payoutsTable.rejectedPrefix") + p.rejected_reason : "—")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>
    </AffiliateLayout>
  );
}
