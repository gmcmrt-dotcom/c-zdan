/**
 * Ürün feature flag'leri (build-time).
 * Affiliate: varsayılan KAPALI — açmak için Cloudflare'de VITE_AFFILIATE_ENABLED=true
 */

export function isAffiliateEnabled(): boolean {
  const v = import.meta.env.VITE_AFFILIATE_ENABLED;
  return v === "true" || v === true;
}

export const AFFILIATE_MODULE_KEY = "affiliates";

export function isAffiliateModuleKey(moduleKey: string): boolean {
  return moduleKey === AFFILIATE_MODULE_KEY;
}
