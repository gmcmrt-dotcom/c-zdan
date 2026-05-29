// Host-aware scope detection
// Production'da subdomain'lere göre yetkilendirme:
//   admin.wallet.com    → sadece /admin routes
//   merchant.wallet.com → sadece /merchant routes
//   wallet.com          → sadece üye routes (/, /topup, vs.)
//
// Dev/staging'de tek host kullanılır → SCOPE_STRICT=false fallback
// .env: VITE_SCOPE_STRICT=true | VITE_ADMIN_HOST=admin.wallet.com | VITE_MERCHANT_HOST=merchant.wallet.com

export type HostScope = "member" | "admin" | "merchant" | "any";

let warned = false;

export function detectHostScope(): HostScope {
  if (typeof window === "undefined") return "any";
  // Default: strict (true). Sadece açıkça "false" set edilmişse loose.
  const strictRaw = import.meta.env.VITE_SCOPE_STRICT;
  const strict = strictRaw !== "false" && strictRaw !== false;

  // Production'da strict kapalıysa runtime warning
  if (import.meta.env.PROD && !strict && !warned) {
    warned = true;
    console.warn(
      "⚠️ VITE_SCOPE_STRICT=false in production — subdomain isolation BROKEN!\n" +
      "Admin/merchant sayfaları her subdomain'den erişilebilir."
    );
  }
  if (!strict) return "any";

  const host = window.location.hostname;
  const adminHost    = import.meta.env.VITE_ADMIN_HOST    ?? "admin.";
  const merchantHost = import.meta.env.VITE_MERCHANT_HOST ?? "merchant.";

  if (host.startsWith(adminHost)    || host === adminHost.replace(/\.$/, ""))    return "admin";
  if (host.startsWith(merchantHost) || host === merchantHost.replace(/\.$/, "")) return "merchant";
  return "member";
}

export function isPathAllowedForScope(pathname: string, scope: HostScope): boolean {
  if (scope === "any") return true;
  if (scope === "admin")    return pathname.startsWith("/admin")  || pathname === "/auth";
  if (scope === "merchant") return pathname.startsWith("/merchant") || pathname === "/auth";
  // member scope — admin/merchant'a izin verme
  return !pathname.startsWith("/admin") && !pathname.startsWith("/merchant");
}

export function scopeRedirect(pathname: string, scope: HostScope): string | null {
  if (isPathAllowedForScope(pathname, scope)) return null;
  if (scope === "admin")    return "/admin";
  if (scope === "merchant") return "/merchant";
  return "/";
}
