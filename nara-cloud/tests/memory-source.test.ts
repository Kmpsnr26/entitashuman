import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root =
  new URL(
    "../",
    import.meta.url
  );

const read = (
  path: string
): Promise<string> =>
  readFile(
    new URL(
      path,
      root
    ),
    "utf8"
  );

test(
  "Phase 11C migration is wired into the executable migration",
  async () => {
    const migration =
      await read(
        "src/db/migrate.ts"
      );

    assert.match(
      migration,
      /ADD COLUMN IF NOT EXISTS project_key TEXT/
    );

    assert.match(
      migration,
      /ADD COLUMN IF NOT EXISTS conversation_id UUID/
    );

    for (const scope of [
      "short_term",
      "long_term",
      "project",
      "conversation"
    ]) {
      assert.match(
        migration,
        new RegExp(
          "'" + scope + "'"
        )
      );
    }

    assert.match(
      migration,
      /idx_nara_memory_owner_scope_updated/
    );

    assert.match(
      migration,
      /idx_nara_memory_project/
    );
  }
);

test(
  "memory service keeps every record operation owner-scoped",
  async () => {
    const service =
      await read(
        "src/services/memory.service.ts"
      );

    assert.match(
      service,
      /INSERT INTO nara_memory/
    );

    assert.match(
      service,
      /FROM nara_memory[\s\S]*WHERE owner_id = \$1/
    );

    assert.match(
      service,
      /WHERE id = \$1[\s\S]*AND owner_id = \$2/
    );

    assert.match(
      service,
      /DELETE FROM nara_memory[\s\S]*AND owner_id = \$2/
    );

    assert.match(
      service,
      /FROM conversations[\s\S]*owner_id = \$2/
    );

    assert.match(
      service,
      /Math\.min\([\s\S]*50/
    );

    assert.doesNotMatch(
      service,
      /API_KEY|Authorization|Bearer\s/
    );
  }
);

test(
  "memory API requires Owner authentication and CSRF for mutations",
  async () => {
    const [
      routes,
      server
    ] =
      await Promise.all([
        read(
          "src/routes/memory.routes.ts"
        ),
        read(
          "src/apps/naraServer.ts"
        )
      ]);

    assert.match(
      routes,
      /router\.use\([\s\S]*requireApiAuth/
    );

    assert.match(
      routes,
      /router\.post\([\s\S]*requireCsrf/
    );

    assert.match(
      routes,
      /router\.delete\([\s\S]*requireCsrf/
    );

    assert.match(
      routes,
      /\.max\(50\)/
    );

    assert.match(
      routes,
      /INVALID_MEMORY_RELATION/
    );

    assert.match(
      server,
      /"\/api\/memory"[\s\S]*memoryRouter/
    );

    assert.doesNotMatch(
      routes,
      /OPENAI_API_KEY|GEMINI_API_KEY|ANTHROPIC_API_KEY|COMPAT_API_KEY/
    );
  }
);
