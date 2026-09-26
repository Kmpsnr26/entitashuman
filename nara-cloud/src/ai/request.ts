import { z } from "zod";

const AiMessageSchema =
  z.object({
    role:
      z.enum([
        "user",
        "assistant"
      ]),

    content:
      z.string()
        .trim()
        .min(1)
        .max(8_000)
  });

export const AiChatSchema =
  z.object({
    message:
      z.string()
        .trim()
        .min(1)
        .max(12_000),

    history:
      z.array(
        AiMessageSchema
      )
        .max(12)
        .default([]),

    provider:
      z.string()
        .trim()
        .min(1)
        .max(40)
        .default("auto")
  })
    .strict();

export type AiChatInput =
  z.infer<
    typeof AiChatSchema
  >;
