import MerchantLayout from "@/components/MerchantLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useEffect, useState } from "react";
import { rpc } from "@/lib/rpc";
import { BookOpen, Download, ExternalLink, FileText, Globe } from "lucide-react";
import { Link } from "react-router-dom";

const DOCS = [
  {
    id: "guide-tr",
    title: "Entegrasyon kılavuzu (Türkçe)",
    desc: "Akış A/B, HMAC imza, parent/bayi modeli, hata kodları ve örnekler.",
    href: "/merchant-api/COMMERCE_MERCHANT_API_GUIDE.md",
    icon: FileText,
  },
  {
    id: "guide-en",
    title: "Integration guide (English)",
    desc: "Full commerce API reference in English.",
    href: "/merchant-api/COMMERCE_MERCHANT_API_GUIDE_EN.md",
    icon: Globe,
  },
  {
    id: "quickstart",
    title: "1 sayfa özet",
    desc: "Hızlı başvuru: endpoint’ler, header’lar ve örnek body.",
    href: "/merchant-api/COMMERCE_MERCHANT_API_QUICKSTART.md",
    icon: BookOpen,
  },
] as const;

export default function MerchantApiDocs() {
  const [merchantType, setMerchantType] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    rpc<{ merchant_type?: string }[]>("merchant_self_nav")
      .catch(() => [] as { merchant_type?: string }[])
      .then((data) => {
        const row = (data ?? [])[0] ?? null;
        setMerchantType(row?.merchant_type ?? null);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <MerchantLayout title="API Dokümantasyonu">
        <div className="text-muted-foreground">Yükleniyor…</div>
      </MerchantLayout>
    );
  }

  if (merchantType !== "commerce") {
    return (
      <MerchantLayout title="API Dokümantasyonu">
        <Card className="p-8 text-center max-w-lg">
          <p className="text-sm font-medium">Bu sayfa yalnızca ticari (commerce) merchant içindir.</p>
          <p className="text-xs text-muted-foreground mt-2">
            Finans (yatırma/çekim) entegrasyonunu <strong>her zaman Wallet ekibi</strong> yapar; karşı tarafa API kılavuzu verilmez.
            Sorularınız için Wallet destek ile iletişime geçin.
          </p>
          <Button variant="outline" className="mt-4" asChild>
            <Link to="/merchant/settings">Ayarlara dön</Link>
          </Button>
        </Card>
      </MerchantLayout>
    );
  }

  return (
    <MerchantLayout title="API Dokümantasyonu">
      <div className="space-y-4 max-w-3xl">
        <Card className="p-4 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-sm font-semibold">Ticari merchant API</h2>
            <Badge variant="secondary">Akış A + B</Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Ticari merchant entegrasyonunu <strong>sizin teknik ekibiniz</strong> yapar (Wallet yalnızca credential ve bu kılavuzu sağlar).
            Akışlar: üye ödemesi (<code>merchant-charge</code>), cüzdana aktarım (<code>merchant-credit</code>).
            API anahtarınızı ve imza secret’ınızı{" "}
            <Link to="/merchant/settings" className="text-primary underline-offset-2 hover:underline">
              Ayarlar
            </Link>{" "}
            sayfasından alın. Secret’ı asla bu dokümanlara yazmayın.
          </p>
        </Card>

        <div className="grid gap-3 sm:grid-cols-1">
          {DOCS.map((doc) => (
            <Card key={doc.id} className="p-4 flex flex-col sm:flex-row sm:items-center gap-3">
              <doc.icon className="size-8 text-primary shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">{doc.title}</div>
                <p className="text-xs text-muted-foreground mt-0.5">{doc.desc}</p>
              </div>
              <Button variant="outline" size="sm" className="shrink-0" asChild>
                <a href={doc.href} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="size-4 mr-1" />
                  Aç
                </a>
              </Button>
            </Card>
          ))}
        </div>

        <Card className="p-4 space-y-3">
          <div className="text-sm font-medium flex items-center gap-2">
            <Download className="size-4" />
            Postman koleksiyonu
          </div>
          <p className="text-xs text-muted-foreground">
            Koleksiyon değişkenlerine <code>base_url</code>, <code>api_key</code> ve <code>signing_secret</code> girin.
            Pre-request script her isteği otomatik imzalar. Bayi kullanıyorsanız: child API key + parent signing secret.
          </p>
          <Button variant="default" size="sm" asChild>
            <a href="/merchant-api/Wallet-Commerce-Merchant.postman_collection.json" download>
              <Download className="size-4 mr-1" />
              İndir (.json)
            </a>
          </Button>
        </Card>

        <Card className="p-4 bg-muted/30 border-dashed">
          <p className="text-xs text-muted-foreground">
            <strong>Base URL:</strong>{" "}
            <code className="break-all">https://&lt;wallet-domain&gt;/merchant-api</code>
            <br />
            <strong>Destek:</strong> Hata durumunda <code>wallet_tx_no</code> veya <code>x-merchant-ref</code> paylaşın; secret göndermeyin.
          </p>
        </Card>
      </div>
    </MerchantLayout>
  );
}
