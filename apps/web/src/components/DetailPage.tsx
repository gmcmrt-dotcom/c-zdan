import { ReactNode, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/**
 * Tüm "varlık detay sayfaları" için ortak iskelet.
 * Header (geri butonu + başlık + alt başlık + sağda actions)
 * + üst metric strip (özet kartları)
 * + tab paneli (Genel, İlişkili kayıtlar, Audit, vb.)
 *
 * Kullanım:
 *   <DetailPage
 *     title="Murat Gemici"
 *     subtitle="Üye no: 00010000"
 *     onBack={() => nav(-1)}
 *     actions={<Button>Dondur</Button>}
 *     stats={[{label:"Bakiye",value:"₺250,00"}]}
 *     tabs={[
 *       { value:"summary", label:"Özet", content: <SummaryTab /> },
 *       { value:"tx", label:"İşlemler", content: <TxTab /> },
 *     ]}
 *   />
 */
export type DetailStat = {
  label: string;
  value: ReactNode;
  hint?: string;
  accent?: "default" | "success" | "warning" | "destructive" | "primary";
};

export type DetailTab = {
  value: string;
  label: string;
  content: ReactNode;
};

const ACCENT: Record<string, string> = {
  default: "text-foreground",
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
  primary: "text-primary",
};

export default function DetailPage({
  title,
  subtitle,
  onBack,
  actions,
  stats = [],
  tabs = [],
  defaultTab,
  tab: controlledTab,
  onTabChange,
  lazyMount = false,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  onBack?: () => void;
  actions?: ReactNode;
  stats?: DetailStat[];
  tabs?: DetailTab[];
  defaultTab?: string;
  /** Kontrollü sekme (dışarıdan tab değiştirmek için) */
  tab?: string;
  onTabChange?: (value: string) => void;
  /** true: sadece aktif sekme mount olur (ağır tab içerikleri için) */
  lazyMount?: boolean;
  children?: ReactNode; // tabs yerine veya yanında özgür içerik
}) {
  const [internalTab, setInternalTab] = useState(defaultTab ?? tabs[0]?.value ?? "");
  const activeTab = controlledTab ?? internalTab;
  const setActiveTab = (v: string) => {
    onTabChange?.(v);
    if (controlledTab === undefined) setInternalTab(v);
  };
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div className="flex items-start gap-2 sm:gap-3 min-w-0">
          {onBack && (
            <Button variant="ghost" size="sm" onClick={onBack} className="shrink-0">
              <ArrowLeft className="size-4 mr-1" />
              Geri
            </Button>
          )}
          <div className="min-w-0">
            <h1 className="text-lg sm:text-xl font-semibold break-words">{title}</h1>
            {subtitle && <p className="text-sm text-muted-foreground mt-0.5 break-words">{subtitle}</p>}
          </div>
        </div>
        {actions && (
          <div className="flex flex-wrap items-center gap-2 shrink-0 w-full sm:w-auto sm:justify-end">
            {actions}
          </div>
        )}
      </div>

      {/* Stats strip */}
      {stats.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {stats.map((s, i) => (
            <Card key={i} className="p-4">
              <div className="text-xs text-muted-foreground">{s.label}</div>
              <div className={`text-xl font-bold tabular-nums mt-1 ${ACCENT[s.accent ?? "default"]}`}>
                {s.value}
              </div>
              {s.hint && <div className="text-[10px] text-muted-foreground mt-1">{s.hint}</div>}
            </Card>
          ))}
        </div>
      )}

      {/* Tabs */}
      {tabs.length > 0 && (
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="flex flex-wrap h-auto gap-1">
            {tabs.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>{t.label}</TabsTrigger>
            ))}
          </TabsList>
          {tabs.map((t) => (
            <TabsContent key={t.value} value={t.value} className="mt-4">
              {!lazyMount || activeTab === t.value ? t.content : null}
            </TabsContent>
          ))}
        </Tabs>
      )}

      {/* Free children */}
      {children}
    </div>
  );
}
