const TEMPLATE_KEY_LABEL: Record<string, string> = {
  affiliate_payout_paid: "Affiliate Ödemesi Tamamlandı",
  email_verify: "E-posta Doğrulama",
  login_new_device: "Yeni Cihaz Girişi",
  mfa_enrolled: "MFA Kurulumu Tamamlandı",
  otp_login: "Giriş Kodu",
  password_reset: "Şifre Sıfırlama",
  referral_qualified: "Davet Ödülü Hak Edildi",
  topup_completed: "Para Yatırma Tamamlandı",
  welcome: "Hoş Geldin Maili",
  withdraw_completed: "Para Çekme Tamamlandı",
  withdraw_failed: "Para Çekme Başarısız",
};

const TG_TEMPLATE_KEY_LABEL: Record<string, string> = {
  staff_new_chat: "Yeni Destek Talebi",
  staff_pending_pcr: "Profil Değişikliği Onayı",
  staff_cash_pool_stale: "Cash Pool Eski",
  staff_high_value_withdraw: "Yüksek Tutar Çekim",
  staff_referral_flagged: "Şüpheli Davet",
};

const AUDIT_ACTION_LABEL: Record<string, string> = {
  create: "Oluşturuldu",
  update: "Güncellendi",
  delete: "Silindi",
  manual_qualify_referral: "Davet Manuel Onaylandı",
  set_role_permission: "Rol Yetkisi Değiştirildi",
  set_user_override: "Kişi Yetkisi Verildi",
  remove_user_override: "Kişi Yetkisi Kaldırıldı",
  set_merchant_limits: "Merchant Limitleri Güncellendi",
  admin_update_member_profile: "Üye Profili Güncellendi",
  toggle_enabled: "Aktif/Pasif Değiştirildi",
  merchant_invite_user: "Merchant Kullanıcısı Eklendi",
  merchant_set_user_role: "Merchant Kullanıcı Rolü Değişti",
  merchant_set_user_active: "Merchant Kullanıcı Durumu Değişti",
  manual_set: "Manuel Kasa Ayarı",
  sync: "Kasa Senkronizasyonu",
  safe_swallow: "Hata Güvenli Şekilde Yutuldu",
};

const RESOURCE_LABEL: Record<string, string> = {
  profiles: "Üye Profili",
  referrals: "Davet",
  bo_permissions: "Rol Yetkisi",
  user_permission_overrides: "Kişi Yetki Override",
  merchants: "Merchant",
  "merchants.cash_pool": "Merchant Kasası",
  merchant_users: "Merchant Kullanıcısı",
  method_types: "Yöntem Tipi",
  mail_templates: "Mail Şablonu",
  telegram_templates: "Telegram Şablonu",
  chat_canned_responses: "Hazır Chat Cevabı",
  audit_log: "Audit Log",
  system_logs: "Sistem Logu",
};

const ENDPOINT_LABEL: Record<string, string> = {
  "topup-init": "Para Yatırma Başlatma",
  "admin-finance-integration-test": "Finance Entegrasyon Testi",
  "admin-cash-pool-sync": "Kasa Sync",
  "merchant-charge": "Merchant Ödeme",
  "merchant-credit": "Cüzdana Giriş",
  "merchant-topup-callback": "Yatırma Callback",
  "merchant-withdraw-callback": "Çekim Callback",
};

const ERROR_CODE_LABEL: Record<string, string> = {
  BAD_JSON: "Geçersiz JSON",
  BAD_BODY: "Geçersiz İstek",
  UNAUTHORIZED: "Oturum Gerekli",
  FORBIDDEN: "Yetki Yok",
  METHOD: "Geçersiz Metot",
  MERCHANT_NOT_FOUND: "Merchant Bulunamadı",
  MERCHANT_INACTIVE: "Merchant Pasif",
  WRONG_MERCHANT_TYPE: "Yanlış Merchant Tipi",
  MERCHANT_SECRET_MISSING: "Merchant Secret Eksik",
  TOPUP_INIT_URL_MISSING: "Init URL Eksik",
  CASH_POOL_API_URL_MISSING: "Kasa Sync URL Eksik",
  NON_JSON_RESPONSE: "JSON Olmayan Cevap",
  HTTP_ERROR: "HTTP Hatası",
  TIMEOUT: "Zaman Aşımı",
  NETWORK_ERROR: "Ağ Hatası",
  CONTRACT_INVALID: "Cevap Formatı Geçersiz",
  CASH_POOL_MISSING: "Kasa Bakiyesi Eksik",
  SYNC_UPDATE_FAILED: "Sync Güncellemesi Başarısız",
};

export function humanizeCode(value: string | null | undefined): string {
  if (!value) return "—";
  return value
    .replace(/[:./-]+/g, " ")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toLocaleUpperCase("tr-TR"));
}

export function templateKeyLabel(key: string | null | undefined): string {
  if (!key) return "—";
  return TEMPLATE_KEY_LABEL[key] ?? TG_TEMPLATE_KEY_LABEL[key] ?? humanizeCode(key);
}

export function auditActionLabel(action: string | null | undefined): string {
  if (!action) return "—";
  return AUDIT_ACTION_LABEL[action] ?? humanizeCode(action);
}

export function resourceLabel(resource: string | null | undefined): string {
  if (!resource) return "—";
  return RESOURCE_LABEL[resource] ?? humanizeCode(resource);
}

export function endpointLabel(endpoint: string | null | undefined): string {
  if (!endpoint) return "—";
  return ENDPOINT_LABEL[endpoint] ?? humanizeCode(endpoint);
}

export function errorCodeLabel(code: string | null | undefined): string {
  if (!code) return "—";
  return ERROR_CODE_LABEL[code] ?? humanizeCode(code);
}
