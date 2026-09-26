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
  "all NARA API responses inherit no-store before route mounting",
  async () => {
    const server =
      await read(
        "src/apps/naraServer.ts"
      );

    const noStoreIndex =
      server.indexOf(
        '"/api",'
      );

    const aiIndex =
      server.indexOf(
        '"/api/ai",'
      );

    assert.ok(
      noStoreIndex >= 0
    );

    assert.ok(
      aiIndex >
        noStoreIndex
    );

    assert.match(
      server,
      /apiNoStore/
    );
  }
);

test(
  "AI, Memory and Backup mutations require trusted origin plus CSRF",
  async () => {
    const [
      ai,
      memory,
      backup
    ] =
      await Promise.all([
        read(
          "src/routes/ai.routes.ts"
        ),
        read(
          "src/routes/memory.routes.ts"
        ),
        read(
          "src/routes/backup.routes.ts"
        )
      ]);

    for (const source of [
      ai,
      memory,
      backup
    ]) {
      assert.match(
        source,
        /requireTrustedOrigin/
      );

      assert.match(
        source,
        /requireCsrf/
      );
    }

    assert.match(
      ai,
      /"\/chat"[\s\S]*requireTrustedOrigin[\s\S]*requireJsonContentType[\s\S]*requireCsrf/
    );

    assert.match(
      ai,
      /"\/stream"[\s\S]*requireTrustedOrigin[\s\S]*requireJsonContentType[\s\S]*requireCsrf/
    );

    assert.match(
      memory,
      /router\.post\([\s\S]*requireTrustedOrigin[\s\S]*requireJsonContentType[\s\S]*requireCsrf/
    );

    assert.match(
      memory,
      /router\.delete\([\s\S]*requireTrustedOrigin[\s\S]*requireCsrf/
    );

    assert.match(
      backup,
      /"\/google-drive"[\s\S]*requireTrustedOrigin[\s\S]*requireCsrf/
    );

    assert.match(
      backup,
      /"\/usb"[\s\S]*requireTrustedOrigin[\s\S]*requireJsonContentType[\s\S]*requireCsrf/
    );
  }
);

test(
  "logout uses centralized origin and CSRF middleware",
  async () => {
    const server =
      await read(
        "src/apps/naraServer.ts"
      );

    assert.match(
      server,
      /"\/logout"[\s\S]*requireApiAuth[\s\S]*requireTrustedOrigin[\s\S]*requireCsrf/
    );

    assert.doesNotMatch(
      server,
      /function validOrigin/
    );
  }
);

test(
  "JSON media type guard fails closed",
  async () => {
    const source =
      await read(
        "src/middleware/requireJsonContentType.ts"
      );

    assert.match(
      source,
      /application\/json/
    );

    assert.match(
      source,
      /application\/\*\+json/
    );

    assert.match(
      source,
      /status\(415\)/
    );

    assert.match(
      source,
      /JSON_CONTENT_TYPE_REQUIRED/
    );
  }
);
