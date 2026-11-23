import { pool } from "../db/pool.js";
import type { AiAttempt } from "../ai/types.js";

interface AiUsageLogInput {
  ownerId: string;
  requestId: string;
  attempt: AiAttempt;
}

function safeLabel(
  value: string | undefined,
  max = 100
): string | null {
  if (!value) {
    return null;
  }

  return value
    .trim()
    .slice(0, max);
}

export async function recordAiUsage(
  input: AiUsageLogInput
): Promise<void> {
  const {
    ownerId,
    requestId,
    attempt
  } = input;

  await pool.query(
    `
      INSERT INTO ai_usage_logs
      (
        request_id,
        owner_id,
        provider,
        model,
        status,
        input_chars,
        output_chars,
        input_tokens,
        output_tokens,
        total_tokens,
        latency_ms,
        error_code,
        fallback_from
      )
      VALUES
      (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10,
        $11, $12, $13
      )
    `,
    [
      requestId,
      ownerId,
      safeLabel(
        attempt.provider,
        40
      ),
      safeLabel(
        attempt.model,
        100
      ),
      attempt.status,
      attempt.inputChars,
      attempt.outputChars,
      attempt.usage
        .inputTokens ??
        null,
      attempt.usage
        .outputTokens ??
        null,
      attempt.usage
        .totalTokens ??
        null,
      attempt.latencyMs,
      safeLabel(
        attempt.errorCode,
        100
      ),
      safeLabel(
        attempt.fallbackFrom,
        40
      )
    ]
  );
}
