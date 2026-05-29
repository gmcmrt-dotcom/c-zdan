import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDownLeft, ArrowUpRight, CheckCircle2, ScanLine, Sparkles, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Step = {
  icon: typeof Wallet;
  title: string;
  body: string;
};

const TOUR_VERSION = "v1";

export default function FirstLoginTour({ userId }: { userId: string | undefined }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  const storageKey = userId ? `wallet:first-login-tour:${TOUR_VERSION}:${userId}` : "";
  const steps: Step[] = useMemo(() => [
    {
      icon: Wallet,
      title: t("member.firstLoginTour.steps.wallet.title"),
      body: t("member.firstLoginTour.steps.wallet.body"),
    },
    {
      icon: ArrowDownLeft,
      title: t("member.firstLoginTour.steps.topup.title"),
      body: t("member.firstLoginTour.steps.topup.body"),
    },
    {
      icon: ArrowUpRight,
      title: t("member.firstLoginTour.steps.withdraw.title"),
      body: t("member.firstLoginTour.steps.withdraw.body"),
    },
    {
      icon: ScanLine,
      title: t("member.firstLoginTour.steps.payment.title"),
      body: t("member.firstLoginTour.steps.payment.body"),
    },
    {
      icon: Sparkles,
      title: t("member.firstLoginTour.steps.loyalty.title"),
      body: t("member.firstLoginTour.steps.loyalty.body"),
    },
  ], [t]);

  useEffect(() => {
    if (!storageKey) return;
    if (window.localStorage.getItem(storageKey) === "done") return;
    const timer = window.setTimeout(() => setOpen(true), 500);
    return () => window.clearTimeout(timer);
  }, [storageKey]);

  const finish = () => {
    if (storageKey) window.localStorage.setItem(storageKey, "done");
    setOpen(false);
  };

  const current = steps[step];
  const Icon = current.icon;
  const isLast = step === steps.length - 1;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) finish();
        else setOpen(true);
      }}
    >
      <DialogContent className="max-w-sm rounded-3xl p-0 overflow-hidden">
        <div className="bg-primary/10 p-5">
          <div className="size-12 rounded-2xl bg-primary text-primary-foreground flex items-center justify-center mb-4">
            <Icon className="size-6" />
          </div>
          <DialogHeader className="text-left">
            <DialogTitle className="text-xl leading-tight">{current.title}</DialogTitle>
            <DialogDescription className="text-sm leading-relaxed pt-1">
              {current.body}
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="px-5 pb-5 space-y-4">
          <div className="flex items-center justify-center gap-1.5 pt-1">
            {steps.map((_, idx) => (
              <span
                key={idx}
                className={`h-1.5 rounded-full transition-all ${idx === step ? "w-6 bg-primary" : "w-1.5 bg-muted-foreground/30"}`}
              />
            ))}
          </div>

          <DialogFooter className="sm:justify-between gap-2">
            <Button variant="ghost" onClick={finish}>
              {t("member.firstLoginTour.skip")}
            </Button>
            <Button
              onClick={() => {
                if (isLast) finish();
                else setStep((s) => s + 1);
              }}
            >
              {isLast ? (
                <>
                  <CheckCircle2 className="size-4 mr-1" />
                  {t("member.firstLoginTour.finish")}
                </>
              ) : (
                t("member.firstLoginTour.next")
              )}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
