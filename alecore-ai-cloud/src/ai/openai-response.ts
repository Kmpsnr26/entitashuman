import type {
  AiUsage
} from "./types.js";

interface OpenAiContent {
  type?: string;
  text?: string;
}

interface OpenAiOutputItem {
  type?: string;
  content?: OpenAiContent[];
}

export interface OpenAiResponse {
  id?: string;

  status?:
    | "completed"
    | "failed"
    | "incomplete"
    | "in_progress"
    | "queued";

  incomplete_details?: {
    reason?: string;
  };

  output?: OpenAiOutputItem[];

  output_text?: string;

  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
}

export function extractOpenAiText(
  response: OpenAiResponse
): string {
  if (
    typeof response.output_text ===
      "string" &&
    response.output_text.trim()
  ) {
    return response.output_text;
  }

  const pieces: string[] = [];

  for (
    const item
    of response.output ?? []
  ) {
    for (
      const content
      of item.content ?? []
    ) {
      if (
        content.type ===
          "output_text" &&
        typeof content.text ===
          "string"
      ) {
        pieces.push(
          content.text
        );
      }
    }
  }

  return pieces.join("");
}

export function extractOpenAiUsage(
  response:
    OpenAiResponse | undefined
): AiUsage {
  const usage =
    response?.usage;

  return {
    inputTokens:
      usage?.input_tokens,

    outputTokens:
      usage?.output_tokens,

    totalTokens:
      usage?.total_tokens
  };
}
