import { ReactNode, useEffect, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { rpc } from "@/lib/rpc";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  LayoutDashboard,
  Network,
  Receipt,
  Settings as SettingsIcon,
  LogOut,
  Wallet,
  Users as UsersIcon,
  User as UserIcon,
  Shield,
  Coins,
  BadgeCheck,
  BookOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";

type NavItem = {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  end?: boolean;
  ownerOnly?: boolean;
  commerceOnly?: boolean;
};

const NAV_GROUPS: Array<{ label: string; items: NavItem[] }> = [
  {
    label: "Operasyon",
    items: [
      { to: "/merchant", label: "Dashboard", icon: LayoutDashboard, end: true },
      { to: "/merchant/transactions", label: "Üye işlemleri", icon: Receipt },
      { to: "/merchant/cashout", label: "Tahsilat", icon: Coins, commerceOnly: true },
      { to: "/merchant/settlement", label: "Mutabakat", icon: Receipt },
      { to: "/merchant/api-calls", label: "API çağrıları", icon: Network },
      { to: "/merchant/api-docs", label: "API dokümantasyonu", icon: BookOpen, commerceOnly: true },
    ],
  },
  {
    label: "Yönetim",
    items: [
      { to: "/merchant/users", label: "Kullanıcılar", icon: UsersIcon, ownerOnly: true },
      { to: "/merchant/permissions", label: "Yetkiler", icon: Shield, ownerOnly: true },
      { to: "/merchant/settings", label: "Ayarlar", icon: SettingsIcon, ownerOnly: true },
    ],
  },
  {
    label: "Hesap",
    items: [{ to: "/merchant/profile", label: "Profil", icon: UserIcon }],
  },
];

function MerchantSidebar({
  merchantName,
  merchantType,
  merchantRole,
  isOwner,
  onLogout,
}: {
  merchantName: string | null;
  merchantType: string | null;
  merchantRole: string | null;
  isOwner: boolean;
  onLogout: () => void;
}) {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";

  const visibleGroups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => {
      if (item.commerceOnly && merchantType !== "commerce") return false;
      if (item.ownerOnly && !isOwner) return false;
      return true;
    }),
  })).filter((group) => group.items.length > 0);

  return (
    <Sidebar collapsible="icon" className="border-r">
      <SidebarContent>
        <div className="px-4 py-4 flex items-center gap-2 border-b">
          <div className="size-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Wallet className="size-4 text-primary" />
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <div className="text-sm font-bold leading-tight">Merchant BO</div>
              <div className="text-[10px] text-muted-foreground truncate">{merchantName ?? "—"}</div>
              {merchantType && (
                <div
                  className={cn(
                    "mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
                    merchantType === "finance" ? "bg-blue-500/10 text-blue-600" : "bg-purple-500/10 text-purple-600",
                  )}
                >
                  <BadgeCheck className="size-3 shrink-0" />
                  {merchantType === "finance" ? "Finans" : "Ticari"} · {merchantRole ?? "user"}
                </div>
              )}
            </div>
          )}
        </div>
        {visibleGroups.map((group) => (
          <SidebarGroup key={group.label} className="py-2">
            <SidebarGroupLabel>{!collapsed && group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.to}>
                    <SidebarMenuButton asChild>
                      <NavLink
                        to={item.to}
                        end={item.end}
                        className={({ isActive }) =>
                          cn(
                            "flex items-center gap-2 rounded-md w-full",
                            isActive && "bg-primary/10 text-primary font-medium",
                          )
                        }
                      >
                        <item.icon className="size-4 shrink-0" />
                        {!collapsed && <span>{item.label}</span>}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton onClick={onLogout} className="text-destructive">
                  <LogOut className="size-4" />
                  {!collapsed && <span>Çıkış</span>}
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}

export default function MerchantLayout({ title, children }: { title?: string; children: ReactNode }) {
  const { user, signOut } = useAuth();
  const nav = useNavigate();
  const [merchantRole, setMerchantRole] = useState<string | null>(null);
  const [merchantName, setMerchantName] = useState<string | null>(null);
  const [merchantType, setMerchantType] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    Promise.all([
      rpc<{ role?: string; merchant_name?: string; merchant_type?: string } | Array<{ role?: string; merchant_name?: string; merchant_type?: string }>>("merchant_self_nav").catch(() => null),
      rpc<{ name?: string; merchant_type?: string } | Array<{ name?: string; merchant_type?: string }>>("merchant_self").catch(() => null),
    ])
      .then(([navData, selfData]) => {
        const navRow = Array.isArray(navData) ? navData[0] : navData;
        const selfRow = Array.isArray(selfData) ? selfData[0] : selfData;
        setMerchantRole(navRow?.role ?? null);
        setMerchantName(navRow?.merchant_name ?? selfRow?.name ?? null);
        setMerchantType(navRow?.merchant_type ?? selfRow?.merchant_type ?? null);
      })
      .catch(() => {
        setMerchantRole(null);
        setMerchantName(null);
        setMerchantType(null);
      });
  }, [user]);

  const isOwner = merchantRole === "owner";

  const onLogout = async () => {
    await signOut();
    nav("/auth");
  };

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-muted/20">
        <MerchantSidebar
          merchantName={merchantName}
          merchantType={merchantType}
          merchantRole={merchantRole}
          isOwner={isOwner}
          onLogout={onLogout}
        />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-14 bg-card border-b flex items-center px-3 sm:px-4 gap-2 sticky top-0 z-10 shrink-0">
            <SidebarTrigger />
            {title && <h1 className="text-sm sm:text-base font-bold truncate">{title}</h1>}
          </header>
          <main className="flex-1 p-3 sm:p-4 lg:p-6 min-w-0 overflow-x-auto">{children}</main>
        </div>
      </div>
    </SidebarProvider>
  );
}
