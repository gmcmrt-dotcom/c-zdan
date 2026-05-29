import { useState } from "react";
import { Bot, Loader2, Send, X } from "lucide-react";
import { useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { invokeFunction } from "@/lib/fn";
import { translateError } from "@/lib/i18n-errors";
import { cn } from "@/lib/utils";

type Message = {
  role: "assistant" | "user";
  body: string;
};

const QUICK_QUESTIONS = [
  "Bu sayfayı nasıl kullanırım?",
  "Bu işlem için hangi yetki gerekir?",
  "Hassas veri merkezi ne demek?",
];

export default function BoAiAssistant() {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      body: "Merhaba, kullanım için size nasıl yardımcı olabilirim ?",
    },
  ]);

  const ask = async (text = question) => {
    const q = text.trim();
    if (!q || loading) return;
    setQuestion("");
    setMessages((prev) => [...prev, { role: "user", body: q }]);
    setLoading(true);
    try {
      const data = await invokeFunction<{ reply?: string }>("bo-ai-assistant", {
        question: q,
        page_path: location.pathname,
      });
      const reply = data?.reply || "Şu an cevap üretilemedi. Teknik ekip kontrol etmeli.";
      setMessages((prev) => [...prev, { role: "assistant", body: reply }]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", body: translateError(err, "AI asistan şu an cevap veremiyor.") },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed bottom-5 right-5 z-40">
      {open && (
        <div className="mb-3 w-[360px] max-w-[calc(100vw-2rem)] rounded-2xl border bg-background shadow-2xl overflow-hidden">
          <div className="flex items-center gap-2 border-b px-4 py-3">
            <div className="size-8 rounded-full bg-primary/10 text-primary flex items-center justify-center">
              <Bot className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">BO AI Asistanı</div>
              <div className="text-[11px] text-muted-foreground">Yetki ve kullanım rehberi</div>
            </div>
            <Button variant="ghost" size="icon" className="size-8" onClick={() => setOpen(false)}>
              <X className="size-4" />
            </Button>
          </div>

          <div className="max-h-[360px] overflow-y-auto p-3 space-y-2">
            {messages.map((m, idx) => (
              <div
                key={idx}
                className={cn(
                  "rounded-xl px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap",
                  m.role === "user"
                    ? "ml-8 bg-primary text-primary-foreground"
                    : "mr-8 bg-muted text-foreground",
                )}
              >
                {m.body}
              </div>
            ))}
            {loading && (
              <div className="mr-8 rounded-xl px-3 py-2 text-sm bg-muted flex items-center gap-2">
                <Loader2 className="size-4 animate-spin" />
                Cevap hazırlanıyor...
              </div>
            )}
          </div>

          <div className="border-t p-3 space-y-2">
            <div className="flex flex-wrap gap-1">
              {QUICK_QUESTIONS.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => ask(q)}
                  disabled={loading}
                  className="rounded-full border px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted disabled:opacity-50"
                >
                  {q}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <Textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Örn: Support rolü üyede hangi bilgileri görebilir?"
                rows={2}
                maxLength={1000}
                className="resize-none text-sm"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    ask();
                  }
                }}
              />
              <Button size="icon" className="h-auto self-stretch" onClick={() => ask()} disabled={loading || !question.trim()}>
                {loading ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              </Button>
            </div>
            <div className="text-[10px] text-muted-foreground">
              Canlı veri göstermez; sadece yetki ve kullanım yönlendirmesi yapar.
            </div>
          </div>
        </div>
      )}

      <Button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded-full h-12 px-4 shadow-lg"
      >
        <Bot className="size-4 mr-2" />
        AI Asistan
      </Button>
    </div>
  );
}
