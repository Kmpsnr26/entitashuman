import "dotenv/config";
import { z } from "zod";

const EnvSchema = z.object({
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
  TICKET_PEPPER: z.string().min(32)
});

export const env = EnvSchema.parse(process.env);
export const isProduction = env.NODE_ENV === "production";
