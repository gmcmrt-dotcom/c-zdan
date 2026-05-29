/** Üye-yüzü topup iframe — güvenli origin allowlist */

const FRAME_HOST_SUFFIXES = [".nndin.com", ".anindakripto1.com"] as const;

const FRAME_HOST_EXACT = new Set([
  "integration.nndin.com",
  "www.integration.nndin.com",
]);

export function parseTopupFrameUrl(raw: string | null | undefined): URL | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    return url;
  } catch {
    return null;
  }
}

export function isEmbeddableTopupPaymentUrl(raw: string | null | undefined): boolean {
  const url = parseTopupFrameUrl(raw);
  if (!url) return false;
  const host = url.hostname.toLowerCase();
  if (FRAME_HOST_EXACT.has(host)) return true;
  return FRAME_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

export function topupFrameOrigin(raw: string | null | undefined): string | null {
  const url = parseTopupFrameUrl(raw);
  return url ? url.origin : null;
}
