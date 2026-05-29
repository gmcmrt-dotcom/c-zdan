import { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { Home, ListOrdered, ScanLine, Star, User } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import NotificationBell from "@/components/NotificationBell";
import HelpButton from "@/components/HelpButton";
import ChatWidget from "@/components/ChatWidget";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import FirstLoginTour from "@/components/FirstLoginTour";

export default function MemberLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const loc = useLocation();
  const { user } = useAuth();

  const tabs = [
    { to: "/", label: t("member.nav.home"), icon: Home, end: true },
    { to: "/transactions", label: t("member.nav.transactions"), icon: ListOrdered },
    { to: "/payment", label: t("member.nav.payment"), icon: ScanLine },
    { to: "/loyalty", label: t("member.nav.loyalty"), icon: Star },
    { to: "/profile", label: t("member.nav.profile"), icon: User },
  ];

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "var(--gradient-bg)" }}>
      {/* Top bar: help + notification bell + language switcher */}
      <div
        className="fixed top-0 right-0 z-30 flex items-center gap-1 p-3 sm:p-4 pointer-events-none"
        style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
      >
        <div className="pointer-events-auto flex items-center gap-1 rounded-full bg-card/80 backdrop-blur border border-border/60 px-1 py-0.5 shadow-sm">
          <HelpButton pageKey={loc.pathname} audience="member" />
          <NotificationBell />
          <LanguageSwitcher />
        </div>
      </div>

      <main
        className="flex-1 min-w-0 w-full max-w-md sm:max-w-lg md:max-w-xl mx-auto px-4 sm:px-5 pb-24"
        style={{ paddingTop: "calc(3.25rem + env(safe-area-inset-top, 0px))" }}
      >
        {children}
      </main>

      {/* Destek chat widget'ı her üye sayfasında */}
      <ChatWidget />
      <FirstLoginTour userId={user?.id} />

      {/* Bottom tab bar */}
      <nav
        className="fixed bottom-0 inset-x-0 z-40 bg-card/95 backdrop-blur border-t border-border"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="max-w-md sm:max-w-lg md:max-w-xl mx-auto grid grid-cols-5 px-1 sm:px-2 py-2 min-w-0">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <NavLink
                key={tab.to}
                to={tab.to}
                end={tab.end}
                className={({ isActive }) =>
                  cn(
                    "flex flex-col items-center justify-center gap-1 py-2 rounded-xl transition-colors min-h-[56px]",
                    isActive ? "text-primary" : "text-muted-foreground",
                  )
                }
              >
                <Icon className="size-5" />
                <span className="text-[11px] font-medium">{tab.label}</span>
              </NavLink>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
