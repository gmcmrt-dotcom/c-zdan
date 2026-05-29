// Admin/Staff Destek Inbox
// Solda thread listesi (filter: status, category), sağda thread detay + reply.
//
// Staff (admin/accounting/support) tüm thread'leri görür.
// Claim: bir staff "üstlenir" — başka staff'lar görür ama claim eden cevap verir.
// Status flow: open → pending_staff → pending_user → resolved (üye reopen edebilir) → closed
//
// TG entegrasyonu Faz 5'te eklenecek (env flag arkasında pasif).
// Hazır cevap kalıpları (chat_canned_responses) Faz 1.5'te yönetim arayüzü
// ekstra sayfa olarak gelecek; şimdilik sadece RPC'den çağrılabilir.

import AdminLayout from "@/components/AdminLayout";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { rpc } from "@/lib/rpc";
import { apiPost } from "@/lib/api";
import { dbSelect } from "@/lib/db";
import { storageSignedUrl } from "@/lib/storage";
import { subscribeRoom } from "@/lib/realtime";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { fmtRelative, fmtDate } from "@/lib/format";
import { maskEmail, sensitiveText } from "@/lib/mask";
import { useAuth } from "@/hooks/useAuth";
import {
  Send,
  Loader2,
  RefreshCw,
  CheckCircle2,
  XCircle,
  UserCheck,
  MessageSquare,
  FileText,
  Image as ImageIcon,
  Video,
  ShieldCheck,
  ShieldAlert,
  ShieldQuestion,
  Download,
  UserCog,
  Check,
  Search,
  X,
  ExternalLink,
  Sparkles,
  Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { translateError } from "@/lib/i18n-errors";
import { TxIdBadge } from "@/components/TxIdBadge";
import { Can } from "@/components/Can";

type ChatCategory = "topup_issue" | "withdraw_issue" | "profile_update" | "general";
type ChatStatus = "open" | "pending_user" | "pending_staff" | "resolved" | "closed";

type ProfileSnippet = {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  member_no?: string;
};

type Thread = {
  id: string;
  public_no: string;
  user_id: string;
  category: ChatCategory;
  subject: string;
  status: ChatStatus;
  related_tx_public_no: string | null;
  claimed_by_staff_id: string | null;
  claimed_at: string | null;
  last_message_at: string | null;
  created_at: string;
  resolved_at: string | null;
  closed_at: string | null;
  profile?: ProfileSnippet | null;
  claimedStaff?: ProfileSnippet | null;
};

type CannedResponse = {
  id: string;
  title: string;
  body: string;
};

type Message = {
  id: string;
  sender_role: "member" | "bot" | "staff";
  sender_user_id: string | null;
  body: string;
  created_at: string;
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
};

type PcrField = "first_name" | "last_name";
type PcrStatus = "pending" | "approved" | "rejected";
type ProfileChangeRequest = {
  id: string;
  thread_id: string | null;
  user_id: string;
  field: PcrField;
  old_value: string | null;
  new_value: string;
  status: PcrStatus;
  rejection_reason: string | null;
  created_at: string;
  reviewed_at: string | null;
  reviewed_by_staff_id: string | null;
};

const CATEGORY_LABEL: Record<ChatCategory, string> = {
  topup_issue:    "Para yatırma",
  withdraw_issue: "Para çekme",
  profile_update: "Profil düzeltme",
  general:        "Genel",
};

const STATUS_LABEL: Record<ChatStatus, string> = {
  open: "Açık",
  pending_staff: "Bekliyor (biz)",
  pending_user: "Üyede",
  resolved: "Çözüldü",
  closed: "Kapalı",
};

const PENDING_STATUSES: ChatStatus[] = ["open", "pending_staff"];
const ALL_STATUSES: ChatStatus[] = ["open", "pending_staff", "pending_user", "resolved", "closed"];
const THREAD_PAGE_SIZE = 50;
/** Realtime birincil; aralık yalnızca kaçan event fallback */
const LIST_POLL_MS = 60_000;
const DETAIL_POLL_MS = 60_000;

const STATUS_COLOR: Record<ChatStatus, string> = {
  open:           "bg-info/15 text-info",
  pending_staff:  "bg-warning/15 text-warning",
  pending_user:   "bg-info/15 text-info",
  resolved:       "bg-success/15 text-success",
  closed:         "bg-muted text-muted-foreground",
};

function toastRpcError(code: string | undefined | null, fallback: string) {
  toast({ title: translateError(code ?? undefined, fallback), variant: "destructive" as const });
}

function profileDisplayName(p?: ProfileSnippet | null, fallback = "—") {
  if (!p) return fallback;
  const name = `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim();
  return name || p.email || fallback;
}

function threadActivityAt(t: Pick<Thread, "last_message_at" | "created_at">): string {
  return t.last_message_at ?? t.created_at;
}

function threadActivityMs(t: Pick<Thread, "last_message_at" | "created_at">): number {
  const ms = new Date(threadActivityAt(t)).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

async function fetchProfileMap(ids: string[]): Promise<Map<string, ProfileSnippet>> {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (!unique.length) return new Map();
  const data = await dbSelect<ProfileSnippet>("profiles", {
    cols: "id, first_name, last_name, email, member_no",
    where: [{ col: "id", op: "in", val: unique }],
  });
  return new Map(data.map((p) => [p.id, p]));
}

export default function AdminChat() {
  const { user, can } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const userFilter = searchParams.get("user")?.trim() || null;
  const [threads, setThreads] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const [statusFilter, setStatusFilter] = useState<ChatStatus[]>([...PENDING_STATUSES]);
  const [categoryFilter, setCategoryFilter] = useState<ChatCategory[]>([]);
  const [listLimit, setListLimit] = useState(THREAD_PAGE_SIZE);
  const [hasMoreThreads, setHasMoreThreads] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [tabVisible, setTabVisible] = useState(() => typeof document === "undefined" || !document.hidden);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) {
      setLoading(true);
      setLoadError(null);
    }
    try {
      const list = await dbSelect<Thread>("chat_threads", {
        cols: "id, public_no, user_id, category, subject, status, related_tx_public_no, claimed_by_staff_id, claimed_at, last_message_at, created_at, resolved_at, closed_at",
        order: { col: "last_message_at", asc: false },
        limit: listLimit,
      });
      setHasMoreThreads(list.length >= listLimit);

      const profileIds = [
        ...list.map((t) => t.user_id),
        ...list.map((t) => t.claimed_by_staff_id).filter((id): id is string => Boolean(id)),
      ];
      const pmap = await fetchProfileMap(profileIds);
      setThreads(
        list.map((t) => ({
          ...t,
          profile: pmap.get(t.user_id) ?? null,
          claimedStaff: t.claimed_by_staff_id ? pmap.get(t.claimed_by_staff_id) ?? null : null,
        })),
      );
    } catch (err: unknown) {
      if (!opts?.silent) {
        setLoadError(err instanceof Error ? err.message : "Destek talepleri yüklenemedi");
        setThreads([]);
      }
    } finally {
      if (!opts?.silent) setLoading(false);
      setLoadingMore(false);
    }
  }, [listLimit]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const onVisibility = () => setTabVisible(!document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  useEffect(() => {
    if (!tabVisible) return;
    const timer = window.setInterval(() => load({ silent: true }), LIST_POLL_MS);
    return () => window.clearInterval(timer);
  }, [tabVisible, load]);

  useEffect(() => {
    if (!tabVisible) return;
    const unsub = subscribeRoom("chat:staff", {
      "chat:list.changed": () => { void load({ silent: true }); },
      "chat:thread.updated": () => { void load({ silent: true }); },
    });
    return () => unsub();
  }, [tabVisible, load]);

  const loadMoreThreads = () => {
    setLoadingMore(true);
    setListLimit((prev) => prev + THREAD_PAGE_SIZE);
  };

  useEffect(() => {
    if (userFilter) {
      setStatusFilter([]);
      setCategoryFilter([]);
    }
  }, [userFilter]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return threads.filter((t) => {
      if (userFilter && t.user_id !== userFilter) return false;
      if (statusFilter.length > 0 && !statusFilter.includes(t.status)) return false;
      if (categoryFilter.length > 0 && !categoryFilter.includes(t.category)) return false;
      if (!q) return true;
      const name = `${t.profile?.first_name ?? ""} ${t.profile?.last_name ?? ""}`.toLowerCase();
      const haystack = [
        t.public_no,
        t.subject,
        t.related_tx_public_no ?? "",
        t.profile?.email ?? "",
        t.profile?.member_no ?? "",
        name,
        CATEGORY_LABEL[t.category],
        STATUS_LABEL[t.status],
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [threads, statusFilter, categoryFilter, userFilter, searchQuery]);

  const clearMemberFilter = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("user");
    setSearchParams(next, { replace: true });
  };

  const pendingPresetActive =
    statusFilter.length === PENDING_STATUSES.length &&
    PENDING_STATUSES.every((s) => statusFilter.includes(s));
  const allPresetActive = statusFilter.length === ALL_STATUSES.length;

  const memberFilterProfile = userFilter
    ? threads.find((t) => t.user_id === userFilter)?.profile
    : null;

  const active = threads.find(t => t.id === activeId) ?? null;

  useEffect(() => {
    if (!userFilter || threads.length === 0) return;
    const match = threads
      .filter((t) => t.user_id === userFilter)
      .sort((a, b) => threadActivityMs(b) - threadActivityMs(a))[0];
    if (match) setActiveId(match.id);
  }, [userFilter, threads]);

  const toggleStatus = (s: ChatStatus) =>
    setStatusFilter(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);
  const toggleCategory = (c: ChatCategory) =>
    setCategoryFilter(prev => prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c]);

  const refreshThreads = useCallback(() => load({ silent: true }), [load]);

  return (
    <AdminLayout title="Destek Talepleri" requireAny={["chat:view", "chat:reply"]}>
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,400px)_1fr] gap-4 min-h-[20rem] lg:h-[calc(100dvh-12rem)]">
        {/* Sol: Thread listesi */}
        <Card className="flex flex-col overflow-hidden">
          {/* Filter bar */}
          <div className="p-3 border-b space-y-2">
            {userFilter && (
              <div className="flex items-start justify-between gap-2 rounded-md bg-info/10 border border-info/20 px-2 py-1.5 text-xs">
                <span className="text-foreground">
                  Üye filtresi:{" "}
                  <span className="font-medium">
                    {memberFilterProfile
                      ? (`${memberFilterProfile.first_name} ${memberFilterProfile.last_name}`.trim() ||
                          sensitiveText(can, "members", "pii:view_full", memberFilterProfile.email, maskEmail))
                      : "Seçili üye"}
                  </span>
                  {memberFilterProfile?.member_no && (
                    <span className="text-muted-foreground"> · {memberFilterProfile.member_no}</span>
                  )}
                </span>
                <Button type="button" size="sm" variant="ghost" className="h-6 px-1.5 shrink-0" onClick={clearMemberFilter}>
                  <X className="size-3" />
                </Button>
              </div>
            )}

            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Ara: CHT-, işlem no, üye, konu…"
                className="h-8 pl-8 text-xs"
              />
            </div>

            <div className="flex items-center justify-between gap-2">
              <div className="flex gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant={pendingPresetActive ? "default" : "outline"}
                  className="h-7 text-[10px] px-2"
                  onClick={() => setStatusFilter([...PENDING_STATUSES])}
                >
                  Bekleyen
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={allPresetActive ? "default" : "outline"}
                  className="h-7 text-[10px] px-2"
                  onClick={() => setStatusFilter([...ALL_STATUSES])}
                >
                  Tümü
                </Button>
              </div>
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => load()} disabled={loading} title="Yenile">
                <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
              </Button>
            </div>

            <div className="text-[10px] text-muted-foreground">
              {loading
                ? "Yükleniyor…"
                : `${filtered.length} gösteriliyor${hasMoreThreads ? ` · son ${listLimit} kayıt` : ""}`}
            </div>

            <div className="text-xs font-semibold text-muted-foreground">Durum</div>
            <div className="flex flex-wrap gap-1">
              {(Object.keys(STATUS_LABEL) as ChatStatus[]).map(s => (
                <button
                  key={s}
                  onClick={() => toggleStatus(s)}
                  className={cn("text-[10px] px-2 py-1 rounded-md transition",
                    statusFilter.includes(s)
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted hover:bg-muted/70 text-muted-foreground"
                  )}
                >
                  {STATUS_LABEL[s]}
                </button>
              ))}
            </div>
            <div className="text-xs font-semibold text-muted-foreground pt-1">Kategori</div>
            <div className="flex flex-wrap gap-1">
              {(Object.keys(CATEGORY_LABEL) as ChatCategory[]).map(c => (
                <button
                  key={c}
                  onClick={() => toggleCategory(c)}
                  className={cn("text-[10px] px-2 py-1 rounded-md transition",
                    categoryFilter.includes(c)
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted hover:bg-muted/70 text-muted-foreground"
                  )}
                >
                  {CATEGORY_LABEL[c]}
                </button>
              ))}
            </div>
          </div>

          {/* Thread list */}
          <div className="flex-1 overflow-y-auto">
            {loading && (
              <div className="flex justify-center p-6"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
            )}
            {!loading && filtered.length === 0 && (
              <div className="p-6 text-center text-sm text-muted-foreground">
                {loadError ? `Talepler yüklenemedi: ${loadError}` : "Filtreyle eşleşen talep yok."}
              </div>
            )}
            {!loading && filtered.map(t => (
              <button
                key={t.id}
                onClick={() => setActiveId(t.id)}
                className={cn(
                  "w-full text-left px-3 py-2.5 border-b hover:bg-muted/30 transition",
                  activeId === t.id && "bg-muted/40"
                )}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-medium", STATUS_COLOR[t.status])}>
                    {STATUS_LABEL[t.status]}
                  </span>
                  <span className="text-[10px] text-muted-foreground">{CATEGORY_LABEL[t.category]}</span>
                  {t.claimedStaff && (
                    <span className="text-[10px] text-primary truncate max-w-[120px]" title={profileDisplayName(t.claimedStaff)}>
                      · {profileDisplayName(t.claimedStaff, "Staff")}
                    </span>
                  )}
                  {t.claimed_by_staff_id && !t.claimedStaff && (
                    <UserCheck className="size-3 text-primary shrink-0" />
                  )}
                </div>
                <div className="text-sm font-medium truncate">{t.subject}</div>
                <div className="text-[11px] text-muted-foreground truncate">
                  {t.profile?.first_name} {t.profile?.last_name}
                  {t.profile?.member_no && ` · ${t.profile.member_no}`}
                </div>
                <div className="text-[10px] text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
                  <span className="font-mono">{t.public_no}</span>
                  {t.related_tx_public_no && <TxIdBadge publicNo={t.related_tx_public_no} className="text-[10px]" />}
                  <span>{fmtRelative(threadActivityAt(t))}</span>
                </div>
              </button>
            ))}
            {!loading && hasMoreThreads && (
              <div className="p-2 border-t">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full text-xs"
                  onClick={loadMoreThreads}
                  disabled={loadingMore}
                >
                  {loadingMore ? <Loader2 className="size-3.5 animate-spin mr-1" /> : null}
                  Daha fazla yükle
                </Button>
              </div>
            )}
          </div>
        </Card>

        {/* Sağ: Thread detay */}
        <Card className="flex flex-col overflow-hidden">
          {active ? (
            <ThreadDetail
              thread={active}
              currentStaffId={user?.id ?? null}
              pollEnabled={tabVisible}
              onChange={refreshThreads}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
              <div className="text-center">
                <MessageSquare className="size-12 mx-auto mb-2 text-muted-foreground/30" />
                <p>Sol taraftan bir talep seç</p>
              </div>
            </div>
          )}
        </Card>
      </div>
    </AdminLayout>
  );
}

// ============================================================
// Thread Detail Panel
// ============================================================
function ThreadDetail({
  thread,
  currentStaffId,
  onChange,
  pollEnabled,
}: {
  thread: Thread;
  currentStaffId: string | null;
  onChange: () => void;
  pollEnabled: boolean;
}) {
  const { can } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [reply, setReply] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const messageCountRef = useRef(0);

  const [pcrs, setPcrs] = useState<ProfileChangeRequest[]>([]);
  const [canned, setCanned] = useState<CannedResponse[]>([]);
  const [cannedId, setCannedId] = useState<string | null>(null);
  const [staffNames, setStaffNames] = useState<Map<string, string>>(new Map());
  const [unclaimedConfirmOpen, setUnclaimedConfirmOpen] = useState(false);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    const el = scrollRef.current;
    const wasAtBottom = el ? el.scrollHeight - el.scrollTop - el.clientHeight < 80 : true;
    const prevCount = messageCountRef.current;
    if (!opts?.silent) setLoading(true);

    const [msgs, atts, prs] = await Promise.all([
      dbSelect<Message>("chat_messages", {
        cols: "id, sender_role, sender_user_id, body, created_at",
        where: { thread_id: thread.id },
        order: { col: "created_at", asc: true },
      }).catch(() => [] as Message[]),
      dbSelect<Attachment>("chat_attachments", {
        cols: "id, thread_id, message_id, storage_path, mime_type, file_size_bytes, file_name, status",
        where: { thread_id: thread.id },
      }).catch(() => [] as Attachment[]),
      dbSelect<ProfileChangeRequest>("chat_profile_change_requests", {
        cols: "id, thread_id, user_id, field, old_value, new_value, status, rejection_reason, created_at, reviewed_at, reviewed_by_staff_id",
        where: { thread_id: thread.id },
        order: { col: "created_at", asc: false },
      }).catch(() => [] as ProfileChangeRequest[]),
    ]);
    messageCountRef.current = msgs.length;
    setMessages(msgs);
    setAttachments(atts);
    setPcrs(prs);

    const staffIds = msgs
      .filter((m) => m.sender_role === "staff" && m.sender_user_id)
      .map((m) => m.sender_user_id as string);
    if (thread.claimed_by_staff_id) staffIds.push(thread.claimed_by_staff_id);
    const staffMap = await fetchProfileMap(staffIds);
    setStaffNames(
      new Map([...staffMap.entries()].map(([id, p]) => [id, profileDisplayName(p, "Staff")])),
    );
    if (!opts?.silent) setLoading(false);
    else if (wasAtBottom && msgs.length > prevCount) {
      requestAnimationFrame(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      });
    }
  }, [thread.id, thread.claimed_by_staff_id]);

  useEffect(() => {
    load();
    if (!pollEnabled) return;
    const timer = window.setInterval(() => load({ silent: true }), DETAIL_POLL_MS);
    return () => window.clearInterval(timer);
  }, [thread.id, pollEnabled, load]);

  useEffect(() => {
    if (!pollEnabled) return;
    const unsub = subscribeRoom(`chat:thread:${thread.id}`, {
      "chat:message.new":   () => { void load({ silent: true }); },
      "chat:thread.updated": () => { onChange(); void load({ silent: true }); },
      "chat:pcr.changed":   () => { void load({ silent: true }); },
    });
    return () => unsub();
  }, [thread.id, pollEnabled, load, onChange]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [thread.id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const data = await dbSelect<CannedResponse>("chat_canned_responses", {
        cols: "id, title, body",
        where: { category: thread.category, is_active: true },
        order: { col: "title", asc: true },
      }).catch(() => [] as CannedResponse[]);
      if (!cancelled) setCanned(data);
    })();
    return () => { cancelled = true; };
  }, [thread.category]);

  const applyCanned = (c: CannedResponse) => {
    setReply(c.body);
    setCannedId(c.id);
  };

  const claim = async () => {
    setBusy(true);
    try {
      // M1 — REST migration (Q2 Option B). Was rpc("chat_claim_thread").
      await apiPost(`/chat/staff/threads/${thread.id}/claim`, {});
      toast({ title: "Talep üstlenildi" });
      onChange();
    } catch (err) {
      toastRpcError(err instanceof Error ? err.message : undefined, "Üstlenilemedi");
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (next: ChatStatus) => {
    setBusy(true);
    try {
      // M1 — REST migration. Was rpc("chat_set_thread_status").
      await apiPost(`/chat/staff/threads/${thread.id}/status`, { status: next });
      toast({ title: `Durum: ${STATUS_LABEL[next]}` });
      onChange();
    } catch (err) {
      toastRpcError(err instanceof Error ? err.message : undefined, "Durum değiştirilemedi");
    } finally {
      setBusy(false);
    }
  };

  const doSend = async () => {
    if (!reply.trim() || sending) return;
    setSending(true);
    try {
      // M1 — REST migration. Was rpc("chat_post_message"). The staff
      // route is `/chat/staff/threads/:id/messages` (separate gate).
      await apiPost(`/chat/staff/threads/${thread.id}/messages`, {
        body: reply.trim(),
        cannedResponseId: cannedId ?? undefined,
      });
      setReply("");
      setCannedId(null);
      await load();
      onChange();
    } catch (err: unknown) {
      toastRpcError(err instanceof Error ? err.message : undefined, "Gönderilemedi");
    } finally {
      setSending(false);
    }
  };

  const send = () => {
    if (!reply.trim() || sending) return;
    if (isClaimable) {
      setUnclaimedConfirmOpen(true);
      return;
    }
    void doSend();
  };

  const isClaimedByMe = thread.claimed_by_staff_id === currentStaffId;
  const isClaimable = !thread.claimed_by_staff_id;
  const isClaimedByOther = Boolean(thread.claimed_by_staff_id && !isClaimedByMe);
  const canReply = thread.status !== "closed";
  const claimedStaffName = profileDisplayName(thread.claimedStaff, "Staff");

  return (
    <>
      {/* Header */}
      <div className="px-4 py-3 border-b bg-muted/20">
        <div className="flex items-center justify-between gap-2 mb-1">
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate">{thread.subject}</div>
            <div className="text-[11px] text-muted-foreground flex items-center gap-2 mt-0.5">
              <span className={cn("px-1.5 py-0.5 rounded font-medium", STATUS_COLOR[thread.status])}>
                {STATUS_LABEL[thread.status]}
              </span>
              <span>{CATEGORY_LABEL[thread.category]}</span>
              <span>·</span>
              <span className="font-mono">{thread.public_no}</span>
            </div>
            <div className="text-[11px] text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-medium text-foreground">
                {thread.profile?.first_name} {thread.profile?.last_name}
              </span>
              {thread.profile?.email && (
                <span>
                  {sensitiveText(can, "members", "pii:view_full", thread.profile.email, maskEmail)}
                </span>
              )}
              {thread.profile?.member_no && <span>{thread.profile.member_no}</span>}
              <span>· oluşturuldu {fmtDate(thread.created_at)}</span>
              <Link
                to={`/admin/members/${thread.user_id}`}
                className="inline-flex items-center gap-0.5 text-primary hover:underline"
              >
                Üye detayı <ExternalLink className="size-3" />
              </Link>
              {thread.related_tx_public_no && (
                <Link
                  to={`/admin/transactions?public_no=${encodeURIComponent(thread.related_tx_public_no)}`}
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                >
                  <TxIdBadge publicNo={thread.related_tx_public_no} noCopy />
                  <ExternalLink className="size-3 shrink-0" />
                </Link>
              )}
            </div>
            {thread.claimed_at && thread.claimedStaff && (
              <p className="text-[10px] text-muted-foreground mt-1">
                Üstlenen: <span className="font-medium text-foreground">{claimedStaffName}</span>
                {thread.claimed_at && <> · {fmtRelative(thread.claimed_at)}</>}
              </p>
            )}
            {isClaimedByOther && (
              <p className="text-[10px] text-warning mt-1">Bu talebi {claimedStaffName} üstlendi.</p>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-1 mt-2">
          {isClaimable && (
            <Button size="sm" variant="outline" onClick={claim} disabled={busy}>
              <UserCheck className="size-3 mr-1" /> Üstlen
            </Button>
          )}
          {isClaimedByMe && thread.status !== "resolved" && (
            <Button size="sm" variant="outline" onClick={() => setStatus("resolved")} disabled={busy}>
              <CheckCircle2 className="size-3 mr-1" /> Çözüldü işaretle
            </Button>
          )}
          {thread.status !== "closed" && (
            <Button size="sm" variant="ghost" onClick={() => setStatus("closed")} disabled={busy}>
              <XCircle className="size-3 mr-1" /> Kapat
            </Button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-2">
        {loading && (
          <div className="flex justify-center p-6"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
        )}
        {!loading && messages.map(m => {
          const fromStaff = m.sender_role === "staff";
          const fromBot = m.sender_role === "bot";
          const msgAtts = attachments.filter(a => a.message_id === m.id);
          return (
            <div
              key={m.id}
              className={cn(
                "max-w-[80%] rounded-2xl px-3 py-2 text-sm",
                fromStaff && "ml-auto bg-primary text-primary-foreground",
                m.sender_role === "member" && "mr-auto bg-muted",
                fromBot && "mr-auto bg-info/10 border border-info/20 text-foreground",
              )}
            >
              {fromBot && (
                <div className="flex items-center gap-1 text-[10px] font-medium text-info mb-1">
                  <Sparkles className="size-3" /> Otomatik
                </div>
              )}
              <div className="whitespace-pre-wrap break-words">{m.body}</div>
              {msgAtts.length > 0 && (
                <div className="mt-2 space-y-1">
                  {msgAtts.map(a => (
                    <AdminAttachmentChip key={a.id} att={a} fromStaff={fromStaff} />
                  ))}
                </div>
              )}
              <div className={cn("text-[10px] mt-1", fromStaff ? "text-primary-foreground/70" : "text-muted-foreground")}>
                {m.sender_role === "member" && "Üye · "}
                {m.sender_role === "staff" && (
                  <>
                    {m.sender_user_id && staffNames.get(m.sender_user_id)
                      ? `${staffNames.get(m.sender_user_id)} · `
                      : "Staff · "}
                  </>
                )}
                {m.sender_role === "bot" && "Bot · "}
                {fmtRelative(m.created_at)}
              </div>
            </div>
          );
        })}
      </div>

      {/* PCR section (sadece profile_update kategorisinde) */}
      {thread.category === "profile_update" && pcrs.length > 0 && (
        <div className="border-t bg-info/5 px-4 py-2 space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs font-medium">
            <UserCog className="size-3.5 text-info" />
            <span>Profil Düzeltme Talepleri</span>
          </div>
          {pcrs.map((p) => (
            <AdminPcrCard key={p.id} pcr={p} onChange={load} />
          ))}
        </div>
      )}

      {/* Reply */}
      {canReply ? (
        <div className="p-3 border-t bg-muted/20">
          {isClaimable && (
            <div className="mb-2 rounded-md border border-warning/30 bg-warning/10 px-2 py-1.5 text-[11px] text-warning">
              Bu talep henüz üstlenilmedi. Cevap yazabilirsiniz; üstlenmek sorumluluğu netleştirir.
            </div>
          )}
          {canned.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1 max-h-20 overflow-y-auto">
              {canned.map((c) => (
                <Button
                  key={c.id}
                  type="button"
                  size="sm"
                  variant={cannedId === c.id ? "default" : "outline"}
                  className="h-7 text-[10px] px-2 max-w-[180px] truncate"
                  title={c.body}
                  onClick={() => applyCanned(c)}
                >
                  {c.title}
                </Button>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <Textarea
              value={reply}
              onChange={(e) => {
                setReply(e.target.value.slice(0, 4000));
                setCannedId(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault(); send();
                }
              }}
              placeholder="Cevap yaz... (Cmd/Ctrl+Enter ile gönder)"
              rows={3}
              maxLength={4000}
              className="flex-1 resize-none"
            />
            <Button size="icon" onClick={send} disabled={sending || !reply.trim()}>
              {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            </Button>
          </div>
          <div className="text-[10px] text-muted-foreground text-right mt-1">{reply.length}/4000</div>
        </div>
      ) : (
        <div className="p-3 border-t bg-muted/30 text-xs text-center text-muted-foreground">
          Bu talep kapatılmış. Yeni mesaj eklenemez.
        </div>
      )}

      <AlertDialog open={unclaimedConfirmOpen} onOpenChange={setUnclaimedConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Üstlenmeden cevap gönderilsin mi?</AlertDialogTitle>
            <AlertDialogDescription>
              Bu talep henüz kimseye atanmadı. Cevabınız gönderilecek; isterseniz önce &quot;Üstlen&quot; ile
              sorumluluğu üzerinize alabilirsiniz.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={sending}>Vazgeç</AlertDialogCancel>
            <AlertDialogAction
              disabled={sending}
              onClick={() => {
                setUnclaimedConfirmOpen(false);
                void doSend();
              }}
            >
              Yine de gönder
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ============================================================
// Attachment chip (admin) — staff dosyayı indirebilir, infected uyarısı görür
// ============================================================
function AdminAttachmentChip({ att, fromStaff }: { att: Attachment; fromStaff: boolean }) {
  const [downloading, setDownloading] = useState(false);
  const Icon = att.mime_type.startsWith("image/") ? ImageIcon
              : att.mime_type.startsWith("video/") ? Video
              : FileText;

  const isInfected = att.status === "infected";

  const onClick = async () => {
    if (isInfected) {
      toast({ title: "Bu dosya virüslü olarak işaretlendi, indirilemez.", variant: "destructive" as any });
      return;
    }
    setDownloading(true);
    try {
      const url = await storageSignedUrl("chat-attachments", att.storage_path, 300);
      window.open(url, "_blank");
    } catch {
      toast({ title: "Dosya açılamadı", variant: "destructive" as any });
    } finally {
      setDownloading(false);
    }
  };

  const sizeLabel = att.file_size_bytes < 1024 * 1024
    ? `${(att.file_size_bytes / 1024).toFixed(1)} KB`
    : `${(att.file_size_bytes / (1024 * 1024)).toFixed(1)} MB`;

  return (
    <button
      onClick={onClick}
      disabled={downloading}
      className={cn("w-full flex items-center gap-2 px-2 py-1.5 rounded-lg border text-left",
        isInfected
          ? "bg-destructive/10 border-destructive/40"
          : fromStaff
            ? "bg-primary-foreground/10 border-primary-foreground/20 hover:bg-primary-foreground/20"
            : "bg-background hover:bg-muted/50"
      )}
    >
      <Icon className={cn("size-4 shrink-0",
        isInfected ? "text-destructive" :
        fromStaff ? "text-primary-foreground/80" : "text-muted-foreground"
      )} />
      <div className="flex-1 min-w-0">
        <div className="text-xs truncate">{att.file_name}</div>
        <div className={cn("text-[10px] flex items-center gap-1",
          isInfected ? "text-destructive" :
          fromStaff ? "text-primary-foreground/60" : "text-muted-foreground"
        )}>
          <span>{sizeLabel}</span>
          <span>·</span>
          {att.status === "clean" && <><ShieldCheck className="size-2.5" /><span>Temiz</span></>}
          {att.status === "scanning" && <><ShieldQuestion className="size-2.5" /><span>Taranıyor</span></>}
          {att.status === "uploaded" && <><ShieldQuestion className="size-2.5" /><span>Taranmadı</span></>}
          {att.status === "infected" && <><ShieldAlert className="size-2.5" /><span>VİRÜSLÜ — açma!</span></>}
          {att.status === "rejected" && <><ShieldAlert className="size-2.5" /><span>Reddedildi</span></>}
        </div>
      </div>
      {downloading ? <Loader2 className="size-3 animate-spin" /> : !isInfected && <Download className="size-3 opacity-50" />}
    </button>
  );
}

// ============================================================
// AdminPcrCard — profile change request onay/red kartı.
// ============================================================
function AdminPcrCard({
  pcr,
  onChange,
}: {
  pcr: ProfileChangeRequest;
  onChange: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [showReject, setShowReject] = useState(false);
  const [reason, setReason] = useState("");

  const fieldLabel = pcr.field === "first_name" ? "Ad" : "Soyad";

  const approve = async () => {
    setBusy(true);
    try {
      // M1 — REST migration. Was rpc("chat_approve_profile_change_request").
      await apiPost(`/chat/staff/pcr/${pcr.id}/approve`, {});
      toast({ title: `${fieldLabel} güncellendi` });
      onChange();
    } catch (err) {
      toastRpcError(err instanceof Error ? err.message : undefined, "Onaylanamadı");
    } finally {
      setBusy(false);
    }
  };

  const reject = async () => {
    if (!reason.trim()) {
      toast({ title: "Red sebebi gerekli", variant: "destructive" as any });
      return;
    }
    setBusy(true);
    try {
      // M1 — REST migration. Was rpc("chat_reject_profile_change_request").
      await apiPost(`/chat/staff/pcr/${pcr.id}/reject`, { reason: reason.trim() });
      toast({ title: "Talep reddedildi" });
      setShowReject(false);
      setReason("");
      onChange();
    } catch (err) {
      toastRpcError(err instanceof Error ? err.message : undefined, "Reddedilemedi");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={cn("text-xs px-2 py-1.5 rounded border",
        pcr.status === "pending"  && "bg-warning/10 border-warning/30",
        pcr.status === "approved" && "bg-success/10 border-success/30",
        pcr.status === "rejected" && "bg-destructive/10 border-destructive/30",
      )}
    >
      <div className="flex items-center gap-2">
        {pcr.status === "pending"  && <Clock className="size-3 text-warning shrink-0" />}
        {pcr.status === "approved" && <Check className="size-3 text-success shrink-0" />}
        {pcr.status === "rejected" && <XCircle className="size-3 text-destructive shrink-0" />}
        <span className="flex-1 truncate">
          <span className="font-medium">{fieldLabel}:</span>{" "}
          <span className="text-muted-foreground">{pcr.old_value || "—"}</span>
          {" → "}
          <span className="font-medium">{pcr.new_value}</span>
        </span>
        {pcr.status === "pending" && !showReject && (
          <Can do="chat:approve_pcr">
            <div className="flex gap-1 shrink-0">
              <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2" onClick={approve} disabled={busy}>
                <Check className="size-3 mr-0.5 text-success" /> Onayla
              </Button>
              <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2" onClick={() => setShowReject(true)} disabled={busy}>
                <XCircle className="size-3 mr-0.5 text-destructive" /> Reddet
              </Button>
            </div>
          </Can>
        )}
      </div>

      {pcr.status === "rejected" && pcr.rejection_reason && (
        <div className="mt-1 text-[10px] text-muted-foreground italic">
          Sebep: {pcr.rejection_reason}
        </div>
      )}

      {showReject && (
        <div className="mt-1.5 flex gap-1">
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value.slice(0, 500))}
            placeholder="Red sebebi (max 500)"
            className="flex-1 h-7 text-xs"
            maxLength={500}
            disabled={busy}
          />
          <Button size="sm" variant="ghost" className="h-7 text-[10px] px-2" onClick={() => { setShowReject(false); setReason(""); }} disabled={busy}>
            Vazgeç
          </Button>
          <Button size="sm" variant="destructive" className="h-7 text-[10px] px-2" onClick={reject} disabled={busy || !reason.trim()}>
            Reddet
          </Button>
        </div>
      )}
    </div>
  );
}
