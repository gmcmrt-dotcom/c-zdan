import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { dbSelect, dbUpdate } from "@/lib/db";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Info, ShieldAlert, Lightbulb, Check } from "lucide-react";
import { fmtRelative } from "@/lib/format";
import { useAuth } from "@/hooks/useAuth";

type Suggestion = {
  id: string;
  kind: string;
  severity: "info" | "warning" | "critical";
  title: string;
  body: string;
  cta_label: string | null;
  cta_url: string | null;
  resource: string | null;
  detected_at: string;
  acknowledged_at: string | null;
};

const ICONS: Record<string, any> = {
  anomaly: AlertTriangle,
  optimization: Lightbulb,
  compliance: ShieldAlert,
  performance: Lightbulb,
  ux: Info,
};

const SEV_CLASS: Record<string, string> = {
  info: "border-l-primary bg-primary/5",
  warning: "border-l-warning bg-warning/5",
  critical: "border-l-destructive bg-destructive/5",
};

export default function SuggestionsPanel() {
  const { can } = useAuth();
  const [list, setList] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const data = await dbSelect<Suggestion>("suggestions", {
      cols: "id,kind,severity,title,body,cta_label,cta_url,resource,detected_at,acknowledged_at",
      where: { dismissed_at: null, resolved_at: null },
      order: { col: "detected_at", asc: false },
      limit: 8,
    }).catch(() => [] as Suggestion[]);
    setList(data);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const ack = async (id: string) => {
    await dbUpdate("suggestions", { acknowledged_at: new Date().toISOString() }, { id }).catch(() => {});
    load();
  };
  const dismiss = async (id: string) => {
    await dbUpdate("suggestions", { dismissed_at: new Date().toISOString() }, { id }).catch(() => {});
    load();
  };

  if (!can("suggestions", "view")) return null;
  if (loading) return null;
  if (list.length === 0) return null;

  return (
    <Card className="mb-6 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Lightbulb className="size-4 text-primary" />
          <h3 className="text-sm font-semibold">Sistem önerileri</h3>
          <Badge variant="secondary">{list.length}</Badge>
        </div>
      </div>
      <div className="space-y-2">
        {list.map((s) => {
          const Icon = ICONS[s.kind] ?? Info;
          return (
            <div key={s.id} className={`p-3 rounded-lg border-l-4 ${SEV_CLASS[s.severity]}`}>
              <div className="flex items-start gap-2">
                <Icon className="size-4 mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">{s.title}</span>
                    <span className="text-[10px] text-muted-foreground whitespace-nowrap">{fmtRelative(s.detected_at)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{s.body}</p>
                  <div className="flex items-center gap-3 mt-2">
                    {s.cta_url && (
                      <Link to={s.cta_url} className="text-xs text-primary font-medium">
                        {s.cta_label ?? "İncele"}
                      </Link>
                    )}
                    {!s.acknowledged_at && (
                      <button onClick={() => ack(s.id)} className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
                        <Check className="size-3" /> Gördüm
                      </button>
                    )}
                    <button onClick={() => dismiss(s.id)} className="text-xs text-muted-foreground hover:text-destructive">
                      Yoksay
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
