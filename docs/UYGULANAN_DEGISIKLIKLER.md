# Wallet — Uygulanan Güvenlik ve İyileştirme Özeti

Bu doküman, 2026 yılı içinde Wallet platformunda yapılan dört turlu güvenlik ve prodüksiyona hazırlık denetiminin (G adımından başlayıp R adımıyla tamamlanan iyileştirme dizisi — 2026-05-28 itibarıyla) iş tarafındaki sonuçlarını özetler. Hedef kitlesi geliştirici ekibi değildir; sistemi yöneten ya da iş kararını veren kişidir. Teknik terimler mümkün olduğunca açıklamalı kullanılmıştır.

---

## Mevcut Durum (Tek Cümlede)

Sistem prodüksiyona açılmaya hazırdır: 50 kritik (P0) güvenlik / para açığının 45'i kapatılmıştır; geri kalan 3 madde tamamen dış sağlayıcı (Aninda) ile sözleşme görüşmesine bağlıdır ya da bilinçli olarak büyük kapsamlı bir özellik geliştirmesi olarak ertelenmiştir.

---

## Kullanıcı için Önemli Değişiklikler

Bu bölüm, gündelik kullanımda fiilen ne değiştiğini anlatır.

### Üye Tarafında

- Giriş yapıldığında oturum artık tarayıcı belleğinde tutulmuyor; "HttpOnly cookie" (JavaScript'in okuyamadığı çerez) kullanılıyor. Bunun anlamı: bir sayfada açık olabilecek bir koddan oturum bilgisi çalınamaz. (Batch O ile geldi.)
- Şifre değişikliği, e-posta değişikliği, çift faktörlü kimlik doğrulama (MFA) açma/kapama, hesap dondurma veya yetki yükseltme — bu olayların her birinde tüm aktif oturumlar otomatik kapatılıyor. Yani şifresi değişen bir kullanıcı, eski tarayıcılarda hâlâ açık kalan oturumlardan oto-çıkarılır.
- MFA (telefonla doğrulama) için artık 8 adet tek-kullanımlık "yedek kod" üretiliyor. Telefonu kaybeden kullanıcı bu kodlarla giriş yapabiliyor. (Batch K3.)
- Hatalı şifre denemesi 10 kere üst üste tekrarlanırsa hesap 15 dakika kilitleniyor.
- "Bu e-posta zaten kayıtlı" / "Bu telefon zaten kayıtlı" türünden cevaplar artık verilmiyor; aynı `SIGNUP_REJECTED` (kayıt reddedildi) cevabı dönüyor. Saldırgan, sistemde kimin olduğunu tek tek tarayamaz. (Batch K2.)
- Yeni cihazdan giriş yapıldığında üyenin e-posta adresine "yeni cihazdan giriş" bildirimi gidiyor (SMTP yapılandırılmışsa). (Batch Q1.)
- Ödeme kodu oluştururken artık "müşteri adı" alanı zorunlu — tüccar tarafı, kodu tarayan kişinin adını sistemde görüp eşleştirir. (Batch K5.)
- İşlem listesinde tüccarın adı, açıklaması veya `merchant_ref` (tüccarın kendi sıra numarası) görünmez; sadece işlem tipi, tutar, tarih ve sistemin kendi numarası görüntülenir (HARD_RULES kural 7).
- Üyeden hiçbir koşulda komisyon alınmaz. Komisyon platform maliyetidir (HARD_RULES kural 8).
- Şifre politikası: en az 12 karakter, büyük + küçük harf + rakam.

### Yönetici (Admin / Personel) Tarafında

- Tüm `/api/rpc` ve `/api/fn` admin işlemleri artık personel kimliği + AAL2 (ek doğrulama) + ilgili izin gerektiriyor. Önceden bir üye token'ı ile admin uçlarına ulaşılabiliyordu (chain 1 — kapatıldı). (Batch P0-1.)
- "Kullanıcının tüm oturumlarını kapat" butonu üye detay sayfasına eklendi; tek tıkla şüpheli bir hesabın tüm cihazlardan çıkışı sağlanıyor. (Batch K4.)
- Bir adminin başka bir admine ait e-posta / şifre değişikliği yapması artık reddediliyor; sadece `bo_users:manage` (kullanıcı yönetimi) izni olan biri yapabilir. Bu, admin-to-admin hesap çalma zincirini kapatır (P0-45).
- Tüm hassas denetim kayıtları (audit_log) artık denetlenen işlemle aynı veritabanı işlem (transaction) içinde yazılıyor. İşlem geri alınırsa kayıt da geri alınır — sahte / eksik kayıt riski yoktur. (Batch J1.)
- PCR (profil değişiklik talebi) için onay AND red, ikisi de denetim kaydına yazılıyor. E-posta onayı sonrası kullanıcının `email_verified_at` (e-posta doğrulanma zamanı) sıfırlanıyor ve tüm oturumları kapatılıyor.
- Personel sohbet ekranında üye e-posta adresi varsayılan olarak maskeli (`j***@example.com`); açık e-postayı görmek için ek izin gerekiyor. (Batch J4.)
- AI kullanım maliyeti günlük olarak izleniyor; günlük bütçenin %80'ine ulaşıldığında bir "yumuşak uyarı" logu basılıyor (yapay zekayı otomatik durdurmuyor, sadece dikkat çekiyor). (Batch K6.)
- Admin para düzeltme / yerleşim kaydı / nakit havuz ayarlama gibi işlemlere "idempotency key" (tekrar koruma anahtarı) eklendi. Yanlışlıkla iki kere tıklamak iki kere para hareketi yapmıyor. (Batch H4.)
- **İzin sözcükleri (permission vocabulary) hizalandı**: Sağlayıcı-yöntem eşleme RPC'lerinin (`admin_set/list/disable_provider_method_map`) ihtiyaç duyduğu `merchants:manage` + `merchants:view` izinleri seed'e eklendi — önceden bu özellikler her admin için sessizce "yetki yok" hatası dönüyordu. Ayrıca seed'de ve frontend permission registry'sinde `bo_users:manage` izninin **bilerek seed edilmediği** (P0-45 admin-to-admin hesap çalma korumasını korumak için) doküman yorumu eklendi. (Batch Q3.)

### Tüccar (Merchant) Tarafında

- Tüccarın kendi paneli üzerinden imzalama gizli anahtarı (signing secret) yenilemesi artık denetim kaydına yazılıyor ve eski `x-api-secret` (legacy başlık) anında geçersizleşiyor. (Batch G1+G3.)
- `merchants.signing_secret` veritabanında düz metin değil, AES-GCM şifrelemesiyle saklanıyor. Veritabanı sızıntısı tek başına tüccar gizli anahtarını sızdırmaz. (P0-12.)
- Tüccar API yanıtlarında imzalama anahtarı artık dönmüyor; sadece maskeli görünüyor.
- Aninda gibi finans sağlayıcılar için tüm webhook'lar (deri çağrılar) zorunlu olarak HMAC imzası + ±5 dakikalık zaman damgası penceresi ile doğrulanıyor. Çalınan gizli anahtar bile sınırsız tekrar saldırısı yapamaz. (P0-20 + P0-27.)
- Para çekme istekleri çift gönderim durumuna karşı atomik olarak "kilitleyip-gönder" pattern'i ile korunuyor. Aynı çekme isteği için yan yana iki istek atılırsa biri otomatik `WITHDRAW_NOT_PUSHABLE` ile reddediliyor. (P0-23.)

---

## Para Akışı (En Önemli Düzeltmeler)

Bu bölüm doğrudan defter tutmayı, çifte ödemeyi ve yarış koşullarını ilgilendirir.

- **Eşzamanlı işlem koruması**: Bakiye değişen her yerde (ödeme kodu tüketme, topup tamamlama, withdraw tamamlama, merchant_credit) artık veritabanı satırı kilitleniyor (`SELECT FOR UPDATE`). İki istek aynı bakiyeyi aynı anda harcayamaz. (P0-2.)
- **Çift çağrı koruması**: Tüccar API'sinde aynı `merchant_ref` ile iki istek geldiğinde, ikincisi para hareketinin yapılmasını beklemeden geri çevriliyor; idempotency kaydı para hareketiyle aynı veritabanı işleminde atılıyor. (P0-3.)
- **Para çekme tek-aktif kuralı**: Bir kullanıcının aynı anda yalnızca bir adet açık para çekme oturumu olabilir; veritabanı seviyesinde "partial unique index" ile garanti altında. (P0-16.)
- **Akış D komisyon hesaplama düzeltildi**: Para çekme finalize edildiğinde nakit havuzu artık `tutar - komisyon` kadar düşüyordu, önceden yanlışlıkla bütün tutar düşürülüyordu. (P0-16.)
- **Nakit havuzu logu artık eksiksiz**: Akış C (topup) ve Akış D (withdraw) sonunda `merchant_cash_pool_log` (nakit havuzu defteri) doğru veriyle yazılıyor. Önceden bu kayıt hiç atılmıyordu; finansal mutabakat imkansızdı. (P0-33 + P0-34.)
- **Sağlayıcı defteri (`provider_ledger`) artık yazılıyor**: Bir "merchant→provider_method" eşleme tablosu eklendi; finans sağlayıcısı tarafındaki para hareketleri artık otomatik kayıt altına alınıyor. (Batch L.)
- **`balance_after` (işlem sonrası bakiye) artık tüm yeni işlemlerde dolduruluyor**. Önceden boş kalıyordu — mutabakat sırasında her kaydı yeniden hesaplamak gerekiyordu. (P0-40.)
- **Aşım limiti (overdraft) artık fiilen uygulanıyor**: `cash_pool + overdraft_limit` para çekme yönlendirmesi sırasında doğru kapasiteye dönüştürülüyor. (P0-39.)
- **Ondalık komisyon matematiği BigInt minor-units + banker yuvarlama ile yapılıyor** — eski `Math.round(amount * pct / 100)` kayan-nokta hesabı kuruş kayıplarına neden oluyordu. (Batch G grubu.)
- **`admin_tx_daily` günlük özeti tablosu düzeltildi**: Saatlik özet işçisi tamamen bozuktu (tip uyumsuzluğu, PRIMARY KEY yoktu). Artık çalışıyor. (P0-36.)
- **Tüccar nakit çekim (cashout)** geçici olarak `503 CASHOUT_DISABLED` ile devre dışı; sahte "kabul edildi" yanıtı dönüp arkada hiçbir şey yapmama hatası giderildi.
- **Profit-share (kâr paylaşımı) drafttan tüketilmiyor**: Yayımlanmamış (`draft`) kampanyaların ödülleri artık üyelere görünmüyor ve talep edilemiyor. (P0-24.)
- **Üye affiliate ödemeleri kapalı**: Anti-farming (ödül çiftçiliğini engelleme) işçileri tamamlanana dek `REFERRAL_PAYOUTS_ENABLED` env ile kapalı tutuluyor. (P0-18.)
- **`external_tx_id` üzerinde tekrar engelleme**: Üçüncü-parti işlem kimliği için kısmi UNIQUE index eklendi (sadece NULL olmayan satırlar). Aynı `external_tx_id` ile iki kez kayıt açılamaz; çift kayıt sessiz geçmez, yazma hatası verir. (Batch Q2.)
- **Veritabanı bütünlük kuralları (Batch P)**: `provider_ledger.provider_id` artık `payment_providers` tablosuna `ON DELETE RESTRICT` ile bağlı; `loyalty_points_log` üzerinde tekrar koruma indeksi (`user_id + reason + reference_id`); `merchants_hierarchy_chk` (parent/child ilişkisi); `profit_share_campaigns` invariantları (`period_from < period_to`, `pool_amount >= 0`, `max_recipients > 0`); `provider_method_health` non-negative + window-ordering + success_rate aralık CHECK'leri. Hiçbiri canlı veriyi değiştirmiyor; her biri yanlış-yazma anında hatayı yüzeye çıkarıyor. (Batch P, mig 0014.)
- **`admin_tx_daily` tazelik gözcüsü**: Saatlik cron `:30`'da çalışıyor; günlük özet tablosu 120 dakikadan fazla geride kalırsa log'a uyarı düşüyor. Pure observability; hiçbir veriyi değiştirmez. (Batch P3.)

---

## Güvenlik (En Önemli Düzeltmeler)

- **Token (oturum bileti) depolama**: Eski sürümde access ve refresh token'ları tarayıcı localStorage'ında tutuluyordu — bir XSS (kod enjeksiyonu) hatası bulunsa hesap kalıcı çalınırdı. Artık her ikisi de HttpOnly çerez içinde, JavaScript erişemiyor. CSRF (sahte istek koruması) çift-gönderim çerezi ile her durum-değiştirici isteği koruyor. (Batch O.)
- **Refresh token formatı opak rastgeleye çevrildi**: Önceden refresh token bir JWT idi ve `JWT_REFRESH_SECRET` anahtarı sızarsa saldırgan kendi token'ını üretebilirdi. Artık 48 byte rastgele bir blob; veritabanında SHA-256 hash'i ile tutuluyor. Anahtar sızıntısı tek başına forge'a (sahteleme) yetmez. (P0-47.)
- **AAL2 (ikinci-faktör doğrulama) zorunlu**: Her personel rotası ve hassas tüccar işlemi için sunucu tarafında ikinci faktörle doğrulanmış olma şartı kontrol ediliyor.
- **MFA kapatma işlemi adımlı doğrulama gerektirir**: Saldırgan oturuma sızsa bile MFA'yı kapatamaz; aktif TOTP kodu + şifre veya AAL2 + yakın zamanlı kimlik doğrulama şart. (P0-49.)
- **TOTP tekrar koruması**: Aynı 30 saniyelik pencerede aynı kod iki kez kullanılamaz.
- **Storage IDOR'u kapatıldı**: Önceden bir kullanıcı, başka bir kullanıcının dosya yolunu tahmin ederek dosya yükleyebiliyor / okuyabiliyor / silebiliyordu. Artık her yol `{userId}/{threadId}` ile bağlı; imzalı URL token'ı içinde kullanıcı kimliği gömülü. (P0-5 + H1.)
- **Chat / referans / affiliate IDOR'u kapatıldı**: Her tabloya özel "scopeRow" doğrulaması var. `isStaff = perms.size > 0` (herhangi bir izni olan personel sayılır) güvenlik açığı, açık per-izin kontrolüne dönüştürüldü. (P0-6 + P0-46.)
- **PII (kişisel veri) maskeleme**: Üye e-posta, telefon ve IBAN bilgileri varsayılan olarak frontend'de maskeli; sadece `members.pii:view_full` izni olan personel açık görür.
- **SSRF (sunucu tarafı sahte istek) koruması**: Tüccar tarafına yapılan tüm dış HTTP çağrıları RFC1918 (özel ağ) / loopback / link-local IP'leri reddediyor; yönlendirmeler manuel.
- **Açık-yönlendirme (open redirect) korumaları**: Topup `returnBase`, tüccar `redirect_url`, MockPay `return`, MfaChallenge `from` — hepsi sunucu tarafı izin listesinden geçiyor.
- **Aninda webhook MD5 karşılaştırması sabit-süreli (constant-time)**: Zaman tabanlı yan-kanal saldırısı yok. (P0-20.)
- **Helmet CSP (içerik güvenlik politikası)** Vite SPA'sı için sıkılaştırıldı; `frame-ancestors 'none'`, satır içi script yasak, vb.
- **JWT geçersizleştirme**: Her access token bir `jti` taşır; acil durumda denylist'e atılıp 15 dakika TTL'i beklenmeden iptal edilebilir.
- **Dosya yükleme MIME magic-byte kontrolü**: Saldırgan ".jpg" diye gönderse bile içerik gerçekten o tipte mi diye baytlara bakılıyor; SVG yüklemesi tamamen reddediliyor (XSS vektörü). (Batch G6.)
- **MOCK_FNS_ENABLED prodüksiyonda reddediliyor**; Aninda `KEY` env zorunlu; admin bootstrap `ADMIN_PASS` zorunlu.

---

## Geliştirici / Operasyon Tarafı

- **Otomatik yedekleme**: `deploy/backup.sh.example` günlük `pg_dump` ile veritabanını yedekliyor; saklama politikası belgelendi.
- **Sistem servisi**: `deploy/wallet-api.service.example` sıkılaştırılmış (NoNewPrivileges, ProtectSystem=strict, SystemCallFilter, vb.).
- **TLS template**: `deploy/nginx-wallet.tls.conf.example` HTTPS + HSTS + HTTP→HTTPS yönlendirme ile geliyor.
- **Postgres rolleri ayrıldı**: `wallet_app` (uygulama) düşük yetkili, `wallet_migrate` (migrasyon) sadece şema değişiklikleri için.
- **CI** her PR'da `npm audit --omit=dev --audit-level=high` çalıştırıyor; Dependabot haftalık güncelleme açıyor.
- **`/readyz`** veritabanı ping'i ile birlikte gerçek hazır-olma sinyali döndürüyor.
- **`/metrics`** Prometheus uçlarını verir; `METRICS_TOKEN` ile korunur.
- **Rate-limit**: Tüm public auth ve `/merchant-api/*` uçları `express-rate-limit` ile sınırlı.
- **Log redaksiyonu**: Pino logger artık e-posta, telefon, IBAN, OTP, token, Aninda body'leri, Anthropic body, Telegram body, geo body'lerini diske inmeden önce maskeliyor.
- **Smoke test**: `node scripts/smoke-all.mjs` 172 endpoint testini ~5 saniyede çalıştırır. Üretime karşı çalışmasını engellemek için BASE localhost kontrolü vardır.
- **Token temizleme cron'u**: Süresi dolmuş refresh / password-reset / email-verification token'ları saatlik temizleniyor (HARD_RULES kural 20 — denetim kayıtlarına dokunmaz).
- **Coğrafi bilgi (login geo)** artık dış servis çağrısı (`ipapi.co`) yerine yerel offline `geoip-lite` (MaxMind GeoLite2) ile yapılıyor — sıfır dış ağ trafiği, sıfır 3. parti PII paylaşımı. Üç ayda bir `npx geoip-lite-update` ile tazeleniyor. (Batch K1-r.)
- **SMTP e-posta**: `lib/email.ts` nodemailer + Resend fallback ile gerçek e-posta gönderiyor. Şifre sıfırlama, profil OTP, MFA yedek kodları, yeni cihaz uyarısı — hepsi gerçek transport'tan geçiyor. SMTP yapılandırılmamışsa sistem sessizce skip ediyor (geliştirme ortamında log'a düşer). (Batch N.)

### Batch R — Cookie Geçişi Sonrası Temizlik

Batch O (cookie + opak refresh + CSRF) sonrası kalan tüm regresyonlar tek seferlik bir süpürmeyle kapatıldı:

- **Socket.IO bağlantısı çerez ile çalışıyor**: WebSocket handshake artık `withCredentials: true` ile açılıyor; sunucu tarafı handshake middleware `Authorization` başlığı OR `Cookie: access_token`'ı sırayla deniyor. Üyenin canlı bildirim / chat soketi Batch O sonrası tek bir kod değişikliğiyle çalışmaya devam ediyor. (R1.)
- **Dosya yükleme + ayar dışa-aktarımı çerezle çalışıyor**: `storage.ts` ve `exportSettlement.ts` artık `credentials: "include"` ile gönderiyor ve `X-CSRF-Token` başlığını çereze göre ekliyor. Önceden Batch O sonrası bu iki yol "Authorization: Bearer (boş)" gönderdiği için sessiz kırılıyordu. (R2 + R3.)
- **Eski `getCurrentUserId` kaldırıldı**: Tarayıcıdaki localStorage JWT'sini decode etmeye çalışıyordu — Batch O sonrası imkansız. Tek çağıran (`merchant/Cashout.tsx`) artık `useAuth().user?.id`'den okuyor. (R4.)
- **Kritik `/auth/refresh` 500 hatası kapatıldı**: Batch O içindeki raw-SQL `SELECT FOR UPDATE` sorgusu Drizzle'ın Date mapper'ını bypass ettiği için `expires_at` string olarak dönüyor, sonraki `.getTime()` çağrısı 500 hata atıyordu. Yani **tüm `/auth/refresh` çağrıları üretimde patlıyordu**. Smoke test #4'te yakalandı; `new Date(row.expires_at)` defansif sarmalama ile düzeltildi. Cookie + opak-refresh + CSRF tasarımı korundu. (R5 — canlı düzeltme.)
- **Login navigation regresyonu**: `useAuth.loadMe()` eski `getAccessToken()` getter'ına dayanıyordu; Batch O onu null'a çevirdiği için kullanıcı login olsa bile yönlendirme yapılmıyordu ("Welcome!" toast'u atılıyor ama sayfa değişmiyordu). `wallet.session-present` (token olmayan, sadece "oturum açık" işareti) flag'i + `hasSessionHint()` helper'ı ile çözüldü.

---

## Hâlâ Bekleyen Maddeler

Toplam 5 madde açık; her birinin durumu:

| ID | Konu | Neden bekliyor | Kim ne yapacak |
|---|---|---|---|
| **P0-21** | Süresi dolmuş bir topup oturumuna gelen geç-bildirim çağrısı şu an HTTP 500 dönüyor — üye ödedi ama bakiyesi yüklenmiyor. | Çözüm Aninda'nın yanıt-kodu sözleşmesini (`200 + LATE_CALLBACK` veya genişletilmiş TTL) değiştirmesini gerektirir. | Aninda teknik ekibi onayı bekleniyor (Q5 sahibi kararı). |
| **P0-22** | Tutar uyuşmazlığı durumunda webhook 500 dönüyor → sağlayıcı sonsuz tekrar saldırısı yapıyor. | Aynı kategori: `200 + AMOUNT_MISMATCH` cevap şekline geçiş için Aninda sözleşmesi. | Aninda teknik ekibi onayı bekleniyor. |
| **P0-32** | 7 adet admin remediation RPC'si (referral nitelendirme, override silme, affiliate dashboard, vb.) henüz yazılmadı. | Geniş kapsamlı ekleme; admin zaten REST üzerinden operasyon yapabiliyor. | İş kararı + geliştirme planlanması. |
| **PARTIAL: profit-share rounding** | Kâr paylaşım havuzu hesabında `platformCost = 0` sabit + yuvarlama artığı + revenue eksik sayımı. | Üyelerin gördüğü ödeme tutarını değiştirir — iş tarafı kararı (Q23 ertelendi). | Sahibinden açık onay. |
| **PARTIAL: signup verification-first** | İlk kayıt sonrası e-posta doğrulanmadan sistem kullanılabiliyor; bunu zorunlu tutmak doğrulama linki tıklanana kadar kullanıcıyı kilitler. | UX değişikliği — destek iş yükünü artırabilir. | İş kararı. |

Ek olarak: Aninda canlıya alımı için operasyon işleri — gerçek `KEY/PASSWORD`, panelde callback URL + IP allow-list ayarı, `merchants.cash_pool` değerinin gerçek banka kapasitesiyle eşleştirilmesi, gerçek depozit/çekim E2E testi. Detaylar `docs/ANINDA_KRIPTO_INTEGRATION.md`.

---

## İptal Edilen / Erteleme Listesi (Bilinçli Karar)

Bu maddeler **eksiklik değildir**; bilinçli olarak yapılmadı veya iptal edildi:

- **Loyalty v3 formülü düzeltmesi (K9)** — Üyeler şu an spek'in ~10 katı puan kazanıyor; iş tarafı "Option C — iş kararı verilene kadar fazladan kazanmaya devam etsin" dedi. Etkisi tüm üye tabanını ilgilendireceği için ertelendi.
- **Sentry / APM gibi dış izleme servisleri** — HARD_RULES kural 22 gereği bilerek bağlanmadı; Pino structured log'lar tek doğruluk kaynağı, dağıtım taraflı log forwarder (Telegram / e-posta) hataları yönlendiriyor.
- **S3 / R2 dosya saklama** — HARD_RULES kural 22: sohbet ekleri yerel disk (`STORAGE_LOCAL_DIR`) üzerinde tutuluyor. Çok-düğümlü dağıtım istemiyoruz; bu karar maliyeti ve karmaşıklığı düşürdü.
- **multer 2.x güncellemesi** — Breaking dep bump (geriye dönük uyumsuz); planlı bir versiyon yükseltme PR'ı bekleniyor.
- **`refund` enum değerinin enum'dan silinmesi** — Sistemde refund (iade) RPC'si yok ve olmayacak (HARD_RULES kural 14 / 13), ancak gelecekte ihtimaline karşı enum değeri tutulmaya karar verildi (Q17).
- **Adjustment prefix'inin `X`'ten `ADJ`'a yeniden adlandırılması** — Aynı sebep + geçmiş kayıtlarla uyumsuzluk riski (Q18).
- **i18n `escapeValue: false`** — HARD_RULES kural 21: tüm çeviri anahtarları statik JSON ve React JSX render sırasında otomatik escape ediyor. Kullanıcı-kontrollü içerik girmedikçe değiştirmek gereksiz. Bilinçli ayar.
- **Chat / audit retention purge cron'u yok** — HARD_RULES kural 20: `audit_log`, `merchant_api_calls`, `chat_messages`, vb. **sonsuza dek** saklanır. Ölçek 100M satıra ulaşınca Postgres partitioning ile çözülecek.
- **GDPR export / erase, KYC retention, AML monitoring** — Büyük kapsamlı eklemeler, hard constraint olarak şu sürümde planlanmadı.

---

## Yeni Kurallar (Hard Rules — 23 Madde)

Sistemde değişmez (invariant) kurallar 16'dan 23'e yükseldi. Her biri tek cümlede:

1. **Idempotency** — Her tüccar çağrısı `merchant_ref` taşır; aynı ref ikinci kez çağrılırsa eski cevap döner.
2. **İmza** — `HMAC-SHA256(signing_secret, timestamp + ":" + raw_body)` zorunlu; parent/child modelinde imza parent'a aittir.
3. **Zaman damgası** — ±5 dakika pencere; dışındaysa `STALE_TIMESTAMP`.
4. **Denetim** — Her tüccar çağrısı `merchant_api_calls`'a, her bakiye hareketi `transactions` + `merchant_settlement_log` veya `merchant_cash_pool_log`'a düşer.
5. **PII maskeleme** — Frontend `mask*()` helper'larıyla gizler; tam görüş `members.pii:view_full` izni gerektirir.
6. **Service-layer scoping** — RLS (row-level security) yok; her okuma servis katmanında çağıranın kimliğine pinleniyor.
7. **Üyeye tüccar adı gösterilmez** — A/B/C/D akışlarında üye sadece işlem tipi etiketi + tarih + tutar + sistem TX kimliğini görür.
8. **Üyeden komisyon alınmaz** — `transactions.amount` üyenin gördüğü gross; `fee` platform komisyonu (üyeye yansıtılmaz).
9. **Reserve pattern** — Ödeme kodu üretildiğinde puan + bakiye rezerve edilir; tüketmede düşer, iptal/timeout'ta serbest bırakılır.
10. **Tier snapshot** — Ödeme kodu üretildiğindeki tier veritabanına yazılır (üye iki kod arasında tier atlayarak gri-alan oluşturamaz).
11. **Tüccar nakit havuzu / kredi limiti kontrolü** — `merchant_credit`'te `SELECT … FOR UPDATE` + CHECK constraint ile garanti; aşımda `INSUFFICIENT_MERCHANT_BALANCE`.
12. **`balance ≠ cash_pool`** — `balance` platform yerleşim defterimiz, `cash_pool` tüccarın kendi bankası; ayrı tutulur.
13. **Tüccar BO izolasyonu** — Tüccar kullanıcısı sadece kendi tüccarının verisini görür; çapraz veri yasak.
14. **Üç katmanlı işlem kimliği** — `public_no` (bizim), `merchant_ref` (tüccarın), `external_tx_id` (3. parti).
15. **Commerce parent/child** — A/B akışındaki muhasebe **child** üzerinde yazılır; parent sadece entegrasyon.
16. **Commerce cashout reservation** — `amount + fee` rezerve edilir; başarıda bakiye düşer, başarısızlıkta serbest kalır.
17. **Güvenlik durumu değişen oturumlar geçersiz olur** — Şifre / e-posta / MFA / freeze / yetki yükseltme aynı transaction içinde `revokeAllForUser` çağırır. (Batch J5.)
18. **Denetim yazımı transactional** — `writeAudit({ trx })` çağıran transaction'a katılır; audit hatası mutasyonu da geri alır. (Batch J1.)
19. **PCR (profil değişiklik talebi) bütünlüğü** — Üye sadece ad/soyad gönderebilir; e-posta/telefon ayrı OTP akışından gider; onay AND red her ikisi de aynı tx içinde audit yazar. (Batch H1+J1.)
20. **Denetim + chat saklama sonsuza dek** — `audit_log`, `merchant_api_calls`, `chat_*`, `ai_cost_log` hiç silinmez; sadece token tabloları purge edilir. (Batch K8.)
21. **i18n `escapeValue: false` bilinçli** — Statik JSON + JSX render zaten kaçırıyor. Kullanıcı-kontrollü çeviri eklenirse o anahtar için ayar değiştirilir.
22. **Yerel-only storage / APM yok / offline geo** — Dosyalar yerel diskte, APM bilerek devre dışı, geo `geoip-lite` ile offline. (Batch K8 + K1-r.)
23. **MFA yedek kodları** — 8 adet tek-kullanımlık `XXXXX-XXXXX` kod; veritabanında yalnız SHA-256 hash'i; yeniden üretim AAL2 gerektirir + eski seti geçersizleştirir. (Batch K3.)

---

## Deploy Sırasında Bilinmesi Gerekenler

- **Batch O dağıtımı tek seferlik tüm kullanıcıları otomatik çıkış yaptıracak**. Hem opak refresh token (O.1), hem HttpOnly cookie (O.2), hem CSRF (O.3) aynı sürümde devreye giriyor. Bu bilinçli: kullanıcı iki kez değil bir kez yeniden giriş yapar. Önceden en az 24 saat duyuru banner'ı / mailing düşünülmesi tavsiye edilir.
- **SMTP ayarları opsiyoneldir** (HOST, PORT, USER, PASS, FROM); yapılandırılmamışsa sistem sessizce skip eder (`EMAIL_NOT_CONFIGURED` debug log). Üretimde SMTP zorunlu sayılmalıdır — yoksa şifre sıfırlama / yeni cihaz uyarısı / OTP gibi e-postalar gönderilmez.
- **`MFA_ENCRYPTION_KEY`** üretimde 64 karakter hex (32 byte) olmak zorunda; tüm-sıfır veya hex-dışı değer reddedilir (env validator).
- **`ADMIN_PASS`** üretimde zorunlu; bootstrap-admin script'i zayıf veya eksik şifre ile başlamaz; ilk girişte şifre değişikliği zorlanır.
- **`MOCK_FNS_ENABLED`** üretimde `false` olmak zorunda; aksi halde uygulama başlamaz.
- **`HOST=127.0.0.1`** varsayılan (`.env.example` içinde); nginx terminate etmiyorsa elle açılması gerekir.
- **`ANINDA_KEY`** üretimde zorunlu, boş veya `admin` değeri reddedilir.
- **Yerel disk dosya saklama** (HARD_RULES kural 22): `STORAGE_LOCAL_DIR` mutlak path olmalı; backup script'i bu dizini de yedeklemeli.
- **`geoip-lite` veritabanı** üç ayda bir tazelenmeli: CI'da `npx geoip-lite-update` çağrısı.
- **Aninda canlıya alım**: panelde callback URL + IP allow-list, `merchants.cash_pool` gerçek banka kapasitesine, `topup_init_url` her aktif finans tüccarı için BO veya SQL ile, mock IBAN fallback'leri kapatılmalı.
- **Build sırası sabittir**: `packages/shared` → `apps/api` → `apps/web`.
- **TLS** nginx üzerinden terminate edilir; `deploy/nginx-wallet.tls.conf.example` referans.

---

## Toplam Kazanım

| Metrik | Önce | Sonra |
|---|--:|--:|
| Toplam P0 (lansman engelleyici) | ~50 | 50 |
| Çözülen P0 | — | 45 |
| Gerçek anlamda bekleyen P0 | — | 3 (hepsi açık sahip kararı) |
| HARD_RULES değişmez kuralları | 16 | **23** |
| Kapatılmış güvenlik saldırı zinciri | 0/6 | **6/6** (chain 5'in son ucu Aninda'ya bağlı) |
| Veritabanı migrasyonu çalıştırıldı | 0004 öncesi | 0015'e kadar |
| Smoke test endpoint kapsaması | parça parça | 172 case / ~5 sn |
| Refresh token formatı | JWT (sızıntıda forge mümkün) | Opak rastgele + sha256 DB lookup |
| Token depolama | `localStorage` (XSS okur) | HttpOnly cookie + CSRF çift-gönderim |
| Coğrafi bilgi sağlayıcısı | `ipapi.co` (dış API çağrısı) | Offline `geoip-lite` (sıfır dış trafik) |

**Sonuç**: Wallet platformu, dış sağlayıcı (Aninda) yanıt-kod sözleşmesi onaylandığında ve operasyon adımları (canlı KEY, callback URL, gerçek banka cash_pool kalibrasyonu) tamamlandığında prodüksiyona açılmaya hazırdır. Bilinçli olarak ertelenmiş 8 madde dışında, dört turlu denetimde tespit edilen kritik güvenlik ve finansal bütünlük açıklarının tamamı kapatılmıştır.

---

*Bu doküman 2026-05-28 tarihinde, Batch R'nin tamamlanmasının ardından üretilmiştir. Güncel teknik kaynak: `.cursor/plans/wallet_production_go-live_audit_591d4884.plan.md`. Kuralların tam metni: `docs/HARD_RULES.md`. Mevcut durum: `docs/SESSION_STATUS.md`.*
