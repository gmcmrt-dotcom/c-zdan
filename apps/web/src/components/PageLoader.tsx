import { Loader2 } from "lucide-react";

export default function PageLoader() {
  return (
    <div className="min-h-[40vh] flex items-center justify-center" role="status" aria-label="Yükleniyor">
      <Loader2 className="size-8 animate-spin text-primary" />
    </div>
  );
}
