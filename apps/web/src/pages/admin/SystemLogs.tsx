import { useEffect, useState } from "react";
import AdminLayout from "@/components/AdminLayout" ;
import { dbSelect } from "@/lib/db";
import { Card } from "@/components/ui/card" ;
import { Input } from "@/components/ui/input" ;
import { Badge } from "@/components/ui/badge" ;
import { Button } from "@/components/ui/button" ;
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, RefreshCcw } from "lucide-react" ;
import { fmtDate } from "@/lib/format" ;
import { auditActionLabel, resourceLabel } from "@/lib/bo-labels";
import { useAuth } from "@/hooks/useAuth";
import { redactLogPayload } from "@/lib/mask";

type Log = {
   id: string; actor_id: string | null; action: string;
   target_type: string | null; target_id: string | null;
   details: any; created_at: string;
};

type AuditLog = {
   id: number; actor_id: string | null; actor_email: string | null; actor_role: string | null;
   resource: string; resource_id: string | null; action: string;
   before_data: any; after_data: any; context: any; created_at: string;
};

export default function AdminSystemLogs () {
  const { can } = useAuth();
  const canViewPayload = can("audit_log", "view_payload");
  const [logs, setLogs] = useState<Log[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [actors, setActors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

     const load = async () => {
       setLoading (true);
       const [sysData, auditData] = await Promise.all([
         dbSelect<Log>("system_logs", { order: { col: "created_at", asc: false }, limit: 500 }).catch(() => [] as Log[]),
         dbSelect<AuditLog>("audit_log", {
           cols: "id, actor_id, actor_email, actor_role, resource, resource_id, action, before_data, after_data, context, created_at",
           order: { col: "created_at", asc: false },
           limit: 500,
         }).catch(() => [] as AuditLog[]),
       ]);
      setLogs(sysData);
      setAuditLogs(auditData);
      // Fetch actor names
      const ids = Array.from(new Set([
        ...sysData.map((l) => l.actor_id).filter(Boolean),
        ...auditData.map((l) => l.actor_id).filter(Boolean),
      ])) as string[];
      if (ids.length) {
        const profiles = await dbSelect<{ id: string; first_name: string; last_name: string; email: string }>("profiles", {
          cols: "id, first_name, last_name, email",
          where: [{ col: "id", op: "in", val: ids }],
        }).catch(() => []);
        const m: Record<string, string> = {};
        profiles.forEach((p) => { m[p.id] = `${p.first_name} ${p.last_name}`.trim() || p.email; });
        setActors (m);
     }
    setLoading (false);
  };
  useEffect(() => { load(); }, []);

  const filtered = logs.filter((l) =>
     !search || `${l.action} ${l.target_type ?? ""} ${l.target_id ?? ""} ${JSON.stringify(l.details)}`.toLowerCase().includes(search.toLowerCase())
  );

  const filteredAudit = auditLogs.filter((l) =>
     !search || `${l.action} ${l.resource} ${l.resource_id ?? ""} ${l.actor_email ?? ""} ${JSON.stringify(l.context)}`.toLowerCase().includes(search.toLowerCase())
  );

     return (
       <AdminLayout title="Sistem Logları" requireAny={["system_logs:view", "audit_log:view"]} >
         <Card className="p-4 mb-4 flex gap-3 items-end" >
           <Input placeholder="Aksiyon, hedef, detay ara" value={search}
              onChange={(e) => setSearch(e.target.value)} className="flex-1" />
           <Button variant="outline" onClick={load}><RefreshCcw className="size-4 mr-2" />Yenile</Button>
         </Card>

      <Tabs defaultValue="audit">
        <TabsList className="mb-3">
          <TabsTrigger value="audit">Audit Log ({filteredAudit.length})</TabsTrigger>
          <TabsTrigger value="system">System Log ({filtered.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="audit">
          <Card className="p-0 overflow-hidden" >
            {loading ? (
              <div className="p-12 flex justify-center" ><Loader2 className="animate-spin" /></div>
            ) : (
              <table className="w-full text-sm" >
                <thead className="bg-muted/50 text-left" >
                  <tr>
                    <th className="px-4 py-3">Tarih</th>
                    <th className="px-4 py-3">Aktör</th>
                    <th className="px-4 py-3">Aksiyon</th>
                    <th className="px-4 py-3">Kaynak</th>
                    <th className="px-4 py-3">Detay</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAudit.map((l) => (
                    <tr key={l.id} className="border-t align-top" >
                      <td className="px-4 py-3 text-xs" >{fmtDate(l.created_at)}</td>
                      <td className="px-4 py-3 text-xs" >
                        {l.actor_email ?? (l.actor_id ? actors[l.actor_id] ?? l.actor_id.slice(0, 8) : "Sistem")}
                        {l.actor_role && <div className="text-[10px] text-muted-foreground">{l.actor_role}</div>}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="outline" className="text-xs" >{auditActionLabel(l.action)}</Badge>
                        <div className="font-mono text-[10px] text-muted-foreground mt-1">{l.action}</div>
                      </td>
                      <td className="px-4 py-3 text-xs" >
                        <div>{resourceLabel(l.resource)}</div>
                        {l.resource_id ? <div className="font-mono text-[10px] text-muted-foreground">{l.resource_id.slice(0, 12)}</div> : null}
                      </td>
                      <td className="px-4 py-3 text-xs" >
                        <pre className="bg-muted/50 p-2 rounded max-w-md overflow-auto" >
                          {JSON.stringify(
                            redactLogPayload(l.context ?? l.after_data ?? l.before_data ?? {}, canViewPayload),
                            null,
                            2,
                          )}
                        </pre>
                      </td>
                    </tr>
                  ))}
                  {filteredAudit.length === 0 && (
                    <tr><td colSpan={5} className="text-center text-muted-foreground py-12" >Audit kaydı yok</td></tr>
                  )}
                </tbody>
              </table>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="system">
          <Card className="p-0 overflow-hidden" >
         {loading ? (
           <div className="p-12 flex justify-center" ><Loader2 className="animate-spin" /></div>
         ) : (
           <table className="w-full text-sm" >
             <thead className="bg-muted/50 text-left" >
               <tr>
                 <th className="px-4 py-3">Tarih</th>
                 <th className="px-4 py-3">Aktör</th>
                 <th className="px-4 py-3">Aksiyon</th>
                 <th className="px-4 py-3">Hedef</th>
                 <th className="px-4 py-3">Detay</th>
               </tr>
             </thead>
             <tbody>
               {filtered.map((l) => (
                 <tr key={l.id} className="border-t align-top" >
                    <td className="px-4 py-3 text-xs" >{fmtDate(l.created_at)}</td>
                    <td className="px-4 py-3 text-xs" >{l.actor_id ? actors[l.actor_id] ?? l.actor_id.slice(0, 8) : "Sistem"}</td>
                    <td className="px-4 py-3">
                      <Badge variant="outline" className="text-xs" >{auditActionLabel(l.action)}</Badge>
                      <div className="font-mono text-[10px] text-muted-foreground mt-1">{l.action}</div>
                    </td>
                    <td className="px-4 py-3 text-xs" >
                      {l.target_type ? (
                        <>
                          <div>{resourceLabel(l.target_type)}</div>
                          <div className="font-mono text-[10px] text-muted-foreground">{l.target_id?.slice(0, 8)}</div>
                        </>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-3 text-xs" >
                      <pre className="bg-muted/50 p-2 rounded max-w-md overflow-auto" >
                        {JSON.stringify(redactLogPayload(l.details, canViewPayload), null, 2)}
                      </pre>
                    </td>
                 </tr>
               ))}
               {filtered.length === 0 && (
                    <tr><td colSpan={5} className="text-center text-muted-foreground py-12" >Kayıt yok</td></tr>
                 )}
               </tbody>
             </table>
          )}
          </Card>
        </TabsContent>
      </Tabs>
      </AdminLayout>
   );
}
