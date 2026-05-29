import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import AdminLayout from "@/components/AdminLayout";
import { api } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CheckCircle2, ChevronLeft, RefreshCw } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";

type RunListItem = {
  id: string;
  triggeredBy: string;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  ok: boolean;
  findingCount: number;
  criticalCount: number;
  errorCount: number;
  warningCount: number;
  durationMs: number | null;
};

type Finding = {
  id: string;
  checkId: string;
  name: string;
  severity: string;
  message: string;
  expected?: string | number | null;
  actual?: string | number | null;
  delta?: string | number | null;
  entityRefs?: Record<string, string | number | null>;
};

type RunDetail = RunListItem & {
  summary: {
    checksRun: number;
    passed: number;
    failed: number;
    bySeverity: { critical: number; error: number; warning: number; info: number };
  };
  findings: Finding[];
  error: string | null;
};

function severityVariant(sev: string): "destructive" | "secondary" | "outline" {
  if (sev === "critical" || sev === "error") return "destructive";
  if (sev === "warning") return "secondary";
  return "outline";
}

function RunStatusBadge({ ok, critical, error }: { ok: boolean; critical: number; error: number }) {
  if (ok) {
    return (
      <Badge variant="outline" className="border-success/40 text-success gap-1">
        <CheckCircle2 className="size-3" /> Temiz
      </Badge>
    );
  }
  return (
    <Badge variant="destructive" className="gap-1">
      <AlertTriangle className="size-3" /> {critical + error} kritik/hata
    </Badge>
  );
}

function RunList() {
  const [rows, setRows] = useState<RunListItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api<{ rows: RunListItem[] }>("/admin/ledger-integrity/runs?limit=30");
      setRows(res.rows);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <Card className="overflow-hidden">
      <div className="p-3 border-b flex items-center justify-between">
        <div className="text-sm font-medium">Çapraz kontrol geçmişi</div>
        <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-left">
          <tr>
            <th className="p-3">Durum</th>
            <th className="p-3">Başlangıç</th>
            <th className="p-3">Tetikleyici</th>
            <th className="p-3 text-right">Bulgu</th>
            <th className="p-3 text-right">Süre</th>
            <th className="p-3" />
          </tr>
        </thead>
        <tbody>
          {loading && (
            <tr>
              <td colSpan={6} className="p-8 text-center text-muted-foreground">Yükleniyor…</td>
            </tr>
          )}
          {!loading && rows.length === 0 && (
            <tr>
              <td colSpan={6} className="p-8 text-center text-muted-foreground">Henüz çalıştırma yok.</td>
            </tr>
          )}
          {!loading &&
            rows.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="p-3">
                  <RunStatusBadge ok={r.ok} critical={r.criticalCount} error={r.errorCount} />
                </td>
                <td className="p-3 text-xs text-muted-foreground whitespace-nowrap">{fmtDate(r.startedAt)}</td>
                <td className="p-3">{r.triggeredBy === "cron" ? "Otomatik" : "Manuel"}</td>
                <td className="p-3 text-right tabular-nums">{r.findingCount}</td>
                <td className="p-3 text-right text-xs text-muted-foreground">
                  {r.durationMs != null ? `${(r.durationMs / 1000).toFixed(1)}s` : "—"}
                </td>
                <td className="p-3 text-right">
                  <Link to={`/admin/ledger-integrity/${r.id}`} className="text-primary text-xs hover:underline">
                    Detay
                  </Link>
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </Card>
  );
}

function RunDetailView({ id }: { id: string }) {
  const [row, setRow] = useState<RunDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        setRow(await api<RunDetail>(`/admin/ledger-integrity/runs/${id}`));
      } catch {
        setRow(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  if (loading) {
    return <Card className="p-8 text-center text-muted-foreground">Yükleniyor…</Card>;
  }
  if (!row) {
    return <Card className="p-8 text-center text-muted-foreground">Kayıt bulunamadı.</Card>;
  }

  return (
    <>
      <div className="flex items-center gap-2 mb-4">
        <Link to="/admin/ledger-integrity" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
          <ChevronLeft className="size-4" /> Liste
        </Link>
      </div>
      <Card className="p-4 mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <RunStatusBadge ok={row.ok} critical={row.criticalCount} error={row.errorCount} />
          <span className="text-sm text-muted-foreground">{fmtDate(row.startedAt)}</span>
          <span className="text-sm">{row.triggeredBy === "cron" ? "Otomatik cron" : "Manuel"}</span>
          <span className="text-sm text-muted-foreground">
            {row.summary.checksRun} kontrol · {row.findingCount} bulgu
          </span>
        </div>
        {row.error && <p className="text-sm text-destructive mt-2">{row.error}</p>}
      </Card>
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left">
            <tr>
              <th className="p-3">Seviye</th>
              <th className="p-3">Kontrol</th>
              <th className="p-3">Mesaj</th>
              <th className="p-3 text-right">Beklenen</th>
              <th className="p-3 text-right">Gerçek</th>
            </tr>
          </thead>
          <tbody>
            {row.findings.length === 0 && (
              <tr>
                <td colSpan={5} className="p-8 text-center text-success">Tüm kontroller temiz.</td>
              </tr>
            )}
            {row.findings.map((f) => (
              <tr key={f.id} className="border-t align-top">
                <td className="p-3">
                  <Badge variant={severityVariant(f.severity)}>{f.severity}</Badge>
                </td>
                <td className="p-3">
                  <div className="font-medium">{f.name}</div>
                  <div className="text-[11px] text-muted-foreground">{f.checkId}</div>
                </td>
                <td className="p-3">{f.message}</td>
                <td className="p-3 text-right tabular-nums text-muted-foreground">{f.expected ?? "—"}</td>
                <td className="p-3 text-right tabular-nums">{f.actual ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}

export default function AdminLedgerIntegrity() {
  const { id } = useParams();
  return (
    <AdminLayout
      title={id ? "Çapraz Kontrol Detayı" : "Çapraz Kontrol"}
      requireAny={["reconciliation:view", "ledger_integrity:run"]}
    >
      {id ? <RunDetailView id={id} /> : <RunList />}
    </AdminLayout>
  );
}

export function LedgerIntegrityPanel() {
  const { can } = useAuth();
  const canRun = can("ledger_integrity", "run");
  const canView = can("reconciliation", "view") || canRun;
  const [last, setLast] = useState<RunListItem | null>(null);
  const [running, setRunning] = useState(false);
  const { toast } = useToast();

  const loadLast = async () => {
    if (!canView) return;
    try {
      const res = await api<{ rows: RunListItem[] }>("/admin/ledger-integrity/runs?limit=1");
      setLast(res.rows[0] ?? null);
    } catch {
      setLast(null);
    }
  };

  useEffect(() => {
    void loadLast();
  }, [canView]);

  const runNow = async () => {
    if (!canRun) return;
    setRunning(true);
    try {
      const res = await api<{ ok: boolean; findingCount?: number; findings: unknown[]; summary: { bySeverity: { critical: number; error: number } } }>(
        "/admin/ledger-integrity/run",
        { method: "POST", body: {} },
      );
      toast({
        title: res.ok ? "Mutabakat temiz" : "Bulgu var",
        description: res.ok
          ? "Tüm kritik ve hata seviyesi kontroller geçti."
          : `${res.summary.bySeverity.critical} kritik, ${res.summary.bySeverity.error} hata bulundu.`,
        variant: res.ok ? undefined : ("destructive" as const),
      });
      await loadLast();
    } catch (err) {
      toast({
        title: "Çalıştırma başarısız",
        description: err instanceof Error ? err.message : "Bilinmeyen hata",
        variant: "destructive" as const,
      });
    } finally {
      setRunning(false);
    }
  };

  if (!canView) return null;

  return (
    <Card className={`p-5 ${last && !last.ok ? "border-destructive/40 bg-destructive/5" : "border-primary/20 bg-primary/5"}`}>
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Mutabakat / Çapraz Kontrol</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Tüm muhasebe invariant&apos;larını tarar. Otomatik: günde 3× (06:00, 14:00, 22:00 UTC).
          </p>
          {last ? (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              <RunStatusBadge ok={last.ok} critical={last.criticalCount} error={last.errorCount} />
              <span className="text-muted-foreground">{fmtDate(last.startedAt)}</span>
              <span>{last.findingCount} bulgu</span>
              <Link to="/admin/ledger-integrity" className="text-primary text-xs hover:underline">
                Geçmiş →
              </Link>
              {last.id && (
                <Link to={`/admin/ledger-integrity/${last.id}`} className="text-primary text-xs hover:underline">
                  Son detay
                </Link>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground mt-2">Henüz çalıştırma yok.</p>
          )}
        </div>
        {canRun && (
          <Button onClick={runNow} disabled={running} className="shrink-0">
            <RefreshCw className={`size-4 mr-1 ${running ? "animate-spin" : ""}`} />
            Çapraz Kontrol Çalıştır
          </Button>
        )}
      </div>
    </Card>
  );
}
