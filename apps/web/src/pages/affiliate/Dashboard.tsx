import { useEffect, useState } from "react";
import AffiliateLayout from "@/components/AffiliateLayout";
import { rpc } from "@/lib/rpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Send, Briefcase, Wallet, TrendingUp } from "lucide-react";
import { fmtTRY } from "@/lib/format";
import { translateError } from "@/lib/i18n-errors";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

type Dashboard = {
  affiliate_id: string;
  affiliate_code: string;
  merchants_count: number;
  this_month_amount: number;
  lifetime_amount: number;
  payable_amount: number;
  has_open_payout: boolean;
};

export default function AffiliateDashboard() {
  const { t } = useTranslation();
  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [requesting, setRequesting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const rows = await rpc<Dashboard[] | Dashboard | null>("get_my_affiliate_dashboard");
      const row = (Array.isArray(rows) ? rows[0] : rows) as Dashboard | null;
      setData(row ?? null);
    } catch (err) {
      toast.error(translateError(err, t("affiliate.dashboardCard.fetchFailed")));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const requestPayout = async () => {
    if (!data) return;
    if (data.has_open_payout) {
      toast.error(t("affiliate.dashboardCard.openExists"));
      return;
    }
    if (data.payable_amount <= 0) {
      toast.error(t("affiliate.dashboardCard.noPayableToast"));
      return;
    }
    if (!confirm(t("affiliate.dashboardCard.confirmRequest", { amount: fmtTRY(data.payable_amount) }))) return;
    setRequesting(true);
    try {
      await rpc("request_affiliate_payout");
      toast.success(t("affiliate.dashboardCard.requested"));
      await load();
    } catch (err) {
      toast.error(translateError(err, t("affiliate.dashboardCard.requestFailed")));
    } finally {
      setRequesting(false);
    }
  };

  return (
    <AffiliateLayout title={t("affiliate.page.dashboardTitle")}>
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="animate-spin" />
        </div>
      ) : !data ? (
        <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">{t("affiliate.dashboardCard.noAffiliateRecord")}</CardContent></Card>
      ) : (
        <div className="space-y-6 max-w-4xl">
          <Card className="rounded-2xl bank-card text-primary-foreground">
            <CardContent className="p-6">
              <div className="text-xs opacity-80 mb-1">{t("affiliate.dashboardCard.code")}</div>
              <div className="text-2xl font-mono font-bold tracking-wide">{data.affiliate_code}</div>
              <div className="text-xs opacity-70 mt-2">{t("affiliate.dashboardCard.merchantsLine", { n: data.merchants_count })}</div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="rounded-2xl">
              <CardContent className="p-5">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <TrendingUp className="size-4 text-primary" />
                  {t("affiliate.dashboardCard.thisMonth")}
                </div>
                <div className="text-2xl font-bold tabular-nums mt-2">{fmtTRY(data.this_month_amount)}</div>
              </CardContent>
            </Card>
            <Card className="rounded-2xl">
              <CardContent className="p-5">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Briefcase className="size-4 text-primary" />
                  {t("affiliate.dashboardCard.lifetime")}
                </div>
                <div className="text-2xl font-bold tabular-nums mt-2">{fmtTRY(data.lifetime_amount)}</div>
              </CardContent>
            </Card>
            <Card className="rounded-2xl border-primary/30">
              <CardContent className="p-5">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Wallet className="size-4 text-primary" />
                  {t("affiliate.dashboardCard.payable")}
                </div>
                <div className="text-2xl font-bold tabular-nums mt-2 text-success">{fmtTRY(data.payable_amount)}</div>
              </CardContent>
            </Card>
          </div>

          <Card className="rounded-2xl">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{t("affiliate.dashboardCard.payoutTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {data.has_open_payout ? (
                <div className="text-sm text-muted-foreground">
                  {t("affiliate.dashboardCard.openPayout")}
                </div>
              ) : data.payable_amount <= 0 ? (
                <div className="text-sm text-muted-foreground">
                  {t("affiliate.dashboardCard.noPayable")}
                </div>
              ) : (
                <>
                  <div className="text-sm">
                    {t("affiliate.dashboardCard.summary", { amount: fmtTRY(data.payable_amount) })}
                  </div>
                  <Button onClick={requestPayout} disabled={requesting} className="rounded-xl">
                    {requesting ? <Loader2 className="size-4 animate-spin mr-1" /> : <Send className="size-4 mr-1" />}
                    {t("affiliate.dashboardCard.requestPayout")}
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </AffiliateLayout>
  );
}
