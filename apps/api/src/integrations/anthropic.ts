/**
 * Thin Anthropic wrapper. Returns null if ANTHROPIC_API_KEY is not configured
 * so callers can degrade gracefully (chat-ai-reply, bo-ai-assistant).
 */
import Anthropic from "@anthropic-ai/sdk";
import { env } from "../lib/env";
import { logger } from "../lib/logger";

// I1 — Cap the Anthropic SDK's wall-clock timeout. Default is no explicit
// timeout, which means a hanging upstream ties up worker threads until the
// connection drops. 30s is comfortable for the long-context models we use
// (max_tokens defaults to 800, so total response is <10s typical).
const ANTHROPIC_TIMEOUT_MS = 30_000;

let client: Anthropic | null = null;
function getClient(): Anthropic | null {
  if (!env.ANTHROPIC_API_KEY) return null;
  if (!client) {
    client = new Anthropic({
      apiKey: env.ANTHROPIC_API_KEY,
      timeout: ANTHROPIC_TIMEOUT_MS,
      maxRetries: 1,
    });
  }
  return client;
}

export async function askAnthropic(opts: {
  system: string;
  user: string;
  maxTokens?: number;
  /** K6 — Identifier of the calling subsystem so ai_cost_log can attribute
   *  spend (`bo-ai-assistant` / `chat-ai-reply` / etc.). Optional. */
  caller?: string;
  /** Optional user id for cost attribution. */
  userId?: string | null;
}): Promise<string | null> {
  const c = getClient();
  if (!c) return null;
  try {
    // I1 — Hard ceiling on the user-supplied prompt. The bo-ai-assistant
    // and chat-ai-reply callers already cap their transcripts but defensive
    // truncation here means a future caller can't accidentally blow the
    // model's context window (and our bill) with a megabyte payload.
    const MAX_PROMPT_CHARS = 32_000;
    const user = opts.user.length > MAX_PROMPT_CHARS
      ? opts.user.slice(0, MAX_PROMPT_CHARS) + "\n…[truncated]"
      : opts.user;
    const r = await c.messages.create({
      model: env.ANTHROPIC_MODEL,
      max_tokens: opts.maxTokens ?? 800,
      system: opts.system,
      messages: [{ role: "user", content: user }],
    });
    // K6 — Cost log. Best-effort: if it fails the AI call still returns
    // normally (recordAiCall catches its own errors and logs.warn).
    if (r.usage) {
      const { recordAiCall } = await import("../services/ai-cost.service");
      void recordAiCall({
        model: env.ANTHROPIC_MODEL,
        inputTokens: r.usage.input_tokens ?? 0,
        outputTokens: r.usage.output_tokens ?? 0,
        caller: opts.caller ?? null,
        userId: opts.userId ?? null,
      });
    }
    const block = r.content.find((b) => b.type === "text");
    return block && block.type === "text" ? block.text : null;
  } catch (err) {
    logger.warn({ err }, "anthropic call failed");
    return null;
  }
}
