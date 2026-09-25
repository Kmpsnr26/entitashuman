import { randomUUID } from "node:crypto";
import { pool } from "../db/pool.js";

export type MemoryScope = "short_term" | "long_term" | "project" | "conversation";

export async function createMemory(input: {
  ownerId: string;
  scope: MemoryScope;
  title: string;
  content: string;
  importance: number;
  projectKey?: string;
  conversationId?: string;
  tags?: string[];
}) {
  const result = await pool.query(
    "INSERT INTO nara_memory (id, owner_id, memory_type, title, content, tags, source, importance, project_key, conversation_id) VALUES ($1,$2,$3,$4,$5,$6,'cloud',$7,$8,$9) RETURNING id, memory_type, title, content, tags, importance, project_key, conversation_id, created_at, updated_at",
    [randomUUID(), input.ownerId, input.scope, input.title, input.content, input.tags ?? [], input.importance, input.projectKey ?? null, input.conversationId ?? null]
  );
  return result.rows[0];
}

export async function listMemory(ownerId: string, limit = 20) {
  const safeLimit = Math.max(1, Math.min(limit, 50));
  const result = await pool.query(
    "SELECT id, memory_type, title, content, tags, importance, project_key, conversation_id, created_at, updated_at FROM nara_memory WHERE owner_id = $1 ORDER BY importance DESC, updated_at DESC LIMIT $2",
    [ownerId, safeLimit]
  );
  return result.rows;
}

export async function deleteMemory(ownerId: string, id: string): Promise<boolean> {
  const result = await pool.query(
    "DELETE FROM nara_memory WHERE id = $1 AND owner_id = $2",
    [id, ownerId]
  );
  return (result.rowCount ?? 0) > 0;
}
