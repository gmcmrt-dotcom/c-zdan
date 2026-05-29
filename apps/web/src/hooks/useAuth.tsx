import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  apiGet,
  apiPost,
  getAal,
  getRefreshToken,
  hasSessionHint,
  setTokens,
  type Tokens,
} from "@/lib/api";

type AppRole = "admin" | "accounting" | "support";
type Permission = { resource: string; action: string };

interface MeResponse {
  user: { id: string; email: string; emailVerified: boolean; aal: "aal1" | "aal2" };
  profile: {
    memberNo: string;
    firstName: string;
    lastName: string;
    phone: string | null;
    kycStatus: "none" | "pending" | "verified" | "rejected";
    isFrozen: boolean;
    referralCode: string | null;
  } | null;
  memberships: {
    isStaff: boolean;
    roles: AppRole[];
    merchantId: string | null;
    merchantRole: "owner" | "accountant" | "read_only" | null;
    isAffiliate: boolean;
  };
  mfa: { enabled: boolean; required: boolean; factorsCount: number };
  permissions: Permission[];
}

interface SessionUser {
  id: string;
  email: string;
}

interface AuthCtx {
  user: SessionUser | null;
  /** Backwards-compat alias: many components access `session?.user` */
  session: { user: SessionUser } | null;
  loading: boolean;
  roles: AppRole[];
  permissions: Permission[];
  isStaff: boolean;
  merchantId: string | null;
  merchantRole: "owner" | "accountant" | "read_only" | null;
  membershipReady: boolean;
  requiresMfa: boolean;
  currentAal: "aal1" | "aal2" | null;
  mfaFactorsCount: number;
  mfaReady: boolean;
  can: (resource: string, action: string) => boolean;
  canAny: (resource: string, actions: string[]) => boolean;
  signOut: (opts?: { allDevices?: boolean }) => Promise<void>;
  refreshPermissions: () => Promise<void>;
  refreshMfa: () => Promise<void>;
  /** Apply tokens returned from /auth/login or /auth/signup and prime me. */
  setTokensAndLoad: (tokens: Tokens) => Promise<void>;
}

const Ctx = createContext<AuthCtx>({
  user: null,
  session: null,
  loading: true,
  roles: [],
  permissions: [],
  isStaff: false,
  merchantId: null,
  merchantRole: null,
  membershipReady: false,
  requiresMfa: false,
  currentAal: null,
  mfaFactorsCount: 0,
  mfaReady: false,
  can: () => false,
  canAny: () => false,
  signOut: async () => {},
  refreshPermissions: async () => {},
  refreshMfa: async () => {},
  setTokensAndLoad: async () => {},
});

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [merchantId, setMerchantId] = useState<string | null>(null);
  const [merchantRole, setMerchantRole] = useState<AuthCtx["merchantRole"]>(null);
  const [requiresMfa, setRequiresMfa] = useState(false);
  const [currentAal, setCurrentAal] = useState<"aal1" | "aal2" | null>(null);
  const [mfaFactorsCount, setMfaFactorsCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [membershipReady, setMembershipReady] = useState(false);
  const [mfaReady, setMfaReady] = useState(false);
  const loadingRef = useRef(false);

  const applyMe = useCallback((me: MeResponse) => {
    setUser({ id: me.user.id, email: me.user.email });
    setRoles(me.memberships.roles);
    setPermissions(me.permissions);
    setMerchantId(me.memberships.merchantId);
    setMerchantRole(me.memberships.merchantRole);
    setRequiresMfa(me.mfa.required);
    setMfaFactorsCount(me.mfa.factorsCount);
    setCurrentAal(me.user.aal);
  }, []);

  const clearAll = useCallback(() => {
    setUser(null);
    setRoles([]);
    setPermissions([]);
    setMerchantId(null);
    setMerchantRole(null);
    setRequiresMfa(false);
    setMfaFactorsCount(0);
    setCurrentAal(null);
  }, []);

  const loadMe = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setMembershipReady(false);
    setMfaReady(false);
    try {
      // O.2-fix — Post-Batch O the access token lives in an HttpOnly cookie
      // and is invisible to JS, so we can't pre-check `getAccessToken()` here
      // (it would always be null and short-circuit `clearAll()` even when the
      // cookie is valid — that's the post-login navigation regression).
      // Trust the non-token session hint instead; the cookie carries the JWT
      // and `/auth/me` is the source of truth.
      if (!hasSessionHint()) {
        clearAll();
        return;
      }
      const me = await apiGet<MeResponse>("/auth/me");
      applyMe(me);
    } catch {
      // bad token / network error → drop session
      setTokens(null);
      clearAll();
    } finally {
      setMembershipReady(true);
      setMfaReady(true);
      loadingRef.current = false;
    }
  }, [applyMe, clearAll]);

  useEffect(() => {
    void (async () => {
      await loadMe();
      // Side-effect: record login IP (non-blocking).
      // O.2-fix — use the cookie-aware session hint, not getAccessToken().
      if (hasSessionHint()) {
        apiPost("/auth/record-login").catch(() => {});
      }
      setLoading(false);
    })();

    const onStorage = (e: StorageEvent) => {
      // O.2-fix — cross-tab login/logout now writes `wallet.session-present`
      // instead of the legacy token keys; keep the legacy keys in the list
      // so the migration release still sees rotations from older tabs.
      if (
        e.key === "wallet.session-present" ||
        e.key === "wallet.accessToken" ||
        e.key === "wallet.refreshToken"
      ) {
        void loadMe();
      }
    };
    const onAuthChanged = () => void loadMe();
    // P1 — `wallet.auth-cleared` is dispatched by api.ts when a 401 retry
    // still fails (refresh token revoked, user disabled). Drop all local
    // state immediately + clear React Query so cached responses for the
    // old identity can't leak into the new (anonymous) UI.
    const onAuthCleared = () => {
      clearAll();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("wallet.auth-changed", onAuthChanged);
    window.addEventListener("wallet.auth-cleared", onAuthCleared);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("wallet.auth-changed", onAuthChanged);
      window.removeEventListener("wallet.auth-cleared", onAuthCleared);
    };
  }, [loadMe, clearAll]);

  const signOut = useCallback(async (opts?: { allDevices?: boolean }) => {
    try {
      // H5 — Always include refresh token + optional allDevices flag so the
      // server revokes the row(s) immediately. Without `allDevices`, only
      // the current refresh chain is killed.
      await apiPost("/auth/logout", {
        refreshToken: getRefreshToken() ?? undefined,
        allDevices: opts?.allDevices === true,
      });
    } catch {
      // ignore
    } finally {
      setTokens(null);
      clearAll();
    }
  }, [clearAll]);

  const refreshPermissions = useCallback(async () => {
    // O.2-fix — gate on the cookie-aware hint, not the (now-always-null)
    // legacy access token getter.
    if (!hasSessionHint()) return;
    try {
      const me = await apiGet<MeResponse>("/auth/me");
      applyMe(me);
    } catch {
      /* ignore */
    }
  }, [applyMe]);

  const refreshMfa = useCallback(async () => {
    await refreshPermissions();
  }, [refreshPermissions]);

  const setTokensAndLoad = useCallback(
    async (tokens: Tokens) => {
      setTokens(tokens);
      await loadMe();
    },
    [loadMe],
  );

  const ctxValue = useMemo<AuthCtx>(() => {
    const can = (resource: string, action: string) =>
      permissions.some((p) => p.resource === resource && p.action === action);
    const canAny = (resource: string, actions: string[]) =>
      actions.some((a) => can(resource, a));
    return {
      user,
      session: user ? { user } : null,
      loading,
      roles,
      permissions,
      isStaff: roles.length > 0,
      merchantId,
      merchantRole,
      membershipReady,
      requiresMfa,
      currentAal: currentAal ?? getAal(),
      mfaFactorsCount,
      mfaReady,
      can,
      canAny,
      signOut,
      refreshPermissions,
      refreshMfa,
      setTokensAndLoad,
    };
  }, [
    user,
    loading,
    roles,
    permissions,
    merchantId,
    merchantRole,
    membershipReady,
    requiresMfa,
    currentAal,
    mfaFactorsCount,
    mfaReady,
    signOut,
    refreshPermissions,
    refreshMfa,
    setTokensAndLoad,
  ]);

  return <Ctx.Provider value={ctxValue}>{children}</Ctx.Provider>;
};

export const useAuth = () => useContext(Ctx);
