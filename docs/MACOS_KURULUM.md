# Wallet — macOS Kurulum Kılavuzu

> Bu doküman, Wallet projesini bir Mac dizüstü bilgisayara `installers/macos/`
> klasöründeki betiklerle nasıl kuracağınızı, başlatacağınızı ve gerekirse mevcut
> bir veritabanı yedeğini yeni makineye nasıl taşıyacağınızı anlatır.
>
> Hedef kitle: Wallet ekibinde Mac kullanan geliştirici ya da test makinesi
> hazırlayan operatör.
>
> Stack: Node 20 · PostgreSQL 16 · Vite + React 18 · Express · Drizzle ORM ·
> Socket.IO · Tailwind + shadcn/ui.

---

## 1. Hızlı Başlangıç (TL;DR)

```bash
# Repoyu klonla (ya da kopyala) — örnek bir konum:
cd ~/Downloads
git clone <repo-url> wallet
cd wallet

# (İsteğe bağlı) Mevcut bir veritabanı yedeğini taşıyacaksanız buraya bırakın:
mkdir -p backups
cp /path/to/wallet-20260528T123000Z.sql.gz backups/

# Kurulumu çalıştırın
cd installers/macos
./install.sh
```

Çalışma sırasında ilk soru ortam seçimidir:

```
Which environment is this install for?
  1) development
  2) production
```

Geliştirme için `1` yeterlidir. Soruyu sormasını istemezseniz çevre değişkeni
ile baypas edebilirsiniz:

```bash
WALLET_ENV=development ./install.sh
# veya
WALLET_ENV=production ./install.sh
```

Kurulum bittiğinde:

```bash
./start.sh   # geliştirme profili — Vite + tsx watch ön planda çalışır
```

ve `http://localhost:8080` otomatik tarayıcıda açılır. Varsayılan giriş
bilgileri kurulum sonunda terminale yazılır.

---

## 2. Önkoşullar

| Bileşen | Notu |
|---------|------|
| macOS 12 (Monterey) veya üstü | Apple Silicon (M1/M2/M3/M4) ve Intel desteklenir. |
| Yönetici şifresi | Homebrew ilk kurulumunda bir kez sorulur. |
| Yaklaşık 2 GB boş disk | `node_modules` ~ 600 MB, PostgreSQL ~ 200 MB, geri kalan kaynak / log. |
| Internet erişimi | Homebrew, Node, npm paketleri için. Kurulumdan sonra projeyi internet olmadan da çalıştırabilirsiniz. |

Aşağıdaki araçların kurulu olması **gerekli değildir**; betik eksik olanları
kendisi kurar:

- Xcode Command Line Tools
- Homebrew
- Node.js 20+
- PostgreSQL 16

---

## 3. Geliştirme mi, Üretim mi? (Profil Seçimi)

Kurulumun ilk adımı bir profil seçer. Profilin etkisi:

| Konu | `development` | `production` |
|------|---------------|--------------|
| `apps/api/.env` içindeki `NODE_ENV` | `development` | `production` |
| Yönetici şifresi | `Admin1234` (kabul edilir) | rastgele üretilen güçlü şifre (sadece kurulum çıktısında gösterilir) |
| `npm run build` | yapılır | yapılır |
| Otomatik başlatma | yok — siz `./start.sh` ile çalıştırırsınız | `~/Library/LaunchAgents/com.wallet.api.plist` (oturum açıldığında otomatik kalkar) |
| Çerez `Secure` bayrağı | `false` | `true` (`http://localhost` tarayıcı tarafından "secure context" sayıldığı için yine çalışır) |
| `VITE_MFA_ENFORCEMENT` | `false` | `true` |
| Tipik kullanım | kod yazma / debug | yerelde "prodüksiyon davranışı"nı test etme |

**Not (HARD_RULES kural 14):** Sırlar (`JWT_*`, `MFA_ENCRYPTION_KEY`,
`STORAGE_SIGNING_SECRET`, `MERCHANT_HMAC_PEPPER`,
`MERCHANT_CASHOUT_CALLBACK_SECRET`) sadece `apps/api/.env` içine yazılır;
`apps/web/.env.local` yalnızca `VITE_*` öneki olan değerleri içerir — bu
değerler tarayıcı paketi içinde dağıtılır.

İki profil arasında geçiş güvenlidir: `production` profili ile bir kez kurulan
makineyi tekrar `development` profili ile kurarsanız betik eski launchd
plist'ini düşürür ve dosyayı kaldırır; tersi yönde de plist sıfırdan üretilir.

---

## 4. Adım Adım Kurulum (~11 adım)

`./install.sh` aşağıdaki sırayla çalışır. Tüm adımlar **idempotent**'tir
(aynı betiği birden çok kez çalıştırmak güvenlidir).

| Adım | Yaptığı iş |
|------|------------|
| 0/11 | **Profil seçimi.** Geliştirme veya üretim — yukarıdaki tabloya bakın. |
| 1/11 | **Xcode Command Line Tools.** Yoksa sistem yükleme penceresini açar. |
| 2/11 | **Homebrew.** Yoksa kurar; varsa sürümü gösterir. `~/.zprofile` dosyasına `brew shellenv` satırını ekler. |
| 3/11 | **Node.js 20+.** Eksikse `brew install node@20` ile kurar. |
| 4/11 | **PostgreSQL 16.** `postgresql@16` formülünü kurar, port `5433` olarak ayarlar (varsayılan 5432 ile çakışmasın), `brew services` ile arka plan servisi olarak başlatır. |
| 5/11 | **`npm install`** (ilk seferde ~600 MB indirir). |
| 6/11 | **`.env` dosyalarını yazar.** Kök `.env`, `apps/api/.env` ve `apps/web/.env.local` dosyaları üretilir; her yeni sır için `openssl rand -hex 32` çalıştırılır. |
| 7/11 | **Veritabanı + rol oluşturur.** `wallet` rolü ve `wallet` veritabanı (ikisi aynı isimde, varsayılan parola `wallet`). |
| 8/11 | **Şema** — bkz. § 5 (dump içe aktarma). |
| 9/11 | **Yönetici hesabı.** `npm run admin:bootstrap` çalıştırır. |
| 10/11 | **`npm run build`** (her zaman; üretim için zorunlu, geliştirme için bir güvence). Çıktı: `apps/api/dist` + `apps/web/dist`. |
| 11/11 | **Otomatik başlatma (sadece üretim profilinde).** `~/Library/LaunchAgents/com.wallet.api.plist` yazılır ve `launchctl load -w` ile yüklenir. Geliştirme profilinde varsa eski plist temizlenir. |

Kurulum sonunda terminale çıkacak özet bölümü bir log dosyasına da yazılır:
`installers/macos/logs/install-YYYYMMDD-HHMMSS.log` (mod 600).

---

## 5. Mevcut Bir Veritabanını İçe Aktarma

Bir başka Mac veya sunucu üzerindeki Wallet'ı yeni makineye taşımak
istiyorsanız, kaynak makinede `pg_dump` alıp dosyayı yeni makinedeki repo
içindeki `backups/` klasörüne bırakın.

### Doğru biçim

`deploy/backup.sh.example` betiğinin ürettiği biçim ya da elle:

```bash
pg_dump "$DATABASE_URL" \
  --no-owner --no-privileges --format=plain \
  | gzip > backups/wallet-$(date -u +%Y%m%dT%H%M%SZ).sql.gz
```

`--no-owner --no-privileges` zorunlu — yeni makinedeki rol farklı isim
olabilir.

### Yükleme davranışı

Kurulum 8/11 adımında kontrolü şöyle yapar:

| Durum | Ne yapar |
|-------|----------|
| Veritabanı boş + `backups/wallet-*.sql.gz` (veya `.sql`) var | Dump'ı `gunzip \| psql` ile geri yükler. Sonrasında `npm run db:migrate` ile şemayı HEAD'e taşır (dump eski bir göç noktasından alınmış olsa bile). |
| Veritabanı dolu | Dump göz ardı edilir, sadece bekleyen göç dosyaları (`db:migrate`) uygulanır. **Veri asla üzerine yazılmaz** — savunmacı davranış. |
| Dump yok | Olağan akış: `db:migrate` + `db:seed` (referans tablolar: loyalty tier'lar, ödeme tipleri, BO izinleri, ayar varsayılanları). |
| `backups/` içinde birden çok dump | En yeni `mtime` olan kazanır. |

### Açık yol gösterme

Belirli bir dosyayı kullanmak için:

```bash
IMPORT_DUMP=/Users/me/Downloads/wallet-prod-snapshot.sql.gz \
  ./install.sh
```

`IMPORT_DUMP` ile verilen dosya bulunamazsa betik bir uyarı basıp otomatik
algılamaya geri döner.

### Yönetici hesabı dump ile geldiyse

`bootstrap-admin` (adım 9/11) e-posta üzerinden idempotent çalışır: dump
zaten bir admin kullanıcısı içeriyorsa şifresi değiştirilmez, yalnızca
`admin` rol bağlaması garanti altına alınır. Bu sayede taşıma sırasında
mevcut kimlik bilgileri kaybolmaz.

---

## 6. Her Gün Kullanım

| Komut | Ne yapar |
|-------|----------|
| `./start.sh` | PostgreSQL'in açık olduğundan emin olur, eski dev süreçlerini temizler, `npm run dev` çalıştırır (API + Vite paralel), `http://localhost:8080` adresini tarayıcıda açar, canlı log akışını başlatır. |
| `./stop.sh` | Dev süreçlerini sonlandırır. PostgreSQL ayakta kalır (servisten dolayı). |
| `./stop.sh --all` | Yukarıdaki + PostgreSQL'i de durdurur. |
| `./status.sh` | Salt-okunur sağlık kontrolü: araç sürümleri, servis durumu, dinleyen portlar, HTTP yoklamaları. Veritabanındaki tablo sayısını gösterir. |
| `./uninstall.sh` | Yerel veritabanını + `node_modules` + üretilmiş `.env` dosyalarını + `storage/` klasörünü siler. Üretim profilindeki launchd plist'i de düşürür. **Homebrew, Node ve PostgreSQL kalır.** Onayı için "YES" yazmanız beklenir. |

Üretim profili için:

```bash
# launchd unit'ini yeniden yükle
launchctl unload ~/Library/LaunchAgents/com.wallet.api.plist
launchctl load -w ~/Library/LaunchAgents/com.wallet.api.plist

# Logları izle
tail -f apps/api/logs/launchd.out.log
tail -f apps/api/logs/launchd.err.log

# SPA'yı statik bir sunucu ile servis et (opsiyonel; üretim profili API'yi
# 3000 portunda tutar, frontend'i siz nasıl yayınlayacağınıza karar verirsiniz)
npx serve -s apps/web/dist -l 8080
```

---

## 7. Adresler ve Portlar

### Geliştirme profili

| Servis | URL / Port |
|--------|------------|
| Web (Vite dev) | `http://localhost:8080` |
| API (Express + Socket.IO) | `http://127.0.0.1:3000` |
| API sağlık ucu | `http://127.0.0.1:3000/health` |
| PostgreSQL | `localhost:5433` (kullanıcı `wallet`, şifre `wallet`, db `wallet`) |
| Vite, `/api` ve `/ws` çağrılarını otomatik olarak `http://127.0.0.1:3000` adresine proxy'ler |  |

### Üretim profili

| Servis | URL / Port |
|--------|------------|
| API (launchd ile) | `http://127.0.0.1:3000` |
| API sağlık ucu | `http://127.0.0.1:3000/health` |
| Web (statik dist) | siz seçersiniz; örn. `npx serve -s apps/web/dist -l 8080` |
| PostgreSQL | `localhost:5433` |

---

## 8. Veritabanına Bağlanma

PostgreSQL standart bir Postgres kurulumudur; herhangi bir istemci
çalışır. Önerilenler:

- [TablePlus](https://tableplus.com/) — ücretsiz katman, görsel, hızlı
- [Postico 2](https://eggerapps.at/postico2/) — ücretsiz, sade, macOS-native
- [pgAdmin 4](https://www.pgadmin.org/) — `brew install --cask pgadmin4`

Bağlantı bilgileri:

```
Host:     localhost
Port:     5433
User:     wallet
Password: wallet     (geliştirme profili)
Database: wallet
```

Komut satırından:

```bash
"$(brew --prefix postgresql@16)/bin/psql" \
  -h localhost -p 5433 -U wallet -d wallet
```

---

## 9. Yedek Almak

Düzenli yedek almak için kaynak repodaki `deploy/backup.sh.example` betiğini
örnek alın. Manuel tek seferlik yedek:

```bash
mkdir -p backups
"$(brew --prefix postgresql@16)/bin/pg_dump" \
  -h localhost -p 5433 -U wallet \
  --no-owner --no-privileges --format=plain wallet \
  | gzip > "backups/wallet-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
```

Bu dosyayı başka bir makineye götürdüğünüzde § 5'teki kurallar çalışır.

---

## 10. Sorun Giderme

### "Permission denied" — `./install.sh` çalışmıyor

```bash
chmod +x installers/macos/*.sh
# veya
bash installers/macos/install.sh
```

### "Port 8080 başka bir süreç tarafından kullanılıyor"

```bash
./stop.sh
sleep 3
./start.sh
```

Hâlâ kalmışsa:

```bash
lsof -nP -iTCP:8080 -sTCP:LISTEN
# çıkan PID'i sonlandırın
```

### "Port 5433 başka bir süreç tarafından kullanılıyor"

Muhtemelen daha önceden kurulu başka bir Postgres var (örn. Postgres.app
veya başka bir Homebrew formülü). Onu durdurun ya da `installers/macos/lib/common.sh`
içinden `POSTGRES_PORT` değerini değiştirin (ardından `apps/api/.env`
içindeki `DATABASE_URL` değerini de eşleyin).

### "Service started ama port 5433'te yanıt yok"

```bash
brew services restart postgresql@16
brew services info postgresql@16
```

### "Role 'wallet' does not exist"

Servis yanlış portta çalkalanmış olabilir.

```bash
./status.sh   # gösterilen portu kontrol edin
# Hâlâ 5432 ise:
"$(brew --prefix)/var/postgresql@16/postgresql.conf" dosyasını açın,
"port = 5433" satırını ekleyin/aktif edin
brew services restart postgresql@16
```

### `bootstrap-admin failed` (üretim profili)

`apps/api/src/db/bootstrap-admin.ts` üretim modunda zayıf şifreleri reddeder.
Betik bunu otomatik çözer (kuvvetli rastgele şifre üretir). Yine de hata
alıyorsanız:

```bash
# Kendi güçlü şifrenizi geçirin (>=12 karakter, 'admin' / 'password' / 'changeme'
# ile başlamayan):
ADMIN_PASS='Sg9!yKpt-XzRm' \
  WALLET_ENV=production \
  ./install.sh
```

### Loglar nerede?

| Dosya | İçerik |
|-------|--------|
| `installers/macos/logs/install-*.log` | Kurulum betiğinin çıktısı (mod 600). |
| `installers/macos/logs/dev.log` | `./start.sh` ile başlatılmış geliştirme süreçlerinin çıktısı. |
| `apps/api/logs/launchd.out.log` | Üretim profilinde launchd'nin standart çıktısı. |
| `apps/api/logs/launchd.err.log` | Üretim profilinde launchd hata çıktısı. |
| `brew services info postgresql@16` | PostgreSQL'in kendi log dosyasının yolunu yazar. |

---

## 11. Kurulan Bileşenlerin Yerleşimi

| Bileşen | Yer |
|---------|-----|
| Homebrew | Apple Silicon: `/opt/homebrew` · Intel: `/usr/local` |
| Node.js 20 | aynı önek |
| PostgreSQL 16 | aynı önek; veri klasörü `$(brew --prefix)/var/postgresql@16` |
| launchd plist (üretim) | `~/Library/LaunchAgents/com.wallet.api.plist` |
| Repo | klonladığınız konum (örn. `~/Downloads/wallet`) |
| Üretilmiş çıktılar | `apps/api/dist` ve `apps/web/dist` |
| Yüklemeler / sohbet ekleri | `storage/` (yerel disk; HARD_RULES kural 22) |

---

## 12. Kaldırma

```bash
cd installers/macos
./uninstall.sh
# "YES" yazıp Enter basın
```

Bu komut yerel veritabanını, üretilmiş `.env` dosyalarını, `storage/`
klasörünü ve (varsa) launchd plist'ini siler. Homebrew, Node ve PostgreSQL
formüllerini elle kaldırmak isterseniz:

```bash
brew services stop postgresql@16
brew uninstall postgresql@16
brew uninstall node@20
# Homebrew'in kendisini kaldırma talimatları için:
#   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/uninstall.sh)"
```

---

## 13. Hızlı Referans Kartı

```bash
# İlk kurulum (geliştirme):
WALLET_ENV=development ./installers/macos/install.sh

# İlk kurulum (üretim — yerelde prod davranışını test):
WALLET_ENV=production  ./installers/macos/install.sh

# Mevcut yedeği taşıma:
cp /path/to/dump.sql.gz backups/
./installers/macos/install.sh

# Belirli bir dump dosyasını kullan:
IMPORT_DUMP=/path/to/dump.sql.gz ./installers/macos/install.sh

# Günlük başlat / durdur:
./installers/macos/start.sh
./installers/macos/stop.sh
./installers/macos/status.sh

# Tipi kontrol:
npm run typecheck
node scripts/smoke-all.mjs   # 172 uç noktalı entegrasyon testi (dev sunucu açıkken)

# Kaldır:
./installers/macos/uninstall.sh
```

---

## 14. İlgili Dokümanlar

- **`installers/macos/README.txt`** — orijinal İngilizce installer kılavuzu
  (her güncelleme önce burada uygulanır, sonra bu Türkçe doküman senkronlanır).
- **`docs/UYGULANAN_DEGISIKLIKLER.md`** — son denetim turunda uygulanan
  değişiklik listesi.
- **`docs/HARD_RULES.md`** — sistemin değişmez kuralları (1–23).
- **`docs/ARCHITECTURE_FLOWS.md`** — A/B/C/D para akışları.
- **`docs/DEPLOY_WORKFLOW.md`** — production deploy + migration akışı.
- **`installers/linux/README.txt`** — Rocky Linux 9 / Alma 9 / RHEL 9
  sunucularda aynı kurulumun karşılığı.
