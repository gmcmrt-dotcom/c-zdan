import i18n from "@/i18n";

// Aktif dile göre BCP-47 locale (tr-TR / en-US). Para birimi her zaman TRY kalır.
function locale() {
  return i18n.language?.startsWith("en") ? "en-US" : "tr-TR";
}

const TX_STATUS_I18N: Record<string, string> = {
  pending: "Beklemede",
  completed: "Tamamlandı",
  failed: "Başarısız",
  cancelled: "İptal edildi",
  expired: "Süresi doldu",
  reversed: "Geri alındı",
};

export function txStatusLabel(status: string | null | undefined): string {
  if (!status) return "—";
  return TX_STATUS_I18N[status] ?? status;
}

const WITHDRAW_SESSION_STATUS_I18N: Record<string, string> = {
  pending: "Beklemede",
  sent_to_merchant: "Merchant'a iletildi",
  success: "Tamamlandı",
  failed: "Başarısız",
  timeout: "Zaman aşımı",
  expired: "Süresi doldu",
  cancelled: "İptal edildi",
};

export function withdrawSessionStatusLabel(status: string | null | undefined): string {
  if (!status) return "—";
  return WITHDRAW_SESSION_STATUS_I18N[status] ?? status;
}

const KYC_STATUS_I18N: Record<string, string> = {
  none: "Yok",
  pending: "Bekliyor",
  verified: "Onaylı",
  rejected: "Reddedildi",
};

export function kycStatusLabel(status: string | null | undefined): string {
  if (!status) return "—";
  return KYC_STATUS_I18N[status] ?? status;
}

export const fmtTRY = (value: number | string | null | undefined) => {
   const n = typeof value === "string" ? parseFloat(value) : (value ?? 0);
   return new Intl.NumberFormat(locale(), {
     style: "currency",
     currency: "TRY",
     minimumFractionDigits : 2,
     maximumFractionDigits : 2,
   }).format(Number.isFinite(n) ? n : 0);
};

/** Maskeli bakiye: tam yetki yokken kaba aralık gösterir */
export function maskBalance(amount: number, canViewFull: boolean): string {
  if (canViewFull) return fmtTRY(amount);
  const n = Number(amount) || 0;
  if (n >= 1_000_000) return "₺1M+";
  if (n >= 100_000) return "₺100K+";
  if (n >= 10_000) return "₺10K+";
  if (n >= 1_000) return "₺1K+";
  if (n > 0) return "₺0+";
  return "₺0";
}

export const fmtNumber = (value: number | string | null | undefined) => {
   const n = typeof value === "string" ? parseFloat(value) : (value ?? 0);
   return new Intl.NumberFormat(locale()).format(Number.isFinite(n) ? n : 0);
};

export const fmtDate = (value: string | Date | null | undefined) => {
   if (!value) return "—";
   const d = typeof value === "string" ? new Date(value) : value;
   if (Number.isNaN(d.getTime())) return "—";
   return new Intl.DateTimeFormat (locale(), {
     day: "2-digit",
     month: "short",
     year: "numeric",
     hour: "2-digit",
     minute: "2-digit",
   }).format(d);
};

export const fmtDateShort = (value: string | Date | null | undefined) => {
   if (!value) return "—";
   const d = typeof value === "string" ? new Date(value) : value;
   if (Number.isNaN(d.getTime())) return "—";
   return new Intl.DateTimeFormat (locale(), { day: "2-digit", month: "short" }).format(d);
};

/**
  * Türkçe-uyumlu title case: her kelimenin ilk harfi büyük, geri kalan? küçük.
  * `?/I/i/?` harflerini doğru işler. Tireli yapıları (`Ali-Veli`) korur.
  */
export function toTitleCaseTr (input: string): string {
   if (!input) return "";
   return input
     .toLocaleLowerCase ("tr-TR")
     .replace(/\s+/g, " ")
     .trim()
     .split(" ")
     .map((w) =>
       w
         .split("-")
         .map((p) => (p ? p[0].toLocaleUpperCase ("tr-TR") + p.slice(1) : p))
         .join("-"),
     )
     .join(" ");
}

export const fmtRelative = (value: string | Date) => {
   const d = typeof value === "string" ? new Date(value) : value;
   const diff = Math.round((Date.now() - d.getTime()) / 1000);
   if (diff < 60) return i18n.t("member.format.justNow");
   if (diff < 3600) return i18n.t("member.format.minAgo", { min: Math.floor(diff / 60) });
   if (diff < 86400) return i18n.t("member.format.hourAgo", { hour: Math.floor(diff / 3600) });
   return fmtDateShort(d);
};

// Tx type → i18n key mapping. Sözlükteki member.transactions.<key> kullanılır.
const TX_TYPE_I18N_KEY: Record<string, string> = {
  topup: "topup",
  spend: "spend",
  refund: "refund",
  adjustment: "adjustment",
  bonus: "bonus",
  merchant_deposit: "merchantDeposit",
  merchant_withdraw: "merchantWithdraw",
  merchant_credit: "merchantCredit",
  referral_bonus: "referralBonus",
  affiliate_commission: "affiliateCommission",
  affiliate_payout: "affiliatePayout",
  profit_share: "profitShare",
};

export const txTypeLabel = (type: string): string => {
  const key = TX_TYPE_I18N_KEY[type];
  if (!key) return type;
  return i18n.t(`member.transactions.${key}`);
};

// Loyalty puan log reason kodlarını i18n key'ine map et
const POINT_REASON_I18N_KEY: Record<string, string> = {
  topup: "topup",
  "topup+first_bonus": "topupFirstBonus",
  "topup+phone_bonus": "topupPhoneBonus",
  spend: "spend",
  "spend+turnover": "spendTurnover",
  spend_cashback: "spendCashback",
  // legacy rows used the literal "Spend Cashback" string
  "Spend Cashback": "spendCashback",
  refund: "refund",
  bonus: "bonus",
  monthly_active: "monthlyActive",
  special_day_birthday: "specialDayBirthday",
  special_day_anniversary: "specialDayAnniversary",
  special_day_custom: "specialDayCustom",
  withdraw_penalty: "withdrawPenalty",
  adjustment: "adjustment",
  tier_promotion: "tierPromotion",
  referral_reward: "referralReward",
};

export const pointReasonLabel = (reason: string | null | undefined): string => {
  if (!reason) return "—";
  // 03 (genişletildi): direkt match → normalize match (lowercase, _/space alternates)
  const direct = POINT_REASON_I18N_KEY[reason];
  if (direct) return i18n.t(`member.pointReason.${direct}`);
  // Normalize: tüm key/lookup'ı lowercase + _ ile boşluk eşitliği
  const norm = reason.toLowerCase().replace(/[\s+]/g, "_");
  for (const [k, v] of Object.entries(POINT_REASON_I18N_KEY)) {
    if (k.toLowerCase().replace(/[\s+]/g, "_") === norm) {
      return i18n.t(`member.pointReason.${v}`);
    }
  }
  // Bilinmeyen: snake_case → Title Case
  return reason.replace(/[+_]/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
};

// 04 / ME-01 / ME-02: settlement_log + cash_pool_log reason kodları
// Backend raw enum'ları kullanıcı dostu Türkçe metinlere çevirir.
const SETTLEMENT_REASON_LABEL: Record<string, string> = {
  pay_to_merchant:    "Üye ödemesi (Akış A)",
  credit_to_member:   "Üyeye fon transferi (Akış B)",
  push_to_merchant:   "Tarafımızdan gelen havale (Akış D)",
  manual_adjustment:  "Manuel düzeltme",
  manual_settlement:  "Manuel settlement",
  bank_transfer:      "Banka transferi",
  // Cash pool log
  cash_pool_sync:     "Kasa senkronizasyon",
  cash_pool_manual:   "Manuel kasa hareketi",
  withdraw_payout:    "Üye çekim ödemesi",
  reconciliation:     "Mutabakat",
};

export const settlementReasonLabel = (reason: string | null | undefined): string => {
  if (!reason) return "—";
  const label = SETTLEMENT_REASON_LABEL[reason];
  if (label) return label;
  // Bilinmeyen: snake_case → Title Case
  return reason.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
};
