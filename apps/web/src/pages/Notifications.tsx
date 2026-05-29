import MemberLayout from "@/components/MemberLayout";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { rpc } from "@/lib/rpc";
import { dbSelect, dbUpdate } from "@/lib/db";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft, Bell, BellOff, CheckCheck, AlertTriangle, CheckCircle2,
  Info, XCircle, X, ChevronRight,
} from "lucide-react";
import { fmtRelative } from "@/lib/format";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

type Notif = {
  id: string;
  category: string;
  severity: "info" | "success" | "warning" | "error";
  title: string;
  body: string | null;
  cta_label: string | null;
  cta_url: string | null;
  read_at: string | null;
  dismissed_at: string | null;
  created_at: string;
};

const SEVERITY_META: Record<string, { icon: any; bg: string; fg: string }> = {
  success: { icon: CheckCircle2,   bg: "bg-success/10",     fg: "text-success" },
  info:    { icon: Info,           bg: "bg-primary/10",     fg: "text-primary" },
  warning: { icon: AlertTriangle,  bg: "bg-warning/10",     fg: "text-warning-foreground" },
  error:   { icon: XCircle,        bg: "bg-destructive/10", fg: "text-destructive" },
};

// Transaction + merchant categories use TR labels (not raw English uppercase).
const CATEGORY_KEYS: Record<string, string> = {
  wallet:      "wallet",
  loyalty:     "loyalty",
  security:    "security",
  promo:       "promo",
  system:      "system",
  transaction: "transaction",
  merchant:    "merchant",
};

export default function Notifications() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const nav = useNavigate();
  const [items, setItems] = useState<Notif[]>([]);
  const [loading, setLoading] = useState(true);
  const [marking, setMarking] = useState(false);

  const load = async () => {
    if (!user) return;
    setLoading(true);
    const data = await dbSelect<Notif>("notifications", {
      cols: "id, category, severity, title, body, cta_label, cta_url, read_at, dismissed_at, created_at",
      where: { user_id: user.id, dismissed_at: null },
      order: { col: "created_at", asc: false },
      limit: 100,
    }).catch(() => [] as Notif[]);
    setItems(data);
    setLoading(false);
  };

  useEffect(() => { load(); }, [user]);

  const markRead = async (id: string) => {
    await dbUpdate("notifications", { read_at: new Date().toISOString() }, { id }).catch(() => {});
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n)));
  };

  const dismiss = async (id: string) => {
    await dbUpdate("notifications", { dismissed_at: new Date().toISOString() }, { id }).catch(() => {});
    setItems((prev) => prev.filter((n) => n.id !== id));
  };

  const markAllRead = async () => {
    setMarking(true);
    try {
      const data = await rpc<number | unknown>("mark_all_notifications_read").catch(() => 0);
      const n = typeof data === "number" ? data : 0;
      toast.success(n > 0 ? t("member.notifications.markedRead", { n }) : t("member.notifications.noUnread"));
      load();
    } finally {
      setMarking(false);
    }
  };

  const handleClick = async (n: Notif) => {
    if (!n.read_at) await markRead(n.id);
    if (n.cta_url) nav(n.cta_url);
  };

  const unreadCount = items.filter((n) => !n.read_at).length;

  return (
    <MemberLayout>
      <div className="pt-4 sm:pt-6 pb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link to="/" className="size-9 rounded-full bg-muted flex items-center justify-center">
            <ArrowLeft className="size-4" />
          </Link>
          <div>
            <h1 className="text-xl font-bold">{t("member.notifications.title")}</h1>
            <p className="text-xs text-muted-foreground">
              {unreadCount > 0 ? t("member.notifications.unreadCount", { n: unreadCount }) : t("member.notifications.allRead")}
            </p>
          </div>
        </div>
        {unreadCount > 0 && (
          <Button size="sm" variant="outline" onClick={markAllRead} disabled={marking}>
            <CheckCheck className="size-4 mr-1" />
            {t("member.notifications.markAllRead")}
          </Button>
        )}
      </div>

      <div className="pb-6">
        {loading ? (
          <div className="text-center text-sm text-muted-foreground py-12">{t("member.notifications.loading")}</div>
        ) : items.length === 0 ? (
          <div className="soft-card rounded-2xl p-10 text-center space-y-3">
            <div className="size-14 rounded-full bg-muted flex items-center justify-center mx-auto">
              <BellOff className="size-7 text-muted-foreground" />
            </div>
            <div>
              <div className="font-semibold">{t("member.notifications.emptyTitle")}</div>
              <div className="text-sm text-muted-foreground mt-1">
                {t("member.notifications.emptyBody")}
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((n) => {
              const meta = SEVERITY_META[n.severity] ?? SEVERITY_META.info;
              const Icon = meta.icon;
              const unread = !n.read_at;
              return (
                <div
                  key={n.id}
                  className={`soft-card rounded-2xl p-4 transition ${unread ? "ring-1 ring-primary/30" : ""}`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`size-10 rounded-full flex items-center justify-center shrink-0 ${meta.bg}`}>
                      <Icon className={`size-5 ${meta.fg}`} />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div
                          className="flex-1 cursor-pointer"
                          onClick={() => handleClick(n)}
                        >
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
                              {CATEGORY_KEYS[n.category] ? t(`member.notifications.categories.${CATEGORY_KEYS[n.category]}`) : n.category}
                            </span>
                            {unread && (
                              <span className="size-1.5 rounded-full bg-primary" aria-label={t("member.notifications.newAria")} />
                            )}
                          </div>
                          <div className="font-semibold mt-0.5">{n.title}</div>
                          {/* Mask any UUID embedded in the body (Hard rule #7 — no merchant id/UUID leaks to the member). */}
                          {n.body && (
                            <div className="text-sm text-muted-foreground mt-0.5">
                              {n.body.replace(/Merchant ID:\s*[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\s*·?\s*/gi, "").replace(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi, "").trim()}
                            </div>
                          )}
                          <div className="text-[11px] text-muted-foreground mt-1.5">{fmtRelative(n.created_at)}</div>
                        </div>

                        <button
                          onClick={(e) => { e.stopPropagation(); dismiss(n.id); }}
                          className="size-7 rounded-full hover:bg-muted flex items-center justify-center shrink-0"
                          aria-label={t("member.notifications.dismissAria")}
                        >
                          <X className="size-4 text-muted-foreground" />
                        </button>
                      </div>

                      {n.cta_url && n.cta_label && (
                        <Link
                          to={n.cta_url}
                          onClick={() => !n.read_at && markRead(n.id)}
                          className="inline-flex items-center gap-1 mt-2 text-sm text-primary font-medium hover:underline"
                        >
                          {n.cta_label}
                          <ChevronRight className="size-3" />
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </MemberLayout>
  );
}

// Optional helper for callers (not used here, kept for tree-shaking awareness)
export const _NotifIconRef = Bell;
