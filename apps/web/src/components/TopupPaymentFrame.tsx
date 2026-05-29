import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink, Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isEmbeddableTopupPaymentUrl, parseTopupFrameUrl } from "@/lib/topup-frame";

type Props = {
  paymentUrl: string;
  onOpenExternal?: () => void;
};

const LOAD_WARN_MS = 12_000;

export default function TopupPaymentFrame({ paymentUrl, onOpenExternal }: Props) {
  const { t } = useTranslation();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [loading, setLoading] = useState(true);
  const [slowLoad, setSlowLoad] = useState(false);

  const embedUrl = parseTopupFrameUrl(paymentUrl);
  const allowed = isEmbeddableTopupPaymentUrl(paymentUrl);
  const invalidUrl = !allowed || !embedUrl;

  useEffect(() => {
    if (invalidUrl) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setSlowLoad(false);
    const warnTimer = window.setTimeout(() => setSlowLoad(true), LOAD_WARN_MS);
    return () => window.clearTimeout(warnTimer);
  }, [paymentUrl, invalidUrl]);

  const handleLoad = useCallback(() => {
    setLoading(false);
    setSlowLoad(false);
  }, []);

  const openExternal = useCallback(() => {
    if (!embedUrl) return;
    window.open(embedUrl.href, "_blank", "noopener,noreferrer");
    onOpenExternal?.();
  }, [embedUrl, onOpenExternal]);

  if (invalidUrl) {
    return (
      <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm space-y-3">
        <div className="flex items-start gap-2 text-destructive">
          <AlertTriangle className="size-5 shrink-0 mt-0.5" />
          <p>{t("member.topup.frame.invalidUrl")}</p>
        </div>
        {paymentUrl.trim() && (
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => {
              try {
                const u = new URL(paymentUrl.trim());
                if (u.protocol === "https:") window.open(u.href, "_blank", "noopener,noreferrer");
              } catch {
                /* ignore */
              }
              onOpenExternal?.();
            }}
          >
            <ExternalLink className="size-4 mr-2" />
            {t("member.topup.frame.openExternal")}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="relative rounded-xl border bg-muted/30 overflow-hidden min-h-[min(70dvh,520px)]">
        {loading && (
          <div
            className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-background/80 backdrop-blur-sm"
            aria-live="polite"
          >
            <Loader2 className="size-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">{t("member.topup.frame.loading")}</p>
          </div>
        )}
        <iframe
          ref={frameRef}
          src={embedUrl.href}
          title={t("member.topup.frame.title")}
          className="w-full min-h-[min(70dvh,520px)] border-0 bg-background"
          allow="payment *; clipboard-write"
          referrerPolicy="strict-origin-when-cross-origin"
          onLoad={handleLoad}
        />
      </div>

      {slowLoad && !loading && (
        <div className="rounded-xl border border-warning/40 bg-warning/10 p-3 text-xs text-warning-foreground flex items-start gap-2">
          <AlertTriangle className="size-4 shrink-0 mt-0.5" />
          <span>{t("member.topup.frame.slowHint")}</span>
        </div>
      )}

      <Button type="button" variant="outline" className="w-full h-11" onClick={openExternal}>
        <ExternalLink className="size-4 mr-2" />
        {t("member.topup.frame.openExternal")}
      </Button>
      <p className="text-[11px] text-center text-muted-foreground">{t("member.topup.frame.stayHint")}</p>
    </div>
  );
}
