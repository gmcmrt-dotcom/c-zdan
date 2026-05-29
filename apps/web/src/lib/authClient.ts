/**
 * Low-level auth helpers for pages that need to call the auth API directly
 * (Profile password change, MFA listing, etc.). Most components should use the
 * `useAuth()` hook instead — it covers login, signup, signOut, and currentUser.
 *
 * All functions throw `ApiError` on non-2xx.
 */
import { apiPost, apiGet, getRefreshToken, setTokens } from "./api";

export interface CurrentUser {
  id: string;
  email: string;
  role?: string | null;
}

// Batch O regression: `getCurrentUserId()` used to JWT-decode the access
// token from localStorage. Post-Batch O the token is in an HttpOnly cookie
// and unreachable to JS. The one call site (`pages/merchant/Cashout.tsx`)
// now reads the id from `useAuth().user?.id` — no replacement helper here.

export async function fetchCurrentUser(): Promise<CurrentUser | null> {
  try {
    const r = await apiGet<{ user: CurrentUser }>("/auth/me");
    return r.user ?? null;
  } catch {
    return null;
  }
}

export async function signOut(opts?: { allDevices?: boolean }): Promise<void> {
  try {
    // H5 — Always send the refresh token so the server can revoke the
    // matching `refresh_tokens` row immediately (previously the body was
    // `{}` and the row stayed valid until expiry). When `allDevices=true`
    // the server revokes ALL refresh rows for this user — surfaced by
    // the new "log out everywhere" button.
    await apiPost("/auth/logout", {
      refreshToken: getRefreshToken() ?? undefined,
      allDevices: opts?.allDevices === true,
    });
  } catch {
    // ignore — local tokens cleared regardless
  }
  setTokens(null);
  window.dispatchEvent(new Event("wallet.auth-cleared"));
}

/** Change the signed-in user's password — requires the current one. */
export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await apiPost("/auth/password/change", { currentPassword, newPassword });
}

export interface MfaFactor {
  id: string;
  type: "totp";
  friendlyName?: string;
  verifiedAt?: string | null;
}

export async function listMfaFactors(): Promise<MfaFactor[]> {
  const r = await apiGet<{ factors: MfaFactor[] }>("/auth/mfa/factors");
  return r.factors ?? [];
}

export async function unenrollMfaFactor(factorId: string): Promise<void> {
  await apiPost("/auth/mfa/unenroll", { factorId });
}
