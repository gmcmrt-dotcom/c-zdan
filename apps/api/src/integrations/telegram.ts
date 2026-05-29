/**
 * Minimal Telegram bot send. Returns null when TG_BOT_TOKEN is not set.
 */
import { env } from "../lib/env";
import { logger } from "../lib/logger";

export interface TgSendResult {
  ok: boolean;
  messageId?: number;
  error?: string;
}

// I1 — Cap the outbound fetch timeout so a stalled Telegram API doesn't
// tie up the chat-tg-notify request thread (or the dispatcher worker).
// AbortSignal.timeout is standard since Node 17.
const TELEGRAM_TIMEOUT_MS = 8_000;

export async function tgSendMessage(opts: {
  chatId: string | number;
  text: string;
  parseMode?: "Markdown" | "HTML";
}): Promise<TgSendResult> {
  if (!env.TG_BOT_TOKEN) return { ok: false, error: "TG_NOT_CONFIGURED" };
  try {
    const res = await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: opts.chatId,
        text: opts.text,
        parse_mode: opts.parseMode,
      }),
      signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS),
    });
    const json = (await res.json().catch(() => null)) as { ok?: boolean; result?: { message_id?: number }; description?: string } | null;
    if (json?.ok) return { ok: true, messageId: json.result?.message_id };
    return { ok: false, error: json?.description ?? `HTTP_${res.status}` };
  } catch (err) {
    logger.warn({ err }, "telegram send failed");
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
