import {
  createHmac,
  randomBytes
} from "node:crypto";

import { pool } from "../db/pool.js";
import { env } from "../config/env.js";

const TICKET_LIFETIME_MS = 90 * 1000;

function hashTicket(
  ticket: string
): string {
  return createHmac(
    "sha256",
    env.TICKET_PEPPER
  )
    .update(ticket)
    .digest("hex");
}

export function isTicketCodeFormatValid(
  ticket: string
): boolean {
  return /^[A-Za-z0-9_-]{40,128}$/.test(ticket);
}

export async function issueTicket(
  userId: string,
  audience: string,
  redirectUri: string
): Promise<string> {
  const rawTicket = randomBytes(32).toString("base64url");
  const codeHash = hashTicket(rawTicket);
  const expiresAt = new Date(Date.now() + TICKET_LIFETIME_MS);

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    await client.query(
      `
        DELETE FROM login_tickets
        WHERE expires_at <= NOW()
      `
    );

    await client.query(
      `
        INSERT INTO login_tickets
        (
          code_hash,
          user_id,
          audience,
          redirect_uri,
          expires_at
        )
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (user_id, audience)
        DO UPDATE SET
          code_hash = EXCLUDED.code_hash,
          redirect_uri = EXCLUDED.redirect_uri,
          created_at = NOW(),
          expires_at = EXCLUDED.expires_at
      `,
      [
        codeHash,
        userId,
        audience,
        redirectUri,
        expiresAt
      ]
    );

    await client.query("COMMIT");
    return rawTicket;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function consumeTicket(
  rawTicket: string,
  audience: string,
  redirectUri: string
): Promise<string | null> {
  if (!isTicketCodeFormatValid(rawTicket)) {
    return null;
  }

  const codeHash = hashTicket(rawTicket);

  const result = await pool.query<{
    user_id: string;
  }>(
    `
      DELETE FROM login_tickets
      WHERE code_hash = $1
        AND audience = $2
        AND redirect_uri = $3
        AND expires_at > NOW()
      RETURNING user_id
    `,
    [
      codeHash,
      audience,
      redirectUri
    ]
  );

  return result.rows[0]?.user_id ?? null;
}
