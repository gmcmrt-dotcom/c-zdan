import MerchantLayout from "@/components/MerchantLayout";
import { useEffect, useState } from "react";
import { rpc } from "@/lib/rpc";
import { invokeFunction } from "@/lib/fn";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { fmtTRY, fmtDate } from "@/lib/format";
import { AlertCircle, Key, Copy, AlertTriangle, RefreshCw, Network, Webhook, BookOpen } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { translateError } from "@/lib/i18n-errors";

type Self = {
  id: string;
  name: string;
  merchant_type: string;
  merchant_scope: string | null;
  is_active: boolean;
  balance: number;
  credit_limit: number;
  available: number;
  outstanding: number;
  cash_pool: number | null;
  cash_pool_updated_at: string | null;
  commission_pct: number | null;
  fixed_fee: number | null;
  daily_limit: number | null;
  per_tx_limit: number | null;
  api_key: string;
  ip_whitelist: string[];
  webhook_url: string | null;
  webhook_url_set_at: string | null;
  signing_secret_set_at: string | null;
};

export default function MerchantSettings() {
  const [self, setSelf] = useState<Self | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // IP whitelist edit
  const [ipText, setIpText] = useState("");
  const [savingIp, setSavingIp] = useState(false);

  // Webhook
  const [webhookUrl, setWebhookUrl] = useState("");
  const [savingWebhook, setSavingWebhook] = useState(false);

  // Rotate
  const [rotating, setRotating] = useState(false);
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const usesParentSecurity = self?.merchant_type === "commerce" && self?.merchant_scope === "child";

  const load = async () => {
    setLoading(true);
    const [selfData, roleData] = await Promise.all([
      rpc<Self | Self[]>("merchant_self").catch(() => null),
      rpc<{ role: string } | Array<{ role: string }>>("merchant_self_role").catch(() => null),
    ]);
    const row = Array.isArray(selfData) ? selfData[0] ?? null : selfData;
    const roleRow = Array.isArray(roleData) ? roleData[0] ?? null : roleData;
    setSelf(row);
    setRole(roleRow?.role ?? null);
    if (row) {
      setIpText((row.ip_whitelist ?? []).join("\n"));
      setWebhookUrl(row.webhook_url ?? "");
    }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const saveIpWhitelist = async () => {
    setSavingIp(true);
    try {
      const ips = ipText
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      const data = await rpc<any>("merchant_self_update_settings", {
        _ip_whitelist: ips,
        _webhook_url: null, // sadece IP güncelle
      });
      const row = Array.isArray(data) ? data[0] : data;
      if (!row?.success) {
        return toast.error(translateError({ error_code: row?.error_code }, "IP listesi güncellenemedi"));
      }
      toast.success("IP whitelist güncellendi");
      load();
    } catch (err: any) {
      toast.error(translateError(err, "Güncellenemedi"));
    } finally {
      setSavingIp(false);
    }
  };

  const saveWebhook = async () => {
    setSavingWebhook(true);
    try {
      const data = await rpc<any>("merchant_self_update_settings", {
        _ip_whitelist: null,
        _webhook_url: webhookUrl,
      });
      const row = Array.isArray(data) ? data[0] : data;
      if (!row?.success) {
        return toast.error(translateError({ error_code: row?.error_code }, "Webhook URL kaydedilemedi"));
      }
      toast.success("Webhook URL güncellendi");
      load();
    } catch (err: any) {
      toast.error(translateError(err, "Kaydedilemedi"));
    } finally {
      setSavingWebhook(false);
    }
  };

  const rotateSecret = async () => {
    setRotating(true);
    try {
      // pepper artık server-side env'de (MERCHANT_HMAC_PEPPER).
      // RPC'yi direkt çağırmıyoruz — edge function pepper'ı geçirir,
      // RPC içinde owner check + signing_secret + api_secret_hash yazar.
      const data = await invokeFunction<{ success?: boolean; error_code?: string; signing_secret?: string }>(
        "merchant-self-rotate-secret",
        {},
      );
      if (!data?.success) {
        return toast.error(translateError({ error_code: data?.error_code }, "Rotate başarısız"));
      }
      setNewSecret(data.signing_secret ?? null);
      setConfirmRotate(false);
      toast.success("Yeni signing secret üretildi");
      load();
    } catch (err: any) {
      toast.error(translateError(err, "Rotate başarısız"));
    } finally {
      setRotating(false);
    }
  };

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() => toast.success(`${label} kopyalandı`));
  };

  if (loading) return <MerchantLayout title="Ayarlar"><div className="text-muted-foreground">Yükleniyor…</div></MerchantLayout>;
  if (!self) return (
    <MerchantLayout title="Ayarlar">
      <Card className="p-8 text-center">
        <AlertCircle className="size-10 mx-auto text-warning mb-2" />
        <p>Merchant erişiminiz tanımlı değil.</p>
      </Card>
    </MerchantLayout>
  );

  // Ayarlar sayfası owner-only (API key, signing secret, IP whitelist, webhook)
  if (role !== "owner") return (
    <MerchantLayout title="Ayarlar">
      <Card className="p-8 text-center">
        <AlertCircle className="size-10 mx-auto text-warning mb-2" />
        <p className="text-sm font-medium">Bu sayfa sadece iş yeri sahibine (owner) açıktır.</p>
        <p className="text-xs text-muted-foreground mt-2">
          API anahtarı, secret rotate, IP whitelist ve webhook ayarları için sahip kullanıcı ile iletişime geçin.
          Şifre değiştirmek veya MFA kurmak istiyorsanız <strong>Profil</strong> menüsünü kullanın.
        </p>
      </Card>
    </MerchantLayout>
  );

  return (
    <MerchantLayout title="Ayarlar">
      <div className="space-y-4 max-w-3xl">

        {/* Hesap özeti */}
        <Card className="p-4 space-y-3">
          <div className="text-sm font-medium flex items-center justify-between">
            <span>Hesap</span>
            {role && <Badge variant={role === "owner" ? "default" : "secondary"}>Rolünüz: {role}</Badge>}
          </div>
          <Row label="Merchant adı" value={self.name} />
          <Row label="Tip" value={self.merchant_type === "commerce" ? "Commerce" : "Finance"} />
          <Row label="Durum" value={self.is_active ? <Badge>Aktif</Badge> : <Badge variant="destructive">Pasif</Badge>} />
          <Row label="Komisyon" value={`%${Number(self.commission_pct ?? 0).toFixed(2)} + ${fmtTRY(Number(self.fixed_fee ?? 0))} / işlem`} />
          <Row label="Tek işlem limiti" value={self.per_tx_limit ? fmtTRY(self.per_tx_limit) : "—"} />
          <Row label="Günlük limit" value={self.daily_limit ? fmtTRY(self.daily_limit) : "—"} />
        </Card>

        {self.merchant_type === "commerce" ? (
          <Card className="p-4 space-y-3">
            <div className="text-sm font-medium">Settlement durumu</div>
            <Row label="Defter bakiyesi" value={
              <span className={self.balance >= 0 ? "text-success font-semibold" : "text-destructive font-semibold"}>
                {self.balance >= 0 ? "+" : "−"}{fmtTRY(Math.abs(self.balance))}
              </span>
            } />
            <Row label="Borç tavanı" value={fmtTRY(self.credit_limit)} />
            <Row label="Açık borç" value={fmtTRY(self.outstanding)} />
          </Card>
        ) : (
          <Card className="p-4 space-y-3">
            <div className="text-sm font-medium">Kasa durumu</div>
            <Row label="Kendi kasamdaki nakit" value={
              <span className={Number(self.cash_pool ?? 0) >= 0 ? "text-success font-semibold" : "text-destructive font-semibold"}>
                {fmtTRY(Number(self.cash_pool ?? 0))}
              </span>
            } />
            <Row label="Son kasa güncellemesi" value={self.cash_pool_updated_at ? fmtDate(self.cash_pool_updated_at) : "Bilinmiyor"} />
          </Card>
        )}

        {self.merchant_type === "commerce" && (
          <Card className="p-4 space-y-3 border-primary/20 bg-primary/5">
            <div className="text-sm font-medium flex items-center gap-2">
              <BookOpen className="size-4" />API Dokümantasyonu
            </div>
            <p className="text-xs text-muted-foreground">
              Ödeme kodu tüketme (Akış A) ve cüzdana aktarım (Akış B) için entegrasyon kılavuzu, İngilizce sürüm ve Postman koleksiyonu.
            </p>
            <Button variant="default" size="sm" asChild>
              <Link to="/merchant/api-docs">Dokümantasyona git</Link>
            </Button>
          </Card>
        )}

        {/* API Key */}
        <Card className="p-4 space-y-3">
          <div className="text-sm font-medium flex items-center gap-2">
            <Key className="size-4" />API Key
          </div>
          <div className="flex items-center gap-2">
            <Input value={self.api_key} readOnly className="font-mono text-xs" />
            <Button size="sm" variant="outline" onClick={() => copy(self.api_key, "API Key")}>
              <Copy className="size-4" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Header: <code>x-merchant-key: {self.api_key.slice(0, 12)}…</code>
          </p>
          <p className="text-xs text-muted-foreground">
            API key bayi bazındadır. Secret ve IP whitelist ana ticari merchant bazında admin tarafından yönetilir.
          </p>
        </Card>

        {/* Signing Secret Rotate */}
        {!usesParentSecurity && <Card className="p-4 space-y-3">
          <div className="text-sm font-medium flex items-center gap-2">
            <RefreshCw className="size-4" />Signing Secret (HMAC)
          </div>

          {self.signing_secret_set_at ? (
            <p className="text-xs text-muted-foreground">
              Son rotate: {fmtDate(self.signing_secret_set_at)}
            </p>
          ) : (
            <p className="text-xs text-warning">
              ⚠️ Henüz signing secret üretilmemiş — bir kez rotate edip değeri kaydedin.
            </p>
          )}

          <div className="bg-warning/10 border border-warning/30 rounded-lg p-3 text-xs flex gap-2">
            <AlertTriangle className="size-4 text-warning shrink-0 mt-0.5" />
            <div>
              <strong>Dikkat:</strong> Yeni secret üretildiğinde eski derhal geçersiz olur. Tüm production sistemlerinizi güncellediğinizden emin olun.
            </div>
          </div>

          {role !== "owner" ? (
            <div className="rounded-lg bg-muted/40 border border-border p-3 text-xs text-muted-foreground">
              <strong>Owner yetkisi gerekli.</strong> Signing secret rotate işlemi sadece Owner rolündeki
              merchant kullanıcısı tarafından yapılabilir. Lütfen yöneticinizle iletişime geçin.
            </div>
          ) : !confirmRotate ? (
            <Button variant="outline" onClick={() => setConfirmRotate(true)}>
              <RefreshCw className="size-4 mr-1" />Yeni secret üret
            </Button>
          ) : (
            <div className="flex items-center gap-2">
              <Button variant="destructive" onClick={rotateSecret} disabled={rotating}>
                {rotating ? "Üretiliyor…" : "Onaylıyorum, üret"}
              </Button>
              <Button variant="ghost" onClick={() => setConfirmRotate(false)} disabled={rotating}>Vazgeç</Button>
            </div>
          )}

          {newSecret && (
            <div className="border border-success bg-success/10 rounded-lg p-3 space-y-2">
              <div className="text-xs font-medium">Yeni signing secret (BİR DAHA gösterilmez):</div>
              <div className="flex items-center gap-2">
                <Input value={newSecret} readOnly type="password" className="font-mono text-xs" />
                <Button size="sm" variant="outline" onClick={() => copy(newSecret, "Signing Secret")}>
                  <Copy className="size-4" />
                </Button>
              </div>
              <Button size="sm" onClick={() => setNewSecret(null)}>Kaydettim, kapat</Button>
            </div>
          )}
        </Card>}

        {/* IP Whitelist */}
        {!usesParentSecurity && <Card className="p-4 space-y-3">
          <div className="text-sm font-medium flex items-center gap-2">
            <Network className="size-4" />IP Whitelist
          </div>
          <Label className="text-xs text-muted-foreground">
            Her satıra bir IP veya CIDR (örn: <code>1.2.3.4</code> veya <code>10.0.0.0/24</code>). Liste boşsa tüm IP'ler izinli.
          </Label>
          <Textarea
            value={ipText}
            onChange={(e) => setIpText(e.target.value)}
            rows={5}
            placeholder="192.168.1.1&#10;10.0.0.0/24"
            className="font-mono text-xs"
          />
          <Button onClick={saveIpWhitelist} disabled={savingIp || role !== "owner"}>
            {savingIp ? "Kaydediliyor…" : "IP listesini kaydet"}
          </Button>
          {role !== "owner" && (
            <p className="text-xs text-muted-foreground italic">Owner yetkisi gerekli.</p>
          )}
          <p className="text-xs text-muted-foreground">
            Mevcut: {self.ip_whitelist?.length ? self.ip_whitelist.join(", ") : "Boş (kısıt yok)"}
          </p>
        </Card>}

        {usesParentSecurity && (
          <Card className="p-4 space-y-2">
            <div className="text-sm font-medium flex items-center gap-2">
              <Network className="size-4" />Güvenlik ayarları
            </div>
            <p className="text-xs text-muted-foreground">
              Bu bayi için API key ayrı tutulur. HMAC secret ve IP whitelist ana ticari merchant seviyesinde ortaktır ve sadece admin tarafından yönetilir.
            </p>
          </Card>
        )}

        {/* Webhook URL */}
        <Card className="p-4 space-y-3">
          <div className="text-sm font-medium flex items-center gap-2">
            <Webhook className="size-4" />Webhook URL
          </div>
          <Label className="text-xs text-muted-foreground">
            Bizim taraftan size push event yolladığımız HTTPS endpoint (Akış C/D için).
            HTTPS zorunlu.
          </Label>
          <Input
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
            placeholder="https://api.firmaniz.com/wallet-webhook"
            type="url"
            className="font-mono text-xs"
          />
          <Button onClick={saveWebhook} disabled={savingWebhook || role !== "owner"}>
            {savingWebhook ? "Kaydediliyor…" : "Webhook'u kaydet"}
          </Button>
          {role !== "owner" && (
            <p className="text-xs text-muted-foreground italic">Owner yetkisi gerekli.</p>
          )}
          {self.webhook_url_set_at && (
            <p className="text-xs text-muted-foreground">
              Son güncelleme: {fmtDate(self.webhook_url_set_at)}
            </p>
          )}
        </Card>
      </div>
    </MerchantLayout>
  );
}

function Row({ label, value }: { label: string; value: any }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm text-right max-w-[60%] break-all">{value}</span>
    </div>
  );
}
