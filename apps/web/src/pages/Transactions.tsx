import { useEffect, useMemo, useState } from "react";
import { rpc } from "@/lib/rpc";
import { useAuth } from "@/hooks/useAuth" ;
import MemberLayout from "@/components/MemberLayout" ;
import { fmtTRY, fmtDate, txTypeLabel } from "@/lib/format" ;
import { ArrowDownLeft , ArrowUpRight, SlidersHorizontal , X } from "lucide-react" ;
import { TxIdBadge } from "@/components/TxIdBadge";
import { Button } from "@/components/ui/button" ;
import { Input } from "@/components/ui/input" ;
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { tr, enUS } from "date-fns/locale";
import { fetchPointsForTxs } from "@/lib/points";
import { useTranslation } from "react-i18next";
import DateRangePicker from "@/components/DateRangePicker";

type Direction = "all" | "in" | "out";

const inflowTypes = ["topup", "refund", "bonus", "merchant_deposit", "merchant_credit"];

function isoDate(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function localDate(value?: string) {
  if (!value) return undefined;
  const [y, m, d] = value.split("-").map(Number);
  return y && m && d ? new Date(y, m - 1, d) : undefined;
}

export default function Transactions() {
  const { t, i18n } = useTranslation();
  const dfLocale = i18n.language?.startsWith("en") ? enUS : tr;
  const { user } = useAuth();
  const [txs, setTxs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [pointsMap, setPointsMap] = useState<Map<string, number>>(new Map());

  const [panelOpen, setPanelOpen] = useState(false);
  const [direction, setDirection] = useState<Direction>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [amountMin, setAmountMin] = useState("");
  const [amountMax, setAmountMax] = useState("");

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const list = await rpc<any[]>("my_transactions", { _limit: 100 });
        setTxs(list ?? []);
        setLoading(false);
        const pm = await fetchPointsForTxs((list ?? []) as any);
        setPointsMap(pm);
      } catch (err) {
        console.error("my_transactions", err);
        setTxs([]);
        setLoading(false);
      }
    })();
  }, [user]);

  const filtered = useMemo(() => {
    const min = amountMin ? parseFloat(amountMin) : undefined;
    const max = amountMax ? parseFloat(amountMax) : undefined;
    const fromDate = localDate(dateFrom);
    const toDate = localDate(dateTo);
    const fromTs = fromDate ? fromDate.setHours(0, 0, 0, 0) : undefined;
    const toTs = toDate ? toDate.setHours(23, 59, 59, 999) : undefined;

    return txs.filter((tx) => {
      const inflow = inflowTypes.includes(tx.type);
      if (direction === "in" && !inflow) return false;
      if (direction === "out" && inflow) return false;

      const ts = new Date(tx.created_at).getTime();
      if (fromTs !== undefined && ts < fromTs) return false;
      if (toTs !== undefined && ts > toTs) return false;

      const abs = Math.abs(Number(tx.amount));
      if (min !== undefined && !Number.isNaN(min) && abs < min) return false;
      if (max !== undefined && !Number.isNaN(max) && abs > max) return false;

      return true;
    });
  }, [txs, direction, dateFrom, dateTo, amountMin, amountMax]);

  const hasActiveFilter =
    direction !== "all" || !!dateFrom || !!dateTo || !!amountMin || !!amountMax;

  const clearAll = () => {
    setDirection ("all");
    setDateFrom("");
    setDateTo("");
    setAmountMin ("");
    setAmountMax ("");
  };

  const setQuickRange = (days: number | "month") => {
    const now = new Date();
    if (days === "month") {
      setDateFrom(isoDate(new Date(now.getFullYear(), now.getMonth(), 1)));
      setDateTo(isoDate(now));
    } else if (days === 0) {
     setDateFrom(isoDate(now));
     setDateTo(isoDate(now));
   } else {
     const from = new Date();
     from.setDate(now.getDate() - (days - 1));
     setDateFrom(isoDate(from));
     setDateTo(isoDate(now));
   }
};

const summaryParts: string[] = [];
if (dateFrom || dateTo) {
   const fromDate = localDate(dateFrom);
   const toDate = localDate(dateTo);
   if (fromDate && toDate) {
     summaryParts .push(`${format(fromDate, "d MMM", { locale: dfLocale })} — ${format(toDate, "d MMM", { locale: dfLocale })}`);
   } else if (fromDate) {
     summaryParts.push(t("member.transactions.afterDate", { date: format(fromDate, "d MMM", { locale: dfLocale }) }));
   } else if (toDate) {
     summaryParts.push(t("member.transactions.beforeDate", { date: format(toDate, "d MMM", { locale: dfLocale }) }));
   }
}
if (amountMin && amountMax) summaryParts.push(`${amountMin}-${amountMax} ₺`);
else if (amountMin) summaryParts.push(`?${amountMin} ?`);
else if (amountMax) summaryParts.push(`?${amountMax} ?`);
if (direction === "in") summaryParts.push(t("member.transactions.dirIn"));
if (direction === "out") summaryParts.push(t("member.transactions.dirOut"));
const summaryText = hasActiveFilter ? summaryParts.join(" · ") : t("member.transactions.allTxLabel");

return (
   <MemberLayout>
     <div className="pt-4 sm:pt-6 pb-3" >
       <h1 className="text-2xl font-bold">{t("member.transactions.title")}</h1>
       <p className="text-sm text-muted-foreground">{t("member.transactions.subtitle")}</p>
     </div>

     <div className="space-y-3" >
       {/* Filter bar */ }
       <div className="flex items-center gap-2" >
         <div className="flex-1 min-w-0" >
            <div className="text-sm font-medium truncate" >{summaryText}</div>
            <div className="text-xs text-muted-foreground">{t("member.transactions.txCount", { n: filtered.length })}</div>
         </div>
         {hasActiveFilter && (
            <Button variant="ghost" size="icon" onClick={clearAll} aria-label={t("member.transactions.clearAria")} >
               <X className="size-4" />
            </Button>
         )}
         <Button
            variant="outline"
            size="sm"
            onClick={() => setPanelOpen((v) => !v)}
            className="relative"
         >
            <SlidersHorizontal className="size-4" />
           {t("member.transactions.filterButton")}
            {hasActiveFilter && (
               <span className="absolute -top-1 -right-1 size-2 rounded-full bg-primary" />
            )}
         </Button>
       </div>

       {panelOpen && (
         <div className="soft-card rounded-2xl p-4 space-y-4" >
            {/* Direction */ }
            <div>
               <div className="text-xs font-medium text-muted-foreground mb-2">{t("member.transactions.directionLabel")}</div>
               <div className="grid grid-cols-1 min-[280px]:grid-cols-3 gap-1 p-1 rounded-lg bg-muted" >
                 {([
                    ["all", t("member.transactions.all")] as const,
                    ["in", t("member.transactions.dirIn")] as const,
                    ["out", t("member.transactions.dirOut")] as const,
                 ] as const).map(([val, label]) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => setDirection(val)}
                      className={cn(
                         "text-xs font-medium py-1.5 rounded-md transition-colors" ,
                        direction === val
                           ? "bg-background shadow-sm text-foreground"
                           : "text-muted-foreground" ,
                      )}
                    >
                      {label}
                    </button>
                 ))}
               </div>
            </div>

            {/* Date range */ }
            <div>
               <div className="text-xs font-medium text-muted-foreground mb-2">{t("member.transactions.dateRangeLabel")}</div>
               <div className="flex flex-wrap gap-1.5 mb-2" >
                 {[
[t("member.transactions.rangeToday"), 0],
              [t("member.transactions.range7d"), 7],
              [t("member.transactions.range30d"), 30],
              [t("member.transactions.rangeMonth"), "month"],
           ].map(([label, val]) => (
              <button
                 key={String(label)}
                 type="button"
                 onClick={() => setQuickRange (val as any)}
                 className="text-[11px] px-2.5 py-1 rounded-full bg-muted hover:bg-muted/70 text-muted-foreground"
              >
                 {label as string}
              </button>
           ))}
         </div>
         <DateRangePicker
           value={{ from: dateFrom, to: dateTo }}
           onChange={(next) => {
             setDateFrom(next.from ?? "");
             setDateTo(next.to ?? "");
           }}
           buttonClassName="w-full h-10"
         />
      </div>

      {/* Amount range */ }
      <div>
         <div className="text-xs font-medium text-muted-foreground mb-2">{t("member.transactions.amountRange")}</div>
         <div className="grid grid-cols-1 min-[320px]:grid-cols-2 gap-2" >
           <Input
              type="number"
              inputMode="decimal"
              placeholder={t("member.transactions.minPlaceholder")}
              value={amountMin}
              onChange={(e) => setAmountMin(e.target.value)}
           />
           <Input
              type="number"
              inputMode="decimal"
              placeholder={t("member.transactions.maxPlaceholder")}
              value={amountMax}
              onChange={(e) => setAmountMax(e.target.value)}
           />
         </div>
      </div>

      {hasActiveFilter && (
         <Button variant="ghost" size="sm" onClick={clearAll} className="w-full">
           {t("member.transactions.clearFilters")}
         </Button>
      )}
   </div>
)}

{/* List */}
<div className="soft-card rounded-2xl divide-y divide-border overflow-hidden" >
   {loading && <div className="p-6 text-center text-sm text-muted-foreground">{t("member.transactions.loading")}</div>}
   {!loading && txs.length === 0 && (
      <div className="p-8 text-center text-sm text-muted-foreground">{t("member.transactions.noTransactions")}</div>
   )}
   {!loading && txs.length > 0 && filtered.length === 0 && (
      <div className="p-8 text-center text-sm text-muted-foreground" >
        {t("member.transactions.noMatch")}
         <button onClick={clearAll} className="block mx-auto mt-2 text-primary font-medium" >
           {t("member.transactions.clearShort")}
         </button>
      </div>
   )}
   {filtered.map((tx) => {
      const inflow = inflowTypes.includes(tx.type);
      return (
         <div key={tx.id} className="flex items-center gap-3 p-4" >
           <div
              className={`size-10 rounded-full flex items-center justify-center ${
                inflow ? "bg-success/10" : "bg-destructive/10"
              }`}
           >
              {inflow ? (
                 <ArrowDownLeft className="size-5 text-success" />
              ) : (
                 <ArrowUpRight className="size-5 text-destructive" />
              )}
           </div>
           <div className="flex-1 min-w-0" >
              <div className="text-sm font-medium" >{txTypeLabel(tx.type)}</div>
              <div className="text-xs text-muted-foreground" >{fmtDate(tx.created_at)}</div>
              {tx.public_no && (
                <TxIdBadge publicNo={tx.public_no} className="mt-0.5" />
              )}
              {/* Hard rule #7: üye-yüzünde merchant adı / merchant_ref / description gösterilmez.
                  description kolonu backend'de merchant adı içerebilir (Akış A spend, Akış B credit). */}
           </div>
           <div className="text-right">
              <div
                 className={`text-sm font-semibold tabular ${
                   inflow ? "text-success" : "text-destructive"
                 }`}
              >
                 {inflow ? "+" : "−"}
                 {fmtTRY(Math.abs(Number(tx.amount)))}
              </div>
              {/* Hard rule #9: provider/komisyon ücreti üye-yüzünde GÖSTERİLMEZ.
                  tx.fee admin/merchant BO'da göster, üyeye gross = net. */}
                       {pointsMap.get(tx.id) !== undefined && pointsMap.get(tx.id) !== 0 && (
                          <div
                            className={`text-[10px] tabular ${
                               (pointsMap.get(tx.id) ?? 0) > 0 ? "text-success" : "text-destructive"
                            }`}
                          >
                            {(pointsMap.get(tx.id) ?? 0) > 0 ? "+" : "−"}
                            {Math.abs(pointsMap.get(tx.id) ?? 0)} {t("member.home.pointsSuffix")}
                          </div>
                       )}
                     </div>
                   </div>
                );
             })}
          </div>
        </div>
      </MemberLayout>
   );
}

