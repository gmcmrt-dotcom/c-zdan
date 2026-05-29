/**
 * Hassas verileri kullanıcı yetkisine göre maskeleyen yardımcılar.
 *
 * Kural: BO kullanıcıları "*.view_full" izinli ise normal görür,
 *        "*.view_masked" izinli ise maskelenmiş görür,
 *        hiçbiri yoksa boş string döner.
 *
 * Üye kendi verisinde her zaman tam görür.
 */

export function maskEmail(email: string | null | undefined): string {
  if (!email) return "";
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  if (local.length <= 2) return `${local[0] ?? "*"}***@${domain}`;
  return `${local.slice(0, 2)}***@${domain}`;
}

export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) return "***";
  // Türkiye için: 5XX *** ** XX
  if (digits.length >= 10) {
    const last2 = digits.slice(-2);
    const head = digits.slice(0, 3);
    return `${head} *** ** ${last2}`;
  }
  // Genel
  return `***${digits.slice(-4)}`;
}

export function maskIban(iban: string | null | undefined): string {
  if (!iban) return "";
  const clean = iban.replace(/\s/g, "");
  if (clean.length < 8) return "***";
  return `${clean.slice(0, 4)} **** **** **** **** ${clean.slice(-4)}`;
}

export function maskTckn(tckn: string | null | undefined): string {
  if (!tckn) return "";
  const digits = tckn.replace(/\D/g, "");
  if (digits.length !== 11) return "***";
  return `${digits.slice(0, 3)}*****${digits.slice(-3)}`;
}

export function maskCardPan(pan: string | null | undefined): string {
  if (!pan) return "";
  const digits = pan.replace(/\D/g, "");
  if (digits.length < 6) return "***";
  return `${digits.slice(0, 4)} **** **** ${digits.slice(-4)}`;
}

export function maskName(fullName: string | null | undefined): string {
  if (!fullName) return "";
  const parts = fullName.trim().split(/\s+/);
  return parts
    .map((p) => (p.length <= 1 ? p : `${p[0]}${"*".repeat(Math.max(p.length - 1, 1))}`))
    .join(" ");
}

/** Genel: kullanıcının izin durumuna göre değer veya maskelenmiş hâli döner */
type CanFn = (resource: string, action: string) => boolean;
export function pickMasked<T>(
  can: CanFn,
  resource: string,
  full: T,
  masker: (v: T) => string,
): T | string {
  if (can(resource, "view_full")) return full;
  if (can(resource, "view_masked")) return masker(full);
  return ""; // ya da "***"
}

/** Merchant API key — ilk/son birkaç karakter, ortası yıldız */
export function maskApiKey(key: string | null | undefined): string {
  if (!key) return "—";
  if (key.length <= 8) return "••••••••";
  return `${key.slice(0, 4)}••••••••${key.slice(-4)}`;
}

/** URL / endpoint — baş/son parça, ortası gizli */
export function maskUrl(url: string | null | undefined): string {
  if (!url) return "—";
  if (url.length <= 16) return "••••••••••••••••";
  return `${url.slice(0, 10)}••••••••${url.slice(-8)}`;
}

/** IP whitelist — sadece adet göster */
export function maskIpList(ips: string[] | null | undefined): string {
  if (!ips?.length) return "—";
  return `${ips.length} IP (gizli)`;
}

/** Yetki yoksa maskeli, varsa tam değer (React node için string döner) */
export function sensitiveText(
  can: CanFn,
  resource: string,
  action: string,
  value: string | null | undefined,
  masker: (v: string) => string = () => "••••••••",
  empty = "—",
): string {
  if (!value?.trim()) return empty;
  if (can(resource, action)) return value;
  return masker(value);
}

const LOG_REDACT_KEYS = new Set([
  "iban",
  "iban_holder",
  "email",
  "phone",
  "api_key",
  "signing_secret",
  "api_secret",
  "password",
  "token",
  "webhook_url",
  "topup_init_url",
  "cash_pool_api_url",
]);

function redactLogValue(key: string, value: unknown): unknown {
  if (value == null) return value;
  const k = key.toLowerCase();
  if (k.includes("secret") || k.includes("password") || k.includes("token")) return "••••••••";
  if (k === "iban" && typeof value === "string") return maskIban(value);
  if (k === "iban_holder" && typeof value === "string") return maskName(value);
  if (k === "email" && typeof value === "string") return maskEmail(value);
  if (k === "phone" && typeof value === "string") return maskPhone(value);
  if (k === "api_key" && typeof value === "string") return maskApiKey(value);
  if ((k === "webhook_url" || k === "topup_init_url" || k === "cash_pool_api_url") && typeof value === "string") {
    return maskUrl(value);
  }
  if (LOG_REDACT_KEYS.has(k) && typeof value === "string") return "••••••••";
  return value;
}

/** Audit/system log JSON — view_payload yoksa hassas alanları maskele */
export function redactLogPayload(data: unknown, canViewPayload: boolean): unknown {
  if (canViewPayload || data == null) return data;
  if (Array.isArray(data)) return data.map((item) => redactLogPayload(item, false));
  if (typeof data === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      if (value != null && typeof value === "object") {
        out[key] = redactLogPayload(value, false);
      } else {
        out[key] = redactLogValue(key, value);
      }
    }
    return out;
  }
  return data;
}
