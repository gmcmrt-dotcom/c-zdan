import { useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { invokeFunction } from "@/lib/fn";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fmtTRY } from "@/lib/format";
import { Banknote, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

// Bu sayfa SADECE staging/dev'de kullanılır.
// Mock-merchant-init redirect_url'i buraya yönlendirir; kullanıcı
// "Ödedim" / "İptal et" basar; mock-merchant-complete tetiklenir.
//
// PROD GUARD: VITE_DEV_MOCK_MERCHANT=true env'i set edilmemişse
// production build'de 403 döner.

export default function MockPay() {
  const mockEnabled = import.meta.env.VITE_DEV_MOCK_MERCHANT === "true";
  if (import.meta.env.PROD && !mockEnabled) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="p-8 max-w-md text-center space-y-3">
          <AlertTriangle className="size-10 text-destructive mx-auto" />
          <h1 className="text-xl font-bold">Bu sayfa production'da devre dışı</h1>
          <p className="text-sm text-muted-foreground">
            MockPay sadece dev/staging için. Aktif etmek için <code>VITE_DEV_MOCK_MERCHANT=true</code> env set edin.
          </p>
        </Card>
      </div>
    );
  }
  return <MockPayInner />;
}

function MockPayInner() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const ref = params.get("ref");
  const amount = parseFloat(params.get("amount") ?? "0");
  // I1 — Allowlist the `?return=` parameter. MockPay is dev-only behind
  // VITE_DEV_MOCK_MERCHANT, but the staging build still exposes it, and
  // an open redirect from a dev page is a phish vector. Restrict to
  // same-origin absolute paths only.
  const rawReturn = params.get("return") ?? "/";
  const returnUrl =
    typeof rawReturn === "string" &&
    rawReturn.startsWith("/") &&
    !rawReturn.startsWith("//") &&
    !rawReturn.startsWith("/\\")
      ? rawReturn
      : "/";

  // Audit 9.2 — secret'i sessionStorage'a taşı (tab kapanınca silinir).
  // Eski localStorage anahtarları varsa migrate et + temizle.
  const [merchantApiKey, setMerchantApiKey] = useState(() => {
    const legacy = localStorage.getItem("mockMerchantApiKey");
    if (legacy) {
      sessionStorage.setItem("mockMerchantApiKey", legacy);
      localStorage.removeItem("mockMerchantApiKey");
      return legacy;
    }
    return sessionStorage.getItem("mockMerchantApiKey") ?? "";
  });
  const [merchantSecret, setMerchantSecret] = useState(() => {
    const legacy = localStorage.getItem("mockMerchantSecret");
    if (legacy) {
      sessionStorage.setItem("mockMerchantSecret", legacy);
      localStorage.removeItem("mockMerchantSecret");
      return legacy;
    }
    return sessionStorage.getItem("mockMerchantSecret") ?? "";
  });
  const [flow, setFlow] = useState<"topup" | "withdraw">("topup");
  const [busy, setBusy] = useState(false);

  const complete = async (status: "success" | "failed") => {
    if (!ref) return;
    if (!merchantApiKey || !merchantSecret) {
      return toast.error("Mock merchant credentials gerekli (env'den ya da admin verir)");
    }
    sessionStorage.setItem("mockMerchantApiKey", merchantApiKey);
    sessionStorage.setItem("mockMerchantSecret", merchantSecret);

    setBusy(true);
    try {
      const r = await invokeFunction<any>("mock-merchant-complete", {
        internal_ref: ref,
        amount,
        status,
        flow,
        merchant_api_key: merchantApiKey,
        merchant_signing_secret: merchantSecret,
        customer_name: "Mock Customer",
      });
      if (!r?.success) {
        toast.error(`Callback başarısız (HTTP ${r?.callback_status}): ${JSON.stringify(r?.callback_response)}`);
      } else {
        toast.success(`${status === "success" ? "Ödeme tamamlandı" : "İptal edildi"} — yönlendiriliyor…`);
        setTimeout(() => { window.location.href = returnUrl; }, 1500);
      }
    } catch (err: any) {
      toast.error(err.message ?? "Hata");
    } finally {
      setBusy(false);
    }
  };

  if (!ref) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="p-6 max-w-md">Geçersiz referans (ref parametresi yok)</Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/20 p-4 flex items-center justify-center">
      <Card className="max-w-md w-full p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="size-12 rounded-full bg-primary/10 flex items-center justify-center">
            <Banknote className="size-6 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Mock Ödeme</h1>
            <p className="text-xs text-muted-foreground">Bu sayfa staging/dev test içindir.</p>
          </div>
        </div>

        <div className="bg-warning/10 border border-warning/30 rounded p-3 text-xs flex gap-2">
          <AlertTriangle className="size-4 text-warning shrink-0 mt-0.5" />
          <div>Production'da bu sayfaya gelinmemeli. Gerçek finance merchant'ın ödeme sayfası burada olmalı.</div>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Tutar</Label>
          <div className="text-3xl font-bold tabular-nums">{fmtTRY(amount)}</div>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">İşlem ref</Label>
          <div className="font-mono text-xs text-muted-foreground">{ref}</div>
        </div>

        <div>
          <Label className="text-xs">Akış</Label>
          <div className="grid grid-cols-2 gap-2 mt-1">
            {(["topup","withdraw"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFlow(f)}
                className={`p-2 border-2 rounded-lg text-sm font-medium transition ${flow === f ? "border-primary bg-primary/5" : "border-border"}`}
              >
                {f === "topup" ? "Topup (Akış C)" : "Withdraw (Akış D)"}
              </button>
            ))}
          </div>
        </div>

        <div className="border-t pt-3 space-y-2">
          <div className="text-xs font-medium">Mock Merchant Credentials (test ortamı)</div>
          <div>
            <Label className="text-xs">API Key</Label>
            <Input value={merchantApiKey} onChange={(e) => setMerchantApiKey(e.target.value)} className="font-mono text-xs" />
          </div>
          <div>
            <Label className="text-xs">Signing Secret</Label>
            <Input value={merchantSecret} onChange={(e) => setMerchantSecret(e.target.value)} type="password" className="font-mono text-xs" />
          </div>
          <p className="text-[10px] text-muted-foreground">sessionStorage'da saklanır (tab kapanınca silinir, sadece test).</p>
          <button
            type="button"
            className="text-[10px] underline text-muted-foreground hover:text-destructive"
            onClick={() => {
              sessionStorage.removeItem("mockMerchantApiKey");
              sessionStorage.removeItem("mockMerchantSecret");
              setMerchantApiKey("");
              setMerchantSecret("");
              toast.success("Credentials temizlendi");
            }}
          >
            Credentials'ı temizle
          </button>
        </div>

        <div className="flex gap-2 pt-2">
          <Button onClick={() => complete("success")} disabled={busy} className="flex-1">
            {busy ? "Bekleniyor…" : "Ödedim ✓"}
          </Button>
          <Button onClick={() => complete("failed")} disabled={busy} variant="destructive" className="flex-1">
            İptal et
          </Button>
        </div>

        <Button variant="ghost" onClick={() => nav(returnUrl)} className="w-full" disabled={busy}>
          Vazgeç (callback yapma)
        </Button>
      </Card>
    </div>
  );
}
