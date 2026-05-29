# Sayfa sözleşmeleri (Admin/Üye/Merchant BO)

Yeni özellik öncesi bu dosyaya madde ekle. Kontrat-önce akış: `docs/FEATURE_WORKFLOW.md`

### Genel kural
- Bir sayfanın "Etki kapsamı" net olmalı: TEK kullanıcı / TEK merchant / global
- "Global etki" değişiklik = migration veya admin RPC üzerinden yapılır, BO sayfası değil

### `/admin/permissions`
- **Amaç**: kullanıcı-bazlı yetki yönetimi
- ✅ Rol toggle (admin/accounting/support), modül override, hassas veri override
- ❌ Global rol matrisi düzenleme (kaldırıldı), başkasını etkileyen toggle
- **Etki kapsamı**: TEK kullanıcı (override mekanizması)

### `/admin/users`
- **Amaç**: BO kullanıcıları yönetimi (admin/accounting/support roller)
- ✅ Yeni BO kullanıcısı yarat (`POST /api/admin/users`, email+şifre+ad+soyad+rol), hesap dondur, role değiştir, profil/aktivite görüntüle
- ✅ Profil "Düzenle" butonu (only admin role) — ad/soyad/e-posta/telefon edit, `admin_update_member_profile` shim + audit_log
- ❌ Mevcut üye seçtirme, kendi admin yetkini kaldırma
- **Etki kapsamı**: tek kullanıcı

### `/merchant/users` (owner only)
- **Amaç**: iş yeri kullanıcıları yönetimi
- ✅ Yeni `merchant_users` satırı (3 rol: owner / accountant / read_only) — yeni user de yaratılabilir
- ❌ Kendi rolünü değiştirme, son owner'ı düşürme (`LAST_OWNER` server guard)
- **Etki kapsamı**: tek merchant'ın kullanıcıları

### `/merchant/permissions`
- **Amaç**: rol-modül yetki dağılımının görüntülenmesi (info-only)
- ✅ 3 rol kartı + modül × rol matrisi gösterir
- ❌ Per-user override (Phase 4'e ertelendi — DB schema gerekiyor)

### `/payment` (üye)
- ✅ Harcama puanı preview gösterir
- ❌ Cashback vaadi göstermez (cashback ürün bazında kapalı)
- ❌ `tx.fee` (provider ücreti) ÜYEYE gösterilmez (Hard rule #9)

### `/merchant` (Merchant BO Dashboard)
- ✅ Tüm metinler MERCHANT POV'unda — "Hesap bakiyem", "Tahsil edilebilir tutar"
- ❌ "Bizden alacaklı" / "Bize borçlu" gibi platform POV YASAK

### `/admin/affiliates` → wizard
- 4 adım: tip (ticari/finans) → merchant seç (multi) → aff bilgi → komisyon
- ❌ TC/vergi no input YASAK
- ✅ External için mevcut `users.id` bağla veya wizard içinde yeni user yarat

### `/admin/merchants`
- Pasif satırlar: full kırmızı arka plan + EN ALTTA sıralı
- Aktif/pasif toggle: SADECE admin role
- Finance merchant: `deposit_min/max` + `withdraw_min/max` alanları görünür
- Finance merchant: kasa tahsilat masrafı `% + sabit` olarak Komisyon sekmesinde tutulur; değişiklik sadece admin veya `merchants:cash_collection_fee` hassas yetkisi açık kullanıcıya açık
- Commerce merchant create: ana parent/standalone kayıt açar; komisyon ve işlem limitleri burada girilmez. Child/bayi bazlı komisyon + `per_tx_limit` + `daily_limit` parent detayındaki `Bayiler` tab'ından girilir.
- Ticari parent admin çatısıdır; Merchant BO kullanıcısı parent'a verilmez, bayi/child kaydına verilir.
- Bayi ekleme: bayi ref otomatik, komisyon (%) zorunlu, IP whitelist parent seviyesinden uygulanır.
- ❌ Ayrı "Sağlayıcılar" sayfası YOK
- ❌ "Onboarding" sol menü YOK (route registry dışında back-compat olarak duruyor)

### `/admin/merchant-children`
- **Amaç**: bayileri ana muhasebe/operasyon kırılımı olarak listelemek
- ✅ Tüm commerce child/bayi kayıtlarını ana merchant, API key, komisyon, limit, settlement, günlük hacim ve durum ile gösterir
- ✅ Satır tıklama child merchant detayına gider; BO yetkili kullanıcıları child detayından verilir
- ✅ Muhasebe raporlarında bayi `merchant_id` ayrı satırdır; parent seçilirse ilgili child'lara genişler
- ❌ Parent ticari merchant'a BO kullanıcısı bağlamaz
- **Etki kapsamı**: commerce child/bayi kayıtları

### `/admin/settings`
- ❌ "Komisyonlar" tab YOK (komisyon merchant ekleme anında set edilir, default settings yok)
- ✅ OTP, Sadakat puanı, Sistem tabs

### `/admin/templates`
- ✅ Mail / Telegram / Chat canned 3 tab — şablon edit + ekle
- ✅ `bo_permissions: templates:view + templates:edit` (admin grant)
- ✅ Her sekmede "Yeni …" butonu → `admin_create_mail_template` / `admin_create_telegram_template` / `admin_create_chat_canned` RPC shim'leri
- ❌ Hard rule #7 ihlal etmez — üye-yüzü mailde merchant adı YOK

### `/admin/reconciliation`
- **Amaç**: finansal mutabakat ve muhasebe invariant görünürlüğü
- ✅ Akış A/B/C/D için `transactions.amount` gross, `transactions.fee` komisyon, beklenen net posting ve gerçekleşen settlement/cash_pool hareketini karşılaştırır
- ✅ Admin/accounting erişimi; tarih ve merchant filtresi
- ✅ Farklı kayıt sayısını öne çıkarır; debugging için public TX no + merchant gösterir
- ❌ Manuel düzeltme/adjustment yapmaz; sadece okuma ve teşhis ekranıdır
- **Etki kapsamı**: global finansal okuma

### `/admin/finance-integrations`
- **Amaç**: finance merchant gerçek entegrasyon readiness görünürlüğü
- ✅ Aktif/pasif finance merchant'ları, `topup_init_url`, webhook, cash_pool freshness (30 dk stale), sync URL, limitler, komisyonlar ve son API çağrısını tek tabloda gösterir
- ✅ Arama + preset filtreler (Tümü / Init eksik / Kasa stale / Sync eksik / Pasif); özet kartlar filtrelenmiş satırlara göre güncellenir
- ✅ CSV export (maskeli API key/URL); link `/admin/merchants?type=finance`
- ✅ Akış C init request/response contract örneğini gösterir
- ✅ "Test et" dialog'u `POST /api/admin/finance-integrations/test` üzerinden gerçek `topup_init_url`'e HMAC imzalı test request gönderir; request/response/contract/callback örneğini gösterir
- ✅ "Kasa sync" butonu `POST /api/admin/finance-integrations/cash-pool-sync` üzerinden `cash_pool_api_url`'den absolute kasa bakiyesi okur; local delta'yı `merchant_cash_pool_log`'a işler
- ✅ Admin/accounting erişimi; merchant detayına hızlı link (`?type=finance`)
- ❌ Bu sayfadan doğrudan merchant config UPDATE yapmaz; düzenleme Merchant Detail tab'larında kalır
- ❌ Merchant callback'i tetiklemez; cash_pool sync sadece açık butonla manuel çalışır
- **Etki kapsamı**: global finance entegrasyon okuma

### `/admin/method-types`
- **Amaç**: yöntem tipi katalogu yönetimi (havale/kripto/papara/kart + admin tarafından yenisi) — global on/off
- ✅ Default tipler seed'de (`apps/api/src/db/seed.ts`): `havale`, `kart`, `papara`, `kripto`
- ✅ Switch (on/off) `admin_set_method_type_enabled` RPC shim'ini çağırır + audit_log
- ✅ `bo_permissions: method_types:edit` hassas yetki (default: admin TRUE, accounting/support FALSE — `/admin/permissions`'tan override edilebilir)
- ✅ Pasif tipler üye-yüzünde "Yakında" rozetiyle görünür (gizlenmez), tıklanamaz
- ✅ "Yeni Tip" dialog → `admin_create_method_type` RPC shim. Default `is_enabled=false` (üye-yüzünde anında "Yakında" görünür). Code lowercase + alfanumerik+_ normalize edilir
- ❌ Tablodan UI'dan doğrudan UPDATE yasak (RPC + audit zorunlu)
- ❌ Yeni tip eklemek üye-yüzü routing/`merchant_methods` ile entegre değildir; sadece label katalog üretir. Aktif kullanım için `payment_routing_rules` insert + merchant config gerekir (manuel iş)
- **Etki kapsamı**: GLOBAL (tüm üye Topup/Withdraw + tüm merchant Methods editor)

### `/admin/loyalty`
- v3 modeli: 6 tier (Çırak/Gezgin/Usta/Şövalye/Lord/Efsane), HEM puan HEM turnover
- ❌ Topup'ta puan vermez (welcome bonus hariç)
- ❌ Cashback şimdilik kapalıdır; ileride açılırsa max `%1.5`

### `/admin/profit-share`
- **Amaç**: net platform kârından dönemsel üye kazanç payı dağıtımı
- ✅ Günlük/haftalık/aylık dönem için `platform_revenue - platform_cost - affiliate_cost` snapshot'ı alır
- ✅ Admin dağıtım yüzdesi + kişi sayısı girer; completed `spend` turnover yapan ilk N üyeye turnover payı oranında dağıtır
- ✅ Claim geçerlilik süresi saat bazında girilir; yayınlanınca her allocation'a `expires_at` yazılır
- ✅ Draft oluşturur, admin yayınlayınca üyeye görünür; bakiye hareketi üye `/profit-share` sayfasında süre dolmadan claim edince oluşur
- ✅ Pending/claimed/expired tutar ve kişi sayıları admin detayında muhasebesel takip edilir; süresi dolanlar cron ile `expired`
- ✅ Sayfanın altında mail taslağı gösterilir; `{{amount}}`, `{{expires_at}}`, `{{claim_url}}` gibi değişkenlerle gönderim katmanına hazırlanır
- ✅ Yeni tx tipi `profit_share`, public_no prefix `PS`
- ❌ Otomatik bakiye yüklemez; yayınlamak claim değildir
- ❌ Merchant adı / provider fee üye-yüzünde gösterilmez
- **Etki kapsamı**: GLOBAL finansal kampanya, admin-only (`profit_share:view/manage`)

### `/admin/referrals`
- ✅ Manuel onay butonu (yeşil ✓) pending davetler için
- ✅ Status TR: Bekliyor / Hak kazandı / Ödüllendi / Süresi doldu / İptal edildi

### `/affiliate/profile`
- ✅ Şifre değiştir + MFA setup link
- ❌ Affiliate bilgileri (ad/iban) bu sayfadan değiştirilemez — admin'den yapılır

### Üye-yüzü ortak
- Hard rule #7 — merchant adı HİÇBİR akışta üyeye gösterilmez
- Hard rule #9 — provider fee gizli
- TX label: `txTypeLabel(tx.type)` ile i18n key map
