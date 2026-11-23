import { pool } from "../db/pool.js";

export interface OwnerAuthRecord {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  is_active: boolean;
}

export interface OwnerUser {
  id: string;
  email: string;
  display_name: string;
  is_active: boolean;
}

export async function findOwnerByEmail(
  email: string
): Promise<OwnerAuthRecord | null> {
  const normalizedEmail = email.trim().toLowerCase();

  const result = await pool.query<OwnerAuthRecord>(
    `
      SELECT
        id,
        email,
        password_hash,
        display_name,
        is_active
      FROM owner_users
      WHERE LOWER(email) = $1
      LIMIT 1
    `,
    [normalizedEmail]
  );

  return result.rows[0] ?? null;
}

export async function findOwnerById(
  id: string
): Promise<OwnerUser | null> {
  const result = await pool.query<OwnerUser>(
    `
      SELECT
        id,
        email,
        display_name,
        is_active
      FROM owner_users
      WHERE id = $1
      LIMIT 1
    `,
    [id]
  );

  return result.rows[0] ?? null;
}

export async function updateLastLogin(
  id: string
): Promise<void> {
  await pool.query(
    `
      UPDATE owner_users
      SET
        last_login_at = NOW(),
        updated_at = NOW()
      WHERE id = $1
    `,
    [id]
  );
}
