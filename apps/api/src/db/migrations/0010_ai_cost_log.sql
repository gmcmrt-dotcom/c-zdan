-- K6 — AI cost tracker for soft-alert at 80% of daily budget (Q8).
--
-- Tracks every Anthropic call's token usage so the daily-budget cron can
-- compute current spend and emit a Telegram/log alert when 80% threshold
-- is crossed. We store input/output tokens separately so we can audit per
-- model later (different models price differently).

CREATE TABLE IF NOT EXISTS ai_cost_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  day             date NOT NULL DEFAULT CURRENT_DATE,
  provider        text NOT NULL DEFAULT 'anthropic',
  model           text NOT NULL,
  caller          text,                     -- 'bo-ai-assistant' / 'chat-ai-reply' / etc.
  input_tokens    integer NOT NULL DEFAULT 0,
  output_tokens   integer NOT NULL DEFAULT 0,
  cost_cents      integer NOT NULL DEFAULT 0,
  user_id         uuid,                     -- caller (best-effort, may be null)
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (input_tokens >= 0 AND output_tokens >= 0 AND cost_cents >= 0)
);

CREATE INDEX IF NOT EXISTS ai_cost_log_day_idx ON ai_cost_log (day DESC);
CREATE INDEX IF NOT EXISTS ai_cost_log_caller_day_idx ON ai_cost_log (caller, day DESC);
