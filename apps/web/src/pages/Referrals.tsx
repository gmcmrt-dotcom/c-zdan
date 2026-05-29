import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { rpc } from "@/lib/rpc";
import { useAuth } from "@/hooks/useAuth";
import MemberLayout from "@/components/MemberLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CopyButton } from "@/components/CopyButton";
import { fmtTRY } from "@/lib/format";
import { StatCard } from "@/components/ui/stat-card";
import { memberGrid2 } from "@/lib/member-layout";
import { translateError } from "@/lib/i18n-errors";
import { Gift, Share2, MessageCircle, Mail, Users, Sparkles, ChevronLeft, Hourglass } from "lucide-react";
import { toast } from "sonner";

type Stats = {
  total_invites: number;
  pending_count: number;
  qualified_count: number;
  rewarded_count: number;
  total_points: number;
  total_balance: number;
};

type ReferralRow = {
  id: string;
  referee_first_name: string | null;
  referee_last_name: string | null;
  status: "pending" | "qualified" | "rewarded" | "expired" | "cancelled";
  qualified_at: string | null;
  rewarded_at: string | null;
  reward_points: number;
  reward_balance: number;
  created_at: string;
};

const STATUS_VARIANT: Record<ReferralRow["status"], "default" | "secondary" | "outline" | "destructive"> = {
  pending: "outline",
  qualified: "secondary",
  rewarded: "default",
  expired: "destructive",
  cancelled: "destructive",
};

function formatDate(iso: string | null, lang: string) {
  if (!iso) return "—";
  try {
    const locale = lang?.startsWith("en") ? "en-US" : "tr-TR";
    return new Date(iso).toLocaleDateString(locale, { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return iso;
  }
}

function maskName(first: string | null, last: string | null, fallback: string) {
  const f = (first ?? "").trim();
  const l = (last ?? "").trim();
  const fm = f ? f[0] + "•".repeat(Math.max(1, f.length - 1)) : "";
  const lm = l ? l[0] + "•".repeat(Math.max(1, l.length - 1)) : "";
  return [fm, lm].filter(Boolean).join(" ") || fallback;
}

export default function Referrals() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const [code, setCode] = useState<string>("");
  const [stats, setStats] = useState<Stats | null>(null);
  const [list, setList] = useState<ReferralRow[]>([]);
  const [loading, setLoading] = useState(true);

  const link = useMemo(() => {
    if (!code) return "";
    return `${window.location.origin}/auth?ref=${encodeURIComponent(code)}`;
  }, [code]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      setLoading(true);
      try {
        const [codeRow, statsRow, rows] = await Promise.all([
          rpc<Array<{ referral_code: string }>>("get_my_referral_link"),
          rpc<Stats[]>("get_my_referral_stats"),
          rpc<ReferralRow[]>("get_my_referrals"),
        ]);

        setCode(codeRow?.[0]?.referral_code ?? "");
        setStats(statsRow?.[0] ?? null);
        setList(rows ?? []);
      } catch (err) {
        toast.error(translateError(err, t("referral.errors.cannotLoad")));
      } finally {
        setLoading(false);
      }
    })();
  }, [user]);

  const shareUrl = link;
  const shareText = useMemo(() => {
    if (!shareUrl) return "";
    return `${t("referral.share.message")}\n${shareUrl}`;
  }, [shareUrl, t]);

  const onNativeShare = async () => {
    if (!shareUrl) return;
    const navAny = navigator as unknown as { share?: (data: { title: string; text: string; url: string }) => Promise<void> };
    if (navAny.share) {
      try {
        await navAny.share({ title: t("referral.share.subject"), text: shareText, url: shareUrl });
      } catch {
        /* user cancelled */
      }
    } else {
      try {
        await navigator.clipboard.writeText(shareUrl);
        toast.success(t("referral.link.copied"));
      } catch {
        toast.error(t("referral.share.unsupported"));
      }
    }
  };

  const whatsappHref = useMemo(
    () => (shareText ? `https://wa.me/?text=${encodeURIComponent(shareText)}` : "#"),
    [shareText],
  );
  const mailHref = useMemo(
    () =>
      shareText
        ? `mailto:?subject=${encodeURIComponent(t("referral.share.subject"))}&body=${encodeURIComponent(shareText)}`
        : "#",
    [shareText, t],
  );

  return (
    <MemberLayout>
      <div className="px-4 pt-4 pb-2 flex items-center gap-2">
        <Link to="/" className="inline-flex items-center text-muted-foreground">
          <ChevronLeft className="size-5" />
          <span className="text-sm">{t("referral.page.backHome")}</span>
        </Link>
      </div>

      <div className="px-4 space-y-4 animate-fade-in">
        {/* Davet edilen üye için progress banner */}
        <RefereeProgressBanner />

        {/* Hero kartı */}
        <Card className="rounded-2xl bank-card text-primary-foreground overflow-hidden">
          <CardContent className="p-5 space-y-3">
            <div className="flex items-center gap-2">
              <Sparkles className="size-5" />
              <div className="text-sm opacity-90">{t("referral.hero.badge")}</div>
            </div>
            <div className="text-2xl font-bold leading-tight">
              {t("referral.hero.line1")} <br />
              <span className="opacity-90">{t("referral.hero.line2")}</span>
            </div>
            <div className="text-xs opacity-80">{t("referral.hero.note")}</div>
          </CardContent>
        </Card>

        {/* Kod ve link kartı */}
        <Card className="rounded-2xl">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Gift className="size-4 text-primary" />
              {t("referral.link.title")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {loading ? (
              <div className="h-10 rounded-xl bg-muted animate-pulse" />
            ) : code ? (
              <>
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">{t("referral.link.code")}</div>
                  <div className="flex items-center justify-between bg-muted rounded-xl px-3 py-2">
                    <span className="text-base font-semibold tabular-nums" style={{ letterSpacing: "0.05em", fontVariantLigatures: "none" }}>{code}</span>
                    <CopyButton value={code} label={t("referral.link.copyCode")} />
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">{t("referral.link.url")}</div>
                  <div className="flex items-center justify-between bg-muted rounded-xl px-3 py-2 gap-2">
                    <span className="text-xs truncate flex-1">{link}</span>
                    <CopyButton value={link} label={t("referral.link.copy")} />
                  </div>
                </div>
                <div className="grid grid-cols-1 min-[280px]:grid-cols-3 gap-2 pt-1">
                  <Button variant="secondary" className="rounded-xl" onClick={onNativeShare}>
                    <Share2 className="size-4 mr-1" />
                    {t("referral.share.native")}
                  </Button>
                  <a href={whatsappHref} target="_blank" rel="noopener noreferrer">
                    <Button variant="secondary" className="rounded-xl w-full">
                      <MessageCircle className="size-4 mr-1" />
                      {t("referral.share.whatsapp")}
                    </Button>
                  </a>
                  <a href={mailHref}>
                    <Button variant="secondary" className="rounded-xl w-full">
                      <Mail className="size-4 mr-1" />
                      {t("referral.share.email")}
                    </Button>
                  </a>
                </div>
              </>
            ) : (
              <div className="text-sm text-muted-foreground">{t("referral.link.preparing")}</div>
            )}
          </CardContent>
        </Card>

        {/* İstatistik kartları */}
        <div className={memberGrid2}>
          <StatCard
            label={t("referral.stats.totalInvites")}
            value={loading ? "—" : stats?.total_invites ?? 0}
            loading={loading}
            valueSize="lg"
            headerRight={<Users className="size-5 text-primary shrink-0" />}
            hint={
              loading
                ? undefined
                : t("referral.stats.qualifiedRewarded", {
                    q: stats?.qualified_count ?? 0,
                    r: stats?.rewarded_count ?? 0,
                  })
            }
          />
          <StatCard
            label={t("referral.stats.earned")}
            value={loading ? "—" : fmtTRY(stats?.total_balance ?? 0)}
            loading={loading}
            valueSize="lg"
            valueClassName="text-success"
            hint={loading ? undefined : t("referral.stats.pointsBonus", { p: stats?.total_points ?? 0 })}
          />
        </div>

        {/* Davet geçmişi */}
        <Card className="rounded-2xl">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t("referral.history.title")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {loading ? (
              <div className="space-y-2">
                <div className="h-12 rounded-xl bg-muted animate-pulse" />
                <div className="h-12 rounded-xl bg-muted animate-pulse" />
              </div>
            ) : list.length === 0 ? (
              <div className="text-sm text-muted-foreground py-8 text-center">
                {t("referral.history.empty")}
              </div>
            ) : (
              list.map((row) => (
                <div
                  key={row.id}
                  className="flex items-center justify-between bg-muted/40 rounded-xl px-3 py-2"
                >
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">
                      {maskName(row.referee_first_name, row.referee_last_name, t("referral.history.anonymous"))}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {t("referral.history.invitedAt", { date: formatDate(row.created_at, i18n.language) })}
                      {row.rewarded_at
                        ? t("referral.history.rewardedAt", { date: formatDate(row.rewarded_at, i18n.language) })
                        : ""}
                    </span>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Badge variant={STATUS_VARIANT[row.status]} className="text-[10px]">
                      {t(`referral.status.${row.status}`, row.status)}
                    </Badge>
                    {row.status === "rewarded" && (
                      <span className="text-[11px] text-success tabular-nums">
                        {t("referral.history.rewardSummary", {
                          balance: fmtTRY(row.reward_balance),
                          points: row.reward_points,
                        })}
                      </span>
                    )}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* Bilgi */}
        <Card className="rounded-2xl bg-muted/30 border-dashed">
          <CardContent className="p-4 text-xs text-muted-foreground space-y-1">
            <div className="font-medium text-foreground">{t("referral.info.title")}</div>
            <div>{t("referral.info.step1")}</div>
            <div>{t("referral.info.step2")}</div>
            <div>{t("referral.info.step3")}</div>
            <div className="pt-1 italic">{t("referral.info.rules")}</div>
          </CardContent>
        </Card>
      </div>
    </MemberLayout>
  );
}

// ============================================================
// RefereeProgressBanner — davet edilen üye için ilerleme
// ============================================================
function RefereeProgressBanner() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [data, setData] = useState<{
    has_pending: boolean;
    threshold: number;
    current_spend: number;
    remaining: number;
    referrer_masked_name: string | null;
  } | null>(null);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const rows = await rpc<any[]>("my_referee_progress").catch(() => null);
      if (!rows) return;
      const row = rows?.[0];
      if (row) setData(row);
    })();
  }, [user]);

  if (!data || !data.has_pending) return null;

  const threshold = Number(data.threshold) || 0;
  const currentSpend = Number(data.current_spend) || 0;
  const pct = threshold > 0 ? Math.min(100, Math.round((currentSpend / threshold) * 100)) : 0;

  return (
    <Card className="rounded-2xl border-primary/30 bg-primary/5">
      <CardContent className="p-4 space-y-2">
        <div className="flex items-start gap-2">
          <Hourglass className="size-5 text-primary shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="text-sm font-semibold text-foreground">
              {t("referral.progress.title")}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {t("referral.progress.body", {
                threshold: fmtTRY(threshold),
                referrer: data.referrer_masked_name ?? "—",
              })}
            </div>
          </div>
        </div>
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground tabular-nums">
              {fmtTRY(currentSpend)} / {fmtTRY(threshold)}
            </span>
            <span className="font-semibold tabular-nums text-primary">%{pct}</span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
