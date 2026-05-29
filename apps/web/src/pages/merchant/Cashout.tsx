import { useEffect, useMemo, useState } from "react";
import MerchantLayout from "@/components/MerchantLayout";
import { rpc } from "@/lib/rpc";
import { dbSelect } from "@/lib/db";
import { fetchMerchantCashoutSessions } from "@/lib/merchant-self";
import { invokeFunction } from "@/lib/fn";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fmtTRY, fmtDate } from "@/lib/format";
import { translateError } from "@/lib/i18n-errors";
import { toast } from "sonner";
import { AlertCircle, Coins, Loader2 } from "lucide-react";

type SelfRow = {
  id: string;
  name: string;
  merchant_type: "commerce" | "finance";
  merchant_scope?: "standalone" | "parent" | "child";
};

type MerchantRow = {
  id: string;
  name: string;
  balance: number;
  cashout_reserved_amount: number;
  cashout_commission_pct: number;
  cashout_fixed_fee: number;
};

type MethodRow = {
  code: string;
  label: string;
  is_active: boolean;
  min_amount: number;
  max_amount: number | null;
};

const STATUS_LABEL: Record<string, string> = {
  pending_provider: "Ödemeci bekliyor",
  processing: "İşleniyor",
  success: "Tamamlandı",
  failed: "Başarısız",
  cancelled: "İptal",
  expired: "Süresi doldu",
};

export default function MerchantCashout() {
  const { user } = useAuth();
  const [self, setSelf] = useState<SelfRow | null>(null);
  const [merchants, setMerchants] = useState<MerchantRow[]>([]);
  const [methods, setMethods] = useState<MethodRow[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [selectedMerchantId, setSelectedMerchantId] = useState("");
  const [methodCode, setMethodCode] = useState("");
  const [amount, setAmount] = useState("");
  const [commission, setCommission] = useState("");
  const [address, setAddress] = useState("");
  const [canCreate, setCanCreate] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    setLoading(true);
    const [selfData, methodData] = await Promise.all([
      rpc<SelfRow | SelfRow[]>("merchant_self").catch(() => null),
      dbSelect<MethodRow>("merchant_cashout_methods", {
        where: { is_active: true },
        order: { col: "sort_order", asc: true },
      }).catch(() => [] as MethodRow[]),
    ]);
    const me = (Array.isArray(selfData) ? selfData[0] : selfData) ?? null;
    setSelf(me);
    setMethods(methodData);
    if (!methodCode && methodData[0]?.code) setMethodCode(methodData[0].code);

    let merchantRows: MerchantRow[] = [];
    if (me?.merchant_scope === "parent") {
      const childRows = await rpc<any[]>("merchant_self_children").catch(() => [] as any[]);
      merchantRows = (childRows ?? []).map((c) => ({
        id: c.id,
        name: c.name,
        balance: c.balance,
        cashout_reserved_amount: c.cashout_reserved_amount ?? 0,
        cashout_commission_pct: c.cashout_commission_pct ?? 0,
        cashout_fixed_fee: c.cashout_fixed_fee ?? 0,
      }));
      if (!selectedMerchantId && merchantRows.length === 1) setSelectedMerchantId(merchantRows[0].id);
    } else if (me?.merchant_type === "commerce") {
      const own = await rpc<any>("merchant_self").catch(() => null);
      const row = Array.isArray(own) ? own[0] : own;
      if (row) {
        merchantRows = [{
          id: row.id,
          name: row.name,
          balance: row.balance,
          cashout_reserved_amount: row.cashout_reserved_amount ?? 0,
          cashout_commission_pct: row.cashout_commission_pct ?? 0,
          cashout_fixed_fee: row.cashout_fixed_fee ?? 0,
        }];
      }
      if (!selectedMerchantId && me.id) setSelectedMerchantId(me.id);
    }
    setMerchants(merchantRows);

    const targetId = selectedMerchantId || (merchantRows.length === 1 ? merchantRows[0].id : "");
    if (targetId) {
      const [sessionRows, permData] = await Promise.all([
        fetchMerchantCashoutSessions(targetId).catch(() => [] as any[]),
        rpc<boolean>("merchant_has_permission", {
          _user_id: user?.id ?? null,
          _merchant_id: targetId,
          _permission_key: "merchant_cashout:create",
        }).catch(() => false),
      ]);
      setSessions(sessionRows);
      setCanCreate(!!permData);
    } else {
      setSessions([]);
      setCanCreate(false);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, [selectedMerchantId, user?.id]);

  const selectedMerchant = useMemo(
    () => merchants.find((m) => m.id === selectedMerchantId) ?? (merchants.length === 1 ? merchants[0] : null),
    [merchants, selectedMerchantId],
  );
  const amountNum = Number(amount || 0);
  const isUsdt = methodCode.toUpperCase().startsWith("USDT_");
  const commissionNum = Number(commission || 0);
  const fee = selectedMerchant && Number.isFinite(amountNum) && amountNum > 0
    ? isUsdt
      ? (Number.isFinite(commissionNum) && commissionNum >= 0 ? Math.round(commissionNum * 100) / 100 : 0)
      : Math.round(((amountNum * Number(selectedMerchant.cashout_commission_pct ?? 0) / 100) + Number(selectedMerchant.cashout_fixed_fee ?? 0)) * 100) / 100
    : 0;
  const totalDebit = amountNum + fee;
  const available = selectedMerchant
    ? Number(selectedMerchant.balance ?? 0) - Number(selectedMerchant.cashout_reserved_amount ?? 0)
    : 0;

  const submit = async () => {
    if (!selectedMerchant) return toast.error("Bayi/merchant seçin");
    if (!methodCode) return toast.error("Yöntem seçin");
    if (!amountNum || amountNum <= 0) return toast.error("Geçerli tutar girin");
    if (isUsdt && (!Number.isFinite(commissionNum) || commissionNum < 0)) {
      return toast.error("USDT çekiminde platform komisyonu (gelir) zorunludur");
    }
    if (!address.trim()) return toast.error("Cüzdan adresi gerekli");
    setSubmitting(true);
    try {
      const data = await invokeFunction<{ success?: boolean; error_code?: string; public_no?: string; session_id?: string }>(
        "merchant-cashout-request",
        {
          merchant_id: selectedMerchant.id,
          method_code: methodCode,
          amount: amountNum,
          payout_address: address.trim(),
          ...(isUsdt ? { commission: commissionNum } : {}),
        },
      );
      if (!data?.success) {
        toast.error(translateError({ error_code: data?.error_code }, "Tahsilat talebi oluşturulamadı"));
        return;
      }
      toast.success(`Tahsilat talebi oluşturuldu: ${data.public_no ?? data.session_id}`);
      setAmount("");
      setCommission("");
      setAddress("");
      await load();
    } catch (err) {
      toast.error(translateError(err, "Tahsilat talebi oluşturulamadı"));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <MerchantLayout title="Tahsilat"><div className="text-muted-foreground">Yükleniyor…</div></MerchantLayout>;

  if (!self || self.merchant_type !== "commerce") {
    return (
      <MerchantLayout title="Tahsilat">
        <Card className="p-8 text-center">
          <AlertCircle className="size-10 mx-auto text-warning mb-2" />
          <p className="text-sm text-muted-foreground">Tahsilat sadece ticari merchant'lar için kullanılabilir.</p>
        </Card>
      </MerchantLayout>
    );
  }

  return (
    <MerchantLayout title="Tahsilat">
      <div className="space-y-4">
        {self.merchant_scope === "parent" && (
          <Card className="p-4">
            <Label>Bayi seçimi</Label>
            <Select value={selectedMerchantId} onValueChange={setSelectedMerchantId}>
              <SelectTrigger className="w-72 mt-1"><SelectValue placeholder="Bayi seçin" /></SelectTrigger>
              <SelectContent>
                {merchants.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-2">Parent aggregate çekim yoktur; tahsilat child/bayi bakiyesinden yapılır.</p>
          </Card>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Defter bakiyesi" value={selectedMerchant ? fmtTRY(Number(selectedMerchant.balance)) : "—"} />
          <Stat label="Bekleyen rezerv" value={selectedMerchant ? fmtTRY(Number(selectedMerchant.cashout_reserved_amount ?? 0)) : "—"} />
          <Stat label="Çekilebilir" value={selectedMerchant ? fmtTRY(available) : "—"} accent={available > 0 ? "text-success" : "text-destructive"} />
          <Stat label="Komisyon" value={selectedMerchant ? `%${Number(selectedMerchant.cashout_commission_pct ?? 0).toFixed(2)} + ${fmtTRY(Number(selectedMerchant.cashout_fixed_fee ?? 0))}` : "—"} />
        </div>

        <Card className="p-4 max-w-2xl space-y-4">
          <div className="flex items-center gap-2">
            <Coins className="size-4 text-primary" />
            <div>
              <div className="text-sm font-medium">Yeni tahsilat talebi</div>
              <div className="text-xs text-muted-foreground">Talep tutarı + komisyon kadar tahsil edilebilir defter bakiyesi rezerve edilir.</div>
            </div>
          </div>
          {!canCreate && (
            <div className="rounded-lg border bg-warning/10 p-3 text-xs text-muted-foreground">
              Bu işlemi başlatmak için owner olmalı veya owner tarafından “Kasa tahsilatı başlatabilir” hassas yetkisi verilmelidir.
            </div>
          )}
          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <Label>Yöntem</Label>
              <Select value={methodCode} onValueChange={setMethodCode}>
                <SelectTrigger><SelectValue placeholder="Yöntem seçin" /></SelectTrigger>
                <SelectContent>
                  {methods.map((m) => <SelectItem key={m.code} value={m.code}>{m.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Tutar (₺)</Label>
              <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
            </div>
            {isUsdt && (
              <div className="md:col-span-2">
                <Label>Platform komisyonu (₺) — gelir</Label>
                <Input
                  inputMode="decimal"
                  value={commission}
                  onChange={(e) => setCommission(e.target.value)}
                  placeholder="0"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  USDT tahsilatında komisyon tutarı platform geliri olarak kaydedilir.
                </p>
              </div>
            )}
            <div className="md:col-span-2">
              <Label>Kripto cüzdan adresi</Label>
              <Input value={address} onChange={(e) => setAddress(e.target.value)} className="font-mono text-xs" placeholder="Adres" />
            </div>
          </div>
          <div className="rounded-lg bg-muted/40 border p-3 text-xs grid grid-cols-3 gap-2">
            <div><span className="text-muted-foreground">Talep</span><div className="font-semibold">{fmtTRY(amountNum || 0)}</div></div>
            <div><span className="text-muted-foreground">Komisyon</span><div className="font-semibold">{fmtTRY(fee)}</div></div>
            <div><span className="text-muted-foreground">Rezerve</span><div className="font-semibold">{fmtTRY(totalDebit || 0)}</div></div>
          </div>
          <Button onClick={submit} disabled={!canCreate || !selectedMerchant || submitting || totalDebit <= 0 || totalDebit > available || (isUsdt && commission.trim() === "")}>
            {submitting ? <Loader2 className="animate-spin size-4 mr-1" /> : null}
            Tahsilat talebi oluştur
          </Button>
        </Card>

        <Card className="overflow-hidden">
          <div className="p-3 border-b text-sm font-medium">Tahsilat geçmişi</div>
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="text-left p-3">Tarih</th>
                <th className="text-left p-3">No</th>
                <th className="text-left p-3">Yöntem</th>
                <th className="text-right p-3">Tutar</th>
                <th className="text-right p-3">Komisyon</th>
                <th className="text-center p-3">Durum</th>
              </tr>
            </thead>
            <tbody>
              {sessions.length === 0 && <tr><td colSpan={6} className="text-center py-6 text-muted-foreground">Henüz tahsilat talebi yok.</td></tr>}
              {sessions.map((s) => (
                <tr key={s.id} className="border-t">
                  <td className="p-3 text-xs whitespace-nowrap">{fmtDate(s.created_at)}</td>
                  <td className="p-3 font-mono text-xs">{s.public_no ?? s.id.slice(0, 8)}</td>
                  <td className="p-3">{s.method_code}</td>
                  <td className="p-3 text-right tabular-nums">{fmtTRY(Number(s.amount))}</td>
                  <td className="p-3 text-right tabular-nums text-xs text-muted-foreground">{fmtTRY(Number(s.fee))}</td>
                  <td className="p-3 text-center"><Badge variant={s.status === "success" ? "secondary" : s.status === "failed" ? "destructive" : "outline"}>{STATUS_LABEL[s.status] ?? s.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </MerchantLayout>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs uppercase text-muted-foreground tracking-wider">{label}</div>
      <div className={`text-xl font-semibold tabular-nums mt-1 ${accent ?? ""}`}>{value}</div>
    </Card>
  );
}
