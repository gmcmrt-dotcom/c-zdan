import { useEffect, useMemo, useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import { dbSelect, dbUpdate } from "@/lib/db";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Save, ShieldAlert, Coins } from "lucide-react";
import { toast } from "sonner";
import { translateError } from "@/lib/i18n-errors";
import { Can } from "@/components/Can";

type Setting = { key: string; value: any; description: string | null };
type CashoutMethod = {
  code: string;
  label: string;
  asset: string;
  network: string;
  is_active: boolean;
  min_amount: number;
  max_amount: number | null;
  sort_order: number;
};

// Hangi key hangi kategoriye + nasıl render edilecek
type SettingDef = {
  key: string;
  label: string;
  description: string;
  category: "otp" | "commission" | "loyalty" | "system";
  kind: "number" | "text" | "toggle" | "json";
  unit?: string;
};

const KNOWN_SETTINGS: SettingDef[] = [
  // OTP
  { key: "otp_length",          label: "OTP uzunluğu",          description: "Kullanıcıya gönderilen doğrulama kodu kaç haneli olacak", category: "otp", kind: "number", unit: "hane" },
  { key: "otp_ttl_minutes",     label: "OTP süresi",            description: "Doğrulama kodunun geçerli olduğu süre",                category: "otp", kind: "number", unit: "dk" },
  { key: "otp_max_attempts",    label: "OTP deneme limiti",     description: "Kullanıcının OTP girmek için kaç deneme hakkı var",     category: "otp", kind: "number", unit: "deneme" },
  { key: "otp_resend_seconds",  label: "OTP yeniden gönderim",  description: "Yeni kod isteyebilmek için bekleme süresi",             category: "otp", kind: "number", unit: "sn" },

  // Komisyonlar tamamen kaldırıldı — her merchant ekleme anında explicit komisyon belirtir.
  // default_finance_commission_pct, default_commerce_commission_pct settings'ten silindi (migration 20260506400000).
  // default_topup_fee_pct, default_spend_fee_pct ileride farklı bir mekanizmaya taşınacak veya kullanılmayacak.

  // Loyalty
  { key: "first_topup_bonus",         label: "İlk yatırma bonusu",         description: "Üye ilk topup'ını yaptığında kazanacağı puan", category: "loyalty", kind: "number", unit: "puan" },
  { key: "first_topup_bonus_v2",      label: "İlk yatırma bonusu (v2)",    description: "Yeni mantık: ilk topup bonus puanı",          category: "loyalty", kind: "number", unit: "puan" },
  { key: "monthly_active_threshold",  label: "Aylık aktif eşiği",          description: "Bir kullanıcının aylık aktif sayılması için min işlem sayısı", category: "loyalty", kind: "number", unit: "işlem" },
  { key: "monthly_active_bonus",      label: "Aylık aktif bonusu",         description: "Aylık aktif kullanıcıya verilen bonus puan",  category: "loyalty", kind: "number", unit: "puan" },
  { key: "monthly_active_bonus_v2",   label: "Aylık aktif bonusu (v2)",    description: "Yeni mantık: aktif kullanıcıya bonus",        category: "loyalty", kind: "number", unit: "puan" },
  { key: "birthday_bonus_points",     label: "Doğum günü bonusu",          description: "Doğum gününde otomatik verilen puan",          category: "loyalty", kind: "number", unit: "puan" },
  { key: "profile_complete_bonus",    label: "Profil tamamlama bonusu",    description: "Telefon eklendiğinde verilen bonus puan",     category: "loyalty", kind: "number", unit: "puan" },
  { key: "points_per_topup_unit",     label: "Yatırmada puan birimi",      description: "Her X TL yatırmada 1 puan (X = bu değer)",    category: "loyalty", kind: "number", unit: "TL" },
  { key: "points_per_topup_unit_v2",  label: "Yatırmada puan (v2)",        description: "v2 hesaplamada birim",                         category: "loyalty", kind: "number", unit: "TL" },
  { key: "points_per_spend_unit",     label: "Harcamada puan birimi",      description: "Her X TL harcamada base puan",                 category: "loyalty", kind: "number", unit: "TL" },
  { key: "points_per_spend_unit_v2",  label: "Harcamada puan (v2)",        description: "v2 turnover-bonuslu hesaplama birimi",         category: "loyalty", kind: "number", unit: "TL" },
  { key: "withdraw_penalty_per_unit", label: "Çekim cezası birimi",        description: "Her X TL çekimde puan kaybı (cezalı)",         category: "loyalty", kind: "number", unit: "TL" },
  { key: "turnover_bonus_log_base",   label: "Turnover bonus log tabanı",  description: "Aynı paranın i. dönüşünde log_base(i+1) bonus", category: "loyalty", kind: "number" },

  // System
  { key: "payment_code_lengths",      label: "Ödeme kodu süreleri",        description: "Üyeye sunulacak kod süreleri (dk olarak JSON array)", category: "system", kind: "json" },
];

const CATEGORY_INFO: Record<string, { label: string; desc: string }> = {
  otp:        { label: "OTP & Güvenlik",  desc: "Doğrulama kodu süresi, deneme limiti vb." },
  commission: { label: "Komisyonlar",     desc: "Yeni merchant oluştururken kullanılan default oranlar" },
  loyalty:    { label: "Sadakat puanı",   desc: "Puan formülleri, bonuslar, eşikler" },
  system:     { label: "Sistem",          desc: "Genel sistem ayarları" },
  unknown:    { label: "Diğer",           desc: "Bilinen kategorilere düşmeyen ayarlar" },
};

export default function AdminSettings() {
  const [items, setItems] = useState<Setting[]>([]);
  const [cashoutMethods, setCashoutMethods] = useState<CashoutMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [savingMethod, setSavingMethod] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Record<string, any>>({});

  const load = async () => {
    setLoading(true);
    const [data, methods] = await Promise.all([
      dbSelect<Setting>("settings", { order: { col: "key", asc: true } }).catch(() => [] as Setting[]),
      dbSelect<CashoutMethod>("merchant_cashout_methods", { order: { col: "sort_order", asc: true } }).catch(() => [] as CashoutMethod[]),
    ]);
    setItems(data);
    setCashoutMethods(methods);
    const ev: Record<string, any> = {};
    data.forEach((s) => { ev[s.key] = s.value; });
    setEditValues(ev);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const updateCashoutMethod = async (code: string, patch: Partial<CashoutMethod>) => {
    setSavingMethod(code);
    try {
      await dbUpdate("merchant_cashout_methods", patch, { code });
      toast.success("Tahsilat yöntemi güncellendi");
    } catch (err) {
      toast.error(translateError(err));
    } finally {
      setSavingMethod(null);
      load();
    }
  };

  const save = async (key: string) => {
    setSavingKey(key);
    let val = editValues[key];
    // JSON parse if string starts with [ or {
    if (typeof val === "string" && (val.trim().startsWith("[") || val.trim().startsWith("{"))) {
      try { val = JSON.parse(val); } catch { /* keep string */ }
    }
    try {
      await dbUpdate("settings", { value: val }, { key });
      toast.success("Kaydedildi");
    } catch (err) {
      toast.error(translateError(err));
    } finally {
      setSavingKey(null);
      load();
    }
  };

  // Group items by category
  const grouped = useMemo(() => {
    const knownMap = new Map(KNOWN_SETTINGS.map((d) => [d.key, d]));
    const groups: Record<string, { setting: Setting; def: SettingDef | null }[]> = {
      otp: [], commission: [], loyalty: [], system: [], unknown: [],
    };
    items.forEach((s) => {
      const def = knownMap.get(s.key) ?? null;
      const cat = def?.category ?? "unknown";
      groups[cat].push({ setting: s, def });
    });
    return groups;
  }, [items]);

  const SettingRow = ({ setting, def }: { setting: Setting; def: SettingDef | null }) => {
    const value = editValues[setting.key];
    const valueAsString = (() => {
      if (value === null || value === undefined) return "";
      if (typeof value === "object") return JSON.stringify(value);
      return String(value);
    })();
    const update = (v: any) => setEditValues((prev) => ({ ...prev, [setting.key]: v }));
    return (
      <div className="border-t first:border-t-0 py-4 first:pt-0">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium">{def?.label ?? setting.key}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{def?.description ?? setting.description ?? ""}</div>
            <div className="text-[10px] font-mono text-muted-foreground mt-1">{setting.key}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {def?.kind === "toggle" ? (
            <Switch checked={!!value} onCheckedChange={(v) => update(v)} />
          ) : def?.kind === "number" ? (
            <div className="flex items-center gap-2 max-w-xs">
              <Input type="number" value={valueAsString} onChange={(e) => update(Number(e.target.value))} className="h-9" />
              {def.unit && <span className="text-xs text-muted-foreground whitespace-nowrap">{def.unit}</span>}
            </div>
          ) : def?.kind === "json" ? (
            <Input value={valueAsString} onChange={(e) => update(e.target.value)} className="h-9 font-mono text-xs max-w-md" placeholder='[15, 60, 1440]' />
          ) : (
            <Input value={valueAsString} onChange={(e) => update(e.target.value)} className="h-9 max-w-md" />
          )}
          <Can do="settings:update">
            <Button size="sm" onClick={() => save(setting.key)} disabled={savingKey === setting.key}>
              {savingKey === setting.key ? <Loader2 className="animate-spin size-4" /> : <Save className="size-4 mr-1" />} Kaydet
            </Button>
          </Can>
        </div>
      </div>
    );
  };

  if (loading) {
    return <AdminLayout title="Sistem Ayarları" requireAny={["settings:view"]}><div className="p-12 flex justify-center"><Loader2 className="animate-spin" /></div></AdminLayout>;
  }

  return (
    <AdminLayout title="Sistem Ayarları" requireAny={["settings:view"]}>
      <Tabs defaultValue="otp">
        <TabsList>
          <TabsTrigger value="otp">{CATEGORY_INFO.otp.label}</TabsTrigger>
          {/* Komisyonlar tab kaldırıldı — komisyon merchant ekleme anında set ediliyor */}
          <TabsTrigger value="loyalty">{CATEGORY_INFO.loyalty.label}</TabsTrigger>
          <TabsTrigger value="cashout">Merchant Tahsilat</TabsTrigger>
          <TabsTrigger value="system">{CATEGORY_INFO.system.label}</TabsTrigger>
          {grouped.unknown.length > 0 && <TabsTrigger value="unknown">{CATEGORY_INFO.unknown.label}</TabsTrigger>}
        </TabsList>

        {(["otp", "loyalty", "system", "unknown"] as const).map((cat) => (
          <TabsContent key={cat} value={cat} className="mt-4">
            <Card className="p-5 max-w-3xl">
              <div className="mb-4">
                <h3 className="font-semibold">{CATEGORY_INFO[cat].label}</h3>
                <p className="text-xs text-muted-foreground mt-0.5">{CATEGORY_INFO[cat].desc}</p>
              </div>
              {grouped[cat].length === 0 ? (
                <div className="text-sm text-muted-foreground py-6 text-center">Bu kategoride ayar yok.</div>
              ) : (
                <div className="divide-y">
                  {grouped[cat].map(({ setting, def }) => (
                    <SettingRow key={setting.key} setting={setting} def={def} />
                  ))}
                </div>
              )}
            </Card>

            {cat === "unknown" && (
              <Card className="p-4 mt-4 max-w-3xl border-dashed">
                <div className="flex items-start gap-2">
                  <ShieldAlert className="size-4 text-muted-foreground mt-0.5" />
                  <div>
                    <div className="text-sm font-medium">Bilinmeyen ayarlar</div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Bu ayarlar tip / açıklaması tanımlı değil. Kullanılmıyorlarsa silebilirsin.
                      Yeni bir ayar tanımı eklemek için <code className="text-xs bg-muted px-1 py-0.5 rounded">KNOWN_SETTINGS</code>
                      &nbsp;dizisini güncelle.
                    </p>
                  </div>
                </div>
              </Card>
            )}
          </TabsContent>
        ))}
        <TabsContent value="cashout" className="mt-4">
          <Card className="p-5 max-w-4xl">
            <div className="mb-4 flex items-start gap-2">
              <Coins className="size-5 text-primary mt-0.5" />
              <div>
                <h3 className="font-semibold">Merchant Tahsilat Yöntemleri</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Ticari merchant'ların settlement alacağını çekebileceği kripto ağları. Pasif yöntemler merchant BO'da seçilemez.
                </p>
              </div>
            </div>
            <div className="divide-y">
              {cashoutMethods.map((m) => (
                <div key={m.code} className="py-4 first:pt-0">
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <div>
                      <div className="text-sm font-medium">{m.label}</div>
                      <div className="text-[10px] font-mono text-muted-foreground">{m.code} · {m.asset}/{m.network}</div>
                    </div>
                    <Can do="settings:update">
                      <Switch
                        checked={m.is_active}
                        disabled={savingMethod === m.code}
                        onCheckedChange={(v) => updateCashoutMethod(m.code, { is_active: v })}
                      />
                    </Can>
                  </div>
                  <div className="grid grid-cols-2 gap-3 max-w-md">
                    <div>
                      <Label className="text-xs">Min tutar (₺)</Label>
                      <Input
                        type="number"
                        value={m.min_amount ?? 0}
                        onChange={(e) => setCashoutMethods((prev) => prev.map((x) => x.code === m.code ? { ...x, min_amount: Number(e.target.value) } : x))}
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Maks tutar (₺)</Label>
                      <Input
                        type="number"
                        value={m.max_amount ?? ""}
                        placeholder="Sınırsız"
                        onChange={(e) => setCashoutMethods((prev) => prev.map((x) => x.code === m.code ? { ...x, max_amount: e.target.value === "" ? null : Number(e.target.value) } : x))}
                      />
                    </div>
                  </div>
                  <Can do="settings:update">
                    <Button
                      size="sm"
                      className="mt-3"
                      variant="outline"
                      disabled={savingMethod === m.code}
                      onClick={() => updateCashoutMethod(m.code, {
                        min_amount: Number(m.min_amount ?? 0),
                        max_amount: m.max_amount == null ? null : Number(m.max_amount),
                      })}
                    >
                      {savingMethod === m.code ? <Loader2 className="animate-spin size-4" /> : <Save className="size-4 mr-1" />} Limitleri kaydet
                    </Button>
                  </Can>
                </div>
              ))}
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </AdminLayout>
  );
}
