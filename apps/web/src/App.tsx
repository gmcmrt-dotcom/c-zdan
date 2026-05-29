import { lazy, Suspense, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate, useParams } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/useAuth";
import RequireAuth from "@/components/RequireAuth";
import ErrorBoundary from "@/components/ErrorBoundary";
import PageLoader from "@/components/PageLoader";
import { AdminReferenceDataProvider } from "@/contexts/AdminReferenceDataContext";
import { isAffiliateEnabled } from "@/lib/feature-flags";

import AuthPage from "./pages/Auth";
import MemberHome from "./pages/MemberHome";
import Transactions from "./pages/Transactions";
import Topup from "./pages/Topup";
import TopupStatus from "./pages/TopupStatus";
import Notifications from "./pages/Notifications";
import Withdraw from "./pages/Withdraw";
import WithdrawStatus from "./pages/WithdrawStatus";
import Payment from "./pages/Payment";
import Loyalty from "./pages/Loyalty";
import Profile from "./pages/Profile";
import Referrals from "./pages/Referrals";
import ProfitShareRewards from "./pages/ProfitShareRewards";
import MockPay from "./pages/MockPay";
import MfaSetup from "./pages/MfaSetup";
import MfaChallenge from "./pages/MfaChallenge";
import NotFound from "./pages/NotFound.tsx";

const AdminDashboard = lazy(() => import("./pages/admin/Dashboard"));
const AdminMembers = lazy(() => import("./pages/admin/Members"));
const AdminMemberDetail = lazy(() => import("./pages/admin/MemberDetail"));
const AdminTransactions = lazy(() => import("./pages/admin/Transactions"));
const AdminMerchants = lazy(() => import("./pages/admin/Merchants"));
const AdminMerchantDetail = lazy(() => import("./pages/admin/MerchantDetailPage"));
const AdminMerchantChildren = lazy(() => import("./pages/admin/MerchantChildren"));
const AdminLoyalty = lazy(() => import("./pages/admin/Loyalty"));
const AdminReferrals = lazy(() => import("./pages/admin/Referrals"));
const AdminAffiliates = lazy(() => import("./pages/admin/Affiliates"));
const AdminCommissions = lazy(() => import("./pages/admin/Commissions"));
const AdminReconciliation = lazy(() => import("./pages/admin/Reconciliation"));
const AdminLedgerIntegrity = lazy(() => import("./pages/admin/LedgerIntegrity"));
const AdminProfitShare = lazy(() => import("./pages/admin/ProfitShare"));
const AdminFinanceIntegrations = lazy(() => import("./pages/admin/FinanceIntegrations"));
const AdminSystemLogs = lazy(() => import("./pages/admin/SystemLogs"));
const AdminSettings = lazy(() => import("./pages/admin/Settings"));
const AdminUsers = lazy(() => import("./pages/admin/Users"));
const AdminChat = lazy(() => import("./pages/admin/Chat"));
const AdminPermissions = lazy(() => import("./pages/admin/Permissions"));
const AdminTemplates = lazy(() => import("./pages/admin/Templates"));
const AdminMethodTypes = lazy(() => import("./pages/admin/MethodTypes"));
const AdminOnboarding = lazy(() => import("./pages/admin/Onboarding"));

const MerchantDashboard = lazy(() => import("./pages/merchant/Dashboard"));
const MerchantSettlement = lazy(() => import("./pages/merchant/Settlement"));
const MerchantApiCalls = lazy(() => import("./pages/merchant/ApiCalls"));
const MerchantTransactions = lazy(() => import("./pages/merchant/Transactions"));
const MerchantCashout = lazy(() => import("./pages/merchant/Cashout"));
const MerchantChildren = lazy(() => import("./pages/merchant/Children"));
const MerchantSettings = lazy(() => import("./pages/merchant/Settings"));
const MerchantApiDocs = lazy(() => import("./pages/merchant/ApiDocs"));
const MerchantUsers = lazy(() => import("./pages/merchant/Users"));
const MerchantProfile = lazy(() => import("./pages/merchant/Profile"));
const MerchantPermissions = lazy(() => import("./pages/merchant/Permissions"));

const AffiliateDashboard = lazy(() => import("./pages/affiliate/Dashboard"));
const AffiliateLedger = lazy(() => import("./pages/affiliate/Ledger"));
const AffiliatePayouts = lazy(() => import("./pages/affiliate/Payouts"));
const AffiliateProfile = lazy(() => import("./pages/affiliate/Profile"));

function AdminUserRedirect() {
  const { id } = useParams<{ id: string }>();
  return <Navigate to={`/admin/users?selected=${id}`} replace />;
}

function StaffLazy({ children }: { children: ReactNode }) {
  return (
    <RequireAuth requireStaff>
      <AdminReferenceDataProvider>
        <Suspense fallback={<PageLoader />}>{children}</Suspense>
      </AdminReferenceDataProvider>
    </RequireAuth>
  );
}

function MerchantLazy({ children }: { children: ReactNode }) {
  return (
    <RequireAuth requireMerchant>
      <Suspense fallback={<PageLoader />}>{children}</Suspense>
    </RequireAuth>
  );
}

function AffiliateLazy({ children }: { children: ReactNode }) {
  if (!isAffiliateEnabled()) {
    return <Navigate to="/" replace />;
  }
  return (
    <RequireAuth>
      <Suspense fallback={<PageLoader />}>{children}</Suspense>
    </RequireAuth>
  );
}

function AdminAffiliatesRoute() {
  if (!isAffiliateEnabled()) {
    return <Navigate to="/admin" replace />;
  }
  return <AdminAffiliates />;
}

const queryClient = new QueryClient();

// P1 — When the API tells the SPA "you are no longer authenticated"
// (`wallet.auth-cleared` from lib/api.ts), wipe React Query so cached
// member/admin responses can't leak into the new (anonymous) UI. The
// event also fires on signOut via the chained dispatch.
if (typeof window !== "undefined") {
  window.addEventListener("wallet.auth-cleared", () => {
    queryClient.clear();
  });
}

const App = () => (
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <AuthProvider>
            <Routes>
              <Route path="/auth" element={<AuthPage />} />
              <Route path="/auth/mfa-challenge" element={<RequireAuth><MfaChallenge /></RequireAuth>} />
              <Route path="/mock-pay" element={<MockPay />} />
              <Route path="/" element={<RequireAuth><MemberHome /></RequireAuth>} />
              <Route path="/transactions" element={<RequireAuth><Transactions /></RequireAuth>} />
              <Route path="/topup" element={<RequireAuth><Topup /></RequireAuth>} />
              <Route path="/topup/status" element={<RequireAuth><TopupStatus /></RequireAuth>} />
              <Route path="/withdraw" element={<RequireAuth><Withdraw /></RequireAuth>} />
              <Route path="/withdraw/status" element={<RequireAuth><WithdrawStatus /></RequireAuth>} />
              <Route path="/payment" element={<RequireAuth><Payment /></RequireAuth>} />
              <Route path="/loyalty" element={<RequireAuth><Loyalty /></RequireAuth>} />
              <Route path="/profile" element={<RequireAuth><Profile /></RequireAuth>} />
              <Route path="/referrals" element={<RequireAuth><Referrals /></RequireAuth>} />
              <Route path="/profit-share" element={<RequireAuth><ProfitShareRewards /></RequireAuth>} />
              <Route path="/notifications" element={<RequireAuth><Notifications /></RequireAuth>} />
              <Route path="/profile/mfa" element={<RequireAuth><MfaSetup /></RequireAuth>} />

              <Route path="/admin" element={<StaffLazy><AdminDashboard /></StaffLazy>} />
              <Route path="/admin/members" element={<StaffLazy><AdminMembers /></StaffLazy>} />
              <Route path="/admin/members/:id" element={<StaffLazy><AdminMemberDetail /></StaffLazy>} />
              <Route path="/admin/transactions" element={<StaffLazy><AdminTransactions /></StaffLazy>} />
              <Route path="/admin/merchants" element={<StaffLazy><AdminMerchants /></StaffLazy>} />
              <Route path="/admin/merchant-children" element={<StaffLazy><AdminMerchantChildren /></StaffLazy>} />
              <Route path="/admin/merchants/:id" element={<StaffLazy><AdminMerchantDetail /></StaffLazy>} />
              <Route path="/admin/loyalty" element={<StaffLazy><AdminLoyalty /></StaffLazy>} />
              <Route path="/admin/referrals" element={<StaffLazy><AdminReferrals /></StaffLazy>} />
              <Route path="/admin/affiliates" element={<StaffLazy><AdminAffiliatesRoute /></StaffLazy>} />
              <Route path="/admin/commissions" element={<StaffLazy><AdminCommissions /></StaffLazy>} />
              <Route path="/admin/profit-share" element={<StaffLazy><AdminProfitShare /></StaffLazy>} />
              <Route path="/admin/reconciliation" element={<StaffLazy><AdminReconciliation /></StaffLazy>} />
              <Route path="/admin/ledger-integrity" element={<StaffLazy><AdminLedgerIntegrity /></StaffLazy>} />
              <Route path="/admin/ledger-integrity/:id" element={<StaffLazy><AdminLedgerIntegrity /></StaffLazy>} />
              <Route path="/admin/finance-integrations" element={<StaffLazy><AdminFinanceIntegrations /></StaffLazy>} />
              <Route path="/admin/system-logs" element={<StaffLazy><AdminSystemLogs /></StaffLazy>} />
              <Route path="/admin/chat" element={<StaffLazy><AdminChat /></StaffLazy>} />
              <Route path="/admin/settings" element={<StaffLazy><AdminSettings /></StaffLazy>} />
              <Route path="/admin/users" element={<StaffLazy><AdminUsers /></StaffLazy>} />
              <Route path="/admin/users/:id" element={<StaffLazy><AdminUserRedirect /></StaffLazy>} />
              <Route path="/admin/permissions" element={<StaffLazy><AdminPermissions /></StaffLazy>} />
              <Route path="/admin/templates" element={<StaffLazy><AdminTemplates /></StaffLazy>} />
              <Route path="/admin/method-types" element={<StaffLazy><AdminMethodTypes /></StaffLazy>} />
              <Route path="/admin/onboarding" element={<StaffLazy><AdminOnboarding /></StaffLazy>} />

              <Route path="/merchant" element={<MerchantLazy><MerchantDashboard /></MerchantLazy>} />
              <Route path="/merchant/settlement" element={<MerchantLazy><MerchantSettlement /></MerchantLazy>} />
              <Route path="/merchant/api-calls" element={<MerchantLazy><MerchantApiCalls /></MerchantLazy>} />
              <Route path="/merchant/transactions" element={<MerchantLazy><MerchantTransactions /></MerchantLazy>} />
              <Route path="/merchant/cashout" element={<MerchantLazy><MerchantCashout /></MerchantLazy>} />
              <Route path="/merchant/children" element={<MerchantLazy><MerchantChildren /></MerchantLazy>} />
              <Route path="/merchant/settings" element={<MerchantLazy><MerchantSettings /></MerchantLazy>} />
              <Route path="/merchant/api-docs" element={<MerchantLazy><MerchantApiDocs /></MerchantLazy>} />
              <Route path="/merchant/users" element={<MerchantLazy><MerchantUsers /></MerchantLazy>} />
              <Route path="/merchant/permissions" element={<MerchantLazy><MerchantPermissions /></MerchantLazy>} />
              <Route path="/merchant/profile" element={<MerchantLazy><MerchantProfile /></MerchantLazy>} />

              <Route path="/affiliate" element={<AffiliateLazy><AffiliateDashboard /></AffiliateLazy>} />
              <Route path="/affiliate/ledger" element={<AffiliateLazy><AffiliateLedger /></AffiliateLazy>} />
              <Route path="/affiliate/payouts" element={<AffiliateLazy><AffiliatePayouts /></AffiliateLazy>} />
              <Route path="/affiliate/profile" element={<AffiliateLazy><AffiliateProfile /></AffiliateLazy>} />

              <Route path="*" element={<NotFound />} />
            </Routes>
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
