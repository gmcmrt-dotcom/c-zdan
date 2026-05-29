// Yöntem Tipi Katalog — admin yönetimi
// Hassas yetki: method_types:edit (admin TRUE default)
// Etki kapsamı: GLOBAL — tüm üye topup/withdraw + merchant editor
// Hard rule: tablo doğrudan UI'dan toggle edilmez; admin_set_method_type_enabled RPC üzerinden + audit_log
import { useEffect, useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { dbSelect } from "@/lib/db";
import { rpc } from "@/lib/rpc";
import { useAuth } from "@/hooks/useAuth";
import { translateError } from "@/lib/i18n-errors";
import { toast } from "sonner";
import { Layers, Loader2, Banknote, Bitcoin, CreditCard, RefreshCw, Plus, Clock } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type MethodTypeRow = {
  code: string;
  label_tr: string;
  label_en: string;
  available_for: "topup" | "withdraw" | "both";
  is_enabled: boolean;
  sort_order: number;
  description_tr: string | null;
  description_en: string | null;
  withdraw_eta_min: number;
  withdraw_eta_max: number;
  withdraw_eta_unit: EtaUnit;
  updated_at: string;
};

type EtaUnit = "minute" | "hour" | "business_day";

const ICON_MAP: Record<string, any> = {
  havale: Banknote,
  crypto: Bitcoin,
  credit_card: CreditCard,
};

const AVAILABLE_FOR_LABEL: Record<MethodTypeRow["available_for"], string> = {
  topup: "Yatırma",
  withdraw: "Çekme",
  both: "Yatırma + Çekme",
};

const ETA_UNIT_LABEL: Record<EtaUnit, string> = {
  minute: "dk",
  hour: "saat",
  business_day: "iş günü",
};

function formatEta(row: Pick<MethodTypeRow, "withdraw_eta_min" | "withdraw_eta_max" | "withdraw_eta_unit">) {
  const unit = ETA_UNIT_LABEL[row.withdraw_eta_unit] ?? row.withdraw_eta_unit;
  if (row.withdraw_eta_min === row.withdraw_eta_max) return `${row.withdraw_eta_min} ${unit}`;
  return `${row.withdraw_eta_min}-${row.withdraw_eta_max} ${unit}`;
}

export default function AdminMethodTypes() {
  const { roles } = useAuth();
  const isAdmin = roles.includes("admin" as any);

  const [rows, setRows] = useState<MethodTypeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingCode, setSavingCode] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await dbSelect<MethodTypeRow>("payment_method_types", {
        order: { col: "sort_order", asc: true },
      });
      setRows(data);
    } catch (err) {
      toast.error(translateError(err, "Yöntem tipleri yüklenemedi"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const toggle = async (row: MethodTypeRow, next: boolean) => {
    if (!isAdmin) {
      toast.error("Bu işlem için admin yetkisi gerekiyor");
      return;
    }
    setSavingCode(row.code);
    try {
      await rpc("admin_set_method_type_enabled", {
        _code: row.code,
        _enabled: next,
      });
    } catch (err) {
      setSavingCode(null);
      toast.error(translateError(err, "Durum değiştirilemedi"));
      return;
    }
    setSavingCode(null);
    toast.success(next ? `"${row.label_tr}" aktifleştirildi` : `"${row.label_tr}" pasifleştirildi (üyeye 'Yakında' olarak görünür)`);
    setRows((prev) =>
      prev.map((r) => (r.code === row.code ? { ...r, is_enabled: next } : r)),
    );
  };

  // Yeni tip ekleme dialog
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState({
    code: "",
    label_tr: "",
    label_en: "",
    available_for: "both" as "topup" | "withdraw" | "both",
    is_enabled: false,
    sort_order: 100,
  });
  const [adding, setAdding] = useState(false);
  const [etaOpen, setEtaOpen] = useState(false);
  const [etaSaving, setEtaSaving] = useState(false);
  const [etaTarget, setEtaTarget] = useState<MethodTypeRow | null>(null);
  const [etaForm, setEtaForm] = useState<{ min: number; max: number; unit: EtaUnit }>({
    min: 5,
    max: 30,
    unit: "minute",
  });

  const openEtaDialog = (row: MethodTypeRow) => {
    setEtaTarget(row);
    setEtaForm({
      min: row.withdraw_eta_min ?? 5,
      max: row.withdraw_eta_max ?? 30,
      unit: row.withdraw_eta_unit ?? "minute",
    });
    setEtaOpen(true);
  };

  const submitEta = async () => {
    if (!etaTarget) return;
    if (etaForm.min <= 0 || etaForm.max <= 0 || etaForm.min > etaForm.max) {
      toast.error("Süre aralığı geçersiz");
      return;
    }
    setEtaSaving(true);
    try {
      await rpc("admin_update_method_type_withdraw_eta", {
        _code: etaTarget.code,
        _min: etaForm.min,
        _max: etaForm.max,
        _unit: etaForm.unit,
      });
    } catch (err) {
      setEtaSaving(false);
      toast.error(translateError(err, "Süre güncellenemedi"));
      return;
    }
    setEtaSaving(false);
    toast.success(`"${etaTarget.label_tr}" çekim süresi güncellendi`);
    setRows((prev) =>
      prev.map((row) =>
        row.code === etaTarget.code
          ? {
              ...row,
              withdraw_eta_min: etaForm.min,
              withdraw_eta_max: etaForm.max,
              withdraw_eta_unit: etaForm.unit,
            }
          : row,
      ),
    );
    setEtaOpen(false);
  };

  const submitAdd = async () => {
    if (!addForm.code || !addForm.label_tr || !addForm.label_en) {
      toast.error("Kod, TR ve EN label zorunlu");
      return;
    }
    setAdding(true);
    try {
      await rpc("admin_create_method_type", {
        _code: addForm.code,
        _label_tr: addForm.label_tr,
        _label_en: addForm.label_en,
        _available_for: addForm.available_for,
        _is_enabled: addForm.is_enabled,
        _sort_order: addForm.sort_order,
      });
    } catch (err) {
      setAdding(false);
      toast.error(translateError(err, "Eklenemedi"));
      return;
    }
    setAdding(false);
    toast.success(`"${addForm.label_tr}" eklendi`);
    setAddOpen(false);
    setAddForm({ code: "", label_tr: "", label_en: "", available_for: "both", is_enabled: false, sort_order: 100 });
    load();
  };

  return (
    <AdminLayout title="Yöntem Tipleri" requireAny={["method_types:view", "method_types:edit"]}>
      <div className="p-4 sm:p-6 space-y-4 max-w-4xl mx-auto">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Layers className="size-6 text-primary" /> Yöntem Tipleri
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Üyelerin "Para Yatır / Para Çek" ekranlarında gördüğü yöntem tiplerini yönetin.
              Pasif olanlar üye-yüzünde "<span className="font-medium">Yakında</span>" rozetiyle görünür.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isAdmin && (
              <Button size="sm" onClick={() => setAddOpen(true)}>
                <Plus className="size-4 mr-1" /> Yeni Tip
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>

        {!isAdmin && (
          <div className="bg-warning/10 border border-warning/30 text-warning-foreground rounded-md p-3 text-sm">
            ⓘ Sadece görüntüleme yetkin var. On/off değiştirmek için admin rolü gereklidir.
          </div>
        )}

        <div className="bg-info/10 border border-info/30 rounded-md p-3 text-sm text-foreground">
          <strong>Etki kapsamı:</strong> Bu sayfadaki her toggle{" "}
          <span className="font-semibold">tüm üyelerin gördüğü</span> yöntem listesini etkiler.
          Pasif yöntem üyeye <em>"Yakında"</em> olarak görünür ve seçilemez.
          Tüm değişiklikler audit log'a kaydedilir.
        </div>

        <Card className="overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-muted-foreground">
              <Loader2 className="size-5 animate-spin mx-auto mb-2" />
              Yükleniyor…
            </div>
          ) : rows.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              Henüz tanımlı yöntem tipi yok.
            </div>
          ) : (
            <div className="divide-y">
              {rows.map((r) => {
                const Icon = ICON_MAP[r.code] ?? Layers;
                const saving = savingCode === r.code;
                return (
                  <div
                    key={r.code}
                    className="p-4 flex items-center gap-4 hover:bg-muted/30 transition-colors"
                  >
                    <div
                      className={`size-10 rounded-lg flex items-center justify-center shrink-0 ${
                        r.is_enabled
                          ? "bg-primary/10 text-primary"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      <Icon className="size-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium">{r.label_tr}</span>
                        <span className="text-xs text-muted-foreground font-mono">{r.code}</span>
                        <Badge variant="outline" className="text-xs">
                          {AVAILABLE_FOR_LABEL[r.available_for]}
                        </Badge>
                        {!r.is_enabled && (
                          <Badge variant="secondary" className="text-xs">
                            Yakında (üye)
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        EN: {r.label_en}
                      </div>
                      {(r.available_for === "withdraw" || r.available_for === "both") && (
                        <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                          <Clock className="size-3" />
                          <span>Çekim tahmini: {formatEta(r)}</span>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {(r.available_for === "withdraw" || r.available_for === "both") && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={!isAdmin}
                          onClick={() => openEtaDialog(r)}
                        >
                          <Clock className="size-4 mr-1" />
                          Süre
                        </Button>
                      )}
                      {saving && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
                      <Switch
                        checked={r.is_enabled}
                        disabled={!isAdmin || saving}
                        onCheckedChange={(next) => toggle(r, next)}
                      />
                      <span
                        className={`text-xs w-12 text-right tabular-nums ${
                          r.is_enabled ? "text-success" : "text-muted-foreground"
                        }`}
                      >
                        {r.is_enabled ? "Aktif" : "Pasif"}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <div className="text-xs text-muted-foreground">
          Yeni tip ekleme RPC üzerinden yapılır. Default `is_enabled=false` — açıldığı an üyeye görünür.
        </div>
      </div>

      {/* Yeni Tip dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Yeni Yöntem Tipi</DialogTitle>
            <DialogDescription>
              Üye-yüzünde "Para Yatır / Para Çek" listelerinde gösterilecek yeni bir yöntem tipi tanımla.
              <br />
              <span className="text-warning">⚠ Default <b>pasif</b> ekler — üyeye "Yakında" rozetli görünür.</span>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Kod * (örn: papara, mobil_odeme)</Label>
              <Input
                value={addForm.code}
                onChange={(e) => setAddForm({ ...addForm, code: e.target.value })}
                placeholder="alfanumerik + _ — boşluk yok"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>TR Etiket *</Label>
                <Input
                  value={addForm.label_tr}
                  onChange={(e) => setAddForm({ ...addForm, label_tr: e.target.value })}
                  placeholder="Papara"
                />
              </div>
              <div>
                <Label>EN Etiket *</Label>
                <Input
                  value={addForm.label_en}
                  onChange={(e) => setAddForm({ ...addForm, label_en: e.target.value })}
                  placeholder="Papara"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Kullanım</Label>
                <select
                  className="w-full h-10 border rounded-md px-3 bg-background"
                  value={addForm.available_for}
                  onChange={(e) => setAddForm({ ...addForm, available_for: e.target.value as any })}
                >
                  <option value="both">Yatırma + Çekme</option>
                  <option value="topup">Sadece yatırma</option>
                  <option value="withdraw">Sadece çekme</option>
                </select>
              </div>
              <div>
                <Label>Sıralama</Label>
                <Input
                  type="number"
                  value={addForm.sort_order}
                  onChange={(e) => setAddForm({ ...addForm, sort_order: Number(e.target.value) })}
                />
              </div>
            </div>
            <div className="flex items-center justify-between border-t pt-3">
              <Label>Direkt aktif et?</Label>
              <Switch
                checked={addForm.is_enabled}
                onCheckedChange={(v) => setAddForm({ ...addForm, is_enabled: v })}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {addForm.is_enabled
                ? "Üye-yüzünde anında görünür ve seçilebilir olur."
                : "Pasif ekler — daha sonra Switch ile açabilirsin."}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)} disabled={adding}>İptal</Button>
            <Button onClick={submitAdd} disabled={adding}>
              {adding && <Loader2 className="size-4 mr-2 animate-spin" />}
              Ekle
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={etaOpen} onOpenChange={setEtaOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Çekim Tahmini Süresi</DialogTitle>
            <DialogDescription>
              {etaTarget?.label_tr} için üye-yüzünde gösterilecek bilgilendirme süresini düzenle.
              Bu ayar routing veya muhasebe davranışını değiştirmez.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Minimum</Label>
                <Input
                  type="number"
                  min={1}
                  value={etaForm.min}
                  onChange={(e) => setEtaForm((prev) => ({ ...prev, min: Number(e.target.value) }))}
                />
              </div>
              <div>
                <Label>Maksimum</Label>
                <Input
                  type="number"
                  min={1}
                  value={etaForm.max}
                  onChange={(e) => setEtaForm((prev) => ({ ...prev, max: Number(e.target.value) }))}
                />
              </div>
            </div>
            <div>
              <Label>Birim</Label>
              <select
                className="w-full h-10 border rounded-md px-3 bg-background"
                value={etaForm.unit}
                onChange={(e) => setEtaForm((prev) => ({ ...prev, unit: e.target.value as EtaUnit }))}
              >
                <option value="minute">Dakika</option>
                <option value="hour">Saat</option>
                <option value="business_day">İş günü</option>
              </select>
            </div>
            <div className="rounded-md border bg-muted/40 p-3 text-sm">
              Üye-yüzünde: <span className="font-medium">Tahmini süre: {formatEta({
                withdraw_eta_min: etaForm.min,
                withdraw_eta_max: etaForm.max,
                withdraw_eta_unit: etaForm.unit,
              })}</span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEtaOpen(false)} disabled={etaSaving}>İptal</Button>
            <Button onClick={submitEta} disabled={etaSaving}>
              {etaSaving && <Loader2 className="size-4 mr-2 animate-spin" />}
              Kaydet
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
