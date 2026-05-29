import { useState } from "react";
import { Check, Copy } from "lucide-react" ;
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { copyToClipboard } from "@/lib/clipboard" ;

interface CopyButtonProps {
  value: string;
  label?: string;
  className?: string;
  size?: "sm" | "md";
}

export function CopyButton({ value, label = "Kopyala", className, size = "sm" }: CopyButtonProps ) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent ) => {
    e.stopPropagation ();
    e.preventDefault ();
     const success = await copyToClipboard (value);
     if (success) {
       setCopied (true);
       toast.success("Kopyalandı");
       window.setTimeout(() => setCopied(false), 1500);
     } else {
       toast.error("Kopyalanamadı" );
     }
  };

  const sizeClass = size === "sm" ? "size-6" : "size-8";
  const iconClass = size === "sm" ? "size-3" : "size-4";

  return (
     <button
       type="button"
       onClick={handleCopy}
       aria-label={label}
       title={label}
       className={cn(
          "inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-mutedtransition-colors" ,
         sizeClass ,
         className ,
       )}
     >
       {copied ? (
          <Check className={cn(iconClass, "text-success" )} />
       ) : (
          <Copy className={iconClass} />
       )}
     </button>
  );
}

export default CopyButton;
