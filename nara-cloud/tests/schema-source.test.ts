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
  "migration contains required NARA auth and memory tables",
  () => {
    for (const table of [
      "owner_users",
      "login_tickets",
      "audit_logs",
      "nara_memory",
      "conversations",
      "messages",
      "owner_auth_sessions",
      "nara_app_sessions"
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
