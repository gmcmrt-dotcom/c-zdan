import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import MemberLayout from "@/components/MemberLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { rpc } from "@/lib/rpc";
import { fmtDate, fmtTRY } from "@/lib/format";
import { translateError } from "@/lib/i18n-errors";
import { TxIdBadge } from "@/components/TxIdBadge";
import { ArrowLeft, CheckCircle2, Gift, Loader2, Trophy } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

type ProfitShareReward = {
  allocation_id: string;
  campaign_id: string;
  period_type: "daily" | "weekly" | "monthly";
  period_from: string;
  period_to: string;
  rank_no: number;
  turnover_amount: number;
  share_pct: number;
  allocated_amount: number;
  status: "pending" | "claimed" | "expired";
  expires_at: string | null;
  claimed_at: string | null;
  expired_at: string | null;
  claim_tx_public_no: string | null;
};

export default function ProfitShareRewards() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<ProfitShareReward[]>([]);
  const [loading, setLoading] = useState(true);
  const [claimingId, setClaimingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await rpc<ProfitShareReward[]>("my_profit_share_rewards");
      setRows(data ?? []);
    } catch (err) {
      toast.error(translateError(err, t("member.profitShare.loadError")));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const claim = async (allocationId: string) => {
    setClaimingId(allocationId);
    try {
      const data = await rpc<{ success: boolean; error_code?: string; amount?: number } | Array<{ success: boolean; error_code?: string; amount?: number }>>("claim_profit_share_reward", {
        _allocation_id: allocationId,
      });
      const result = Array.isArray(data) ? data[0] : data;
      if (!result?.success) {
        toast.error(translateError({ message: result?.error_code } as any, result?.error_code ?? t("member.profitShare.claimError")));
        await load();
        return;
      }
      toast.success(t("member.profitShare.claimSuccess", { amount: fmtTRY(result.amount) }));
      await load();
    } catch (err) {
      toast.error(translateError(err, t("member.profitShare.claimError")));
    } finally {
      setClaimingId(null);
    }
  };

  const pending = rows.filter((r) => r.status === "pending");
  const history = rows.filter((r) => r.status !== "pending");

  return (
    <MemberLayout>
      <div className="pt-4 sm:pt-6 pb-8 space-y-5">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link to="/">
              <ArrowLeft className="size-5" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Gift className="size-6 text-primary" />
              {t("member.profitShare.title")}
            </h1>
            <p className="text-sm text-muted-foreground">{t("member.profitShare.subtitle")}</p>
          </div>
        </div>

        <Card className="p-4 bg-primary/5 border-primary/20">
          <div className="text-sm font-medium">{t("member.profitShare.howItWorksTitle")}</div>
          <p className="text-sm text-muted-foreground mt-1">{t("member.profitShare.howItWorksBody")}</p>
        </Card>

        {loading ? (
          <Card className="p-8 text-center text-muted-foreground">
            <Loader2 className="size-5 animate-spin mx-auto mb-2" />
            {t("common.loading")}
          </Card>
        ) : rows.length === 0 ? (
          <Card className="p-8 text-center">
            <Trophy className="size-10 text-muted-foreground mx-auto mb-3" />
            <div className="font-medium">{t("member.profitShare.emptyTitle")}</div>
            <p className="text-sm text-muted-foreground mt-1">{t("member.profitShare.emptyBody")}</p>
          </Card>
        ) : (
          <>
            {pending.length > 0 && (
              <div className="space-y-3">
                <h2 className="text-sm font-semibold">{t("member.profitShare.pendingTitle")}</h2>
                {pending.map((row) => (
                  <Card key={row.allocation_id} className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-xs text-muted-foreground">
                          {fmtDate(row.period_from)} - {fmtDate(row.period_to)}
                        </div>
                        <div className="text-2xl font-bold text-success mt-1">+{fmtTRY(row.allocated_amount)}</div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {t("member.profitShare.rankLine", {
                            rank: row.rank_no,
                            turnover: fmtTRY(row.turnover_amount),
                            share: Number(row.share_pct).toFixed(4),
                          })}
                        </div>
                        {row.expires_at && (
                          <div className="text-xs text-warning-foreground mt-1">
                            {t("member.profitShare.expiresAt", { date: fmtDate(row.expires_at) })}
                          </div>
                        )}
                      </div>
                      <Badge variant="outline" className="bg-success/10 text-success border-success/30">
                        {t("member.profitShare.claimable")}
                      </Badge>
                    </div>
                    <Button className="w-full mt-4" onClick={() => claim(row.allocation_id)} disabled={claimingId === row.allocation_id}>
                      {claimingId === row.allocation_id ? (
                        <Loader2 className="size-4 mr-1 animate-spin" />
                      ) : (
                        <CheckCircle2 className="size-4 mr-1" />
                      )}
                      {t("member.profitShare.claimCta")}
                    </Button>
                  </Card>
                ))}
              </div>
            )}

            {history.length > 0 && (
              <div className="space-y-3">
                <h2 className="text-sm font-semibold">{t("member.profitShare.historyTitle")}</h2>
                <div className="soft-card rounded-2xl divide-y divide-border overflow-hidden">
                  {history.map((row) => (
                    <div key={row.allocation_id} className="p-4 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium">{fmtTRY(row.allocated_amount)}</div>
                        <div className="text-xs text-muted-foreground">
                          {row.claimed_at
                            ? t("member.profitShare.claimedAt", { date: fmtDate(row.claimed_at) })
                            : row.expired_at
                              ? t("member.profitShare.expiredAt", { date: fmtDate(row.expired_at) })
                              : fmtDate(row.period_to)}
                        </div>
                        {row.claim_tx_public_no && (
                          <TxIdBadge publicNo={row.claim_tx_public_no} className="mt-1" />
                        )}
                      </div>
                      <Badge variant="outline">
                        {row.status === "claimed" ? t("member.profitShare.claimed") : t("member.profitShare.expired")}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </MemberLayout>
  );
}
