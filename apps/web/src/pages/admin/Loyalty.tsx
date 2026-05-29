import { useEffect, useState } from "react";
import AdminLayout from "@/components/AdminLayout" ;
import { dbSelect, dbUpdate } from "@/lib/db";
import { Card } from "@/components/ui/card" ;
import { Button } from "@/components/ui/button" ;
import { Input } from "@/components/ui/input" ;
import { Label } from "@/components/ui/label" ;
import { Switch } from "@/components/ui/switch" ;
import { Badge } from "@/components/ui/badge" ;
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs" ;
import { Loader2, Save } from "lucide-react" ;
import { toast } from "sonner";
import { translateError } from "@/lib/i18n-errors" ;

type Tier = {
   id: number; level_name: string; sub_rank: number; display_name: string;
   min_points: number; min_turnover: number;
   point_multiplier : number; cashback_pct: number;
   sort_order: number; is_archived: boolean;
};
type Rule = {
   id: string; key: string; description: string; value: number; is_active: boolean;
};

const SUB_LEVEL_LABELS = ["Plus", "Pro", "Prime"] as const;

export default function AdminLoyalty() {
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | number | null>(null);

  const load = async () => {
    setLoading (true);
     const [t, r] = await Promise.all([
       dbSelect<Tier>("loyalty_tiers", {
         cols: "id, level_name, sub_rank, display_name, min_points, min_turnover, point_multiplier, cashback_pct, sort_order, is_archived",
         where: { is_archived: false },
         order: { col: "sort_order", asc: true },
       }).catch(() => [] as Tier[]),
       dbSelect<Rule>("loyalty_rules", { order: { col: "key" } }).catch(() => [] as Rule[]),
     ]);
    setTiers(t);
    setRules(r);
    setLoading (false);
  };
  useEffect(() => { load(); }, []);

  const saveTier = async (tier: Tier) => {
    setSavingId (tier.id);
     try {
       await dbUpdate("loyalty_tiers", {
         display_name : tier.display_name ,
         min_points : tier.min_points ,
         min_turnover: tier.min_turnover,
         point_multiplier : tier.point_multiplier ,
         cashback_pct: Math.min(Number(tier.cashback_pct) || 0, 1.5),
       }, { id: tier.id });
       toast.success(`${tier.display_name} kaydedildi`);
     } catch (err) {
       toast.error(translateError(err));
     } finally {
       setSavingId(null);
     }
  };

  const saveRule = async (rule: Rule) => {
    setSavingId (rule.id);
     try {
       await dbUpdate("loyalty_rules", {
         value: rule.value, is_active: rule.is_active , description: rule.description ,
       }, { id: rule.id });
       toast.success("Kural kaydedildi" );
     } catch (err) {
       toast.error(translateError(err));
     } finally {
       setSavingId(null);
     }
  };

  if (loading) return (
     <AdminLayout title="Sadakat Yönetimi" requireAny={["loyalty:view"]} >
       <div className="p-12 flex justify-center" ><Loader2 className="animate-spin" /></div>
     </AdminLayout>
  );

  return (
    <AdminLayout title="Sadakat" requireAny={["loyalty:view"]} >
      <Tabs defaultValue="tiers">
        <TabsList>
           <TabsTrigger value="tiers">Seviyeler</TabsTrigger>
           <TabsTrigger value="rules">Puan Kuralları </TabsTrigger>
        </TabsList>

        <TabsContent value="tiers" className="space-y-3">
          <div className="text-xs text-muted-foreground p-3 rounded-lg bg-muted/40 border space-y-1">
            <div><strong>ℹ️ Sadakat Programı — Nasıl çalışıyor:</strong></div>
            <div>• Üye mağazada harcadıkça puan kazanır. Para yatırmaktan puan gelmez.</div>
            <div>• Üst seviyeye geçmek için HEM yeterli puan HEM yeterli toplam harcama (turnover) gerek.</div>
            <div>• Cashback şimdilik kapalıdır. İleride açılırsa üst sınır %1,5 olacak şekilde korunur.</div>
            <div>• Sık para çeken üyenin puan çarpanı 30 gün boyunca yarıya düşer (anti-farming).</div>
          </div>
          {tiers.map((tier, idx) => (
            <Card key={tier.id} className="p-4">
              <div className="flex items-center justify-between mb-3" >
                 <div className="flex items-center gap-2" >
                   <Badge variant="outline">{tier.level_name}</Badge>
                   <h3 className="font-semibold text-lg" >{tier.display_name}</h3>
                   <span className="text-xs text-muted-foreground">
                     {SUB_LEVEL_LABELS[tier.sub_rank] ?? `Barem ${tier.sub_rank + 1}`} · sıra {tier.sort_order}
                   </span>
                 </div>
                 <Button size="sm" onClick={() => saveTier(tier)} disabled={savingId === tier.id}>
{savingId === tier.id ? <Loader2 className="animate-spin size-4" /> : <Save className="size-4 mr-2" />}
                    Kaydet
                  </Button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                     <Label>Görünen Ad</Label>
                     <Input value={tier.display_name}
                       onChange={(e) => setTiers(tiers.map((t, i) => i === idx ? { ...t, display_name: e.target.value } : t))} />
                  </div>
                  <div>
                     <Label>Min Puan</Label>
                     <Input type="number" min="0" value={tier.min_points}
                       onChange={(e) => setTiers(tiers.map((t, i) => i === idx ? { ...t, min_points: Number(e.target.value) } : t))} />
                  </div>
                  <div>
                     <Label>Min Turnover (₺)</Label>
                     <Input type="number" min="0" value={tier.min_turnover}
                       onChange={(e) => setTiers(tiers.map((t, i) => i === idx ? { ...t, min_turnover: Number(e.target.value) } : t))} />
                  </div>
                  <div>
                     <Label>Puan Çarpanı (×)</Label>
                     <Input type="number" min="1" max="5" step="0.1" value={tier.point_multiplier}
                       onChange={(e) => setTiers(tiers.map((t, i) => i === idx ? { ...t, point_multiplier: Number(e.target.value) } : t))} />
                  </div>
                  <div>
                     <Label>Cashback (%) — şimdilik kapalı, max 1.5</Label>
                     <Input type="number" min="0" max="1.5" step="0.1" value={tier.cashback_pct}
                       onChange={(e) => setTiers(tiers.map((t, i) => i === idx ? { ...t, cashback_pct: Number(e.target.value) } : t))} />
                  </div>
                </div>
              </Card>
            ))}
          </TabsContent>

          <TabsContent value="rules" className="space-y-3">
            {rules.map((rule, idx) => (
              <Card key={rule.id} className="p-4">
                <div className="flex items-center justify-between mb-3" >
                  <div>
                     <code className="text-xs bg-muted px-2 py-1 rounded" >{rule.key}</code>
                  </div>
                  <div className="flex items-center gap-3" >
                     <Switch checked={rule.is_active}
                       onCheckedChange ={(v) => setRules(rules.map((r, i) => i === idx ? { ...r, is_active: v } : r))} />
                     <Button size="sm" onClick={() => saveRule(rule)} disabled={savingId === rule.id}>
                       {savingId === rule.id ? <Loader2 className="animate-spin size-4" /> : <Save className="size-4 mr-2"/>}
                       Kaydet
                     </Button>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3" >
                  <div className="md:col-span-2" >
                     <Label>Açıklama</Label>
                     <Input value={rule.description}
                       onChange={(e) => setRules(rules.map((r, i) => i === idx ? { ...r, description: e.target.value } : r))} />
                  </div>
                  <div>
                     <Label>Değer</Label>
                     <Input type="number" step="0.01" value={rule.value}
                       onChange={(e) => setRules(rules.map((r, i) => i === idx ? { ...r, value: Number(e.target.value) } :r))} />
                  </div>
                </div>
              </Card>
            ))}
          </TabsContent>
        </Tabs>
      </AdminLayout>
   );
}
