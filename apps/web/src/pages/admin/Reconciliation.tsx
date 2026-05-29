import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import AdminLayout from "@/components/AdminLayout";
import { dbSelect, type WhereCondition } from "@/lib/db";
import { fmtTRY, fmtDate, txTypeLabel } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RefreshCw, AlertTriangle, CheckCircle2 } from "lucide-react";
import { TxIdBadge } from "@/components/TxIdBadge";
import DateRangePicker from "@/components/DateRangePicker";

type Tx = {
  id: string;
  public_no: string | null;
  merchant_ref: string | null;
  type: string;
  amount: number;
  fee: number;
  status: string;
  created_at: string;
  reference_id: string | null;
  metadata: Record<string, any> | null;
};

type Merchant = { id: string; name: string; merchant_type: "commerce" | "finance"; merchant_scope: string | null; parent_merchant_id: string | null };
type Movement = {
  reference_id: string | null;
  reference_type: string | null;
  change_amount: number;
  reason: string;
  merchant_id: string;
  notes: string | null;
};

type ReconRow = {
  tx: Tx;
  merchant: Merchant | null;
  expected: number | null;
  actual: number | null;
  source: "settlement" | "cash_pool" | "metadata";
  ok: boolean;
};

const FLOW_TYPES = ["spend", "merchant_credit", "topup", "merchant_withdraw"];

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function expectedPosting(tx: Tx): { amount: number | null; source: ReconRow["source"] } {
  const meta = tx.metadata ?? {};
  const explicit = num(meta.settlement_change) ?? num(meta.cash_pool_change);
  if (explicit !== null) {
    return { amount: explicit, source: meta.settlement_change !== undefined ? "settlement" : "cash_pool" };
  }

  const gross = Number(tx.amount) || 0;
  const fee = Number(tx.fee) || 0;
  if (tx.type === "spend") return { amount: gross - fee, source: "settlement" };
  if (tx.type === "merchant_credit") return { amount: -(gross + fee), source: "settlement" };
  if (tx.type === "topup") return { amount: gross - fee, source: "cash_pool" };
  if (tx.type === "merchant_withdraw") return { amount: -(gross - fee), source: "cash_pool" };
  return { amount: null, source: "metadata" };
}

function nearlyEqual(a: number | null, b: number | null) {
  if (a === null || b === null) return false;
  return Math.abs(a - b) < 0.005;
}

export default function AdminReconciliation() {
  const [searchParams] = useSearchParams();
  const deepLinkApplied = useRef(false);
  const today = new Date().toISOString().slice(0, 10);
  const defaultFrom = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(today);
  const [merchantId, setMerchantId] = useState("");
  const [loading, setLoading] = useState(false);
  const [txs, setTxs] = useState<Tx[]>([]);
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [settlement, setSettlement] = useState<Movement[]>([]);
  const [cashPool, setCashPool] = useState<Movement[]>([]);

  const highlightPublicNo = (searchParams.get("public_no") ?? "").toUpperCase();

  useEffect(() => {
    if (deepLinkApplied.current) return;
    const mid = searchParams.get("merchant_id");
    const f = searchParams.get("from");
    const t = searchParams.get("to");
    if (!mid && !f && !t) return;
    deepLinkApplied.current = true;
    if (mid) setMerchantId(mid);
    if (f) setFrom(f);
    if (t) setTo(t);
  }, [searchParams]);

  const load = async () => {
    setLoading(true);
    const fromIso = new Date(from).toISOString();
    const endDate = new Date(to);
    endDate.setHours(23, 59, 59, 999);
    const toIso = endDate.toISOString();

    const merchantRows = await dbSelect<Merchant>("merchants", {
      cols: "id, name, merchant_type, merchant_scope, parent_merchant_id",
      order: { col: "name", asc: true },
    }).catch(() => [] as Merchant[]);

    const txWhere: WhereCondition[] = [
      { col: "status", op: "eq", val: "completed" },
      { col: "type", op: "in", val: FLOW_TYPES },
      { col: "created_at", op: "gte", val: fromIso },
      { col: "created_at", op: "lte", val: toIso },
    ];
    if (merchantId) {
      const selectedMerchant = merchantRows.find((m) => m.id === merchantId);
      const childIds = selectedMerchant?.merchant_scope === "parent"
        ? merchantRows.filter((m) => m.parent_merchant_id === merchantId).map((m) => m.id)
        : [];
      const ids = childIds.length > 0 ? childIds : [merchantId];
      txWhere.push({ col: "metadata->>merchant_id", op: "in", val: ids });
    }

    const [txRes, settlementRes, cashRes] = await Promise.all([
      dbSelect<Tx>("transactions", {
        cols: "id, public_no, merchant_ref, type, amount, fee, status, created_at, reference_id, metadata",
        where: txWhere,
        order: { col: "created_at", asc: false },
        limit: 1000,
      }).catch(() => [] as Tx[]),
      dbSelect<Movement>("merchant_settlement_log", {
        cols: "reference_id, reference_type, change_amount, reason, merchant_id, notes",
        where: [
          { col: "created_at", op: "gte", val: fromIso },
          { col: "created_at", op: "lte", val: toIso },
        ],
        limit: 5000,
      }).catch(() => [] as Movement[]),
      dbSelect<Movement>("merchant_cash_pool_log", {
        cols: "reference_id, reference_type, change_amount, reason, merchant_id, notes",
        where: [
          { col: "created_at", op: "gte", val: fromIso },
          { col: "created_at", op: "lte", val: toIso },
        ],
        limit: 5000,
      }).catch(() => [] as Movement[]),
    ]);

    setTxs(txRes);
    setMerchants(merchantRows);
    setSettlement(settlementRes);
    setCashPool(cashRes);
    setLoading(false);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, merchantId]);

  const rows = useMemo<ReconRow[]>(() => {
    const merchantMap = new Map(merchants.map((m) => [m.id, m]));
    const settlementByTx = new Map(settlement.filter((m) => m.reference_id).map((m) => [m.reference_id, m]));
    const settlementByMerchantRef = new Map(
      settlement
        .filter((m) => m.reason === "credit_to_member" && m.notes?.startsWith("ref:"))
        .map((m) => [m.notes!.slice(4).split(/\s+/)[0], m]),
    );
    const cashByRef = new Map(cashPool.filter((m) => m.reference_id).map((m) => [m.reference_id, m]));

    return txs.map((tx) => {
      const mid = tx.metadata?.merchant_id as string | undefined;
      const merchant = mid ? merchantMap.get(mid) ?? null : null;
      const expected = expectedPosting(tx);
      let actual: number | null = null;

      if (tx.type === "spend") actual = num(settlementByTx.get(tx.id)?.change_amount);
      else if (tx.type === "topup" || tx.type === "merchant_withdraw") actual = num(cashByRef.get(tx.reference_id)?.change_amount);
      else if (tx.type === "merchant_credit") {
        const byTx = settlementByTx.get(tx.id);
        const byMerchantRef = tx.merchant_ref ? settlementByMerchantRef.get(tx.merchant_ref) : undefined;
        actual = num((byTx ?? byMerchantRef)?.change_amount);
      }

      return {
        tx,
        merchant,
        expected: expected.amount,
        actual,
        source: expected.source,
        ok: nearlyEqual(expected.amount, actual),
      };
    });
  }, [txs, merchants, settlement, cashPool]);

  const totals = rows.reduce(
    (acc, row) => {
      acc.gross += Number(row.tx.amount) || 0;
      acc.fee += Number(row.tx.fee) || 0;
      acc.expected += row.expected ?? 0;
      acc.actual += row.actual ?? 0;
      if (!row.ok) acc.mismatch += 1;
      return acc;
    },
    { gross: 0, fee: 0, expected: 0, actual: 0, mismatch: 0 },
  );

  return (
    <AdminLayout title="Mutabakat" requireAny={["reconciliation:view", "transactions:view_full", "commissions:view"]}>
      <Card className="p-4 mb-4">
        <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-end gap-3">
          <div className="w-full sm:flex-1 sm:max-w-md min-w-0">
            <Label className="text-xs">Tarih aralığı</Label>
            <DateRangePicker
              value={{ from, to }}
              onChange={(next) => {
                setFrom(next.from ?? "");
                setTo(next.to ?? "");
              }}
              buttonClassName="w-full"
            />
          </div>
          <div className="w-full sm:w-auto sm:min-w-[10rem] max-w-xs">
            <Label className="text-xs">Merchant</Label>
            <select
              value={merchantId}
              onChange={(e) => setMerchantId(e.target.value)}
              className="w-full h-9 border rounded-md px-3 bg-background text-sm"
            >
              <option value="">Tümü</option>
              {merchants.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.merchant_scope === "child" ? "Bayi: " : m.merchant_scope === "parent" ? "Ana: " : ""}{m.name}
                </option>
              ))}
            </select>
          </div>
          <Button variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className={`size-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Yenile
          </Button>
        </div>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
        <Card className="p-4"><div className="text-xs text-muted-foreground">Gross Hacim</div><div className="text-xl font-bold">{fmtTRY(totals.gross)}</div></Card>
        <Card className="p-4"><div className="text-xs text-muted-foreground">Komisyon</div><div className="text-xl font-bold">{fmtTRY(totals.fee)}</div></Card>
        <Card className="p-4"><div className="text-xs text-muted-foreground">Beklenen Net</div><div className="text-xl font-bold">{fmtTRY(totals.expected)}</div></Card>
        <Card className="p-4"><div className="text-xs text-muted-foreground">Gerçekleşen Net</div><div className="text-xl font-bold">{fmtTRY(totals.actual)}</div></Card>
        <Card className={`p-4 ${totals.mismatch > 0 ? "border-destructive/50 bg-destructive/5" : "border-success/40 bg-success/5"}`}>
          <div className="text-xs text-muted-foreground">Farklı Kayıt</div>
          <div className={`text-xl font-bold ${totals.mismatch > 0 ? "text-destructive" : "text-success"}`}>{totals.mismatch}</div>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="p-3 border-b bg-muted/40 text-sm text-muted-foreground">
          Gross tutar üyeye yansıyan işlem tutarıdır; beklenen/gerçekleşen net merchant settlement veya cash_pool hareketidir.
        </div>
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left">
            <tr>
              <th className="p-3">Durum</th>
              <th className="p-3">Tarih</th>
              <th className="p-3">İşlem</th>
              <th className="p-3">Merchant</th>
              <th className="p-3 text-right">Gross</th>
              <th className="p-3 text-right">Komisyon</th>
              <th className="p-3 text-right">Beklenen Net</th>
              <th className="p-3 text-right">Gerçekleşen</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">Yükleniyor...</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">Veri yok.</td></tr>}
            {!loading && rows.map((row) => (
              <tr
                key={row.tx.id}
                className={`border-t ${
                  highlightPublicNo && row.tx.public_no?.toUpperCase() === highlightPublicNo
                    ? "bg-primary/10 ring-1 ring-inset ring-primary/30"
                    : ""
                }`}
              >
                <td className="p-3">
                  {row.ok ? <CheckCircle2 className="size-4 text-success" /> : <AlertTriangle className="size-4 text-destructive" />}
                </td>
                <td className="p-3 text-xs text-muted-foreground whitespace-nowrap">{fmtDate(row.tx.created_at)}</td>
                <td className="p-3">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{txTypeLabel(row.tx.type)}</Badge>
                    <TxIdBadge publicNo={row.tx.public_no} />
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-1">{row.source}</div>
                </td>
                <td className="p-3">{row.merchant?.name ?? "—"}</td>
                <td className="p-3 text-right tabular-nums">{fmtTRY(Number(row.tx.amount))}</td>
                <td className="p-3 text-right tabular-nums text-muted-foreground">{Number(row.tx.fee) > 0 ? fmtTRY(Number(row.tx.fee)) : "—"}</td>
                <td className="p-3 text-right tabular-nums">{row.expected === null ? "—" : fmtTRY(row.expected)}</td>
                <td className={`p-3 text-right tabular-nums ${row.ok ? "text-success" : "text-destructive"}`}>
                  {row.actual === null ? "—" : fmtTRY(row.actual)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </AdminLayout>
  );
}
