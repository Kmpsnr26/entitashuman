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
  "Drive backup export is bounded and Owner scoped",
  async () => {
    const source =
      await read(
        "src/services/backup-export.service.ts"
      );

    assert.match(
      source,
      /FROM alecore_ai_memory/
    );

    assert.match(
      source,
      /WHERE owner_id = \$1/
    );

    assert.match(
      source,
      /BACKUP_MEMORY_RECORD_LIMIT/
    );

    assert.match(
      source,
      /5_000/
    );

    assert.doesNotMatch(
      source,
      /owner_auth_sessions|alecore_ai_app_sessions|ai_usage_logs|password_hash/
    );
  }
);

test(
  "Drive transport keeps credentials server-side and normalizes upstream failures",
  async () => {
    const source =
      await read(
        "src/services/google-drive-backup.service.ts"
      );

    assert.match(
      source,
      /https:\/\/oauth2\.googleapis\.com\/token/
    );

    assert.match(
      source,
      /https:\/\/www\.googleapis\.com\/upload\/drive\/v3\/files/
    );

    assert.match(
      source,
      /GOOGLE_DRIVE_MAX_MULTIPART_BYTES[\s\S]*4_500_000/
    );

    assert.match(
      source,
      /Buffer\.byteLength/
    );

    assert.match(
      source,
      /multipart\/related/
    );

    assert.match(
      source,
      /GOOGLE_DRIVE_AUTH_FAILED/
    );

    assert.match(
      source,
      /GOOGLE_DRIVE_RATE_LIMITED/
    );

    assert.doesNotMatch(
      source,
      /response\.text\(\)/
    );

    assert.doesNotMatch(
      source,
      /console\.log\([\s\S]*(accessToken|refreshToken|clientSecret)/
    );
  }
);

test(
  "Drive backup API preserves Owner auth, CSRF and safe response boundaries",
  async () => {
    const [
      routes,
      server,
      env
    ] =
      await Promise.all([
        read(
          "src/routes/backup.routes.ts"
        ),
        read(
          "src/apps/aleServer.ts"
        ),
        read(
          "src/config/env.ts"
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
      /limit:[\s\S]*5/
    );

    assert.match(
      routes,
      /ALECORE_AI_GOOGLE_DRIVE_BACKUP_CREATED/
    );

    assert.doesNotMatch(
      routes,
      /GOOGLE_DRIVE_CLIENT_SECRET|GOOGLE_DRIVE_REFRESH_TOKEN|access_token|Authorization/
    );

    assert.match(
      server,
      /"\/api\/backups"[\s\S]*backupRouter/
    );

    for (const key of [
      "GOOGLE_DRIVE_CLIENT_ID",
      "GOOGLE_DRIVE_CLIENT_SECRET",
      "GOOGLE_DRIVE_REFRESH_TOKEN",
      "GOOGLE_DRIVE_BACKUP_FOLDER_ID"
    ]) {
      assert.match(
        env,
        new RegExp(key)
      );
    }

    assert.match(
      env,
      /Semua GOOGLE_DRIVE_\* wajib diisi bersama/
    );
  }
);
