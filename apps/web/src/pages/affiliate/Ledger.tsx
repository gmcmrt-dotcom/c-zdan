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

type Row = {
  id: string;
  merchant_name: string;
  source_type: string;
  basis_amount: number;
  commission_basis: string;
  commission_pct: number | null;
  commission_amount: number;
  payout_id: string | null;
  created_at: string;
};

const BASIS_KEYS: Record<string, string> = {
  our_commission: "ourCommission",
  merchant_volume: "merchantVolume",
  fixed_per_tx: "fixedPerTx",
};

const SOURCE_KEYS: Record<string, string> = {
  spend: "spend",
  topup: "topup",
  merchant_withdraw: "merchantWithdraw",
};

function fmtDateTime(iso: string) {
  try {
    return new Date(iso).toLocaleString("tr-TR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function AffiliateLedger() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const data = await rpc<Row[]>("get_my_affiliate_ledger", { _limit: 200 });
        setRows(data ?? []);
      } catch (err) {
        toast.error(translateError(err, t("affiliate.ledgerTable.loadFailed")));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <AffiliateLayout title={t("affiliate.page.ledgerTitle")}>
      <div className="max-w-5xl">
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            {loading ? (
              <div className="p-8 flex items-center justify-center"><Loader2 className="animate-spin" /></div>
            ) : rows.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">{t("affiliate.ledgerTable.empty")}</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-muted/40 border-b text-xs">
                  <tr>
                    <th className="text-left p-3">{t("affiliate.ledgerTable.headerDate")}</th>
                    <th className="text-left p-3">{t("affiliate.ledgerTable.headerMerchant")}</th>
                    <th className="text-left p-3">{t("affiliate.ledgerTable.headerSource")}</th>
                    <th className="text-left p-3">{t("affiliate.ledgerTable.headerBasis")}</th>
                    <th className="text-right p-3">{t("affiliate.ledgerTable.headerBaseAmount")}</th>
                    <th className="text-right p-3">{t("affiliate.ledgerTable.headerPct")}</th>
                    <th className="text-right p-3">{t("affiliate.ledgerTable.headerCommission")}</th>
                    <th className="text-left p-3">{t("affiliate.ledgerTable.headerStatus")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b hover:bg-muted/20 transition">
                      <td className="p-3 text-xs">{fmtDateTime(r.created_at)}</td>
                      <td className="p-3">{r.merchant_name}</td>
                      <td className="p-3">{SOURCE_KEYS[r.source_type] ? t(`affiliate.sourceLabel.${SOURCE_KEYS[r.source_type]}`) : r.source_type}</td>
                      <td className="p-3 text-xs">{BASIS_KEYS[r.commission_basis] ? t(`affiliate.basisLabel.${BASIS_KEYS[r.commission_basis]}`) : r.commission_basis}</td>
                      <td className="p-3 text-right tabular-nums">{fmtTRY(r.basis_amount)}</td>
                      <td className="p-3 text-right tabular-nums">{r.commission_pct != null ? `%${r.commission_pct}` : "—"}</td>
                      <td className="p-3 text-right tabular-nums font-medium text-success">{fmtTRY(r.commission_amount)}</td>
                      <td className="p-3">
                        {r.payout_id ? (
                          <Badge variant="default" className="text-[10px]">{t("affiliate.ledgerTable.statusPaid")}</Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px]">{t("affiliate.ledgerTable.statusPending")}</Badge>
                        )}
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
