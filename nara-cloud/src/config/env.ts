import "dotenv/config";
import { z } from "zod";

const BaseEnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

  DATABASE_URL: z.string().min(1),

  BIND_HOST: z
    .string()
    .min(1)
    .default("127.0.0.1"),

  AUTH_PORT: z.coerce
    .number()
    .int()
    .min(1)
    .max(65535)
    .default(4100),

  NARA_PORT: z.coerce
    .number()
    .int()
    .min(1)
    .max(65535)
    .default(4200),

  PUBLIC_AUTH_ORIGIN: z.string().url(),
  PUBLIC_NARA_ORIGIN: z.string().url(),

  AUTH_SESSION_SECRET: z.string().min(32),
  NARA_SESSION_SECRET: z.string().min(32),
  TICKET_PEPPER: z.string().min(32),

  OPENAI_API_KEY: z
    .string()
    .min(20)
    .optional(),

  OPENAI_MODEL: z
    .string()
    .min(1)
    .max(100)
    .default("gpt-6-astra"),

  GEMINI_API_KEY: z
    .string()
    .min(20)
    .optional(),

  GEMINI_MODEL: z
    .string()
    .min(1)
    .max(100)
    .default("gemini-3.8-flash"),

  ANTHROPIC_API_KEY: z
    .string()
    .min(20)
    .optional(),

  ANTHROPIC_MODEL: z
    .string()
    .min(1)
    .max(100)
    .default("claude-sonnet-4-6"),

  COMPAT_PROVIDER_ID: z
    .string()
    .regex(/^[a-z0-9._-]+$/)
    .max(40)
    .default("compatible"),

  COMPAT_API_BASE_URL: z
    .string()
    .url()
    .optional(),

  COMPAT_API_KEY: z
    .string()
    .min(1)
    .optional(),

  COMPAT_MODEL: z
    .string()
    .min(1)
    .max(100)
    .optional(),

  AI_PROVIDER_ORDER: z
    .string()
    .min(1)
    .default("openai,gemini,anthropic,compatible"),

  AI_REQUEST_TIMEOUT_MS:
    z.coerce
      .number()
      .int()
      .min(5_000)
      .max(180_000)
      .default(120_000),

  AI_MAX_OUTPUT_TOKENS:
    z.coerce
      .number()
      .int()
      .min(64)
      .max(8_192)
      .default(2_048)
});

function isBareOrigin(
  value: string
): boolean {
  const url = new URL(value);

  return (
    url.pathname === "/" &&
    url.search === "" &&
    url.hash === ""
  );
}

const EnvSchema =
  BaseEnvSchema.superRefine(
    (value, context) => {
      const secrets = [
        value.AUTH_SESSION_SECRET,
        value.NARA_SESSION_SECRET,
        value.TICKET_PEPPER
      ];

      if (
        new Set(secrets).size !==
        secrets.length
      ) {
        context.addIssue({
          code:
            z.ZodIssueCode.custom,
          message:
            "AUTH_SESSION_SECRET, NARA_SESSION_SECRET dan TICKET_PEPPER harus berbeda.",
          path:
            ["AUTH_SESSION_SECRET"]
        });
      }

      for (
        const [
          key,
          secret
        ] of [
          [
            "AUTH_SESSION_SECRET",
            value.AUTH_SESSION_SECRET
          ],
          [
            "NARA_SESSION_SECRET",
            value.NARA_SESSION_SECRET
          ],
          [
            "TICKET_PEPPER",
            value.TICKET_PEPPER
          ]
        ] as const
      ) {
        if (
          /GANTI|GENERATE|CHANGE_ME|YOUR_/i
            .test(secret)
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode.custom,
            message:
              `${key} masih memakai placeholder.`,
            path:
              [key]
          });
        }
      }

      for (
        const [
          key,
          origin
        ] of [
          [
            "PUBLIC_AUTH_ORIGIN",
            value.PUBLIC_AUTH_ORIGIN
          ],
          [
            "PUBLIC_NARA_ORIGIN",
            value.PUBLIC_NARA_ORIGIN
          ]
        ] as const
      ) {
        if (!isBareOrigin(origin)) {
          context.addIssue({
            code:
              z.ZodIssueCode.custom,
            message:
              `${key} harus berupa origin tanpa path/query/hash.`,
            path:
              [key]
          });
        }
      }

      if (
        value.AUTH_PORT ===
        value.NARA_PORT
      ) {
        context.addIssue({
          code:
            z.ZodIssueCode.custom,
          message:
            "AUTH_PORT dan NARA_PORT harus berbeda.",
          path:
            ["NARA_PORT"]
        });
      }

      if (
        [
          "openai",
          "gemini",
          "anthropic",
          "auto"
        ].includes(
          value.COMPAT_PROVIDER_ID
        )
      ) {
        context.addIssue({
          code:
            z.ZodIssueCode.custom,
          message:
            "COMPAT_PROVIDER_ID memakai ID provider yang dicadangkan.",
          path:
            ["COMPAT_PROVIDER_ID"]
        });
      }

      const compatValues = [
        value.COMPAT_API_BASE_URL,
        value.COMPAT_API_KEY,
        value.COMPAT_MODEL
      ];

      const compatConfigured =
        compatValues.filter(
          value =>
            Boolean(value)
        ).length;

      if (
        compatConfigured !== 0 &&
        compatConfigured !==
          compatValues.length
      ) {
        context.addIssue({
          code:
            z.ZodIssueCode.custom,
          message:
            "COMPAT_API_BASE_URL, COMPAT_API_KEY dan COMPAT_MODEL harus diisi bersama.",
          path:
            ["COMPAT_API_BASE_URL"]
        });
      }

      if (
        value.NODE_ENV ===
        "production"
      ) {
        for (
          const [
            key,
            origin
          ] of [
            [
              "PUBLIC_AUTH_ORIGIN",
              value.PUBLIC_AUTH_ORIGIN
            ],
            [
              "PUBLIC_NARA_ORIGIN",
              value.PUBLIC_NARA_ORIGIN
            ]
          ] as const
        ) {
          if (
            new URL(origin).protocol !==
            "https:"
          ) {
            context.addIssue({
              code:
                z.ZodIssueCode.custom,
              message:
                `${key} wajib HTTPS di production.`,
              path:
                [key]
            });
          }
        }

        if (
          value.BIND_HOST ===
            "0.0.0.0" ||
          value.BIND_HOST ===
            "::"
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode.custom,
            message:
              "Production NARA Cloud tidak boleh bind langsung ke semua interface.",
            path:
              ["BIND_HOST"]
          });
        }

        if (
          value.COMPAT_API_BASE_URL &&
          new URL(
            value.COMPAT_API_BASE_URL
          ).protocol !==
            "https:"
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode.custom,
            message:
              "COMPAT_API_BASE_URL wajib HTTPS di production.",
            path:
              ["COMPAT_API_BASE_URL"]
          });
        }

        if (
          /CHANGE_ME|YOUR_DATABASE_PASSWORD/i
            .test(
              value.DATABASE_URL
            )
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode.custom,
            message:
              "DATABASE_URL production masih memakai placeholder.",
            path:
              ["DATABASE_URL"]
          });
        }
      }
    }
  );

export const env =
  EnvSchema.parse(process.env);

export const isProduction =
  env.NODE_ENV === "production";
