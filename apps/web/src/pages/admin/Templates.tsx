// Şablon yönetimi — Mail + Telegram + Chat canned responses
import { useEffect, useMemo, useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { rpc } from "@/lib/rpc";
import { dbSelect, dbUpdate } from "@/lib/db";
import { useAuth } from "@/hooks/useAuth";
import { translateError } from "@/lib/i18n-errors";
import { isAffiliateEnabled } from "@/lib/feature-flags";
import { templateKeyLabel } from "@/lib/bo-labels";
import { toast } from "sonner";
import { Loader2, Mail, Send, MessageCircle, Pencil, Save, Plus } from "lucide-react";

type MailTpl = {
  id: string;
  template_key: string;
  locale: "tr" | "en";
  subject: string;
  body_html: string;
  body_text: string;
  variables: string[];
  description: string | null;
  audience: "member" | "staff" | "merchant" | "affiliate";
  is_active: boolean;
  updated_at: string;
};

type TgTpl = {
  id: string;
  template_key: string;
  locale: "tr" | "en";
  body_md: string;
  variables: string[];
  description: string | null;
  audience: "member" | "staff" | "merchant";
  is_active: boolean;
  updated_at: string;
};

type CannedTpl = {
  id: string;
  category: "topup_issue" | "withdraw_issue" | "profile_update" | "general";
  title: string;
  body: string;
  trigger_keywords: string[];
  is_active: boolean;
  use_count: number;
  updated_at: string;
};

const CATEGORY_LABEL: Record<CannedTpl["category"], string> = {
  topup_issue: "Para yatırma",
  withdraw_issue: "Para çekme",
  profile_update: "Profil değişikliği",
  general: "Genel",
};

const AUDIENCE_LABEL: Record<string, string> = {
  member: "Üye",
  staff: "Staff",
  merchant: "Merchant",
  affiliate: "Affiliate",
};

export default function AdminTemplates() {
  const { roles } = useAuth();
  const isAdmin = roles.includes("admin" as any);

  const [mailRows, setMailRows] = useState<MailTpl[]>([]);
  const [tgRows, setTgRows] = useState<TgTpl[]>([]);
  const [cannedRows, setCannedRows] = useState<CannedTpl[]>([]);
  const [loading, setLoading] = useState(true);

  const [editMail, setEditMail] = useState<MailTpl | null>(null);
  const [editTg, setEditTg] = useState<TgTpl | null>(null);
  const [editCanned, setEditCanned] = useState<CannedTpl | null>(null);
  // Yeni şablon ekleme dialog state
  const [addMailOpen, setAddMailOpen] = useState(false);
  const [addTgOpen, setAddTgOpen] = useState(false);
  const [addCannedOpen, setAddCannedOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    const [mRes, tRes, cRes] = await Promise.allSettled([
      dbSelect<MailTpl>("mail_templates", { order: { col: "template_key", asc: true } }),
      dbSelect<TgTpl>("telegram_templates", { order: { col: "template_key", asc: true } }),
      dbSelect<CannedTpl>("chat_canned_responses", { order: { col: "title", asc: true } }),
    ]);
    if (mRes.status === "rejected") toast.error(translateError(mRes.reason, "Mail şablonları okunamadı"));
    if (tRes.status === "rejected") toast.error(translateError(tRes.reason, "TG şablonları okunamadı"));
    if (cRes.status === "rejected") toast.error(translateError(cRes.reason, "Canned response'lar okunamadı"));
    const mail = mRes.status === "fulfilled" ? mRes.value : [];
    setMailRows(
      isAffiliateEnabled() ? mail : mail.filter((row) => row.audience !== "affiliate"),
    );
    setTgRows(tRes.status === "fulfilled" ? tRes.value : []);
    setCannedRows(cRes.status === "fulfilled" ? cRes.value : []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const counts = useMemo(() => ({
    mail: mailRows.length,
    tg: tgRows.length,
    canned: cannedRows.length,
  }), [mailRows, tgRows, cannedRows]);

  if (!isAdmin) return null;

  return (
    <AdminLayout title="Şablonlar" requireAny={["templates:view"]}>
      <div className="text-xs text-muted-foreground p-3 rounded-lg bg-muted/40 border space-y-1 mb-4">
        <div><strong>ℹ️ Şablonlar — nasıl çalışıyor:</strong></div>
        <div>• <strong>Mail:</strong> üye + staff'a gönderilen mailler (welcome, OTP, withdraw success vb.).</div>
        <div>• <strong>Telegram:</strong> staff bildirimleri (Faz 5 bot kurulduğunda aktif).</div>
        <div>• <strong>Chat (Canned):</strong> destek panelinde hazır cevap olarak kullanılır + AI cevap üretirken context.</div>
        <div>• Değişkenler <code className="bg-muted px-1 rounded">{"{{variable}}"}</code> formatında. Edge fn render ederken doldurur.</div>
      </div>

      <Tabs defaultValue="mail">
        <TabsList>
          <TabsTrigger value="mail"><Mail className="size-4 mr-1" /> Mail ({counts.mail})</TabsTrigger>
          <TabsTrigger value="tg"><Send className="size-4 mr-1" /> Telegram ({counts.tg})</TabsTrigger>
          <TabsTrigger value="canned"><MessageCircle className="size-4 mr-1" /> Chat Canned ({counts.canned})</TabsTrigger>
        </TabsList>

        {/* MAIL */}
        <TabsContent value="mail" className="mt-4">
          {/* Yeni Mail Şablonu */}
          <div className="flex justify-end mb-2">
            <Button size="sm" onClick={() => setAddMailOpen(true)}>
              <Plus className="size-4 mr-1" /> Yeni Mail Şablonu
            </Button>
          </div>
          <Card className="p-0 overflow-hidden">
            {loading ? (
              <div className="p-12 flex justify-center"><Loader2 className="animate-spin" /></div>
            ) : mailRows.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">Henüz mail şablonu yok.</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left">
                  <tr>
                    <th className="px-4 py-3">Şablon</th>
                    <th className="px-4 py-3">Konu</th>
                    <th className="px-4 py-3">Hedef</th>
                    <th className="px-4 py-3">Dil</th>
                    <th className="px-4 py-3 text-center">Aktif</th>
                    <th className="px-4 py-3 text-right">İşlem</th>
                  </tr>
                </thead>
                <tbody>
                  {mailRows.map((m) => (
                    <tr key={m.id} className="border-t hover:bg-muted/20">
                      <td className="px-4 py-2">
                        <div className="font-medium">{templateKeyLabel(m.template_key)}</div>
                        <div className="font-mono text-[10px] text-muted-foreground mt-0.5">{m.template_key}</div>
                      </td>
                      <td className="px-4 py-2">
                        <div className="font-medium">{m.subject}</div>
                        {m.description && <div className="text-[11px] text-muted-foreground mt-0.5">{m.description}</div>}
                      </td>
                      <td className="px-4 py-2"><Badge variant="outline" className="text-[10px]">{AUDIENCE_LABEL[m.audience]}</Badge></td>
                      <td className="px-4 py-2 font-mono text-xs uppercase">{m.locale}</td>
                      <td className="px-4 py-2 text-center">
                        <Badge variant={m.is_active ? "default" : "outline"} className="text-[10px]">
                          {m.is_active ? "✓" : "✗"}
                        </Badge>
                      </td>
                      <td className="px-4 py-2 text-right">
                        <Button size="sm" variant="ghost" onClick={() => setEditMail(m)}>
                          <Pencil className="size-3" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </TabsContent>

        {/* TELEGRAM */}
        <TabsContent value="tg" className="mt-4">
          {/* Yeni TG Şablonu */}
          <div className="flex justify-end mb-2">
            <Button size="sm" onClick={() => setAddTgOpen(true)}>
              <Plus className="size-4 mr-1" /> Yeni Telegram Şablonu
            </Button>
          </div>
          <Card className="p-0 overflow-hidden">
            {loading ? (
              <div className="p-12 flex justify-center"><Loader2 className="animate-spin" /></div>
            ) : tgRows.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">Henüz Telegram şablonu yok.</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left">
                  <tr>
                    <th className="px-4 py-3">Şablon</th>
                    <th className="px-4 py-3">İçerik (özet)</th>
                    <th className="px-4 py-3">Hedef</th>
                    <th className="px-4 py-3">Dil</th>
                    <th className="px-4 py-3 text-center">Aktif</th>
                    <th className="px-4 py-3 text-right">İşlem</th>
                  </tr>
                </thead>
                <tbody>
                  {tgRows.map((t) => (
                    <tr key={t.id} className="border-t hover:bg-muted/20">
                      <td className="px-4 py-2">
                        <div className="font-medium">{templateKeyLabel(t.template_key)}</div>
                        <div className="font-mono text-[10px] text-muted-foreground mt-0.5">{t.template_key}</div>
                      </td>
                      <td className="px-4 py-2">
                        <div className="text-xs text-muted-foreground line-clamp-2 max-w-[400px]">{t.body_md.slice(0, 120)}…</div>
                        {t.description && <div className="text-[11px] text-muted-foreground mt-0.5 italic">{t.description}</div>}
                      </td>
                      <td className="px-4 py-2"><Badge variant="outline" className="text-[10px]">{AUDIENCE_LABEL[t.audience]}</Badge></td>
                      <td className="px-4 py-2 font-mono text-xs uppercase">{t.locale}</td>
                      <td className="px-4 py-2 text-center">
                        <Badge variant={t.is_active ? "default" : "outline"} className="text-[10px]">
                          {t.is_active ? "✓" : "✗"}
                        </Badge>
                      </td>
                      <td className="px-4 py-2 text-right">
                        <Button size="sm" variant="ghost" onClick={() => setEditTg(t)}>
                          <Pencil className="size-3" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </TabsContent>

        {/* CHAT CANNED */}
        <TabsContent value="canned" className="mt-4">
          {/* Yeni Hazır Cevap */}
          <div className="flex justify-end mb-2">
            <Button size="sm" onClick={() => setAddCannedOpen(true)}>
              <Plus className="size-4 mr-1" /> Yeni Hazır Cevap
            </Button>
          </div>
          <Card className="p-0 overflow-hidden">
            {loading ? (
              <div className="p-12 flex justify-center"><Loader2 className="animate-spin" /></div>
            ) : cannedRows.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">Henüz hazır cevap yok.</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left">
                  <tr>
                    <th className="px-4 py-3">Kategori</th>
                    <th className="px-4 py-3">Başlık</th>
                    <th className="px-4 py-3">İçerik (özet)</th>
                    <th className="px-4 py-3 text-center">Kullanım</th>
                    <th className="px-4 py-3 text-center">Aktif</th>
                    <th className="px-4 py-3 text-right">İşlem</th>
                  </tr>
                </thead>
                <tbody>
                  {cannedRows.map((c) => (
                    <tr key={c.id} className="border-t hover:bg-muted/20">
                      <td className="px-4 py-2"><Badge variant="outline" className="text-[10px]">{CATEGORY_LABEL[c.category]}</Badge></td>
                      <td className="px-4 py-2 font-medium">{c.title}</td>
                      <td className="px-4 py-2">
                        <div className="text-xs text-muted-foreground line-clamp-2 max-w-[400px]">{c.body.slice(0, 140)}…</div>
                      </td>
                      <td className="px-4 py-2 text-center text-xs tabular-nums">{c.use_count}</td>
                      <td className="px-4 py-2 text-center">
                        <Badge variant={c.is_active ? "default" : "outline"} className="text-[10px]">
                          {c.is_active ? "✓" : "✗"}
                        </Badge>
                      </td>
                      <td className="px-4 py-2 text-right">
                        <Button size="sm" variant="ghost" onClick={() => setEditCanned(c)}>
                          <Pencil className="size-3" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </TabsContent>
      </Tabs>

      {/* MAIL EDIT */}
      <Dialog open={!!editMail} onOpenChange={(o) => !o && setEditMail(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          {editMail && <EditMailDialog row={editMail} onSaved={() => { setEditMail(null); load(); }} />}
        </DialogContent>
      </Dialog>

      {/* TG EDIT */}
      <Dialog open={!!editTg} onOpenChange={(o) => !o && setEditTg(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          {editTg && <EditTgDialog row={editTg} onSaved={() => { setEditTg(null); load(); }} />}
        </DialogContent>
      </Dialog>

      {/* CANNED EDIT */}
      <Dialog open={!!editCanned} onOpenChange={(o) => !o && setEditCanned(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          {editCanned && <EditCannedDialog row={editCanned} onSaved={() => { setEditCanned(null); load(); }} />}
        </DialogContent>
      </Dialog>

      {/* ADD MAIL */}
      <Dialog open={addMailOpen} onOpenChange={setAddMailOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <AddMailDialog onSaved={() => { setAddMailOpen(false); load(); }} onClose={() => setAddMailOpen(false)} />
        </DialogContent>
      </Dialog>

      {/* ADD TG */}
      <Dialog open={addTgOpen} onOpenChange={setAddTgOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <AddTgDialog onSaved={() => { setAddTgOpen(false); load(); }} onClose={() => setAddTgOpen(false)} />
        </DialogContent>
      </Dialog>

      {/* ADD CANNED */}
      <Dialog open={addCannedOpen} onOpenChange={setAddCannedOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <AddCannedDialog onSaved={() => { setAddCannedOpen(false); load(); }} onClose={() => setAddCannedOpen(false)} />
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}

/* -------------- Edit dialogs -------------- */

function EditMailDialog({ row, onSaved }: { row: MailTpl; onSaved: () => void }) {
  const [subject, setSubject] = useState(row.subject);
  const [bodyHtml, setBodyHtml] = useState(row.body_html);
  const [bodyText, setBodyText] = useState(row.body_text);
  const [isActive, setIsActive] = useState(row.is_active);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await dbUpdate(
        "mail_templates",
        { subject, body_html: bodyHtml, body_text: bodyText, is_active: isActive, updated_at: new Date().toISOString() },
        { id: row.id },
      );
      toast.success("Mail şablonu güncellendi.");
      onSaved();
    } catch (err) {
      toast.error(translateError(err, "Kaydedilemedi"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Mail Şablonu — {templateKeyLabel(row.template_key)}</DialogTitle>
        <DialogDescription>
          Teknik anahtar: <code className="font-mono text-xs bg-muted px-1 rounded">{row.template_key}</code>
          <br />
          Değişkenler: {row.variables.length > 0 ? row.variables.map((v) => <code key={v} className="mx-1 px-1 bg-muted rounded text-xs">{`{{${v}}}`}</code>) : "yok"}
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div>
          <Label>Konu</Label>
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
        </div>
        <div>
          <Label>HTML gövde</Label>
          <Textarea value={bodyHtml} onChange={(e) => setBodyHtml(e.target.value)} rows={10} className="font-mono text-xs" />
        </div>
        <div>
          <Label>Plain text fallback</Label>
          <Textarea value={bodyText} onChange={(e) => setBodyText(e.target.value)} rows={4} className="text-xs" />
        </div>
        <Label className="flex items-center gap-2 cursor-pointer text-sm">
          <Switch checked={isActive} onCheckedChange={setIsActive} />
          Aktif
        </Label>
      </div>
      <DialogFooter>
        <Button onClick={save} disabled={saving}>
          {saving ? <Loader2 className="animate-spin size-4 mr-1" /> : <Save className="size-4 mr-1" />}
          Kaydet
        </Button>
      </DialogFooter>
    </>
  );
}

function EditTgDialog({ row, onSaved }: { row: TgTpl; onSaved: () => void }) {
  const [bodyMd, setBodyMd] = useState(row.body_md);
  const [isActive, setIsActive] = useState(row.is_active);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await dbUpdate(
        "telegram_templates",
        { body_md: bodyMd, is_active: isActive, updated_at: new Date().toISOString() },
        { id: row.id },
      );
      toast.success("TG şablonu güncellendi.");
      onSaved();
    } catch (err) {
      toast.error(translateError(err, "Kaydedilemedi"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Telegram Şablonu — {templateKeyLabel(row.template_key)}</DialogTitle>
        <DialogDescription>
          Teknik anahtar: <code className="font-mono text-xs bg-muted px-1 rounded">{row.template_key}</code>
          <br />
          Değişkenler: {row.variables.length > 0 ? row.variables.map((v) => <code key={v} className="mx-1 px-1 bg-muted rounded text-xs">{`{{${v}}}`}</code>) : "yok"}
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div>
          <Label>Markdown gövde (TG MarkdownV2)</Label>
          <Textarea value={bodyMd} onChange={(e) => setBodyMd(e.target.value)} rows={10} className="font-mono text-xs" />
          <p className="text-[11px] text-muted-foreground mt-1">
            *kalın*, _italik_, `kod`, [link](url). Özel karakterler için \\ kullan.
          </p>
        </div>
        <Label className="flex items-center gap-2 cursor-pointer text-sm">
          <Switch checked={isActive} onCheckedChange={setIsActive} />
          Aktif
        </Label>
      </div>
      <DialogFooter>
        <Button onClick={save} disabled={saving}>
          {saving ? <Loader2 className="animate-spin size-4 mr-1" /> : <Save className="size-4 mr-1" />}
          Kaydet
        </Button>
      </DialogFooter>
    </>
  );
}

function EditCannedDialog({ row, onSaved }: { row: CannedTpl; onSaved: () => void }) {
  const [title, setTitle] = useState(row.title);
  const [body, setBody] = useState(row.body);
  const [keywords, setKeywords] = useState(row.trigger_keywords.join(", "));
  const [isActive, setIsActive] = useState(row.is_active);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const kwArr = keywords.split(",").map((s) => s.trim()).filter(Boolean);
    try {
      await dbUpdate(
        "chat_canned_responses",
        { title, body, trigger_keywords: kwArr, is_active: isActive, updated_at: new Date().toISOString() },
        { id: row.id },
      );
      toast.success("Hazır cevap güncellendi.");
      onSaved();
    } catch (err) {
      toast.error(translateError(err, "Kaydedilemedi"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Hazır Cevap — <Badge variant="outline">{CATEGORY_LABEL[row.category]}</Badge></DialogTitle>
      </DialogHeader>
      <div className="space-y-3">
        <div>
          <Label>Başlık (admin liste için)</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div>
          <Label>Gövde (chat'e gönderilen mesaj)</Label>
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={6} />
        </div>
        <div>
          <Label>Tetikleyici kelimeler (virgülle ayır)</Label>
          <Input value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="örn: havale gelmedi, para yatmadı" />
        </div>
        <Label className="flex items-center gap-2 cursor-pointer text-sm">
          <Switch checked={isActive} onCheckedChange={setIsActive} />
          Aktif
        </Label>
      </div>
      <DialogFooter>
        <Button onClick={save} disabled={saving}>
          {saving ? <Loader2 className="animate-spin size-4 mr-1" /> : <Save className="size-4 mr-1" />}
          Kaydet
        </Button>
      </DialogFooter>
    </>
  );
}

// ============================================================================
// ADD DIALOGS — Yeni şablon ekleme (3 tip)
// ============================================================================

function AddMailDialog({ onSaved, onClose }: { onSaved: () => void; onClose: () => void }) {
  const [form, setForm] = useState({
    template_key: "",
    locale: "tr" as "tr" | "en",
    subject: "",
    body_html: "",
    body_text: "",
    audience: "member" as "member" | "staff" | "merchant" | "affiliate",
    description: "",
    is_active: true,
  });
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (!form.template_key || !form.subject || !form.body_html) {
      toast.error("Teknik anahtar, konu ve HTML gövde zorunlu");
      return;
    }
    setSaving(true);
    try {
      await rpc("admin_create_mail_template", {
        _template_key: form.template_key,
        _locale: form.locale,
        _subject: form.subject,
        _body_html: form.body_html,
        _body_text: form.body_text || form.body_html.replace(/<[^>]*>/g, ""),
        _audience: form.audience,
        _description: form.description || null,
        _is_active: form.is_active,
      });
      toast.success("Mail şablonu eklendi");
      onSaved();
    } catch (err) {
      toast.error(translateError(err, "Eklenemedi"));
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <DialogHeader>
        <DialogTitle>Yeni Mail Şablonu</DialogTitle>
        <DialogDescription>Üye/staff/merchant'a gönderilecek e-posta şablonu.</DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Teknik anahtar *</Label>
            <Input value={form.template_key} onChange={(e) => setForm({ ...form, template_key: e.target.value })} placeholder="welcome, otp_login..." />
            <p className="text-[11px] text-muted-foreground mt-1">Kullanıcıya gösterilmez; sistemin bu şablonu bulması için kullanılır.</p>
          </div>
          <div>
            <Label>Dil</Label>
            <select className="w-full h-10 border rounded-md px-3 bg-background"
              value={form.locale} onChange={(e) => setForm({ ...form, locale: e.target.value as any })}>
              <option value="tr">TR</option>
              <option value="en">EN</option>
            </select>
          </div>
        </div>
        <div>
          <Label>Hedef</Label>
          <select className="w-full h-10 border rounded-md px-3 bg-background"
            value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value as any })}>
            <option value="member">Üye</option>
            <option value="staff">Staff</option>
            <option value="merchant">Merchant</option>
            {isAffiliateEnabled() && <option value="affiliate">Affiliate</option>}
          </select>
        </div>
        <div>
          <Label>Konu *</Label>
          <Input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
        </div>
        <div>
          <Label>Gövde (HTML) *</Label>
          <Textarea value={form.body_html} onChange={(e) => setForm({ ...form, body_html: e.target.value })} rows={8} />
        </div>
        <div>
          <Label>Plain text (opsiyonel — boşsa HTML'den çıkar)</Label>
          <Textarea value={form.body_text} onChange={(e) => setForm({ ...form, body_text: e.target.value })} rows={3} />
        </div>
        <div>
          <Label>Açıklama (admin notu)</Label>
          <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>
        <div className="flex items-center justify-between border-t pt-3">
          <Label>Aktif</Label>
          <Switch checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={saving}>İptal</Button>
        <Button onClick={submit} disabled={saving}>
          {saving && <Loader2 className="size-4 mr-2 animate-spin" />}
          Ekle
        </Button>
      </DialogFooter>
    </>
  );
}

function AddTgDialog({ onSaved, onClose }: { onSaved: () => void; onClose: () => void }) {
  const [form, setForm] = useState({
    template_key: "",
    locale: "tr" as "tr" | "en",
    body_md: "",
    audience: "staff" as "member" | "staff" | "merchant",
    description: "",
    is_active: true,
  });
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (!form.template_key || !form.body_md) {
      toast.error("Teknik anahtar ve gövde zorunlu");
      return;
    }
    setSaving(true);
    try {
      await rpc("admin_create_telegram_template", {
        _template_key: form.template_key,
        _locale: form.locale,
        _body_md: form.body_md,
        _audience: form.audience,
        _description: form.description || null,
        _is_active: form.is_active,
      });
      toast.success("Telegram şablonu eklendi");
      onSaved();
    } catch (err) {
      toast.error(translateError(err, "Eklenemedi"));
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <DialogHeader>
        <DialogTitle>Yeni Telegram Şablonu</DialogTitle>
        <DialogDescription>Staff bildirimleri için Markdown formatlı şablon.</DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Teknik anahtar *</Label>
            <Input value={form.template_key} onChange={(e) => setForm({ ...form, template_key: e.target.value })} placeholder="new_chat, pending_pcr..." />
            <p className="text-[11px] text-muted-foreground mt-1">Kullanıcıya gösterilmez; sistemin bu şablonu bulması için kullanılır.</p>
          </div>
          <div>
            <Label>Dil</Label>
            <select className="w-full h-10 border rounded-md px-3 bg-background"
              value={form.locale} onChange={(e) => setForm({ ...form, locale: e.target.value as any })}>
              <option value="tr">TR</option>
              <option value="en">EN</option>
            </select>
          </div>
        </div>
        <div>
          <Label>Hedef</Label>
          <select className="w-full h-10 border rounded-md px-3 bg-background"
            value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value as any })}>
            <option value="staff">Staff</option>
            <option value="member">Üye</option>
            <option value="merchant">Merchant</option>
          </select>
        </div>
        <div>
          <Label>Markdown Gövde *</Label>
          <Textarea value={form.body_md} onChange={(e) => setForm({ ...form, body_md: e.target.value })} rows={8}
            placeholder="*Yeni destek talebi*"/>
        </div>
        <div>
          <Label>Açıklama (admin notu)</Label>
          <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>
        <div className="flex items-center justify-between border-t pt-3">
          <Label>Aktif</Label>
          <Switch checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={saving}>İptal</Button>
        <Button onClick={submit} disabled={saving}>
          {saving && <Loader2 className="size-4 mr-2 animate-spin" />}
          Ekle
        </Button>
      </DialogFooter>
    </>
  );
}

function AddCannedDialog({ onSaved, onClose }: { onSaved: () => void; onClose: () => void }) {
  const [form, setForm] = useState({
    category: "general" as "topup_issue" | "withdraw_issue" | "profile_update" | "general",
    title: "",
    body: "",
    trigger_keywords: "",
    is_active: true,
  });
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (!form.title || !form.body) {
      toast.error("Başlık ve gövde zorunlu");
      return;
    }
    setSaving(true);
    const keywords = form.trigger_keywords
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    try {
      await rpc("admin_create_chat_canned", {
        _category: form.category,
        _title: form.title,
        _body: form.body,
        _trigger_keywords: keywords,
        _is_active: form.is_active,
      });
      toast.success("Hazır cevap eklendi");
      onSaved();
    } catch (err) {
      toast.error(translateError(err, "Eklenemedi"));
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <DialogHeader>
        <DialogTitle>Yeni Hazır Cevap</DialogTitle>
        <DialogDescription>Destek panelinde hızlı cevap olarak kullanılır + AI cevap üretirken context.</DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div>
          <Label>Kategori</Label>
          <select className="w-full h-10 border rounded-md px-3 bg-background"
            value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as any })}>
            <option value="general">Genel</option>
            <option value="topup_issue">Para yatırma</option>
            <option value="withdraw_issue">Para çekme</option>
            <option value="profile_update">Profil değişikliği</option>
          </select>
        </div>
        <div>
          <Label>Başlık *</Label>
          <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="örn: 'Havale gecikti'" />
        </div>
        <div>
          <Label>Cevap Gövdesi *</Label>
          <Textarea value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} rows={6} />
        </div>
        <div>
          <Label>Tetikleyici Kelimeler (virgülle ayır)</Label>
          <Input value={form.trigger_keywords} onChange={(e) => setForm({ ...form, trigger_keywords: e.target.value })} placeholder="havale, gecikme, geldi mi" />
        </div>
        <div className="flex items-center justify-between border-t pt-3">
          <Label>Aktif</Label>
          <Switch checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={saving}>İptal</Button>
        <Button onClick={submit} disabled={saving}>
          {saving && <Loader2 className="size-4 mr-2 animate-spin" />}
          Ekle
        </Button>
      </DialogFooter>
    </>
  );
}
