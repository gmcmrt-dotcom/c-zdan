// Tüm hata mesajlarını dile göre çeviren tek nokta.
// UI tarafında: toast.error(translateError(error)) şeklinde kullanılır.
import i18n from "@/i18n";

// EN_CODE_DICT — en yaygın hata kodlarının İngilizce karşılıkları.
// Burada olmayan kodlar için CODE_DICT (TR) fallback kullanılır.
const EN_CODE_DICT: Record<string, string> = {
  INVALID_KEY: "Invalid API key",
  BAD_SIGNATURE: "Could not verify signature",
  STALE_TIMESTAMP: "Request timestamp invalid or too old",
  IP_NOT_ALLOWED: "IP address is not on the allow list",
  AMOUNT_MISMATCH: "Amount does not match the code",
  NAME_MISMATCH: "Customer name does not match",
  CODE_NOT_FOUND: "Code not found",
  CODE_EXPIRED: "Code has expired",
  CODE_USED: "Code has already been used",
  CODE_CANCELLED: "Code was cancelled",
  LIMIT_EXCEEDED: "Transaction limit exceeded",
  BAD_JSON: "Invalid request body",
  BAD_BODY: "Missing or invalid fields",
  MISSING_FIELDS: "Required fields are missing",
  METHOD: "Method not allowed",
  MERCHANT_INACTIVE: "Merchant is inactive",
  WRONG_MERCHANT_TYPE: "This merchant cannot use this endpoint",
  INSUFFICIENT_FUNDS: "Insufficient balance",
  MEMBER_NOT_FOUND: "Member not found",
  MEMBER_FROZEN: "Member account is frozen",
  AMOUNT_INVALID: "Invalid amount",
  DUPLICATE_REF: "This reference has already been used",
  RPC_ERROR: "Server operation failed",
  INTERNAL: "Server error",
  UNKNOWN: "Unknown error",
  EMAIL_TAKEN: "This email is already in use",
  RATE_LIMITED: "Too many requests, please wait a bit",
  LOGIN_RATE_LIMIT: "Too many login attempts — wait ~15 minutes or restart the API in dev",
  SIGNUP_RATE_LIMIT: "Too many signup attempts, please wait",
  REFRESH_RATE_LIMIT: "Too many session refresh attempts, please wait",
  ENUM_RATE_LIMIT: "Too many requests, please wait",
  RESET_RATE_LIMIT: "Too many password reset attempts, please wait",
  MFA_RATE_LIMIT: "Too many MFA attempts, please wait",
  OTP_RATE_LIMIT: "Too many OTP requests, please wait",
  BELOW_MIN_AMOUNT: "Below minimum amount",
  TOO_MANY_ATTEMPTS: "Too many wrong attempts, request a new code",
  INVALID_CODE: "Invalid verification code",
  OTP_EXPIRED: "Code expired, request a new one",
  EMAIL_NOT_CONFIGURED: "Email service is not configured yet",
  INVALID_PHONE: "Phone must be (5XX) XXX XX XX",
  INVALID_EMAIL: "Enter a valid email",
  unauthorized: "Authentication required",
  FORBIDDEN: "You are not authorized for this action",
  UNAUTHORIZED: "Authentication required",
  INSUFFICIENT_MERCHANT_BALANCE: "Settlement book insufficient for Flow B (balance + credit_limit < amount + fee)",
  AMOUNT_ZERO: "Amount cannot be zero",
  REASON_REQUIRED: "Reason is required",
  MERCHANT_REQUIRED: "Merchant ID is required",
  MERCHANT_NOT_FOUND: "Merchant not found",
  WALLET_NO_REQUIRED: "Wallet number is required",
  NAME_REQUIRED: "Name is required",
  ACCOUNT_NOT_FOUND: "Wallet account not found",
  NO_AVAILABLE_PROVIDER: "No active provider, please try again later",
  WITHDRAW_IN_PROGRESS: "You already have a pending withdrawal. Please complete it first.",
  METHOD_REQUIRED: "Method selection is required",
  IBAN_REQUIRED: "IBAN required",
  PAPARA_ACCOUNT_REQUIRED: "Papara account number required",
  IBAN_INVALID: "IBAN failed validation (format or checksum)",
  IBAN_HOLDER_REQUIRED: "Account holder name is required",
  CRYPTO_TYPE_REQUIRED: "Select a crypto asset",
  PAYOUT_ADDRESS_REQUIRED: "Wallet address is required",
  WITHDRAW_PUSH_FAILED: "Withdrawal could not be sent to provider. Contact support.",
  SESSION_NOT_FOUND: "Session not found",
  SESSION_REQUIRED: "Session reference is required",
  THREAD_NOT_FOUND: "Support thread not found",
  THREAD_CLOSED: "This thread is closed",
  INVALID_BODY: "Message text is invalid",
  INVALID_STATUS: "Invalid status",
  AUTH_USER_NOT_FOUND: "No user registered with this email",
  BAD_CREDENTIALS: "Invalid email or password",
  ACCOUNT_FROZEN: "Your account is frozen. Please contact support.",
  MFA_REQUIRED: "Two-step verification (MFA) is required for this action",
  NOT_FOUND: "Record not found",
  PENDING_EXISTS: "You have a pending transaction. Complete or cancel it first.",
  // Member referral
  REFERRAL_DISABLED: "Invite system is currently closed.",
  REFERRAL_INVALID_CODE: "Invalid invite code.",
  REFERRAL_SELF_REFERRAL: "You cannot register with your own invite code.",
  REFERRAL_ALREADY_APPLIED: "This account already used an invite.",
  REFERRAL_DUPLICATE_PHONE: "Same phone number as the referrer.",
  REFERRAL_DUPLICATE_EMAIL: "Same email as the referrer.",
  REFERRAL_IP_RATE_LIMIT: "Too many signups from the same connection — blocked for security.",
  REFERRAL_MONTHLY_CAP: "You've reached this month's invite cap.",
  REFERRAL_MONTHLY_REWARD_CAP: "Monthly reward cap reached, your reward is pending.",
  REFERRAL_MIN_SPEND_NOT_MET: "Minimum spend for the reward not reached.",
  REFERRAL_NOT_FOUND: "Invite record not found.",
  REFERRAL_NOT_QUALIFIED: "Invite is not yet eligible for a reward.",
  REFERRAL_EXPIRED: "Invite has expired.",
  REFERRAL_NOT_FOUND_OR_TERMINAL: "This record cannot be cancelled (already rewarded or cancelled).",
  // Affiliate
  AFFILIATE_DISABLED: "Affiliate module is currently disabled.",
  AFFILIATE_NOT_FOUND: "Affiliate record not found.",
  AFFILIATE_NO_PAYABLE: "No payable commission.",
  AFFILIATE_PAYOUT_ALREADY_OPEN: "You already have an open payout request.",
  AFFILIATE_INVALID_BASIS: "Invalid commission basis.",
  MERCHANT_ALREADY_LINKED: "This merchant already has an active affiliate link.",
  LINK_NOT_FOUND_OR_INACTIVE: "Link not found or already closed.",
  PAYOUT_NOT_FOUND: "Payout request not found.",
  PAYOUT_INVALID_STATUS: "Payout request not in valid status for this action.",
  PAYOUT_NOT_FOUND_OR_INVALID_STATUS: "Request not found or cannot be rejected in current state.",
  PAYOUT_NOT_APPROVED: "Request must be approved by admin first.",
  INVALID_KIND: "Invalid affiliate kind.",
  LINKED_USER_REQUIRED: "linked_user_id is required for internal_member kind.",
  AUTH_USER_REQUIRED: "External affiliate requires auth user_id.",
  EMAIL_REQUIRED: "Email is required.",
  INSUFFICIENT_PERMISSION: "You don't have permission for this action.",
  MERCHANT_REF_REQUIRED: "Merchant reference is required.",
  MERCHANT_INIT_UNSAFE: "Payment instructions failed safety checks.",
  METHOD_INACTIVE: "This method is not active.",
  CHILD_MERCHANT_REQUIRED: "Select a child merchant for this action.",
  COMMISSION_REQUIRED: "Commission percentage is required for a child merchant.",
  INVALID_COMMISSION: "Invalid commission percentage.",
  BO_ACCESS_CHILD_ONLY: "Commerce BO access can only be granted to child merchants.",
  CHILD_SECRET_ROTATE_NOT_ALLOWED: "Child merchants use the parent merchant secret.",
  CHILD_IP_WHITELIST_NOT_ALLOWED: "Child merchants use the parent merchant IP allow list.",
  PARENT_NOT_PROVISIONED: "Parent merchant credentials are not ready.",
  EXTERNAL_REF_REQUIRED: "Child merchant reference is required.",
  CHILD_CREATE_FAILED: "Child merchant could not be created.",
  INVALID_COLLECTION_FEE: "Invalid collection expense.",
  INVALID_PERIOD_TYPE: "Invalid period type.",
  INVALID_PERIOD_RANGE: "Invalid period range.",
  INVALID_DISTRIBUTION_PCT: "Invalid distribution percentage.",
  INVALID_RECIPIENT_LIMIT: "Recipient count must be between 1 and 500.",
  INVALID_CLAIM_EXPIRES_HOURS: "Claim validity must be between 1 and 720 hours.",
  PROFIT_SHARE_NO_PROFIT: "No positive net profit for this period.",
  PROFIT_SHARE_NO_ELIGIBLE_USERS: "No eligible users for this period.",
  PROFIT_SHARE_CAMPAIGN_NOT_FOUND: "Profit share campaign not found.",
  PROFIT_SHARE_INVALID_STATUS: "Profit share campaign is not in a valid status.",
  PROFIT_SHARE_NO_ALLOCATIONS: "No allocations found for this campaign.",
  PROFIT_SHARE_NOT_FOUND: "Profit share reward not found.",
  PROFIT_SHARE_NOT_PUBLISHED: "Profit share reward is not published yet.",
  PROFIT_SHARE_NOT_CLAIMABLE: "This profit share reward cannot be claimed.",
  PROFIT_SHARE_EXPIRED: "This profit share reward has expired.",
  AUTH_REQUIRED: "Please sign in first.",
  STAFF_REQUIRED: "Staff account required. After db:reset run npm run admin:bootstrap and sign in again as admin@wallet.local.",
  PERMISSION_DENIED: "You do not have permission for this action. After db:reset sign out and sign in again as admin@wallet.local.",
};

const PG_DICT: Array<[RegExp, string]> = [
   [/insufficient\s+balance/i , "Yetersiz bakiye" ],
   [/resulting\s+balance\s+would\s+be\s+negative/i , "İşlem sonrası bakiye eksiye düşemez" ],
   [/invalid\s+amount/i , "Geçersiz tutar" ],
   [/amount\s+cannot\s+be\s+zero/i , "Tutar sıfır olamaz" ],
   [/points\s+cannot\s+be\s+zero/i , "Puan sıfır olamaz" ],
   [/invalid\s+ttl/i , "Geçersiz süre" ],
   [/code\s+not\s+found\s+or\s+not\s+active/i , "Kod bulunamadı veya aktif değil" ],
   [/code\s+not\s+active/i , "Kod aktif değil" ],
   [/code\s+not\s+found/i , "Kod bulunamadı" ],
   [/topup\s+not\s+found\s+or\s+already\s+processed/i , "Yükleme isteği bulunamadı veya zaten işlenmiş" ],
   [/merchant\s+not\s+found/i , "İş yeri bulunamadı" ],
   [/account\s+not\s+found/i , "Hesap bulunamadı" ],
   [/^forbidden$/i , "Bu işlem için yetkiniz yok" ],
   [/^unauthorized$/i , "Yetkilendirme gerekli" ],
   [/forbidden/i, "Bu işlem için yetkiniz yok" ],
];

const CODE_DICT: Record<string, string> = {
   INVALID_KEY: "Geçersiz API anahtarı" ,
   BAD_SIGNATURE : "İmza doğrulanamadı" ,
   STALE_TIMESTAMP : "İstek zaman damgası geçersiz veya çok eski" ,
   IP_NOT_ALLOWED : "IP adresi izinli listede değil" ,
   AMOUNT_MISMATCH : "Tutar koddaki tutar ile uyuşmuyor" ,
   NAME_MISMATCH : "Müşteri adı uyuşmuyor" ,
   CODE_NOT_FOUND : "Kod bulunamadı" ,
   CODE_EXPIRED : "Kodun süresi dolmuş" ,
   CODE_USED: "Kod daha önce kullanılmış" ,
   CODE_CANCELLED : "Kod iptal edilmiş" ,
   LIMIT_EXCEEDED : "İşlem limiti aşıldı" ,
   BAD_JSON: "Geçersiz istek gövdesi" ,
   BAD_BODY: "Eksik veya hatalı alanlar" ,
   MISSING_FIELDS : "Zorunlu alanlar eksik" ,
   METHOD: "İzin verilmeyen istek yöntemi" ,
   MERCHANT_INACTIVE : "İş yeri pasif" ,
   WRONG_MERCHANT_TYPE : "Bu merchant bu endpoint'i kullanma yetkisine sahip değil" ,
   INSUFFICIENT_FUNDS : "Yetersiz bakiye" ,
   MEMBER_NOT_FOUND : "Üye bulunamadı" ,
   MEMBER_FROZEN : "Üye hesabı dondurulmuş" ,
   AMOUNT_INVALID : "Geçersiz tutar" ,
   DUPLICATE_REF : "Bu referans daha önce kullanıldı" ,
   RPC_ERROR: "Sunucu işlemi başarısız" ,
   INTERNAL: "Sunucu hatası" ,
   UNKNOWN: "Bilinmeyen hata" ,
   EMAIL_TAKEN: "Bu e-posta zaten kullanımda" ,
   RATE_LIMITED : "Çok sık istek, lütfen biraz bekle" ,
   LOGIN_RATE_LIMIT : "Çok fazla giriş denemesi — ~15 dk bekleyin (dev'de API'yi yeniden başlatın)" ,
   SIGNUP_RATE_LIMIT : "Çok fazla kayıt denemesi, lütfen bekleyin" ,
   REFRESH_RATE_LIMIT : "Çok fazla oturum yenileme, lütfen bekleyin" ,
   ENUM_RATE_LIMIT : "Çok sık istek, lütfen biraz bekle" ,
   RESET_RATE_LIMIT : "Çok fazla şifre sıfırlama denemesi, lütfen bekleyin" ,
   MFA_RATE_LIMIT : "Çok fazla MFA denemesi, lütfen bekleyin" ,
   OTP_RATE_LIMIT : "Çok fazla doğrulama kodu isteği, lütfen bekleyin" ,
   BELOW_MIN_AMOUNT : "Minimum tutarın altında" ,
   TOO_MANY_ATTEMPTS : "Çok fazla yanlış deneme, yeni kod iste" ,
   INVALID_CODE : "Doğrulama kodu hatalı" ,
   OTP_EXPIRED: "Kodun süresi doldu, yeniden iste" ,
   EMAIL_NOT_CONFIGURED : "E-posta altyapısı henüz hazır değil" ,
   INVALID_PHONE : "Telefon (5XX) XXX XX XX biçiminde olmalı" ,
   INVALID_EMAIL : "Geçerli bir e-posta gir" ,
   unauthorized : "Yetkilendirme gerekli" ,
   FORBIDDEN: "Bu işlem için yetkiniz yok" ,
   UNAUTHORIZED : "Yetkilendirme gerekli" ,
   INVALID_WINDOW : "Geçersiz zaman aralığı" ,
   WINDOW_FUTURE : "Aralık gelecekte olamaz" ,
   NO_POINTS_IN_WINDOW : "Bu pencerede iptal edilecek puan yok" ,
   INSUFFICIENT_MERCHANT_BALANCE : "Akış B için defter yetersiz (defter bakiyesi + borç tavanı < tutar + komisyon)" ,
   BALANCE_EXCEEDS_NEW_LIMIT : "Mevcut bakiye yeni limit'in altında — önce manuel settlement yap" ,
   INVALID_LIMIT : "Geçersiz limit (0 veya pozitif olmalı)" ,
   AMOUNT_ZERO : "Tutar sıfır olamaz" ,
   REASON_REQUIRED : "Sebep zorunlu" ,
   MERCHANT_REQUIRED : "Merchant ID zorunlu" ,
   MERCHANT_NOT_FOUND : "Merchant bulunamadı" ,
   WALLET_NO_REQUIRED : "Cüzdan numarası zorunlu" ,
   NAME_REQUIRED : "Ad bilgisi zorunlu" ,
   ACCOUNT_NOT_FOUND : "Cüzdan hesabı bulunamadı" ,
   MERCHANT_ADJUSTMENT_FAILED : "Merchant kasa hareketi başarısız" ,
   REF_PAYLOAD_MISMATCH : "Aynı referansla farklı içerik gönderildi" ,
   BAD_TIMESTAMP : "Zaman damgası hatalı" ,
   IDEMPOTENT_REPLAY : "Tekrar edilen istek" ,
   NO_AVAILABLE_PROVIDER : "Şu anda aktif sağlayıcı yok, lütfen biraz sonra tekrar dene" ,
   WITHDRAW_IN_PROGRESS : "Zaten beklemede olan bir çekim talebiniz var. Önce onu sonuçlandırın." ,
   MERCHANT_NOT_PROVISIONED : "Merchant kurulumu eksik (signing_secret yok). Yöneticinize bildirin." ,
   PEPPER_NOT_CONFIGURED : "Sunucu kurulumu eksik. Yöneticinize bildirin." ,
   PEPPER_REQUIRED : "Sunucu kurulumu eksik. Yöneticinize bildirin." ,
   OWNER_REQUIRED : "Bu işlem yalnızca merchant owner'ı tarafından yapılabilir." ,
   NOT_A_MERCHANT_USER : "Hesabınız bir merchant'a bağlı değil." ,
   ROTATE_FAILED : "Secret rotate edilemedi." ,
   METHOD_REQUIRED : "Yöntem seçimi zorunlu" ,
   IBAN_REQUIRED : "IBAN gerekli" ,
   PAPARA_ACCOUNT_REQUIRED : "Papara hesap numarası gerekli" ,
   IBAN_INVALID : "IBAN doğrulanamadı (format veya kontrol haneleri yanlış)" ,
   IBAN_HOLDER_REQUIRED : "Hesap sahibi adı gerekli" ,
   CRYPTO_TYPE_REQUIRED : "Kripto varlık seçin" ,
   PAYOUT_ADDRESS_REQUIRED : "Cüzdan adresi gerekli" ,
   WITHDRAW_PUSH_FAILED : "Çekim sağlayıcıya iletilemedi. Destek ile iletişime geçin." ,
   SESSION_NOT_FOUND : "Oturum bulunamadı" ,
   SESSION_REQUIRED : "Oturum referansı zorunlu" ,
   THREAD_NOT_FOUND : "Destek talebi bulunamadı" ,
   THREAD_CLOSED : "Bu talep kapatılmış" ,
   INVALID_BODY : "Mesaj metni geçersiz" ,
   MERCHANT_MISMATCH : "Sağlayıcı eşleşmiyor" ,
   INVALID_STATUS : "Geçersiz durum" ,
   AUTH_USER_NOT_FOUND : "Bu e-posta ile kayıtlı kullanıcı yok" ,
   BAD_CREDENTIALS : "E-posta veya şifre hatalı" ,
   ACCOUNT_FROZEN : "Hesabınız donduruldu. Lütfen destek ile iletişime geçin." ,
   INVALID_ROLE : "Geçersiz rol" ,
   NOT_FOUND : "Kayıt bulunamadı" ,
   COMPANY_NAME_REQUIRED : "Şirket adı zorunlu" ,
   TAX_NO_REQUIRED : "Vergi numarası zorunlu" ,
   CONTACT_NAME_REQUIRED : "Yetkili adı zorunlu" ,
   INVALID_TYPE : "Geçersiz merchant tipi" ,
   PENDING_APPLICATION_EXISTS : "Bu e-posta için zaten açık bir başvuru var" ,
   APPLICATION_NOT_FOUND : "Başvuru bulunamadı" ,
   ALREADY_DECIDED : "Başvuru zaten karara bağlanmış" ,
   INVALID_ACTION : "Geçersiz işlem" ,
   CANNOT_CANCEL : "Bu başvuru iptal edilemez (statüsü uygun değil)" ,
   INVALID_IP : "Geçersiz IP veya CIDR formatı" ,
   WEBHOOK_NOT_HTTPS : "Webhook URL HTTPS olmalı" ,
   PENDING_EXISTS : "Devam eden bir işleminiz var. Önce onu tamamlayın veya iptal edin." ,
  INVALID_PERIOD_TYPE : "Geçersiz dönem tipi" ,
  INVALID_PERIOD_RANGE : "Geçersiz dönem aralığı" ,
  INVALID_DISTRIBUTION_PCT : "Geçersiz dağıtım oranı" ,
  INVALID_RECIPIENT_LIMIT : "Kişi sayısı 1 ile 500 arasında olmalı" ,
  INVALID_CLAIM_EXPIRES_HOURS : "Geçerlilik süresi 1 ile 720 saat arasında olmalı" ,
  PROFIT_SHARE_NO_PROFIT : "Bu dönem için pozitif net kâr yok" ,
  PROFIT_SHARE_NO_ELIGIBLE_USERS : "Bu dönem için uygun üye bulunamadı" ,
  PROFIT_SHARE_CAMPAIGN_NOT_FOUND : "Kazanç dağıtımı kampanyası bulunamadı" ,
  PROFIT_SHARE_INVALID_STATUS : "Kazanç dağıtımı kampanyası bu işlem için uygun durumda değil" ,
  PROFIT_SHARE_NO_ALLOCATIONS : "Bu kampanya için dağıtım satırı yok" ,
  PROFIT_SHARE_NOT_FOUND : "Kazanç payı bulunamadı" ,
  PROFIT_SHARE_NOT_PUBLISHED : "Kazanç payı henüz yayında değil" ,
  PROFIT_SHARE_NOT_CLAIMABLE : "Bu kazanç payı alınamaz" ,
  PROFIT_SHARE_EXPIRED : "Bu kazanç payının süresi doldu" ,
  AUTH_REQUIRED : "Önce giriş yapmalısın" ,
   STAFF_REQUIRED : "Staff hesabı gerekli. db:reset sonrası npm run admin:bootstrap çalıştırıp admin@wallet.local ile yeniden giriş yapın." ,
   PERMISSION_DENIED : "Bu işlem için yetki yok. db:reset sonrası çıkış yapıp admin@wallet.local ile yeniden giriş yapın." ,
   USER_NOT_FOUND : "Oturum geçersiz (kullanıcı bulunamadı). Çıkış yapıp yeniden giriş yapın." ,
   // ───────── Member Referral (Akış E) ─────────
   REFERRAL_DISABLED : "Davet sistemi şu anda kapalı." ,
   REFERRAL_INVALID_CODE : "Geçersiz davet kodu." ,
   REFERRAL_SELF_REFERRAL : "Kendi davet kodunla kayıt olamazsın." ,
   REFERRAL_ALREADY_APPLIED : "Bu hesap zaten bir davetle kullanıldı." ,
   REFERRAL_DUPLICATE_PHONE : "Davet eden ile aynı telefon numarası kullanılmış." ,
   REFERRAL_DUPLICATE_EMAIL : "Davet eden ile aynı e-posta kullanılmış." ,
   REFERRAL_IP_RATE_LIMIT : "Aynı bağlantıdan çok fazla kayıt — güvenlik için engellendi." ,
   REFERRAL_MONTHLY_CAP : "Bu ay için davet üst sınırına ulaştın." ,
   REFERRAL_MONTHLY_REWARD_CAP : "Bu ay için ödül üst sınırına ulaşıldı, talep beklemede." ,
   REFERRAL_MIN_SPEND_NOT_MET : "Ödül için minimum harcama tutarına ulaşılmadı." ,
   REFERRAL_NOT_FOUND : "Davet kaydı bulunamadı." ,
   REFERRAL_NOT_QUALIFIED : "Davet henüz ödül için uygun değil." ,
   REFERRAL_EXPIRED : "Davet süresi dolmuş." ,
   REFERRAL_NOT_FOUND_OR_TERMINAL : "Bu kayıt iptal edilemez (zaten ödüllendirilmiş veya iptal edilmiş)." ,
   // ───────── Merchant Affiliate (Akış F) ─────────
   AFFILIATE_DISABLED : "İş ortağı (affiliate) modülü şu an kapalı." ,
   AFFILIATE_NOT_FOUND : "Affiliate kaydı bulunamadı." ,
   AFFILIATE_NO_PAYABLE : "Talep edilebilir komisyon yok." ,
   AFFILIATE_PAYOUT_ALREADY_OPEN : "Zaten açık bir ödeme talebin var." ,
   AFFILIATE_INVALID_BASIS : "Geçersiz komisyon tabanı." ,
   MERCHANT_ALREADY_LINKED : "Bu merchant'a zaten aktif bir affiliate bağlı." ,
   LINK_NOT_FOUND_OR_INACTIVE : "Bağlama bulunamadı veya zaten kapalı." ,
   PAYOUT_NOT_FOUND : "Ödeme talebi bulunamadı." ,
   PAYOUT_INVALID_STATUS : "Ödeme talebi bu durum için uygun değil." ,
   PAYOUT_NOT_FOUND_OR_INVALID_STATUS : "Talep bulunamadı veya bu durumda red edilemez." ,
   PAYOUT_NOT_APPROVED : "Talep önce admin tarafından onaylanmalı." ,
   INVALID_KIND : "Geçersiz affiliate tipi." ,
   LINKED_USER_REQUIRED : "Sistem üyesi tipinde linked_user_id zorunlu." ,
   AUTH_USER_REQUIRED : "Dış affiliate için auth user_id zorunlu." ,
   EMAIL_REQUIRED : "E-posta zorunlu." ,
   INSUFFICIENT_PERMISSION : "Bu işlem için yetkiniz yok." ,
   MERCHANT_REF_REQUIRED : "Merchant referansı zorunlu." ,
   MERCHANT_INIT_UNSAFE : "Ödeme talimatı güvenlik kontrolünden geçmedi." ,
   METHOD_INACTIVE : "Bu yöntem aktif değil." ,
   CHILD_MERCHANT_REQUIRED : "Bu işlem için bayi seçmelisiniz." ,
   COMMISSION_REQUIRED : "Bayi için komisyon (%) zorunlu." ,
   INVALID_COMMISSION : "Komisyon oranı geçersiz." ,
   BO_ACCESS_CHILD_ONLY : "Ticari merchant BO erişimi yalnızca bayi kaydına verilebilir." ,
   CHILD_SECRET_ROTATE_NOT_ALLOWED : "Bayiler ana ticari merchant secret'ını kullanır." ,
   CHILD_IP_WHITELIST_NOT_ALLOWED : "Bayiler ana ticari merchant IP whitelist'ini kullanır." ,
   PARENT_NOT_PROVISIONED : "Ana ticari merchant credential'ları hazır değil." ,
   EXTERNAL_REF_REQUIRED : "Bayi referansı zorunlu." ,
   CHILD_CREATE_FAILED : "Bayi oluşturulamadı." ,
   INVALID_COLLECTION_FEE : "Tahsilat masrafı geçersiz." ,
   ACCOUNT_HOLDER_REQUIRED : "Hesap sahibi bilgisi gerekli" ,
   INVALID_STATE : "İşlem mevcut durumda bu adımı kabul etmiyor" ,
   SESSION_EXPIRED : "İşlem süresi doldu, lütfen yeni bir işlem başlatın" ,
   CONFIRMED_CANNOT_CANCEL : "Onayladığın işlem iptal edilemez, sağlayıcı onayı bekleniyor" ,
   MERCHANT_INIT_FAILED : "Sağlayıcıdan ödeme bilgileri alınamadı, lütfen tekrar dene" ,
   MERCHANT_INIT_NOT_CONFIGURED : "Para yatırma geçici olarak kullanılamıyor, lütfen daha sonra tekrar dene" ,
   MFA_REQUIRED : "Bu işlem için iki adımlı doğrulama (MFA) gerekli" ,
};

const AUTH_DICT: Array<[RegExp, string]> = [
   [/invalid\s+login\s+credentials/i , "E-posta veya Şifre hatalı" ],
   [/email\s+not\s+confirmed/i , "E-posta adresi onaylanmamış" ],
   [/user\s+already\s+registered/i , "Bu e-posta zaten kayıtlı" ],
   [/already\s+(registered|exists)/i , "Bu e-posta zaten kayıtlı" ],
   [/email\s+rate\s+limit\s+exceeded/i , "Çok fazla istek gönderildi, lütfen biraz sonra tekrar dene" ],
   [/password\s+should\s+be\s+at\s+least\s+(\d+)/i , "Şifre en az $1 karakter olmalı" ],
   [/unable\s+to\s+validate\s+email\s+address/i , "Geçerli bir e-posta adresi gir" ],
   [/signup(s)?\s+(is\s+)?disabled/i , "Yeni kayıt şu anda kapalı" ],
   [/anonymous\s+sign-?ins?\s+are\s+disabled/i , "Anonim giriş kapalı" ],
   [/jwt\s+expired/i , "Oturum süresi doldu, lütfen tekrar giriş yap" ],
   [/network/i, "Ağ hatası, bağlantını kontrol et" ],
];

function pickMessage(err: unknown): string {
  if (!err) return "";
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  if (typeof err === "object") {
    const anyErr = err as any;
    return (
      anyErr.error_message ||
      anyErr.message ||
      anyErr.error_description ||
      anyErr.error ||
       ""
    );
  }
  return String(err);
}

function pickCode(err: unknown): string | null {
   if (!err || typeof err !== "object") return null;
   const anyErr = err as any;
   return anyErr.error_code || anyErr.code || null;
}

// Aktif dile göre code → message lookup. EN sözlüğünde varsa EN, yoksa TR fallback.
function lookupCode(code: string): string | undefined {
  const lng = i18n.language || "tr";
  if (lng.startsWith("en") && EN_CODE_DICT[code]) return EN_CODE_DICT[code];
  return CODE_DICT[code];
}

export function translateError (err: unknown, fallback?: string): string {
   const lng = i18n.language || "tr";
   const defaultFallback = lng.startsWith("en")
     ? "An unexpected error occurred"
     : "Beklenmeyen bir hata oluştu";
   const fb = fallback ?? defaultFallback;

   const code = pickCode(err);
   const codeMsg = code ? lookupCode(code) : undefined;
   if (codeMsg) return codeMsg;

   const msg = pickMessage(err).trim();
   if (!msg) return fb;

   // Doğrudan error_code string'i geldiyse
   const directMsg = lookupCode(msg);
   if (directMsg) return directMsg;

   for (const [re, tr] of AUTH_DICT) {
     const m = msg.match(re);
     if (m) return tr.replace("$1", m[1] ?? "");
   }
   for (const [re, tr] of PG_DICT) {
     if (re.test(msg)) return tr;
   }

   // Audit 9.5 — production'da PostgreSQL/network ham mesajlarını
   // kullanıcıya gösterme. Sadece dev'de parantez içinde debug için ek.
   if (import.meta.env?.DEV) {
     return `${fb}${msg ? ` (${msg})` : ""}`;
   }
   return fb;
}
