import AdminLayout from "@/components/AdminLayout";
import { StatCard } from "@/components/ui/stat-card";
import { BoStatGrid } from "@/components/bo/BoPagePrimitives";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { dbSelect } from "@/lib/db";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { fmtTRY } from "@/lib/format";
import { RefreshCw, Store } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { maskApiKey, sensitiveText } from "@/lib/mask";

type BayiRow = {
  id: string;
  name: string;
  api_key: string | null;
  is_active: boolean;
  parent_merchant_id: string | null;
  external_sub_merchant_ref: string | null;
  commission_pct: number | null;
  fixed_fee: number | null;
  per_tx_limit: number | null;
  daily_limit: number | null;
  balance: number | null;
};

type ParentRow = { id: string; name: string; ip_whitelist: string[] | null };

export default function AdminMerchantChildren() {
  const nav = useNavigate();
  const { can } = useAuth();
  const [rows, setRows] = useState<BayiRow[]>([]);
  const [parents, setParents] = useState<Record<string, ParentRow>>({});
  const [todayAgg, setTodayAgg] = useState<Record<string, { volume: number; count: number }>>({});
  const [parentFilter, setParentFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const [childRows, parentRows] = await Promise.all([
      dbSelect<BayiRow>("merchants", {
        cols: "id,name,api_key,is_active,parent_merchant_id,external_sub_merchant_ref,commission_pct,fixed_fee,per_tx_limit,daily_limit,balance",
        where: [
          { col: "merchant_type", op: "eq", val: "commerce" },
          { col: "merchant_scope", op: "eq", val: "child" },
        ],
        order: { col: "name" },
      }).catch(() => [] as BayiRow[]),
      dbSelect<ParentRow>("merchants", {
        cols: "id,name,ip_whitelist",
        where: [
          { col: "merchant_type", op: "eq", val: "commerce" },
          { col: "merchant_scope", op: "neq", val: "child" },
        ],
        order: { col: "name" },
      }).catch(() => [] as ParentRow[]),
    ]);

    const bayiRows = childRows;
    const parentMap: Record<string, ParentRow> = {};
    parentRows.forEach((p) => { parentMap[p.id] = p; });
    setRows(bayiRows);
    setParents(parentMap);

    const since = new Date();
    since.setHours(0, 0, 0, 0);
    const txRows = await dbSelect<{ amount: number; metadata: any }>("transactions", {
      cols: "amount,metadata",
      where: [
        { col: "status", op: "eq", val: "completed" },
        { col: "created_at", op: "gte", val: since.toISOString() },
      ],
      limit: 500, // /from shim hard cap (from.routes FromBody.limit.max)
    }).catch(() => [] as Array<{ amount: number; metadata: any }>);

    const childIds = new Set(bayiRows.map((r) => r.id));
    const agg: Record<string, { volume: number; count: number }> = {};
    txRows.forEach((tx) => {
      const mid = tx.metadata?.merchant_id;
      if (!mid || !childIds.has(mid)) return;
      agg[mid] = agg[mid] ?? { volume: 0, count: 0 };
      agg[mid].volume += Number(tx.amount) || 0;
      agg[mid].count += 1;
    });
    setTodayAgg(agg);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (parentFilter && r.parent_merchant_id !== parentFilter) return false;
      if (statusFilter === "active" && !r.is_active) return false;
      if (statusFilter === "inactive" && r.is_active) return false;
      if (!q) return true;
      const parentName = r.parent_merchant_id ? parents[r.parent_merchant_id]?.name ?? "" : "";
      return (
        r.name.toLowerCase().includes(q) ||
        parentName.toLowerCase().includes(q) ||
        (r.external_sub_merchant_ref ?? "").toLowerCase().includes(q) ||
        (r.api_key ?? "").toLowerCase().includes(q)
      );
    });
  }, [rows, parents, parentFilter, statusFilter, search]);

  const totals = filtered.reduce(
    (acc, row) => {
      const today = todayAgg[row.id];
      acc.balance += Number(row.balance ?? 0);
      acc.volume += today?.volume ?? 0;
      acc.count += today?.count ?? 0;
      return acc;
    },
    { balance: 0, volume: 0, count: 0 },
  );

  return (
    <AdminLayout title="Bayiler" requireAny={["merchant_children:view", "merchants:view_full"]}>
      <BoStatGrid cols={4}>
        <StatCard label="Toplam bayi" value={filtered.length} valueSize="lg" />
        <StatCard
          label="Toplam settlement"
          value={`${totals.balance >= 0 ? "+" : "−"}${fmtTRY(Math.abs(totals.balance))}`}
          valueSize="lg"
          valueClassName={totals.balance >= 0 ? "text-success" : "text-destructive"}
        />
        <StatCard
          label="Bugünkü hacim"
          value={fmtTRY(totals.volume)}
          hint={`${totals.count} işlem`}
          valueSize="lg"
        />
      </BoStatGrid>

      <Card className="p-4 mb-4">
        <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-end gap-3">
          <div className="w-full sm:flex-1 sm:min-w-[12rem] min-w-0">
            <div className="text-xs text-muted-foreground mb-1">Ara</div>
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Bayi, ana merchant, ref veya API key" />
          </div>
          <div className="w-full sm:w-auto sm:min-w-[10rem] max-w-xs">
            <div className="text-xs text-muted-foreground mb-1">Ana ticari merchant</div>
            <select className="w-full h-9 border rounded-md px-3 bg-background text-sm" value={parentFilter} onChange={(e) => setParentFilter(e.target.value)}>
              <option value="">Tümü</option>
              {Object.values(parents).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="w-full sm:w-auto sm:min-w-[8rem] max-w-[10rem]">
            <div className="text-xs text-muted-foreground mb-1">Durum</div>
            <select className="w-full h-9 border rounded-md px-3 bg-background text-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}>
              <option value="all">Tümü</option>
              <option value="active">Aktif</option>
              <option value="inactive">Pasif</option>
            </select>
          </div>
          <Button variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className={`size-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Yenile
          </Button>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="text-left p-3">Bayi</th>
              <th className="text-left p-3">Ana Merchant</th>
              <th className="text-left p-3">API Key</th>
              <th className="text-left p-3">Komisyon</th>
              <th className="text-left p-3">Limitler</th>
              <th className="text-right p-3">Settlement</th>
              <th className="text-right p-3">Bugün</th>
              <th className="text-center p-3">Durum</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={8} className="text-center py-8 text-muted-foreground">Yükleniyor...</td></tr>}
            {!loading && filtered.length === 0 && <tr><td colSpan={8} className="text-center py-8 text-muted-foreground">Bayi bulunamadı.</td></tr>}
            {!loading && filtered.map((row) => {
              const parent = row.parent_merchant_id ? parents[row.parent_merchant_id] : null;
              const today = todayAgg[row.id] ?? { volume: 0, count: 0 };
              return (
                <tr key={row.id} className="border-t cursor-pointer hover:bg-muted/40" onClick={() => nav(`/admin/merchants/${row.id}`)}>
                  <td className="p-3">
                    <div className="font-medium flex items-center gap-2"><Store className="size-4 text-muted-foreground" />{row.name}</div>
                    <div className="text-xs font-mono text-muted-foreground">{row.external_sub_merchant_ref ?? "-"}</div>
                  </td>
                  <td className="p-3">{parent?.name ?? "-"}</td>
                  <td className="p-3 text-xs font-mono">
                    {sensitiveText(can, "merchants", "api_credentials", row.api_key ?? "", maskApiKey)}
                  </td>
                  <td className="p-3">%{Number(row.commission_pct ?? 0).toFixed(2)}{Number(row.fixed_fee ?? 0) > 0 ? ` + ${fmtTRY(Number(row.fixed_fee))}` : ""}</td>
                  <td className="p-3 text-xs">
                    <div>Tek işlem: {row.per_tx_limit != null ? fmtTRY(Number(row.per_tx_limit)) : "-"}</div>
                    <div>Günlük: {row.daily_limit != null ? fmtTRY(Number(row.daily_limit)) : "-"}</div>
                  </td>
                  <td className={`p-3 text-right tabular-nums ${Number(row.balance ?? 0) >= 0 ? "text-success" : "text-destructive"}`}>
                    {Number(row.balance ?? 0) >= 0 ? "+" : "-"}{fmtTRY(Math.abs(Number(row.balance ?? 0)))}
                  </td>
                  <td className="p-3 text-right tabular-nums">
                    {fmtTRY(today.volume)}
                    <div className="text-[10px] text-muted-foreground">{today.count} işlem</div>
                  </td>
                  <td className="p-3 text-center">
                    <Badge variant={row.is_active ? "secondary" : "destructive"}>{row.is_active ? "Aktif" : "Pasif"}</Badge>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </AdminLayout>
  );
}
