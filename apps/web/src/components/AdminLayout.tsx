import { ReactNode, useEffect, useState } from "react";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { useAuth } from "@/hooks/useAuth";
import { dbCount } from "@/lib/db";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { LogOut, Wallet, ShieldAlert } from "lucide-react";
import { getAdminNavGroups, type AdminNavItemDef } from "@/lib/admin-bo-registry";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import HelpButton from "@/components/HelpButton";
import BoAiAssistant from "@/components/BoAiAssistant";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";

// Sidebar pending chat count polling — 60sn interval
const CHAT_POLL_INTERVAL_MS = 60_000;
function useChatPendingCount(enabled: boolean) {
  const [count, setCount] = useState<number>(0);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const fetchCount = async () => {
      const c = await dbCount("chat_threads", {
        where: [{ col: "status", op: "in", val: ["open", "pending_staff"] }],
      }).catch(() => 0);
      if (alive) setCount(c);
    };
    fetchCount();
    const id = setInterval(fetchCount, CHAT_POLL_INTERVAL_MS);
    return () => { alive = false; clearInterval(id); };
  }, [enabled]);
  return count;
}

function AdminSidebar() {
  const { t } = useTranslation();
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const { roles, signOut } = useAuth();
  const location = useLocation();

  // NavLink default isActive sadece pathname'i karşılaştırır.
  // /admin/merchants?type=commerce ve ?type=finance aynı pathname olduğu
  // için ikisi birden active görünüyordu. Querystring ile ayır.
  const isItemActive = (itemUrl: string): boolean => {
    const [path, query] = itemUrl.split("?");
    if (location.pathname !== path) return false;
    if (!query) {
      // Query'siz nav item: aynı pathname'de query'li başka bir item da
      // varsa default'unu (query'siz) seçili göstermek için sadece tam
      // eşleşmeli (location.search boş olmalı).
      return location.search === "" || location.search === "?";
    }
    // Query'li nav item: location.search'de tüm key/value'lar bulunmalı
    const itemParams = new URLSearchParams(query);
    const locParams = new URLSearchParams(location.search);
    for (const [k, v] of itemParams.entries()) {
      if (locParams.get(k) !== v) return false;
    }
    return true;
  };

  // Destek menüsünde pending chat count badge'i.
  // Sadece staff için poll (admin/accounting/support).
  const isStaff = roles.length > 0;
  const chatPending = useChatPendingCount(isStaff);

  type NavItem = AdminNavItemDef & { badge?: number };
  const groups = getAdminNavGroups().map((g) => ({
    label: g.label,
    items: g.items.map((item): NavItem => ({
      ...item,
      title: item.titleI18nKey ? t(item.titleI18nKey) : item.title,
      badge: item.url === "/admin/chat" ? chatPending : undefined,
    })),
  }));

  const visibleGroups = groups
    .map((g) => ({ ...g, items: g.items.filter((i) => i.roles.some((r) => roles.includes(r as any))) }))
    .filter((g) => g.items.length > 0);

  return (
    <Sidebar collapsible="icon" className="border-r">
      <SidebarContent>
        <div className="px-4 py-4 flex items-center gap-2 border-b">
          <div className="size-8 rounded-lg bg-primary flex items-center justify-center">
            <Wallet className="size-4 text-primary-foreground" />
          </div>
          {!collapsed && (
            <div>
              <div className="text-sm font-bold leading-tight">Wallet</div>
              <div className="text-xs text-muted-foreground">{t("admin.header.backOffice")}</div>
            </div>
          )}
        </div>
        {visibleGroups.map((group) => (
          <SidebarGroup key={group.label} className="py-2">
            <SidebarGroupLabel>{!collapsed && group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  // querystring duyarlı active state
                  const active = isItemActive(item.url);
                  return (
                    <SidebarMenuItem key={item.url}>
                      <SidebarMenuButton asChild>
                        <Link
                          to={item.url}
                          aria-current={active ? "page" : undefined}
                          className={cn(
                            "flex items-center gap-2 hover:bg-muted/60 rounded-md",
                            active && "bg-primary/10 text-primary font-medium",
                          )}
                        >
                          <div className="relative">
                            <item.icon className="size-4" />
                            {/* Pending count badge — collapsed sidebar'da icon'un üstünde */}
                            {collapsed && item.badge !== undefined && item.badge > 0 && (
                              <span className="absolute -top-1.5 -right-1.5 size-4 rounded-full bg-destructive text-destructive-foreground text-[9px] font-bold flex items-center justify-center">
                                {item.badge > 99 ? "99+" : item.badge}
                              </span>
                            )}
                          </div>
                          {!collapsed && (
                            <>
                              <span className="flex-1">{item.title}</span>
                              {item.badge !== undefined && item.badge > 0 && (
                                <span className="ml-auto px-1.5 py-0.5 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold min-w-[18px] text-center">
                                  {item.badge > 99 ? "99+" : item.badge}
                                </span>
                              )}
                            </>
                          )}
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton onClick={signOut} className="text-destructive">
                  <LogOut className="size-4" />
                  {!collapsed && <span>{t("common.logout")}</span>}
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}

type AdminLayoutProps = {
  children: ReactNode;
  title: string;
  /** Page-level permission gate. Sidebar role filtering is not authorization. */
  requireAny?: string[];
};

function hasSpec(can: (resource: string, action: string) => boolean, spec: string) {
  const [resource, action = "view"] = spec.split(":");
  return can(resource, action);
}

export default function AdminLayout({ children, title, requireAny }: AdminLayoutProps) {
  const { isStaff, loading, user, membershipReady, can } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();

  useEffect(() => {
    if (!loading && user && !isStaff) nav("/", { replace: true });
  }, [loading, isStaff, user, nav]);

  if (loading || !membershipReady) return null;
  if (!isStaff) return null;

  const allowed = !requireAny?.length || requireAny.some((spec) => hasSpec(can, spec));

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-muted/30">
        <AdminSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-14 bg-background border-b flex items-center px-3 sm:px-4 gap-2 sm:gap-3 sticky top-0 z-10 shrink-0">
            <SidebarTrigger />
            <h1 className="text-sm sm:text-base font-semibold flex items-center gap-1 min-w-0 truncate">
              <span className="truncate">{title}</span>
              <HelpButton pageKey={loc.pathname} audience="staff" />
            </h1>
            <div className="ml-auto flex items-center gap-1">
              <LanguageSwitcher />
            </div>
          </header>
          <main className="flex-1 p-3 sm:p-4 lg:p-6 min-w-0 overflow-x-auto">
            {allowed ? children : (
              <Card className="p-8 text-center max-w-xl mx-auto mt-10">
                <ShieldAlert className="size-10 mx-auto text-warning mb-3" />
                <div className="font-medium">Bu sayfa için yetkiniz yok</div>
                <p className="text-sm text-muted-foreground mt-1">
                  Bu ekranı görüntülemek için ilgili BO izni gerekir. Yetki gerekiyorsa admin kullanıcınızla görüşün.
                </p>
              </Card>
            )}
          </main>
          <BoAiAssistant />
        </div>
      </div>
    </SidebarProvider>
  );
}
