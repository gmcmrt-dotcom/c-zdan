import { CalendarIcon } from "lucide-react";
import { format, startOfMonth, subDays, subMonths } from "date-fns";
import { tr } from "date-fns/locale";
import type { DateRange } from "react-day-picker";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { cn } from "@/lib/utils";

type DateRangeValue = {
  from?: string;
  to?: string;
};

type DateRangePickerProps = {
  value: DateRangeValue;
  onChange: (value: DateRangeValue) => void;
  className?: string;
  buttonClassName?: string;
  placeholder?: string;
  align?: "start" | "center" | "end";
};

function toDate(value?: string) {
  if (!value) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return undefined;
  const d = new Date(year, month - 1, day);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function toIsoDate(date?: Date) {
  if (!date) return undefined;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function label(value: DateRangeValue, placeholder: string) {
  const from = toDate(value.from);
  const to = toDate(value.to);
  if (from && to) {
    return `${format(from, "d MMM yyyy", { locale: tr })} – ${format(to, "d MMM yyyy", { locale: tr })}`;
  }
  if (from) return `${format(from, "d MMM yyyy", { locale: tr })} – …`;
  if (to) return `… – ${format(to, "d MMM yyyy", { locale: tr })}`;
  return placeholder;
}

function presetRange(id: string): DateRangeValue {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (id === "today") return { from: toIsoDate(today), to: toIsoDate(today) };
  if (id === "yesterday") {
    const d = subDays(today, 1);
    return { from: toIsoDate(d), to: toIsoDate(d) };
  }
  if (id === "7d") return { from: toIsoDate(subDays(today, 6)), to: toIsoDate(today) };
  if (id === "30d") return { from: toIsoDate(subDays(today, 29)), to: toIsoDate(today) };
  if (id === "month") return { from: toIsoDate(startOfMonth(today)), to: toIsoDate(today) };
  if (id === "lastMonth") {
    const d = subMonths(today, 1);
    return {
      from: toIsoDate(new Date(d.getFullYear(), d.getMonth(), 1)),
      to: toIsoDate(new Date(d.getFullYear(), d.getMonth() + 1, 0)),
    };
  }
  if (id === "year") return { from: toIsoDate(subDays(today, 364)), to: toIsoDate(today) };
  return {};
}

const PRESETS = [
  { id: "today", label: "Bugün" },
  { id: "yesterday", label: "Dün" },
  { id: "7d", label: "Son 7 Gün" },
  { id: "30d", label: "Son 30 Gün" },
  { id: "month", label: "Bu Ay" },
  { id: "lastMonth", label: "Geçen Ay" },
  { id: "year", label: "Son 1 Yıl" },
] as const;

const CALENDAR_RANGE_CLASSNAMES = {
  months: "flex flex-col sm:flex-row gap-3 sm:gap-4 justify-center",
  month: "space-y-2",
  caption: "flex justify-center pt-1 relative items-center min-h-9",
  caption_label: "hidden",
  caption_dropdowns: "flex items-center justify-center gap-2 text-sm font-medium",
  dropdown_month: "bg-background text-sm font-medium outline-none cursor-pointer rounded-md px-1",
  dropdown_year: "bg-background text-sm font-medium outline-none cursor-pointer rounded-md px-1",
  nav: "flex items-center gap-1",
  nav_button: "h-7 w-7 bg-transparent p-0 opacity-70 hover:opacity-100 border-0 shadow-none",
  nav_button_previous: "absolute left-0",
  nav_button_next: "absolute right-0",
  table: "w-full border-collapse",
  head_row: "flex",
  head_cell: "text-muted-foreground w-9 font-medium text-[0.75rem]",
  row: "flex w-full mt-1",
  cell: cn(
    "h-9 w-9 text-center text-sm p-0 relative",
    "[&:has([aria-selected].day-range-start)]:rounded-l-md",
    "[&:has([aria-selected].day-range-end)]:rounded-r-md",
    "[&:has([aria-selected])]:bg-primary/10",
    "first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md",
  ),
  day: "h-9 w-9 p-0 font-normal rounded-md aria-selected:opacity-100 hover:bg-muted",
  day_range_start: "day-range-start",
  day_range_end: "day-range-end",
  day_selected: "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground",
  day_range_middle: "aria-selected:bg-primary/15 aria-selected:text-foreground rounded-none",
};

export default function DateRangePicker({
  value,
  onChange,
  className,
  buttonClassName,
  placeholder = "Tarih aralığı seç",
  align = "start",
}: DateRangePickerProps) {
  const isWide = useMediaQuery("(min-width: 1024px)");
  const monthCount = isWide ? 2 : 1;

  const selected: DateRange | undefined = {
    from: toDate(value.from),
    to: toDate(value.to),
  };

  const handleSelect = (range?: DateRange) => {
    if (!range?.from) {
      onChange({});
      return;
    }
    onChange({
      from: toIsoDate(range.from),
      to: range.to ? toIsoDate(range.to) : value.to,
    });
  };

  return (
    <Popover modal>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "h-9 min-w-0 justify-start gap-2 text-left font-normal",
            !value.from && !value.to && "text-muted-foreground",
            buttonClassName,
          )}
        >
          <CalendarIcon className="size-4 shrink-0" />
          <span className="truncate">{label(value, placeholder)}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align={align}
        side="bottom"
        sideOffset={8}
        collisionPadding={16}
        className={cn(
          "z-[200] w-auto max-w-[calc(100vw-1rem)] p-0 overflow-hidden rounded-xl shadow-lg",
          className,
        )}
      >
        <div className="flex max-h-[min(85vh,520px)] flex-col sm:max-h-[min(70vh,440px)] sm:flex-row bg-background overflow-hidden">
          {/* Presets: yatay (mobil) / dikey (masaüstü) */}
          <div
            className={cn(
              "shrink-0 border-b sm:border-b-0 sm:border-r bg-muted/30",
              "flex sm:flex-col gap-0.5 p-2 sm:py-3 sm:w-[7.5rem] overflow-x-auto sm:overflow-x-visible",
            )}
          >
            {PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => onChange(presetRange(preset.id))}
                className={cn(
                  "shrink-0 rounded-md px-3 py-1.5 text-left text-xs font-medium whitespace-nowrap",
                  "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                  "sm:w-full",
                )}
              >
                {preset.label}
              </button>
            ))}
          </div>

          <div className="min-w-0 overflow-auto p-2 sm:p-3">
            <Calendar
              mode="range"
              selected={selected}
              onSelect={handleSelect}
              numberOfMonths={monthCount}
              locale={tr}
              captionLayout="dropdown-buttons"
              fromYear={2020}
              toYear={new Date().getFullYear() + 2}
              initialFocus
              className="p-0 pointer-events-auto"
              classNames={CALENDAR_RANGE_CLASSNAMES}
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
