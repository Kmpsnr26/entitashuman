import type { Request } from "express";
import { pool } from "../db/pool.js";

interface AuditOptions {
  userId?: string | null;
  eventType: string;
  request?: Request;
  metadata?: Record<string, unknown>;
}

const FORBIDDEN_KEYS =
  /password|passphrase|secret|token|ticket|authorization|cookie|csrf|api.?key|refresh.?token|access.?token/i;

export function sanitizeAuditMetadata(
  value: unknown,
  depth = 0
): unknown {
  if (depth > 4) {
    return "[TRUNCATED]";
  }

  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "string") {
    return value.slice(0, 500);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, 20)
      .map((item) => sanitizeAuditMetadata(item, depth + 1));
  }

  if (typeof value === "object") {
    const output: Record<string, unknown> = {};

    for (const [key, item] of Object.entries(value).slice(0, 30)) {
      if (FORBIDDEN_KEYS.test(key)) {
        output[key] = "[REDACTED]";
      } else {
        output[key] = sanitizeAuditMetadata(item, depth + 1);
      }
    }

    return output;
  }

  return String(value).slice(0, 200);
}

export async function audit(
  options: AuditOptions
): Promise<void> {
  const ip = options.request?.ip ?? null;
  const userAgent =
    options.request?.get("user-agent")?.slice(0, 500) ?? null;

  const eventType = options.eventType.trim().slice(0, 100);

  await pool.query(
    `
      INSERT INTO audit_logs
      (
        user_id,
        event_type,
        ip_address,
        user_agent,
        metadata
      )
      VALUES ($1, $2, $3, $4, $5)
    `,
    [
      options.userId ?? null,
      eventType,
      ip,
      userAgent,
      JSON.stringify(
        sanitizeAuditMetadata(options.metadata ?? {})
      )
    ]
  );
}
