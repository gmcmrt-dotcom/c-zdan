import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react" ;
import { DayPicker } from "react-day-picker" ;

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button" ;

export type CalendarProps = React.ComponentProps <typeof DayPicker>;

function Calendar({ className, classNames, showOutsideDays = true, ...props }: CalendarProps ) {
  return (
     <DayPicker
        showOutsideDays ={showOutsideDays }
        className={cn("p-3", className)}
        classNames={{
          months : "flex flex-col sm:flex-row gap-6 sm:gap-8" ,
          month: "space-y-4",
          caption : "flex justify-center pt-1 relative items-center gap-2 min-h-9" ,
          caption_label : "text-sm font-semibold" ,
          caption_dropdowns: "flex items-center justify-center gap-2 text-sm font-semibold",
          dropdown_month: "bg-background text-sm font-medium outline-none cursor-pointer rounded-md px-1",
          dropdown_year: "bg-background text-sm font-medium outline-none cursor-pointer rounded-md px-1",
          dropdown: "bg-background border-0 text-sm font-semibold outline-none cursor-pointer",
          nav: "space-x-1 flex items-center" ,
          nav_button : cn(
             buttonVariants ({ variant: "outline" }),
              "h-7 w-7 bg-transparent p-0 opacity-60 hover:opacity-100 border-0 shadow-none" ,
           ),
          nav_button_previous : "absolute left-1" ,
          nav_button_next : "absolute right-1" ,
          table: "w-full border-collapse space-y-1" ,
          head_row : "flex",
          head_cell : "text-muted-foreground rounded-md w-9 font-semibold text-[0.8rem]" ,
          row: "flex w-full mt-2" ,
          cell: "h-9 w-9 text-center text-sm p-0 relative [&:has([aria-selected].day-range-start)]:rounded-l-lg [&:has([aria-selected].day-range-end)]:rounded-r-lg [&:has([aria-selected])]:bg-sky-100 first:[&:has([aria-selected])]:rounded-l-lg last:[&:has([aria-selected])]:rounded-r-lg focus-within:relative focus-within:z-20" ,
          day: cn(buttonVariants ({ variant: "ghost" }), "h-9 w-9 p-0 font-normal rounded-lg aria-selected:opacity-100 hover:bg-sky-50" ),
          day_range_start : "day-range-start" ,
          day_range_end : "day-range-end" ,
          day_selected :
              "bg-sky-500 text-white hover:bg-sky-500 hover:text-white focus:bg-sky-500 focus:text-white" ,
          day_today : "bg-sky-50 text-sky-600" ,
          day_outside :
              "day-outside text-muted-foreground opacity-50 aria-selected:bg-accent/50 aria-selected:text-muted-foregroundaria-selected:opacity-30" ,
          day_disabled : "text-muted-foreground opacity-50" ,
          day_range_middle : "aria-selected:bg-sky-100 aria-selected:text-foreground aria-selected:rounded-none" ,
          day_hidden : "invisible",
           ...classNames,
        }}
        components={{
          IconLeft : ({ ..._props }) => <ChevronLeft className="h-4 w-4" />,
          IconRight : ({ ..._props }) => <ChevronRight className="h-4 w-4" />,
        }}
        {...props}
     />
  );
}
Calendar.displayName = "Calendar";

export { Calendar };
