import { randomUUID } from "node:crypto";

import { pool } from "../db/pool.js";

export type MemoryScope =
  | "short_term"
  | "long_term"
  | "project"
  | "conversation";

export interface MemoryRecord {
  id: string;
  scope: MemoryScope;
  title: string;
  content: string;
  tags: string[];
  importance: number;
  projectKey: string | null;
  conversationId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateMemoryInput {
  ownerId: string;
  scope: MemoryScope;
  title: string;
  content: string;
  importance: number;
  projectKey?: string;
  conversationId?: string;
  tags?: string[];
}

export interface ListMemoryInput {
  ownerId: string;
  scope?: MemoryScope;
  projectKey?: string;
  conversationId?: string;
  limit: number;
}

export class MemoryRelationError extends Error {
  constructor() {
    super("MEMORY_RELATION_NOT_FOUND");
    this.name = "MemoryRelationError";
  }
}

async function assertConversationOwnership(
  ownerId: string,
  conversationId: string | undefined
): Promise<void> {
  if (!conversationId) {
    return;
  }

  const result = await pool.query(
    `
      SELECT 1
      FROM conversations
      WHERE id = $1
        AND owner_id = $2
      LIMIT 1
    `,
    [
      conversationId,
      ownerId
    ]
  );

  if ((result.rowCount ?? 0) === 0) {
    throw new MemoryRelationError();
  }
}

export async function createMemory(
  input: CreateMemoryInput
): Promise<MemoryRecord> {
  await assertConversationOwnership(
    input.ownerId,
    input.conversationId
  );

  const result = await pool.query<MemoryRecord>(
    `
      INSERT INTO nara_memory
      (
        id,
        owner_id,
        memory_type,
        title,
        content,
        tags,
        source,
        importance,
        project_key,
        conversation_id
      )
      VALUES
      (
        $1, $2, $3, $4, $5,
        $6, 'cloud', $7, $8, $9
      )
      RETURNING
        id,
        memory_type AS "scope",
        title,
        content,
        tags,
        importance,
        project_key AS "projectKey",
        conversation_id AS "conversationId",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
    `,
    [
      randomUUID(),
      input.ownerId,
      input.scope,
      input.title,
      input.content,
      input.tags ?? [],
      input.importance,
      input.projectKey ?? null,
      input.conversationId ?? null
    ]
  );

  return result.rows[0]!;
}

export async function listMemory(
  input: ListMemoryInput
): Promise<MemoryRecord[]> {
  const safeLimit = Math.max(
    1,
    Math.min(
      input.limit,
      50
    )
  );

  const result = await pool.query<MemoryRecord>(
    `
      SELECT
        id,
        memory_type AS "scope",
        title,
        content,
        tags,
        importance,
        project_key AS "projectKey",
        conversation_id AS "conversationId",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM nara_memory
      WHERE owner_id = $1
        AND (
          $2::text IS NULL
          OR memory_type = $2
        )
        AND (
          $3::text IS NULL
          OR project_key = $3
        )
        AND (
          $4::uuid IS NULL
          OR conversation_id = $4
        )
      ORDER BY
        importance DESC,
        updated_at DESC
      LIMIT $5
    `,
    [
      input.ownerId,
      input.scope ?? null,
      input.projectKey ?? null,
      input.conversationId ?? null,
      safeLimit
    ]
  );

  return result.rows;
}

export async function findMemory(
  ownerId: string,
  id: string
): Promise<MemoryRecord | null> {
  const result = await pool.query<MemoryRecord>(
    `
      SELECT
        id,
        memory_type AS "scope",
        title,
        content,
        tags,
        importance,
        project_key AS "projectKey",
        conversation_id AS "conversationId",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM nara_memory
      WHERE id = $1
        AND owner_id = $2
      LIMIT 1
    `,
    [
      id,
      ownerId
    ]
  );

  return result.rows[0] ?? null;
}

export async function deleteMemory(
  ownerId: string,
  id: string
): Promise<boolean> {
  const result = await pool.query(
    `
      DELETE FROM nara_memory
      WHERE id = $1
        AND owner_id = $2
    `,
    [
      id,
      ownerId
    ]
  );

  return (result.rowCount ?? 0) > 0;
}
