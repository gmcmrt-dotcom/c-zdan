import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Can } from "@/components/Can";
import TxIdBadge from "@/components/TxIdBadge";
import { rpc } from "@/lib/rpc";
import { dbSelect, dbSelectMaybeOne } from "@/lib/db";
import { fmtDate, fmtTRY, maskBalance, txStatusLabel, txTypeLabel } from "@/lib/format";
import { translateError } from "@/lib/i18n-errors";
import { toast } from "sonner";
import { Pencil } from "lucide-react";

type MemberProfile = {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  phone: string | null;
};

export function MemberEditBlock({
  member,
  fullPii,
  onSaved,
}: {
  member: MemberProfile;
  fullPii: boolean;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ first_name: "", last_name: "", email: "", phone: "" });
  const [busy, setBusy] = useState(false);

  const openEdit = () => {
    setForm({
      first_name: member.first_name,
      last_name: member.last_name,
      email: member.email,
      phone: member.phone ?? "",
    });
    setOpen(true);
  };

  const submit = async () => {
    setBusy(true);
    try {
      await rpc("admin_update_member_profile", {
        _user_id: member.id,
        _first_name: form.first_name.trim() || null,
        _last_name: form.last_name.trim() || null,
        _email: form.email.trim() || null,
        _phone: form.phone.trim() || null,
      });
      toast.success("Profil güncellendi");
      setOpen(false);
      onSaved();
    } catch (err) {
      toast.error(translateError(err, "Güncellenemedi"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Can do="members:update">
      <div className="pt-3 border-t flex justify-end">
        <Button size="sm" variant="outline" onClick={openEdit}>
          <Pencil className="size-4 mr-1" />
          Düzenle
        </Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Üye profilini düzenle</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div>
              <Label>Ad</Label>
              <Input value={form.first_name} onChange={(e) => setForm((f) => ({ ...f, first_name: e.target.value }))} />
            </div>
            <div>
              <Label>Soyad</Label>
              <Input value={form.last_name} onChange={(e) => setForm((f) => ({ ...f, last_name: e.target.value }))} />
            </div>
            <div>
              <Label>E-posta</Label>
              <Input value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} disabled={!fullPii} />
            </div>
            <div>
              <Label>Telefon</Label>
              <Input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} disabled={!fullPii} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Vazgeç
            </Button>
            <Button onClick={submit} disabled={busy}>
              {busy ? "Kaydediliyor…" : "Kaydet"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Can>
  );
}

type PendingAdjust =
  | { kind: "balance"; amount: number; reason: string }
  | { kind: "points"; points: number; reason: string };

export function AdminAdjustBlock({ userId, onDone }: { userId: string; onDone: () => void }) {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [points, setPoints] = useState("");
  const [pReason, setPReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingAdjust | null>(null);

  const requestBalance = () => {
    const n = Number(amount);
    if (!n) return toast.error("Tutar gerekli");
    if (!reason.trim()) return toast.error("Sebep zorunlu");
    setPending({ kind: "balance", amount: n, reason: reason.trim() });
  };

  const requestPoints = () => {
    const p = parseInt(points, 10);
    if (!p) return toast.error("Puan gerekli");
    if (!pReason.trim()) return toast.error("Sebep zorunlu");
    setPending({ kind: "points", points: p, reason: pReason.trim() });
  };

  const confirm = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      if (pending.kind === "balance") {
        await rpc("admin_adjust_balance", {
          _user_id: userId,
          _amount: pending.amount,
          _reason: pending.reason,
        });
        toast.success(`Bakiye ${pending.amount > 0 ? "yüklendi" : "düşüldü"}`);
        setAmount("");
        setReason("");
      } else {
        await rpc("admin_award_points", {
          _user_id: userId,
          _points: pending.points,
          _reason: pending.reason,
        });
        toast.success(`${pending.points} puan işlendi`);
        setPoints("");
        setPReason("");
      }
      setPending(null);
      onDone();
    } catch (err) {
      toast.error(translateError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <div className="text-xs font-semibold text-muted-foreground mb-2">BAKİYE DÜZELT</div>
        <div className="flex flex-col sm:flex-row gap-2">
          <Input type="number" step="0.01" placeholder="±Tutar" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <Input placeholder="Sebep (zorunlu)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <Button size="sm" onClick={requestBalance} disabled={busy}>
            Uygula
          </Button>
        </div>
      </div>
      <div>
        <div className="text-xs font-semibold text-muted-foreground mb-2">PUAN VER / DÜŞ</div>
        <div className="flex flex-col sm:flex-row gap-2">
          <Input type="number" placeholder="±Puan" value={points} onChange={(e) => setPoints(e.target.value)} />
          <Input placeholder="Sebep (zorunlu)" value={pReason} onChange={(e) => setPReason(e.target.value)} />
          <Button size="sm" onClick={requestPoints} disabled={busy}>
            Uygula
          </Button>
        </div>
      </div>

      <AlertDialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending?.kind === "balance" ? "Bakiye düzeltmesini onayla" : "Puan düzeltmesini onayla"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending?.kind === "balance" && (
                <>
                  <strong>{pending.amount > 0 ? "+" : ""}{pending.amount} ₺</strong> uygulanacak. Sebep: {pending.reason}
                </>
              )}
              {pending?.kind === "points" && (
                <>
                  <strong>{pending.points > 0 ? "+" : ""}{pending.points} puan</strong> uygulanacak. Sebep: {pending.reason}
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Vazgeç</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={confirm}>
              {busy ? "İşleniyor…" : "Onayla"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function RecentTxPreview({
  rows,
  onViewAll,
}: {
  rows: { id: string; type: string; amount: number; created_at: string; public_no?: string | null }[];
  onViewAll: () => void;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="pt-3 border-t space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Son işlemler</span>
        <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={onViewAll}>
          Tümünü gör
        </Button>
      </div>
      <ul className="space-y-1.5">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-2 text-sm">
            <span className="truncate">
              <Badge variant="outline" className="mr-1.5 font-normal">{txTypeLabel(r.type)}</Badge>
              {r.public_no ? <span className="font-mono text-xs text-muted-foreground ml-1">{r.public_no}</span> : null}
            </span>
            <span className="tabular-nums shrink-0 text-xs">{fmtTRY(Math.abs(Number(r.amount)))}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SessionsTab({ userId, canFullBalance }: { userId: string; canFullBalance: boolean }) {
  const [topups, setTopups] = useState<any[]>([]);
  const [withdraws, setWithdraws] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      dbSelect<{ id: string; public_no: string | null; amount: number; status: string; created_at: string }>("topup_sessions", {
        cols: "id, public_no, amount, status, created_at",
        where: [
          { col: "user_id", op: "eq", val: userId },
          { col: "status", op: "in", val: ["pending", "awaiting_member_action", "member_confirmed", "redirected", "sent_to_merchant"] },
        ],
        order: { col: "created_at", asc: false },
        limit: 20,
      }).catch(() => []),
      dbSelect<{ id: string; public_no: string | null; amount: number; status: string; created_at: string }>("withdraw_sessions", {
        cols: "id, public_no, amount, status, created_at",
        where: [
          { col: "user_id", op: "eq", val: userId },
          { col: "status", op: "in", val: ["pending", "sent_to_merchant"] },
        ],
        order: { col: "created_at", asc: false },
        limit: 20,
      }).catch(() => []),
    ]).then(([t, w]) => {
      setTopups(t);
      setWithdraws(w);
      setLoading(false);
    });
  }, [userId]);

  if (loading) return <div className="text-sm text-muted-foreground">Yükleniyor…</div>;

  const SessionTable = ({ title, rows }: { title: string; rows: any[] }) => (
    <Card className="overflow-hidden">
      <div className="px-4 py-2 text-sm font-medium border-b bg-muted/30">{title}</div>
      {rows.length === 0 ? (
        <div className="p-4 text-xs text-muted-foreground">Kayıt yok</div>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-muted-foreground bg-muted/50">
            <tr>
              <th className="text-left p-2">İşlem No</th>
              <th className="text-right p-2">Tutar</th>
              <th className="text-center p-2">Durum</th>
              <th className="text-right p-2">Tarih</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="p-2">{r.public_no ? <TxIdBadge publicNo={r.public_no} /> : "—"}</td>
                <td className="p-2 text-right tabular-nums">{maskBalance(Number(r.amount), canFullBalance)}</td>
                <td className="p-2 text-center">
                  <Badge variant="outline">{txStatusLabel(r.status)}</Badge>
                </td>
                <td className="p-2 text-right text-xs text-muted-foreground">{fmtDate(r.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );

  return (
    <div className="space-y-4">
      <SessionTable title="Bekleyen yatırma" rows={topups} />
      <SessionTable title="Bekleyen çekim" rows={withdraws} />
    </div>
  );
}

export function ReferralsTab({ userId }: { userId: string }) {
  const [asReferrer, setAsReferrer] = useState<any[]>([]);
  const [asReferee, setAsReferee] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      dbSelect<{ id: string; status: string; qualifying_amount: number | null; created_at: string }>("referrals", {
        cols: "id, status, qualifying_amount, created_at",
        where: { referrer_user_id: userId },
        order: { col: "created_at", asc: false },
        limit: 30,
      }).catch(() => []),
      dbSelectMaybeOne<{ id: string; status: string; qualifying_amount: number | null; created_at: string }>("referrals", {
        cols: "id, status, qualifying_amount, created_at",
        where: { referee_user_id: userId },
      }).catch(() => null),
    ]).then(([ref, done]) => {
      setAsReferrer(ref);
      setAsReferee(done ? [done] : []);
      setLoading(false);
    });
  }, [userId]);

  const statusTr: Record<string, string> = {
    pending: "Bekliyor",
    qualified: "Hak kazandı",
    rewarded: "Ödüllendi",
    expired: "Süresi doldu",
    cancelled: "İptal",
  };

  if (loading) return <div className="text-sm text-muted-foreground">Yükleniyor…</div>;

  const Table = ({ title, rows }: { title: string; rows: any[] }) => (
    <Card className="overflow-hidden">
      <div className="px-4 py-2 text-sm font-medium border-b bg-muted/30">{title}</div>
      {rows.length === 0 ? (
        <div className="p-4 text-xs text-muted-foreground">Kayıt yok</div>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-muted-foreground bg-muted/50">
            <tr>
              <th className="text-left p-2">Durum</th>
              <th className="text-right p-2">Eşik</th>
              <th className="text-right p-2">Kayıt</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="p-2">
                  <Badge variant="outline">{statusTr[r.status] ?? r.status}</Badge>
                </td>
                <td className="p-2 text-right tabular-nums">{fmtTRY(Number(r.qualifying_amount ?? 0))}</td>
                <td className="p-2 text-right text-xs text-muted-foreground">{fmtDate(r.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );

  return (
    <div className="space-y-4">
      <Table title="Davet ettikleri" rows={asReferrer} />
      <Table title="Davet edildiği kayıt" rows={asReferee} />
    </div>
  );
}
