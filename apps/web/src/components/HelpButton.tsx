import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { HelpCircle, Play } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { dbSelectMaybeOne, type WhereCondition } from "@/lib/db";

type HelpArticle = {
  id: string;
  title_tr: string;
  body_tr: string;
  title_en: string | null;
  body_en: string | null;
  video_url: string | null;
};

/**
 * Sayfa veya buton bazında "?" yardım ikonu.
 * Tıklayınca popover açılır, içeriği help_articles tablosundan çeker.
 *
 * <HelpButton pageKey="/topup" />
 * <HelpButton pageKey="/payment" elementKey="generate-code" />
 */
export default function HelpButton({
  pageKey,
  elementKey,
  audience = "member",
  className = "",
}: {
  pageKey: string;
  elementKey?: string;
  audience?: "member" | "staff" | "both";
  className?: string;
}) {
  const { i18n } = useTranslation();
  const [article, setArticle] = useState<HelpArticle | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const lang = i18n.language?.startsWith("en") ? "en" : "tr";

  useEffect(() => {
    if (!open || article) return;
    setLoading(true);
    const where: WhereCondition[] = [
      { col: "page_key", op: "eq", val: pageKey },
      { col: "scope", op: "eq", val: elementKey ? "button" : "page" },
      { col: "is_active", op: "eq", val: true },
      { col: "audience", op: "in", val: [audience, "both"] },
    ];
    if (elementKey) where.push({ col: "element_key", op: "eq", val: elementKey });
    dbSelectMaybeOne<HelpArticle>("help_articles", {
      cols: "id,title_tr,body_tr,title_en,body_en,video_url",
      where,
    })
      .then((data) => {
        setArticle(data);
        setLoading(false);
      })
      .catch(() => {
        setArticle(null);
        setLoading(false);
      });
  }, [open]);

  const title = (lang === "en" && article?.title_en) ? article.title_en : article?.title_tr;
  const body = (lang === "en" && article?.body_en) ? article.body_en : article?.body_tr;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={`inline-flex items-center justify-center size-6 rounded-full text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors ${className}`}
          aria-label="Yardım"
        >
          <HelpCircle className="size-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72" align="end">
        {loading && <div className="text-sm text-muted-foreground">Yükleniyor…</div>}
        {!loading && !article && (
          <div className="text-sm text-muted-foreground">Bu sayfa için henüz yardım metni eklenmemiş.</div>
        )}
        {article && (
          <div className="space-y-2">
            <h4 className="font-semibold text-sm">{title}</h4>
            <p className="text-xs text-muted-foreground whitespace-pre-line">{body}</p>
            {(() => {
              // I1 — Scheme allowlist on `video_url`. Without this an admin
              // could set a `javascript:` URL or `data:` URL that fires on
              // click. Restrict to http/https only.
              const raw = article.video_url;
              if (!raw) return null;
              let safeHref: string | null = null;
              try {
                const u = new URL(raw);
                if (u.protocol === "http:" || u.protocol === "https:") {
                  safeHref = u.toString();
                }
              } catch {
                safeHref = null;
              }
              if (!safeHref) return null;
              return (
                <a href={safeHref} target="_blank" rel="noopener noreferrer"
                   className="inline-flex items-center gap-1 text-xs text-primary font-medium">
                  <Play className="size-3" /> Video izle
                </a>
              );
            })()}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
