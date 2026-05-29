# Deploy "+" — tek komutla production

> **Hızlı başlangıç:** `deploy.config.json` oluştur → sohbette `+` yaz → onayla → bitti.
> **Manuel:** `npm run deploy`
> **Detaylı iş akışı:** `docs/DEPLOY_WORKFLOW.md`

**Son güncelleme:** 2026-05-29

---

## Ne yapar?

`+` komutu (veya `npm run deploy`) yerel geliştirmeyi **önce GitHub'a**, ardından production sunucusuna gönderir:

1. **Ön kontrol (yerel)** — `typecheck` zorunlu; `lint` varsayılan açık; `test:seed:verify` isteğe bağlı
2. **GitHub senkronizasyonu** — değişiklik varsa otomatik commit; remote'un gerisindeyse push (`origin`/aktif dal)
3. **Gönderim** — `git` modu: sunucuda pull; `rsync` modu: çalışma ağacını doğrudan senkronize eder
4. **Sunucu** — `npm install` → `db:migrate` → `build` → `systemctl restart wallet-api` → `nginx reload` → `/health` doğrulama

**Güvenlik:** `typecheck` başarısızsa deploy **asla** çalışmaz. `deploy.config.json` ve `.env` dosyaları commit edilmez (`.gitignore` + script denylist). `deploy.config.json` yoksa script Türkçe kurulum talimatı verip durur.

---

## Tek seferlik kurulum

### 1. Sunucu (Rocky Linux 9)

Sunucuda repo henüz yoksa:

```bash
sudo dnf install -y git
sudo git clone https://github.com/SIZIN-ORG/wallet.git /opt/wallet
cd /opt/wallet
sudo ./installers/linux/install.sh   # WALLET_ENV=production seçin
```

Kurulum sonrası sunucuda şunlar hazır olmalı:

| Bileşen | Konum / komut |
|---------|----------------|
| Repo | `/opt/wallet` (veya sizin yolunuz) |
| API env | `/opt/wallet/apps/api/.env` — `DATABASE_URL`, `JWT_*`, secret'lar |
| systemd | `wallet-api.service` — `sudo systemctl status wallet-api` |
| nginx | `:80` üzerinden SPA + `/api` proxy |
| PostgreSQL | `127.0.0.1:5433` |

Detay: `installers/linux/README.txt`, `docs/DEPLOY_WORKFLOW.md` § 3–4.

### 2. SSH anahtarı (yerel makine → sunucu)

Yerel makinede:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519 -C "wallet-deploy"
ssh-copy-id -i ~/.ssh/id_ed25519 wallet@SUNUCU_IP
ssh -i ~/.ssh/id_ed25519 wallet@SUNUCU_IP "echo SSH OK"
```

`wallet` kullanıcısının `sudo` yetkisi olmalı (`systemctl restart wallet-api`, `nginx reload` için). Rocky installer production modunda bunu ayarlar.

### 3. Yerel yapılandırma

Proje kökünde:

```bash
cp deploy.config.example.json deploy.config.json
```

`deploy.config.json` örneği (gitignored — asla commit etmeyin):

```json
{
  "host": "203.0.113.10",
  "user": "wallet",
  "port": 22,
  "path": "/opt/wallet",
  "sshKey": "~/.ssh/id_ed25519",
  "deployMethod": "git",
  "gitRemote": "origin",
  "gitBranch": "main",
  "remoteRunUser": "wallet",
  "webStaticPath": null,
  "preflight": {
    "typecheck": true,
    "lint": true,
    "seedVerify": false
  }
}
```

| Alan | Açıklama |
|------|----------|
| `host` | Sunucu IP veya hostname |
| `user` | SSH bağlantı kullanıcısı |
| `path` | Sunucudaki repo kökü (`/opt/wallet`) |
| `sshKey` | Yerel özel anahtar yolu |
| `deployMethod` | `"git"` (varsayılan) veya `"rsync"` |
| `gitRemote` / `gitBranch` | GitHub push/pull hedefi (varsayılan `origin` / `main`; push aktif daldan yapılır) |
| `remoteRunUser` | Sunucuda `npm`/`git` çalıştıran kullanıcı |
| `webStaticPath` | Opsiyonel — `DEPLOY_WORKFLOW` §4'teki `/var/www/wallet/` yolu; Rocky installer nginx'i repo içinden servis ediyorsa `null` bırakın |
| `preflight.seedVerify` | `true` yaparsanız deploy öncesi `npm run test:seed:verify` koşar (yalnızca temiz local DB'de anlamlı) |

### 4. Git remote (git modu)

`deployMethod: "git"` için sunucudaki repo, sizin push ettiğiniz remote'u okuyabilmeli:

```bash
# Yerel
git remote -v          # origin → GitHub/GitLab vb.
git push -u origin main

# Sunucu (bir kez)
sudo -u wallet git -C /opt/wallet remote -v
```

---

## Günlük kullanım

### Terminal

```bash
npm run deploy              # interaktif onay sorar
npm run deploy -- --yes     # onayı atla
npm run deploy -- --message "feat: yeni ödeme akışı"   # özel commit mesajı
npm run deploy -- --no-push # yalnızca sunucu deploy, GitHub atlanır
npm run deploy -- --dry-run # commit/push önizlemesi, deploy yok
DEPLOY_CONFIRM=1 npm run deploy
```

### Cursor sohbet — `+` komutu

Sohbette tam olarak şunlardan biri yazıldığında agent deploy akışını başlatır:

- `+`
- `deploy`
- `sunucuya gönder`

Agent davranışı (`.cursor/rules/deploy-plus.mdc`):

1. `deploy.config.json` var mı kontrol et — yoksa kurulum adımlarını göster
2. Kullanıcıya kısa özet sun (git durumu, hedef sunucu, GitHub remote)
3. **Onay iste** — kullanıcı onaylamadan `npm run deploy` çalıştırma
4. Onay sonrası `npm run deploy -- --yes` (script önce GitHub commit+push, sonra sunucu deploy yapar)
5. Çıktıyı özetle (GitHub + sunucu); hata varsa kök nedeni raporla

---

## Adım adım (script içi)

```
┌─────────────────────────────────────────────────────────────┐
│  YEREL                                                      │
├─────────────────────────────────────────────────────────────┤
│  1. deploy.config.json yükle (yoksa → Türkçe hata + çık)   │
│  2. npm run typecheck          ← ZORUNLU, başarısız = DUR   │
│  3. npm run lint               ← varsayılan açık            │
│  4. npm run test:seed:verify    ← config ile opsiyonel      │
│  5. git status özeti + dal uyarıları                        │
│  6. Kullanıcı onayı (--yes veya DEPLOY_CONFIRM=1 ile atla) │
│  7. GitHub (--no-push ile atlanabilir):                     │
│     a. Değişiklik varsa → git add . + commit (timestamp     │
│        veya --message)                                      │
│     b. Remote gerideyse → git push origin/<aktif dal>       │
│     c. Güncelse → push atlanır                              │
│  8. rsync → sunucu              (deployMethod=rsync)        │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼ SSH
┌─────────────────────────────────────────────────────────────┐
│  SUNUCU (/opt/wallet)                                       │
├─────────────────────────────────────────────────────────────┤
│  9.  git pull --ff-only          (git modunda)              │
│  10. npm install --no-audit --no-fund                       │
│  11. npm run db:migrate                                     │
│  12. npm run build                                          │
│  13. sudo systemctl restart wallet-api                      │
│  14. rsync web/dist → webStaticPath  (yapılandırıldıysa)   │
│  15. sudo nginx -t && sudo systemctl reload nginx           │
│  16. curl http://127.0.0.1:3000/health                      │
└─────────────────────────────────────────────────────────────┘
```

---

## deployMethod: git vs rsync

| | **git** (önerilen) | **rsync** |
|---|-------------------|-----------|
| Ne zaman | Commit'lenmiş, push edilmiş kod | Hızlı test; `--no-push` ile GitHub atlanabilir |
| Yerel | Otomatik commit + `git push` (varsayılan) | Aynı GitHub adımı + `rsync` ile dosya kopyası |
| Sunucu | `git pull --ff-only` | Pull yok — dosyalar zaten güncel |
| Risk | Düşük — izlenebilir commit | Orta — `--no-push` ile commit dışı dosya gidebilir |

**Öneri:** Production için her zaman `git` modu; `rsync` yalnızca staging veya acil hotfix için.

---

## Geri alma (rollback)

Otomatik down-migration yok (`docs/DEPLOY_WORKFLOW.md` § 8).

1. **Uygulama:** Sunucuda önceki commit'e dönün:
   ```bash
   cd /opt/wallet
   sudo -u wallet git checkout <önceki-commit>
   sudo -u wallet npm run build
   sudo systemctl restart wallet-api
   ```
2. **Veritabanı:** Başarısız migration varsa ters SQL yazın veya `backups/` dump'ından restore edin.
3. **Doğrulama:** `curl -fsS http://127.0.0.1:3000/health` ve isteğe bağlı `node scripts/smoke-all.mjs` (yalnızca staging).

---

## Sorun giderme

| Belirti | Kontrol |
|---------|---------|
| `deploy.config.json bulunamadı` | `cp deploy.config.example.json deploy.config.json` |
| `SSH anahtarı bulunamadı` | `sshKey` yolunu düzeltin veya `ssh-keygen` |
| `Permission denied (publickey)` | `ssh-copy-id` tekrarlayın |
| `typecheck` fail | Deploy durur — önce TS hatalarını düzeltin |
| `GitHub push başarısız` | `git remote -v`, `ssh -T git@github.com` veya `gh auth login` |
| `git pull --ff-only` fail | Sunucuda manuel merge gerekebilir; önce `git status` |
| API 502 | `sudo journalctl -u wallet-api -n 100` |
| Migration hata | `apps/api/.env` içindeki `DATABASE_URL` doğru mu? |

---

## İlgili dosyalar

| Dosya | Amaç |
|-------|------|
| `scripts/deploy-plus.mjs` | Deploy script |
| `deploy.config.example.json` | Yapılandırma şablonu |
| `deploy.config.json` | Gerçek config (gitignored) |
| `.cursor/rules/deploy-plus.mdc` | Agent `+` davranışı |
| `docs/DEPLOY_WORKFLOW.md` | Genel deploy + migration rehberi |
| `installers/linux/install.sh` | İlk sunucu kurulumu |
| `deploy/wallet-api.service.example` | systemd unit şablonu |
| `deploy/nginx-wallet.conf.example` | nginx şablonu |
