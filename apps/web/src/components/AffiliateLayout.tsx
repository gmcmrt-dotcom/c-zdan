import { ReactNode, useEffect, useState } from "react";
import { NavLink, useNavigate, Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { dbSelectMaybeOne } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { LayoutDashboard, ListOrdered, Wallet, LogOut, Loader2, User as UserIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { isAffiliateEnabled } from "@/lib/feature-flags";



/**
 * Affiliate portal'a erişim:
 *   - external affiliate (auth_user_id eşleşmesi)
 *   - internal_member affiliate (linked_user_id eşleşmesi)
 * Hiçbiri değilse → /'a yönlendir (üye home).
 */
export default function AffiliateLayout({ title, children }: { title?: string; children: ReactNode }) {
  const affiliateEnabled = isAffiliateEnabled();
  const { t } = useTranslation();
  const NAV = [
    { to: "/affiliate", label: t("affiliate.layout.navDashboard"), icon: LayoutDashboard, end: true },
    { to: "/affiliate/ledger", label: t("affiliate.layout.navLedger"), icon: ListOrdered },
    { to: "/affiliate/payouts", label: t("affiliate.layout.navPayouts"), icon: Wallet },
    // Profil sayfası
    { to: "/affiliate/profile", label: t("affiliate.layout.navProfile"), icon: UserIcon, end: false },
  ];
  const { user, signOut, loading: authLoading } = useAuth();
  const nav = useNavigate();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [affiliateName, setAffiliateName] = useState<string>("");

  useEffect(() => {
    if (!user) {
      setAllowed(null);
      setAffiliateName("");
      return;
    }
    let cancelled = false;
    setAllowed(null);
    (async () => {
      const data = await dbSelectMaybeOne<{ id: string; name: string; code: string; status: string; kind: string }>("merchant_affiliates", {
        cols: "id, name, code, status, kind",
        or: [`auth_user_id.eq.${user.id},linked_user_id.eq.${user.id}`],
        where: { status: "active" },
      }).catch(() => null);

      if (cancelled) return;
      if (!data) {
        setAllowed(false);
      } else {
        setAllowed(true);
        setAffiliateName(`${data.name} · ${data.code}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const onLogout = async () => {
    await signOut();
    nav("/auth");
  };

  if (!affiliateEnabled) {
    return <Navigate to="/" replace />;
  }

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  if (allowed === null) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="animate-spin" />
      </div>
    );
  }

  if (!allowed) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="min-h-screen bg-muted/20 flex flex-col md:flex-row">
      <aside className="w-full md:w-60 bg-card border-b md:border-b-0 md:border-r flex md:flex-col">
        <div className="p-3 md:p-4 border-r md:border-r-0 md:border-b flex items-center gap-2 shrink-0">
          <div className="size-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <Wallet className="size-4 text-primary" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-bold">{t("affiliate.layout.portalTitle")}</div>
            <div className="text-[10px] text-muted-foreground truncate">{affiliateName || user.email}</div>
          </div>
        </div>
        <nav className="flex-1 p-2 flex md:block gap-1 md:space-y-1 overflow-x-auto">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition whitespace-nowrap ${
                  isActive ? "bg-primary text-primary-foreground" : "hover:bg-muted"
                }`
              }
            >
              <item.icon className="size-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="p-2 border-l md:border-l-0 md:border-t shrink-0">
          <Button variant="ghost" size="sm" className="w-full justify-start" onClick={onLogout}>
            <LogOut className="size-4 mr-2" /> {t("affiliate.layout.logout")}
          </Button>
        </div>
      </aside>

      <main className="flex-1 min-w-0">
        {title && (
          <header className="bg-card border-b px-4 md:px-6 py-4">
            <h1 className="text-xl font-bold">{title}</h1>
          </header>
        )}
        <div className="p-4 md:p-6">{children}</div>
      </main>
    </div>
  );
}
