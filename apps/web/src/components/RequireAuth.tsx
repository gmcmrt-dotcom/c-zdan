import { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Loader2 } from "lucide-react";
import { detectHostScope, scopeRedirect } from "@/lib/hostScope";

// MFA enforcement feature flag.
// Default OFF — staff bypass MFA challenge until ops explicitly enables it.
// Enable by setting VITE_MFA_ENFORCEMENT=true in apps/web/.env.local (or the
// build-host environment) BEFORE building. Vite inlines the value at compile time.
const MFA_ENFORCEMENT_ENABLED = import.meta.env.VITE_MFA_ENFORCEMENT === "true";

type Props = {
  children: ReactNode;
  /** /admin/* — kullanıcı staff (role'ü olan) olmalı. Audit 4.1. */
  requireStaff?: boolean;
  /** /merchant/* — kullanıcı aktif merchant_users üyesi olmalı. Audit 4.2. */
  requireMerchant?: boolean;
};

export default function RequireAuth({ children, requireStaff, requireMerchant }: Props) {
  const {
    user, loading, isStaff, merchantId, membershipReady,
    requiresMfa, currentAal, mfaFactorsCount, mfaReady,
  } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    );
  }
  if (!user) return <Navigate to="/auth" replace state={{ from: location }} />;

  // Host scope kontrolü (subdomain ayrımı) — strict modda /admin /merchant izolasyonu
  const scope = detectHostScope();
  const redirectTo = scopeRedirect(location.pathname, scope);
  if (redirectTo && redirectTo !== location.pathname) {
    return <Navigate to={redirectTo} replace />;
  }

  // Audit 4.1/4.2 — rol/üyelik gating. membershipReady false iken karar
  // ALMA, yoksa fetch tamamlanmadan haksız 403 verebiliriz.
  if (requireStaff || requireMerchant) {
    if (!membershipReady) {
      return (
        <div className="min-h-screen flex items-center justify-center">
          <Loader2 className="size-8 animate-spin text-primary" />
        </div>
      );
    }
    if (requireStaff && !isStaff) {
      return <Navigate to="/" replace />;
    }
    if (requireMerchant && !merchantId) {
      return <Navigate to="/" replace />;
    }
  }

  // MFA enforcement (staff only, gated by VITE_MFA_ENFORCEMENT).
  // requireStaff routes: redirect to /auth/mfa-challenge unless AAL2.
  // No enrolled factor → /profile/mfa for forced enrollment.
  // mfaReady=false → wait for the fetch (do not redirect early).
  if (MFA_ENFORCEMENT_ENABLED && requireStaff && requiresMfa) {
    if (!mfaReady) {
      return (
        <div className="min-h-screen flex items-center justify-center">
          <Loader2 className="size-8 animate-spin text-primary" />
        </div>
      );
    }
    if (mfaFactorsCount === 0) {
      // Hiç factor enroll edilmemiş — zorunlu kurulum
      if (location.pathname !== "/profile/mfa") {
        return <Navigate to="/profile/mfa" replace state={{ from: location, force: true }} />;
      }
    } else if (currentAal !== "aal2") {
      // Factor var ama bu session aal1 — challenge gerek
      if (location.pathname !== "/auth/mfa-challenge") {
        return <Navigate to="/auth/mfa-challenge" replace state={{ from: location }} />;
      }
    }
  }

  return <>{children}</>;
}
