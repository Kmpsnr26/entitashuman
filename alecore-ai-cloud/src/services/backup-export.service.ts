import { pool } from "../db/pool.js";

const BACKUP_MEMORY_RECORD_LIMIT =
  5_000;

export interface MemoryBackupRecord {
  id: string;
  scope: string;
  title: string;
  content: string;
  tags: string[];
  importance: number;
  projectKey: string | null;
  conversationId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MemoryBackupSnapshot {
  schemaVersion: 1;
  kind: "alecore-ai-memory";
  exportedAt: string;
  memories: MemoryBackupRecord[];
}

export class BackupExportError extends Error {
  readonly code:
    | "BACKUP_RECORD_LIMIT_EXCEEDED";

  constructor(
    code:
      | "BACKUP_RECORD_LIMIT_EXCEEDED"
  ) {
    super(code);
    this.name = "BackupExportError";
    this.code = code;
  }
}

export async function createMemoryBackupSnapshot(
  ownerId: string
): Promise<MemoryBackupSnapshot> {
  const result =
    await pool.query<MemoryBackupRecord>(
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
        FROM alecore_ai_memory
        WHERE owner_id = $1
        ORDER BY
          updated_at ASC,
          id ASC
        LIMIT $2
      `,
      [
        ownerId,
        BACKUP_MEMORY_RECORD_LIMIT +
          1
      ]
    );

  if (
    result.rows.length >
    BACKUP_MEMORY_RECORD_LIMIT
  ) {
    throw new BackupExportError(
      "BACKUP_RECORD_LIMIT_EXCEEDED"
    );
  }

  return {
    schemaVersion:
      1,

    kind:
      "alecore-ai-memory",

    exportedAt:
      new Date()
        .toISOString(),

    memories:
      result.rows
  };
}

export {
  BACKUP_MEMORY_RECORD_LIMIT
};
