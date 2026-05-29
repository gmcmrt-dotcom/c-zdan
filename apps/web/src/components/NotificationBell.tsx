import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bell, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { dbSelect, dbUpdate, type WhereCondition } from "@/lib/db";
import { subscribeRoom } from "@/lib/realtime";
import { useAuth } from "@/hooks/useAuth";
import { fmtRelative } from "@/lib/format";
import { Link } from "react-router-dom";

type Notif = {
  id: string;
  category: string;
  severity: "info" | "success" | "warning" | "error";
  title: string;
  body: string | null;
  cta_label: string | null;
  cta_url: string | null;
  created_at: string;
  read_at: string | null;
};

export default function NotificationBell() {
  const { user } = useAuth();
  const [list, setList] = useState<Notif[]>([]);
  const [loading, setLoading] = useState(false);

  const unread = list.filter((n) => !n.read_at).length;

  const load = async () => {
    if (!user) return;
    setLoading(true);
    const data = await dbSelect<Notif>("notifications", {
      cols: "id,category,severity,title,body,cta_label,cta_url,created_at,read_at",
      order: { col: "created_at", asc: false },
      limit: 20,
    }).catch(() => [] as Notif[]);
    setList(data);
    setLoading(false);
  };

  useEffect(() => {
    if (!user) return;
    load();
    // 60 sn'de bir tazele (basit polling — sonra realtime'a geçilebilir)
    const t = setInterval(load, 60000);
    // P1 — match the server room name exactly. Server emits to
    // `user:<userId>` (apps/api/src/realtime/server.ts emitNotification);
    // we were subscribing to `user-notifications:<userId>` so live updates
    // never arrived and the bell only refreshed on the 60s polling tick.
    const unsub = subscribeRoom(`user:${user.id}`, {
      "notification": () => load(),
    });
    return () => {
      clearInterval(t);
      unsub();
    };
  }, [user]);

  const markRead = async (id: string) => {
    await dbUpdate("notifications", { read_at: new Date().toISOString() }, { id }).catch(() => {});
    setList((l) => l.map((n) => n.id === id ? { ...n, read_at: new Date().toISOString() } : n));
  };
  const markAllRead = async () => {
    if (!user) return;
    const where: WhereCondition[] = [
      { col: "user_id", op: "eq", val: user.id },
      { col: "read_at", op: "eq", val: null },
    ];
    await dbUpdate("notifications", { read_at: new Date().toISOString() }, where).catch(() => {});
    load();
  };
  const dismiss = async (id: string) => {
    await dbUpdate("notifications", { dismissed_at: new Date().toISOString() }, { id }).catch(() => {});
    setList((l) => l.filter((n) => n.id !== id));
  };

  if (!user) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className="size-10 rounded-full bg-card border border-border flex items-center justify-center relative"
          aria-label="Bildirimler"
        >
          <Bell className="size-4 text-muted-foreground" />
          {unread > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center px-1">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <div className="flex items-center justify-between p-3 border-b">
          <span className="font-semibold text-sm">Bildirimler</span>
          {unread > 0 && (
            <button onClick={markAllRead} className="text-xs text-primary hover:underline">
              Tümünü okundu işaretle
            </button>
          )}
        </div>
        <div className="max-h-96 overflow-y-auto">
          {loading && <div className="p-6 text-center text-sm text-muted-foreground">Yükleniyor…</div>}
          {!loading && list.length === 0 && (
            <div className="p-6 text-center text-sm text-muted-foreground">Henüz bildirim yok</div>
          )}
          {list.map((n) => (
            <div key={n.id} className={`p-3 border-b last:border-b-0 hover:bg-muted/30 ${!n.read_at ? "bg-primary/5" : ""}`}>
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium truncate">{n.title}</span>
                    <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                      {fmtRelative(n.created_at)}
                    </span>
                  </div>
                  {n.body && <p className="text-xs text-muted-foreground mt-0.5">{n.body}</p>}
                  <div className="flex items-center gap-2 mt-1.5">
                    {n.cta_url && (
                      <Link to={n.cta_url} className="text-xs text-primary font-medium" onClick={() => markRead(n.id)}>
                        {n.cta_label ?? "Aç"}
                      </Link>
                    )}
                    {!n.read_at && (
                      <button onClick={() => markRead(n.id)} className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
                        <Check className="size-3" /> Okundu
                      </button>
                    )}
                    <button onClick={() => dismiss(n.id)} className="text-xs text-muted-foreground hover:text-destructive inline-flex items-center gap-1">
                      <X className="size-3" /> Kaldır
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
