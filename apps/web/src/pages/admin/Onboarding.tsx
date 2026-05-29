import AdminLayout from "@/components/AdminLayout";
import { useEffect, useState } from "react";
import { dbSelect, type WhereCondition } from "@/lib/db";
import { rpc } from "@/lib/rpc";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { fmtDate } from "@/lib/format";
import { Can } from "@/components/Can";
import { CheckCircle2, XCircle, MessageSquare, Copy, AlertTriangle, Plus } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { translateError } from "@/lib/i18n-errors";

type App = {
  id: string;
  company_name: string;
  trade_name: string | null;
  tax_no: string;
  contact_email: string;
  contact_name: string;
  contact_phone: string | null;
  requested_type: "commerce" | "finance";
  requested_methods: string[] | null;
  status: "pending" | "reviewing" | "info_requested" | "approved" | "rejected" | "cancelled";
  notes: string | null;
  approved_merchant_id: string | null;
  created_at: string;
  updated_at: string;
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Bekliyor",
  reviewing: "İncelemede",
  info_requested: "Bilgi istendi",
  approved: "Onaylandı",
  rejected: "Reddedildi",
  cancelled: "İptal",
};
const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "outline", reviewing: "secondary", info_requested: "outline",
  approved: "secondary", rejected: "destructive", cancelled: "outline",
};

export default function AdminOnboarding() {
  const [rows, setRows] = useState<App[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"open" | "all" | "approved" | "rejected">("open");
  const [selected, setSelected] = useState<App | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    const where: WhereCondition[] = [];
    if (filter === "open") where.push({ col: "status", op: "in", val: ["pending","reviewing","info_requested"] });
    if (filter === "approved") where.push({ col: "status", op: "eq", val: "approved" });
    if (filter === "rejected") where.push({ col: "status", op: "in", val: ["rejected","cancelled"] });
    const data = await dbSelect<App>("merchant_applications", {
      where: where.length ? where : undefined,
      order: { col: "created_at", asc: false },
      limit: 200,
    }).catch(() => [] as App[]);
    setRows(data);
    setLoading(false);
  };
  useEffect(() => { load(); }, [filter]);

  return (
    <AdminLayout title="Merchant Onboarding" requireAny={["merchants:approve"]}>
      <div className="space-y-4">
        <Card className="p-3 flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Filtre:</span>
          {(["open","all","approved","rejected"] as const).map((f) => (
            <Button
              key={f}
              size="sm"
              variant={filter === f ? "default" : "outline"}
              onClick={() => setFilter(f)}
            >
              {f === "open" ? "Açık" : f === "all" ? "Hepsi" : f === "approved" ? "Onaylananlar" : "Reddedilenler"}
            </Button>
          ))}
          <Button size="sm" variant="ghost" onClick={load} className="ml-auto">Yenile</Button>
          <Can do="merchants:approve">
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4 mr-1" />Yeni başvuru ekle
            </Button>
          </Can>
        </Card>

        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="text-left p-3">Şirket</th>
                <th className="text-left p-3">Tip</th>
                <th className="text-left p-3">İletişim</th>
                <th className="text-center p-3">Durum</th>
                <th className="text-right p-3">Tarih</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={5} className="text-center py-6 text-muted-foreground">Yükleniyor…</td></tr>}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={5} className="text-center py-6 text-muted-foreground">Başvuru yok.</td></tr>
              )}
              {rows.map((r) => (
                <tr key={r.id} className="border-t hover:bg-muted/30 cursor-pointer" onClick={() => setSelected(r)}>
                  <td className="p-3">
                    <div className="font-medium">{r.trade_name || r.company_name}</div>
                    <div className="text-xs text-muted-foreground">{r.tax_no}</div>
                  </td>
                  <td className="p-3"><Badge variant="outline">{r.requested_type}</Badge></td>
                  <td className="p-3 text-xs">
                    <div>{r.contact_name}</div>
                    <div className="text-muted-foreground">{r.contact_email}</div>
                  </td>
                  <td className="p-3 text-center">
                    <Badge variant={STATUS_VARIANT[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                  </td>
                  <td className="p-3 text-right text-xs text-muted-foreground">{fmtDate(r.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      {selected && <ReviewDialog app={selected} onClose={() => { setSelected(null); load(); }} />}
      {createOpen && <CreateDialog onClose={() => { setCreateOpen(false); load(); }} />}
    </AdminLayout>
  );
}

function ReviewDialog({ app, onClose }: { app: App; onClose: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [credentials, setCredentials] = useState<{ merchant_id: string; api_key: string; signing_secret: string } | null>(null);

  const decide = async (action: "approve" | "reject" | "request_info") => {
    if ((action === "reject" || action === "request_info") && !note.trim()) {
      return toast({ title: "Açıklama zorunlu", variant: "destructive" as any });
    }
    setBusy(true);
    try {
      const data = await rpc<unknown>("admin_review_application", {
        _application_id: app.id,
        _action: action,
        _note: note || null,
      });
      const row = Array.isArray(data) ? data[0] : (data as any);
      if (!row?.success) {
        return toast({ title: translateError({ error_code: row?.error_code }, "İşlem başarısız"), variant: "destructive" as any });
      }
      if (action === "approve") {
        setCredentials({
          merchant_id: row.merchant_id,
          api_key: row.api_key,
          signing_secret: row.signing_secret,
        });
        toast({ title: "Merchant onaylandı — credentials görüntüleniyor" });
      } else {
        toast({ title: action === "reject" ? "Reddedildi" : "Bilgi istendi" });
        onClose();
      }
    } catch (err: any) {
      toast({ title: translateError(err, "İşlem başarısız"), variant: "destructive" as any });
    } finally {
      setBusy(false);
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() => toast({ title: `${label} kopyalandı` }));
  };

  if (credentials) {
    return (
      <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
        <Card className="max-w-2xl w-full p-6 space-y-4">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="size-8 text-success" />
            <div>
              <h2 className="text-xl font-bold">Merchant onaylandı</h2>
              <p className="text-xs text-muted-foreground">Bu credentials BİR DAHA gösterilmeyecek — güvenli yere kaydedin ve merchant'a iletin.</p>
            </div>
          </div>

          <div className="bg-warning/10 border border-warning/30 rounded-lg p-3 flex gap-2 text-xs">
            <AlertTriangle className="size-4 text-warning shrink-0 mt-0.5" />
            <div>
              <strong>Güvenlik:</strong> Signing secret asla URL'de veya log'larda gösterilmemeli. Merchant'a güvenli kanal (1Password, Bitwarden vs.) ile iletin.
            </div>
          </div>

          <CredentialField label="Merchant ID" value={credentials.merchant_id} onCopy={() => copyToClipboard(credentials.merchant_id, "Merchant ID")} />
          <CredentialField label="API Key (x-merchant-key header)" value={credentials.api_key} onCopy={() => copyToClipboard(credentials.api_key, "API Key")} />
          <CredentialField label="Signing Secret (HMAC için)" value={credentials.signing_secret} onCopy={() => copyToClipboard(credentials.signing_secret, "Signing Secret")} secret />

          <div className="flex justify-end pt-2">
            <Button onClick={() => { setCredentials(null); onClose(); }}>Kapat (anladım, kaydettim)</Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <Card className="max-w-2xl w-full p-6 space-y-4">
        <div>
          <h2 className="text-xl font-bold">{app.trade_name || app.company_name}</h2>
          <div className="text-xs text-muted-foreground">{app.tax_no} · <Badge variant="outline">{app.requested_type}</Badge></div>
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <Info label="Şirket" value={app.company_name} />
          <Info label="Marka" value={app.trade_name || "—"} />
          <Info label="Vergi no" value={app.tax_no} />
          <Info label="Yetkili" value={`${app.contact_name} · ${app.contact_email}`} />
          <Info label="Telefon" value={app.contact_phone || "—"} />
          <Info label="İstenen yöntemler" value={app.requested_methods?.join(", ") || "—"} />
        </div>

        {(app.status === "pending" || app.status === "info_requested") && (
          <Can do="merchants:approve">
            <div className="space-y-3 border-t pt-4">
              <Label className="text-xs">Açıklama (reject/request_info için zorunlu)</Label>
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Vergi levhası fotoğrafı eklemenizi rica ederiz" />
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => decide("approve")} disabled={busy}>
                  <CheckCircle2 className="size-4 mr-1" />Onayla
                </Button>
                <Button onClick={() => decide("request_info")} variant="outline" disabled={busy}>
                  <MessageSquare className="size-4 mr-1" />Bilgi İste
                </Button>
                <Button onClick={() => decide("reject")} variant="destructive" disabled={busy}>
                  <XCircle className="size-4 mr-1" />Reddet
                </Button>
              </div>
            </div>
          </Can>
        )}

        {app.status === "approved" && (
          <div className="text-sm text-success">
            ✅ Onaylandı · Merchant ID: {app.approved_merchant_id ?? "—"}
            <div className="text-xs text-muted-foreground">Credentials zaten paylaşıldı (geri alınamaz).</div>
          </div>
        )}
        {app.status === "rejected" && app.notes && (
          <div className="text-sm bg-destructive/10 border border-destructive/30 rounded p-3">
            <strong>Reddedildi:</strong> {app.notes}
          </div>
        )}
        {app.status === "info_requested" && app.notes && (
          <div className="text-sm bg-warning/10 border border-warning/30 rounded p-3">
            <strong>Bilgi istendi:</strong> {app.notes}
          </div>
        )}

        <div className="flex justify-end pt-2 border-t">
          <Button variant="ghost" onClick={onClose}>Kapat</Button>
        </div>
      </Card>
    </div>
  );
}

function CreateDialog({ onClose }: { onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [type, setType] = useState<"commerce" | "finance">("commerce");
  const [companyName, setCompanyName] = useState("");
  const [tradeName, setTradeName] = useState("");
  const [taxNo, setTaxNo] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [city, setCity] = useState("");
  const [iban, setIban] = useState("");
  const [methods, setMethods] = useState<string[]>([]);
  const [notes, setNotes] = useState("");

  const toggle = (m: string) => setMethods((p) => p.includes(m) ? p.filter(x => x !== m) : [...p, m]);

  const submit = async () => {
    if (!companyName || !taxNo || !contactEmail || !contactName) {
      return toast({ title: "Şirket adı, vergi no, ad-soyad ve e-posta zorunlu", variant: "destructive" as any });
    }
    setBusy(true);
    try {
      const data = await rpc<unknown>("admin_create_application", {
        _company_name: companyName,
        _tax_no: taxNo,
        _contact_email: contactEmail,
        _contact_name: contactName,
        _requested_type: type,
        _trade_name: tradeName || null,
        _city: city || null,
        _contact_phone: contactPhone || null,
        _requested_methods: methods.length ? methods : null,
        _iban: iban || null,
        _notes: notes || null,
      });
      const row = Array.isArray(data) ? data[0] : (data as any);
      if (!row?.success) {
        return toast({ title: translateError({ error_code: row?.error_code }, "Başvuru oluşturulamadı"), variant: "destructive" as any });
      }
      toast({ title: "Başvuru kaydedildi — incele ve onayla" });
      onClose();
    } catch (err: any) {
      toast({ title: translateError(err, "Oluşturulamadı"), variant: "destructive" as any });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 overflow-y-auto">
      <Card className="max-w-2xl w-full p-6 space-y-4 my-8">
        <div>
          <h2 className="text-xl font-bold">Yeni Merchant Başvurusu</h2>
          <p className="text-xs text-muted-foreground">Yetkili kişi tarafından manuel kaydedilen başvuru. Sonrasında "Onayla" ile credentials üretilir.</p>
        </div>

        <div>
          <Label className="text-xs">Tip</Label>
          <div className="grid grid-cols-2 gap-2 mt-1">
            {(["commerce","finance"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setType(t)}
                className={`p-2 border-2 rounded-lg text-sm font-medium transition ${type === t ? "border-primary bg-primary/5" : "border-border"}`}
              >
                {t === "commerce" ? "Commerce" : "Finance"}
              </button>
            ))}
          </div>
        </div>

        {type === "finance" && (
          <div>
            <Label className="text-xs">Yöntemler</Label>
            <div className="flex flex-wrap gap-2 mt-1">
              {["havale","card","crypto"].map((m) => (
                <button
                  key={m}
                  onClick={() => toggle(m)}
                  className={`px-3 py-1 rounded-full text-xs border ${methods.includes(m) ? "bg-primary text-primary-foreground border-primary" : "bg-card"}`}
                >
                  {m === "havale" ? "Havale/EFT" : m === "card" ? "Kart" : "Kripto"}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <FormField label="Şirket adı *" value={companyName} onChange={setCompanyName} />
          <FormField label="Marka adı" value={tradeName} onChange={setTradeName} />
          <FormField label="Vergi no *" value={taxNo} onChange={setTaxNo} />
          <FormField label="Şehir" value={city} onChange={setCity} />
          <FormField label="Yetkili adı *" value={contactName} onChange={setContactName} />
          <FormField label="E-posta *" value={contactEmail} onChange={setContactEmail} type="email" />
          <FormField label="Telefon" value={contactPhone} onChange={setContactPhone} />
          <FormField label="IBAN" value={iban} onChange={setIban} />
        </div>

        <div>
          <Label className="text-xs">Notlar (admin için)</Label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="KYB belgeleri tarafımıza ulaştı, vs." />
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Vazgeç</Button>
          <Button onClick={submit} disabled={busy}>{busy ? "Kaydediliyor…" : "Başvuruyu kaydet"}</Button>
        </div>
      </Card>
    </div>
  );
}

function FormField({ label, value, onChange, type }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <div>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} type={type ?? "text"} />
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}

function CredentialField({ label, value, onCopy, secret }: { label: string; value: string; onCopy: () => void; secret?: boolean }) {
  return (
    <div>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="flex items-center gap-2 mt-1">
        <Input
          value={value}
          readOnly
          type={secret ? "password" : "text"}
          className="font-mono text-xs"
        />
        <Button size="sm" variant="outline" onClick={onCopy}><Copy className="size-4" /></Button>
      </div>
    </div>
  );
}
