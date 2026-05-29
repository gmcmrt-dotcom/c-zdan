// Üye-yüzü Destek Chat Widget
// Floating bubble (sağ alt) + paneli açılınca:
//   - Thread listesi (üyenin açık/geçmiş talepleri)
//   - Yeni talep formu (kategori + subject + body)
//   - Thread detay (mesaj history + reply input)
//
// Hard rule #7: merchant adı / merchant_ref / external_tx_id GÖSTERİLMEZ.
// Tüm çağrılar SECURITY DEFINER RPC'ler üzerinden (chat_create_thread,
// chat_post_message). RLS direkt SELECT'e izin verir (üye kendi thread'leri).
//
// Realtime: thread açıldığında socket room'a subscribe olunur (subscribeRoom).

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { rpc } from "@/lib/rpc";
import { apiPost } from "@/lib/api";
import { dbSelect, dbSelectMaybeOne } from "@/lib/db";
import { storageUpload, storageSignedUrl, storageRemove } from "@/lib/storage";
import { subscribeRoom } from "@/lib/realtime";
import { invokeFunction } from "@/lib/fn";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MessageCircle, X, ArrowLeft, Send, Loader2, Plus, RefreshCw, Paperclip, FileText, Image as ImageIcon, Video, Trash2, ShieldAlert, ShieldCheck, ShieldQuestion, Sparkles, ThumbsUp, ThumbsDown, UserCog, Check, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtRelative } from "@/lib/format";
import { toast } from "sonner";

// Dosya upload constraints
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_MIMES = ["application/pdf", "image/png", "image/jpeg", "image/webp", "video/mp4"] as const;
const ACCEPT_ATTR = ALLOWED_MIMES.join(",");

type AttachmentDraft = {
  id: string;             // chat_attachments.id (RPC sonrası dolar)
  file_name: string;
  mime_type: string;
  file_size_bytes: number;
  storage_path: string;
  uploading: boolean;
  scanning: boolean;
  status: "uploaded" | "scanning" | "clean" | "infected" | "rejected";
};

type ChatCategory = "topup_issue" | "withdraw_issue" | "profile_update" | "general";
type ChatStatus = "open" | "pending_user" | "pending_staff" | "resolved" | "closed";

type Thread = {
  id: string;
  public_no: string;
  category: ChatCategory;
  subject: string;
  status: ChatStatus;
  last_message_at: string;
  created_at: string;
};

type Message = {
  id: string;
  thread_id: string;
  sender_role: "member" | "bot" | "staff";
  body: string;
  created_at: string;
  feedback_score: number | null;
};

type Attachment = {
  id: string;
  thread_id: string;
  message_id: string | null;
  storage_path: string;
  mime_type: string;
  file_size_bytes: number;
  file_name: string;
  status: "uploaded" | "scanning" | "clean" | "infected" | "rejected";
  created_at: string;
};

// Profile change request
type PcrField = "first_name" | "last_name";
type PcrStatus = "pending" | "approved" | "rejected";

type ProfileChangeRequest = {
  id: string;
  thread_id: string | null;
  field: PcrField;
  old_value: string | null;
  new_value: string;
  status: PcrStatus;
  rejection_reason: string | null;
  created_at: string;
  reviewed_at: string | null;
};

type View = "list" | "new" | "detail";

const STORAGE_KEY = "wallet.chat.widget.open";

export default function ChatWidget() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [open, setOpen] = useState<boolean>(() => {
    try { return localStorage.getItem(STORAGE_KEY) === "true"; } catch { return false; }
  });
  const [view, setView] = useState<View>("list");
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, String(open)); } catch {}
  }, [open]);

  // Auth yoksa widget gösterme
  if (!user) return null;

  const goNew = () => { setView("new"); setActiveThreadId(null); };
  const goList = () => { setView("list"); setActiveThreadId(null); };
  const goDetail = (threadId: string) => { setView("detail"); setActiveThreadId(threadId); };

  return (
    <>
      {/* Floating button */}
      {!open && (
        <button
          aria-label={t("member.chat.openAria")}
          onClick={() => setOpen(true)}
          className="fixed bottom-24 right-4 z-50 size-14 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center hover:scale-105 transition-transform"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          <MessageCircle className="size-6" />
        </button>
      )}

      {/* Panel */}
      {open && (
        <div
          className="fixed bottom-20 right-4 z-50 w-[min(380px,calc(100vw-2rem))] h-[min(560px,calc(100vh-7rem))] rounded-2xl bg-card border border-border shadow-2xl flex flex-col overflow-hidden"
          role="dialog"
          aria-label={t("member.chat.panelAria")}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/30">
            <div className="flex items-center gap-2 min-w-0">
              {view !== "list" && (
                <button
                  onClick={goList}
                  className="size-7 rounded-full hover:bg-muted flex items-center justify-center"
                  aria-label={t("member.chat.backAria")}
                >
                  <ArrowLeft className="size-4" />
                </button>
              )}
              <div className="text-sm font-semibold truncate">
                {view === "list"   && t("member.chat.title")}
                {view === "new"    && t("member.chat.newTitle")}
                {view === "detail" && t("member.chat.detailTitle")}
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="size-7 rounded-full hover:bg-muted flex items-center justify-center"
              aria-label={t("member.chat.closeAria")}
            >
              <X className="size-4" />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-hidden flex flex-col">
            {view === "list"   && <ChatList   onPickThread={goDetail} onNewThread={goNew} />}
            {view === "new"    && <ChatNew    onCreated={(id) => goDetail(id)} onCancel={goList} />}
            {view === "detail" && activeThreadId && <ChatDetail threadId={activeThreadId} />}
          </div>
        </div>
      )}
    </>
  );
}

// ============================================================
// LIST VIEW
// ============================================================
function ChatList({ onPickThread, onNewThread }: { onPickThread: (id: string) => void; onNewThread: () => void }) {
  const { t } = useTranslation();
  const [threads, setThreads] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const data = await dbSelect<Thread>("chat_threads", {
      cols: "id, public_no, category, subject, status, last_message_at, created_at",
      order: { col: "last_message_at", asc: false },
      limit: 50,
    }).catch(() => [] as Thread[]);
    setThreads(data);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex justify-center p-8">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        )}
        {!loading && threads.length === 0 && (
          <div className="p-6 text-center text-sm text-muted-foreground">
            {t("member.chat.empty")}
          </div>
        )}
        {!loading && threads.map((th) => (
          <button
            key={th.id}
            onClick={() => onPickThread(th.id)}
            className="w-full text-left px-4 py-3 border-b hover:bg-muted/30 flex items-start gap-2"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className={cn(
                  "size-2 rounded-full shrink-0",
                  th.status === "pending_user"  && "bg-warning",
                  th.status === "pending_staff" && "bg-info",
                  th.status === "open"          && "bg-info",
                  th.status === "resolved"      && "bg-success",
                  th.status === "closed"        && "bg-muted-foreground/40",
                )} />
                <span className="text-sm font-medium truncate">{th.subject}</span>
              </div>
              <div className="text-[10px] text-muted-foreground flex items-center gap-2 mt-0.5">
                <span>{t(`member.chat.category.${th.category}`)}</span>
                <span>·</span>
                <span>{fmtRelative(th.last_message_at)}</span>
                <span>·</span>
                <span className="font-mono">{th.public_no}</span>
              </div>
            </div>
          </button>
        ))}
      </div>
      <div className="p-3 border-t bg-muted/20 flex gap-2">
        <Button size="sm" variant="ghost" onClick={load} disabled={loading} aria-label={t("member.chat.refreshAria")}>
          <RefreshCw className={cn("size-4", loading && "animate-spin")} />
        </Button>
        <Button size="sm" onClick={onNewThread} className="flex-1">
          <Plus className="size-4 mr-1" /> {t("member.chat.newBtn")}
        </Button>
      </div>
    </div>
  );
}

// ============================================================
// NEW THREAD VIEW
// ============================================================
// Topup/Withdraw kategorisinde TX ID format kontrolü
const TX_ID_PATTERN = /^[A-Z]{1,3}-\d{8}-\d{6}$/;

function ChatNew({ onCreated, onCancel }: { onCreated: (id: string) => void; onCancel: () => void }) {
  const { t } = useTranslation();
  // default kategori 'topup_issue' (en sık karşılaşılan sorun)
  const [category, setCategory] = useState<ChatCategory>("topup_issue");
  const [subject, setSubject] = useState("");           // profile_update / general
  const [txId, setTxId] = useState("");                 // topup_issue / withdraw_issue
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  const isTxBased = category === "topup_issue" || category === "withdraw_issue";
  const expectedPrefix = category === "topup_issue" ? "T-" : category === "withdraw_issue" ? "W-" : "";

  // Kategori değişince input alanlarını sıfırla (karışmasın)
  useEffect(() => {
    setSubject("");
    setTxId("");
  }, [category]);

  const validate = (): { ok: boolean; error?: string } => {
    if (isTxBased) {
      if (!txId.trim()) return { ok: false, error: t("member.chat.txId.required") };
      if (!TX_ID_PATTERN.test(txId.trim())) return { ok: false, error: t("member.chat.txId.invalidFormat") };
      if (!txId.trim().startsWith(expectedPrefix)) {
        return { ok: false, error: t("member.chat.txId.prefixMismatch", { prefix: expectedPrefix }) };
      }
    } else {
      if (!subject.trim()) return { ok: false, error: t("member.chat.fillAll") };
    }
    if (!body.trim()) return { ok: false, error: t("member.chat.fillAll") };
    return { ok: true };
  };

  const submit = async () => {
    const v = validate();
    if (!v.ok) {
      toast.error(v.error || t("member.chat.fillAll"));
      return;
    }
    setBusy(true);
    try {
      // M1 — REST migration (Q2 Option B). Was rpc("chat_create_thread").
      // Topup/withdraw: subject = TX ID, plus related_tx_public_no parameter.
      const useTxId = isTxBased ? txId.trim().toUpperCase() : null;
      const row = await apiPost<{ thread_id: string; success?: boolean }>(
        "/chat/threads",
        {
          category,
          subject: useTxId ?? subject.trim(),
          body: body.trim(),
          relatedTxPublicNo: useTxId ?? undefined,
        },
      );
      if (!row?.thread_id) {
        toast.error(t("member.chat.createFailed"));
        return;
      }
      toast.success(t("member.chat.created"));
      onCreated(row.thread_id);
    } catch (err: any) {
      toast.error(err.message || t("member.chat.createFailed"));
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = !busy && body.trim() && (isTxBased ? txId.trim() : subject.trim());

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        <div>
          <Label className="text-xs">{t("member.chat.categoryLabel")}</Label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as ChatCategory)}
            className="w-full h-10 border rounded-md px-2 bg-background text-sm"
          >
            <option value="topup_issue">{t("member.chat.category.topup_issue")}</option>
            <option value="withdraw_issue">{t("member.chat.category.withdraw_issue")}</option>
            <option value="profile_update">{t("member.chat.category.profile_update")}</option>
            <option value="general">{t("member.chat.category.general")}</option>
          </select>
        </div>
        {isTxBased ? (
          <div>
            <Label className="text-xs">{t("member.chat.txId.label")}</Label>
            <Input
              value={txId}
              onChange={(e) => setTxId(e.target.value.toUpperCase().slice(0, 30))}
              placeholder={`${expectedPrefix}YYYYMMDD-NNNNNN`}
              maxLength={30}
              className="font-mono"
            />
            <div className="text-[10px] text-muted-foreground mt-1">
              {t("member.chat.txId.hint")}
            </div>
          </div>
        ) : (
          <div>
            <Label className="text-xs">{t("member.chat.subjectLabel")}</Label>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value.slice(0, 200))}
              placeholder={t("member.chat.subjectPlaceholder")}
              maxLength={200}
            />
          </div>
        )}
        <div>
          <Label className="text-xs">{t("member.chat.bodyLabel")}</Label>
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value.slice(0, 4000))}
            placeholder={t("member.chat.bodyPlaceholder")}
            rows={6}
            maxLength={4000}
          />
          <div className="text-[10px] text-muted-foreground text-right mt-1">{body.length}/4000</div>
        </div>
      </div>
      <div className="p-3 border-t bg-muted/20 flex gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
          {t("common.cancel")}
        </Button>
        <Button size="sm" onClick={submit} disabled={!canSubmit} className="flex-1">
          {busy ? <Loader2 className="size-4 animate-spin" /> : t("member.chat.submitBtn")}
        </Button>
      </div>
    </div>
  );
}

// ============================================================
// DETAIL VIEW
// ============================================================
function ChatDetail({ threadId }: { threadId: string }) {
  const { t } = useTranslation();
  const [thread, setThread] = useState<Thread | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [drafts, setDrafts] = useState<AttachmentDraft[]>([]);
  const [reply, setReply] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [pcrs, setPcrs] = useState<ProfileChangeRequest[]>([]);

  const load = async () => {
    setLoading(true);
    const [th, msgs, atts, prs] = await Promise.all([
      dbSelectMaybeOne<Thread>("chat_threads", {
        cols: "id, public_no, category, subject, status, last_message_at, created_at",
        where: { id: threadId },
      }).catch(() => null),
      dbSelect<Message>("chat_messages", {
        cols: "id, thread_id, sender_role, body, created_at, feedback_score",
        where: { thread_id: threadId },
        order: { col: "created_at", asc: true },
      }).catch(() => [] as Message[]),
      dbSelect<Attachment>("chat_attachments", {
        cols: "id, thread_id, message_id, storage_path, mime_type, file_size_bytes, file_name, status, created_at",
        where: { thread_id: threadId },
      }).catch(() => [] as Attachment[]),
      dbSelect<ProfileChangeRequest>("chat_profile_change_requests", {
        cols: "id, thread_id, field, old_value, new_value, status, rejection_reason, created_at, reviewed_at",
        where: { thread_id: threadId },
        order: { col: "created_at", asc: false },
      }).catch(() => [] as ProfileChangeRequest[]),
    ]);
    setThread(th);
    setMessages(msgs);
    setAttachments(atts);
    setPcrs(prs);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // P1 — match the server room name exactly. The Socket.IO server emits to
    // `chat:thread:<id>` (apps/api/src/realtime/server.ts); we were
    // subscribing to `chat:<id>` so the widget never received realtime
    // updates and silently fell back to polling.
    const unsub = subscribeRoom(`chat:thread:${threadId}`, {
      "chat:message.new":    () => load(),
      "chat:thread.updated": () => load(),
    });
    return () => unsub();
  }, [threadId]);

  // Yeni mesaj eklendiğinde alta scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";  // reset for re-pick

    // Client-side validation
    if (file.size > MAX_FILE_SIZE) {
      toast.error(t("member.chat.attachment.tooLarge"));
      return;
    }
    if (!ALLOWED_MIMES.includes(file.type as any)) {
      toast.error(t("member.chat.attachment.mimeNotAllowed"));
      return;
    }

    // Sanitize filename: alphanumeric + .-_ only, max 100
    const safeName = file.name.replace(/[^\w.\-]+/g, "_").slice(0, 100);
    const tempId = crypto.randomUUID();
    // P0-5: the server re-keys uploads under `u/{userId}/...` so callers can
    // only write into their own prefix. We send the legical path; the server
    // returns the canonical (prefixed) path which we then persist.
    const requestedPath = `${threadId}/${tempId}-${safeName}`;
    const draft: AttachmentDraft = {
      id: tempId,
      file_name: safeName,
      mime_type: file.type,
      file_size_bytes: file.size,
      storage_path: requestedPath,
      uploading: true,
      scanning: false,
      status: "uploaded",
    };
    setDrafts((prev) => [...prev, draft]);

    let storagePath = requestedPath;
    try {
      // 1) Storage upload — server returns the prefixed path we must persist.
      const uploaded = await storageUpload("chat-attachments", requestedPath, file);
      storagePath = uploaded.path;
      setDrafts((prev) =>
        prev.map((d) => (d.id === tempId ? { ...d, storage_path: storagePath } : d)),
      );

      // M1 — REST migration (Q2 Option B). Was rpc("chat_register_attachment").
      const row = await apiPost<{ attachment_id: string; success?: boolean }>(
        `/chat/threads/${threadId}/attachments`,
        {
          storagePath,
          mimeType: file.type,
          fileSize: file.size,
          fileName: safeName,
        },
      );
      if (!row?.attachment_id) {
        throw new Error("REGISTER_FAILED");
      }
      const realId = row.attachment_id;

      // 3) draft state güncelle: tempId → realId, scanning başlasın
      setDrafts((prev) => prev.map((d) =>
        d.id === tempId
          ? { ...d, id: realId, uploading: false, scanning: true }
          : d
      ));

      // 4) Native scan fn'i tetikle (fire-and-forget okay, ama biz await edelim)
      const scanData = await invokeFunction<{ status?: string }>("chat-attachment-scan", {
        attachment_id: realId,
      }).catch(() => null);
      const newStatus = scanData?.status ?? "uploaded";
      setDrafts((prev) => prev.map((d) =>
        d.id === realId
          ? { ...d, scanning: false, status: newStatus as AttachmentDraft["status"] }
          : d
      ));

      if (newStatus === "infected") {
        toast.error(t("member.chat.attachment.infected"));
        // Infected ise listeden çıkar — backend zaten storage'dan sildi
        setDrafts((prev) => prev.filter((d) => d.id !== realId));
      }
    } catch (err: any) {
      toast.error(err.message || t("member.chat.attachment.uploadFailed"));
      // Cleanup: storage'dan sil (best effort), draft'ı kaldır
      await storageRemove("chat-attachments", [storagePath]);
      setDrafts((prev) => prev.filter((d) => d.id !== tempId));
    }
  };

  const removeDraft = async (draft: AttachmentDraft) => {
    setDrafts((prev) => prev.filter((d) => d.id !== draft.id));
    // Best effort: storage'dan ve DB'den sil
    await storageRemove("chat-attachments", [draft.storage_path]);
  };

  const [aiThinking, setAiThinking] = useState(false);

  const send = async () => {
    if ((!reply.trim() && drafts.length === 0) || sending) return;
    // Hâlâ yüklenen/taranan draft varsa bekle
    const stillPending = drafts.some((d) => d.uploading || d.scanning);
    if (stillPending) {
      toast.error(t("member.chat.attachment.waitForScan"));
      return;
    }
    // Body boşsa default mesaj
    const bodyText = reply.trim() || (drafts.length > 0 ? t("member.chat.attachment.defaultBody") : "");
    setSending(true);
    try {
      // M1 — REST migration. Was rpc("chat_post_message").
      // The REST handler doesn't take `_attachment_ids`; attachments are
      // already registered against the thread by `/chat/threads/:id/attachments`
      // above, so we just post the message body here.
      await apiPost(`/chat/threads/${threadId}/messages`, {
        body: bodyText,
      });
      setReply("");
      setDrafts([]);
      await load();

      // AI auto-reply tetikle (asenkron, hata sessiz)
      // Native fn ANTHROPIC_API_KEY yoksa sessizce skip eder
      setAiThinking(true);
      try {
        await invokeFunction("chat-ai-reply", { thread_id: threadId });
        await load();  // bot cevabı geldiyse tabloyu yenile
      } catch (aiErr) {
        // AI hatası kullanıcıyı rahatsız etmesin — staff cevap verecek
        console.warn("AI reply failed (non-blocking):", aiErr);
      } finally {
        setAiThinking(false);
      }
    } catch (err: any) {
      toast.error(err.message || t("member.chat.sendFailed"));
    } finally {
      setSending(false);
    }
  };

  const setFeedback = async (messageId: string, score: 1 | -1 | 0) => {
    try {
      // M1 — REST migration. Was rpc("chat_set_message_feedback").
      const data = await apiPost<{ success: boolean; error_code?: string }>(
        `/chat/messages/${messageId}/feedback`,
        { score },
      );
      if (!data?.success) {
        toast.error(data?.error_code || t("member.chat.feedback.failed"));
        return;
      }
      // Optimistic update
      setMessages((prev) => prev.map((m) =>
        m.id === messageId ? { ...m, feedback_score: score === 0 ? null : score } : m
      ));
    } catch {
      toast.error(t("member.chat.feedback.failed"));
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const canReply = thread && thread.status !== "closed";

  // Bir mesaja ait attachment'ları getir
  const attsByMessageId = (msgId: string) => attachments.filter((a) => a.message_id === msgId);

  return (
    <div className="flex flex-col h-full">
      {thread && (
        <div className="px-4 py-2 border-b bg-muted/20 text-xs text-muted-foreground">
          <div className="font-medium text-foreground truncate">{thread.subject}</div>
          <div className="flex items-center gap-2 mt-0.5">
            <span>{t(`member.chat.category.${thread.category}`)}</span>
            <span>·</span>
            <span>{t(`member.chat.status.${thread.status}`)}</span>
            <span>·</span>
            <span className="font-mono">{thread.public_no}</span>
          </div>
        </div>
      )}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2">
        {messages.length === 0 && (
          <div className="text-center text-xs text-muted-foreground py-8">
            {t("member.chat.noMessages")}
          </div>
        )}
        {messages.map((m) => {
          const fromMember = m.sender_role === "member";
          const fromBot = m.sender_role === "bot";
          const msgAtts = attsByMessageId(m.id);
          return (
            <div
              key={m.id}
              className={cn("max-w-[85%] rounded-2xl px-3 py-2 text-sm",
                fromMember
                  ? "ml-auto bg-primary text-primary-foreground"
                  : fromBot
                    ? "mr-auto bg-info/10 border border-info/30 text-foreground"
                    : "mr-auto bg-muted text-foreground"
              )}
            >
              {fromBot && (
                <div className="flex items-center gap-1 text-[10px] font-medium text-info mb-1">
                  <Sparkles className="size-3" />
                  <span>{t("member.chat.senderRole.bot")}</span>
                </div>
              )}
              <div className="whitespace-pre-wrap break-words">{m.body}</div>
              {msgAtts.length > 0 && (
                <div className="mt-2 space-y-1">
                  {msgAtts.map((a) => (
                    <AttachmentChip key={a.id} att={a} fromMember={fromMember} />
                  ))}
                </div>
              )}
              <div className={cn("text-[10px] mt-1 flex items-center gap-2", fromMember ? "text-primary-foreground/70" : "text-muted-foreground")}>
                <span>{fmtRelative(m.created_at)}</span>
                {fromBot && (
                  <div className="flex items-center gap-0.5 ml-auto">
                    <button
                      onClick={() => setFeedback(m.id, m.feedback_score === 1 ? 0 : 1)}
                      className={cn("size-5 rounded-full hover:bg-success/15 flex items-center justify-center transition-colors",
                        m.feedback_score === 1 && "bg-success/20 text-success")}
                      aria-label={t("member.chat.feedback.helpful")}
                      title={t("member.chat.feedback.helpful")}
                    >
                      <ThumbsUp className="size-2.5" />
                    </button>
                    <button
                      onClick={() => setFeedback(m.id, m.feedback_score === -1 ? 0 : -1)}
                      className={cn("size-5 rounded-full hover:bg-destructive/15 flex items-center justify-center transition-colors",
                        m.feedback_score === -1 && "bg-destructive/20 text-destructive")}
                      aria-label={t("member.chat.feedback.notHelpful")}
                      title={t("member.chat.feedback.notHelpful")}
                    >
                      <ThumbsDown className="size-2.5" />
                    </button>
                  </div>
                )}
                {!fromMember && !fromBot && <> · {t(`member.chat.senderRole.${m.sender_role}`)}</>}
              </div>
            </div>
          );
        })}
        {aiThinking && (
          <div className="mr-auto bg-info/5 border border-info/20 rounded-2xl px-3 py-2 text-xs text-muted-foreground flex items-center gap-2 max-w-[60%]">
            <Sparkles className="size-3 text-info animate-pulse" />
            <span>{t("member.chat.aiThinking")}</span>
          </div>
        )}
      </div>
      {/* Profile change requests (sadece profile_update kategorisinde) */}
      {thread?.category === "profile_update" && (
        <ProfileChangeSection threadId={threadId} pcrs={pcrs} onChange={load} />
      )}

      {canReply ? (
        <div className="border-t bg-muted/20">
          {/* Draft attachments */}
          {drafts.length > 0 && (
            <div className="px-2 pt-2 flex flex-wrap gap-1.5">
              {drafts.map((d) => (
                <DraftChip key={d.id} draft={d} onRemove={() => removeDraft(d)} />
              ))}
            </div>
          )}
          {/* Reply input */}
          <div className="p-2 flex gap-2 items-end">
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPT_ATTR}
              className="hidden"
              onChange={handleFileSelect}
            />
            <Button
              size="icon"
              variant="ghost"
              onClick={() => fileInputRef.current?.click()}
              disabled={drafts.length >= 3}
              aria-label={t("member.chat.attachment.attachAria")}
              title={t("member.chat.attachment.attachTitle")}
            >
              <Paperclip className="size-4" />
            </Button>
            <Textarea
              value={reply}
              onChange={(e) => setReply(e.target.value.slice(0, 4000))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder={t("member.chat.replyPlaceholder")}
              rows={2}
              maxLength={4000}
              className="flex-1 min-h-[44px] resize-none"
            />
            <Button
              size="icon"
              onClick={send}
              disabled={sending || (!reply.trim() && drafts.length === 0)}
              aria-label={t("member.chat.sendAria")}
            >
              {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            </Button>
          </div>
        </div>
      ) : (
        <div className="p-3 border-t bg-muted/30 text-xs text-center text-muted-foreground">
          {t("member.chat.threadClosed")}
        </div>
      )}
    </div>
  );
}

// ============================================================
// AttachmentChip — gönderilmiş bir mesajdaki dosya
// ============================================================
function AttachmentChip({ att, fromMember }: { att: Attachment; fromMember: boolean }) {
  const { t } = useTranslation();
  const [downloading, setDownloading] = useState(false);
  const Icon = pickFileIcon(att.mime_type);

  // Infected dosya RLS ile zaten gizli (üye-yüzünde görünmez)
  // Burada sadece status badge gösteriyoruz
  const onClick = async () => {
    setDownloading(true);
    try {
      const url = await storageSignedUrl("chat-attachments", att.storage_path, 300);  // 5 dakika
      window.open(url, "_blank");
    } catch {
      toast.error(t("member.chat.attachment.openFailed"));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <button
      onClick={onClick}
      disabled={downloading}
      className={cn("w-full flex items-center gap-2 px-2 py-1.5 rounded-lg border",
        fromMember
          ? "bg-primary-foreground/10 border-primary-foreground/20 hover:bg-primary-foreground/20"
          : "bg-background hover:bg-muted/50"
      )}
    >
      <Icon className={cn("size-4 shrink-0", fromMember ? "text-primary-foreground/80" : "text-muted-foreground")} />
      <div className="flex-1 min-w-0 text-left">
        <div className="text-xs truncate">{att.file_name}</div>
        <div className={cn("text-[10px] flex items-center gap-1", fromMember ? "text-primary-foreground/60" : "text-muted-foreground")}>
          <span>{formatFileSize(att.file_size_bytes)}</span>
          {att.status === "scanning" && (
            <><span>·</span><ShieldQuestion className="size-2.5" /><span>{t("member.chat.attachment.scanning")}</span></>
          )}
          {att.status === "clean" && (
            <><span>·</span><ShieldCheck className="size-2.5" /></>
          )}
          {att.status === "uploaded" && (
            <><span>·</span><ShieldQuestion className="size-2.5" /><span>{t("member.chat.attachment.unscanned")}</span></>
          )}
        </div>
      </div>
      {downloading && <Loader2 className="size-3 animate-spin" />}
    </button>
  );
}

// ============================================================
// DraftChip — henüz gönderilmemiş, upload/scan aşamasındaki dosya
// ============================================================
function DraftChip({ draft, onRemove }: { draft: AttachmentDraft; onRemove: () => void }) {
  const { t } = useTranslation();
  const Icon = pickFileIcon(draft.mime_type);
  return (
    <div className={cn(
      "flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-full text-[11px] border",
      draft.status === "infected" ? "bg-destructive/10 border-destructive/30" : "bg-muted",
    )}>
      <Icon className="size-3 shrink-0" />
      <span className="max-w-[120px] truncate">{draft.file_name}</span>
      {draft.uploading && <><Loader2 className="size-3 animate-spin" /><span>{t("member.chat.attachment.uploading")}</span></>}
      {!draft.uploading && draft.scanning && <><Loader2 className="size-3 animate-spin" /><span>{t("member.chat.attachment.scanning")}</span></>}
      {!draft.uploading && !draft.scanning && draft.status === "clean" && <ShieldCheck className="size-3 text-success" />}
      {!draft.uploading && !draft.scanning && draft.status === "uploaded" && <ShieldQuestion className="size-3 text-muted-foreground" />}
      {!draft.uploading && !draft.scanning && draft.status === "infected" && <ShieldAlert className="size-3 text-destructive" />}
      <button
        onClick={onRemove}
        className="size-5 rounded-full hover:bg-background/50 flex items-center justify-center"
        aria-label={t("member.chat.attachment.removeAria")}
      >
        <X className="size-3" />
      </button>
    </div>
  );
}

function pickFileIcon(mime: string) {
  if (mime.startsWith("image/")) return ImageIcon;
  if (mime.startsWith("video/")) return Video;
  return FileText;
}

// ============================================================
// ProfileChangeSection — member-facing profile change request panel.
// profile_update kategorili thread'de gösterilir.
// Mevcut PCR'ları listeler + yeni talep formu açar.
// ============================================================
function ProfileChangeSection({
  threadId,
  pcrs,
  onChange,
}: {
  threadId: string;
  pcrs: ProfileChangeRequest[];
  onChange: () => void;
}) {
  const { t } = useTranslation();
  const [showForm, setShowForm] = useState(false);
  const [field, setField] = useState<PcrField>("first_name");
  const [newValue, setNewValue] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!newValue.trim()) {
      toast.error(t("member.chat.profileChange.fillValue"));
      return;
    }
    setSubmitting(true);
    try {
      // M1 — REST migration. Was rpc("chat_create_profile_change_request").
      // I3 — Route schema is restricted to first_name/last_name only;
      // email/phone go through /api/auth/profile-change-otp.
      await apiPost(`/chat/threads/${threadId}/profile-change-request`, {
        field,
        newValue: newValue.trim(),
      });
      toast.success(t("member.chat.profileChange.created"));
      setShowForm(false);
      setNewValue("");
      onChange();
    } catch (err: any) {
      toast.error(err?.code || err?.message || t("member.chat.profileChange.createFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  const fieldLabel = (f: PcrField) =>
    f === "first_name" ? t("member.chat.profileChange.field.first_name")
                       : t("member.chat.profileChange.field.last_name");

  return (
    <div className="border-t bg-info/5 px-3 py-2">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5 text-xs font-medium">
          <UserCog className="size-3.5 text-info" />
          <span>{t("member.chat.profileChange.title")}</span>
        </div>
        {!showForm && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-[11px] px-2"
            onClick={() => setShowForm(true)}
          >
            <Plus className="size-3 mr-1" />
            {t("member.chat.profileChange.newBtn")}
          </Button>
        )}
      </div>

      {/* PCR listesi */}
      {pcrs.length > 0 && (
        <div className="space-y-1 mb-1.5">
          {pcrs.map((p) => (
            <div
              key={p.id}
              className={cn("text-[11px] px-2 py-1 rounded border flex items-center gap-2",
                p.status === "pending"  && "bg-warning/10 border-warning/30",
                p.status === "approved" && "bg-success/10 border-success/30",
                p.status === "rejected" && "bg-destructive/10 border-destructive/30",
              )}
            >
              {p.status === "pending"  && <Loader2 className="size-2.5 animate-spin shrink-0" />}
              {p.status === "approved" && <Check className="size-2.5 text-success shrink-0" />}
              {p.status === "rejected" && <XCircle className="size-2.5 text-destructive shrink-0" />}
              <span className="truncate">
                <span className="font-medium">{fieldLabel(p.field)}:</span>{" "}
                <span className="text-muted-foreground">{p.old_value || "—"}</span>{" → "}
                <span className="font-medium">{p.new_value}</span>
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Form */}
      {showForm && (
        <div className="bg-background/80 rounded-lg p-2 space-y-1.5">
          <div className="flex gap-1.5">
            <select
              value={field}
              onChange={(e) => setField(e.target.value as PcrField)}
              className="flex-1 h-8 border rounded-md px-2 text-xs bg-background"
              disabled={submitting}
            >
              <option value="first_name">{t("member.chat.profileChange.field.first_name")}</option>
              <option value="last_name">{t("member.chat.profileChange.field.last_name")}</option>
            </select>
            <Input
              value={newValue}
              onChange={(e) => setNewValue(e.target.value.slice(0, 100))}
              placeholder={t("member.chat.profileChange.newValuePlaceholder")}
              className="flex-1 h-8 text-xs"
              maxLength={100}
              disabled={submitting}
            />
          </div>
          <div className="flex gap-1.5">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-[11px] flex-1"
              onClick={() => { setShowForm(false); setNewValue(""); }}
              disabled={submitting}
            >
              {t("common.cancel")}
            </Button>
            <Button
              size="sm"
              className="h-7 text-[11px] flex-1"
              onClick={submit}
              disabled={submitting || !newValue.trim()}
            >
              {submitting ? <Loader2 className="size-3 animate-spin" /> : t("member.chat.profileChange.submitBtn")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
