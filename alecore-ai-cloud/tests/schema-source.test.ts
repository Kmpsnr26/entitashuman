import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(
  new URL(
    "../src/db/migrate.ts",
    import.meta.url
  ),
  "utf8"
);

test(
  "migration contains required AleCore AI auth and memory tables",
  () => {
    for (const table of [
      "owner_users",
      "login_tickets",
      "audit_logs",
      "alecore_ai_memory",
      "conversations",
      "messages",
      "owner_auth_sessions",
      "alecore_ai_app_sessions",
      "ai_usage_logs"
    ]) {
      assert.match(
        migration,
        new RegExp(
          "CREATE TABLE IF NOT EXISTS\\s+" +
          table
        )
      );
    }
  }
);

test(
  "migration renames legacy NARA tables without losing existing data",
  () => {
    assert.match(migration, /ALTER TABLE public\.nara_memory RENAME TO alecore_ai_memory/);
    assert.match(migration, /ALTER TABLE public\.nara_app_sessions RENAME TO alecore_ai_app_sessions/);
    assert.match(migration, /IF to_regclass\('public\.alecore_ai_memory'\) IS NOT NULL THEN/);
  }
);

test(
  "migration enforces Owner, Argon2id, ticket and memory constraints",
  () => {
    assert.match(
      migration,
      /idx_owner_users_single_active/
    );

    assert.match(
      migration,
      /LOWER\(email\)/
    );

    assert.match(
      migration,
      /password_hash LIKE '\$argon2id\$%'/
    );

    assert.match(
      migration,
      /login_tickets_user_audience_unique/
    );

    assert.match(
      migration,
      /importance BETWEEN 1 AND 5/
    );

    assert.match(
      migration,
      /role IN \('user', 'assistant'\)/
    );
  }
);

test(
  "session tables are migration-owned rather than runtime-created",
  async () => {
    const sessions =
      await readFile(
        new URL(
          "../src/sessions/sessions.ts",
          import.meta.url
        ),
        "utf8"
      );

    assert.match(
      sessions,
      /createTableIfMissing:\s*false/
    );

    assert.doesNotMatch(
      sessions,
      /createTableIfMissing:\s*true/
    );
  }
);

test(
  "AI usage schema records metrics without prompt or response content columns",
  () => {
    const table =
      (
        migration.match(
          /CREATE TABLE IF NOT EXISTS ai_usage_logs \(([\s\S]*?)\n\);/
        ) ??
        []
      )[1] ??
      "";

    assert.match(
      table,
      /request_id UUID NOT NULL/
    );

    assert.match(
      table,
      /provider TEXT NOT NULL/
    );

    assert.match(
      table,
      /input_tokens INTEGER/
    );

    assert.match(
      table,
      /output_tokens INTEGER/
    );

    assert.doesNotMatch(
      table,
      /prompt|message|content|authorization|api.?key/i
    );
  }
);
