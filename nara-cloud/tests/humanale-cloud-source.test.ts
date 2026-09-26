import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root =
  new URL(
    "../",
    import.meta.url
  );

const repositoryRoot =
  new URL(
    "../../",
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
  "HumanALE bridge is Owner-authenticated, same-origin and CSRF protected",
  async () => {
    const [
      routes,
      server
    ] =
      await Promise.all([
        read(
          "src/routes/humanale.routes.ts"
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
      /"\/context"[\s\S]*requireTrustedOrigin[\s\S]*requireJsonContentType[\s\S]*requireCsrf/
    );

    assert.match(
      routes,
      /HUMANALE_CONTEXT_APPROVAL_REQUIRED/
    );

    assert.match(
      routes,
      /NARA_HUMANALE_CONTEXT_GRANTED/
    );

    assert.doesNotMatch(
      routes,
      /OPENAI_API_KEY|GEMINI_API_KEY|ANTHROPIC_API_KEY|COMPAT_API_KEY|GOOGLE_DRIVE_CLIENT_SECRET|GOOGLE_DRIVE_REFRESH_TOKEN/
    );

    assert.match(
      server,
      /"\/api\/humanale"[\s\S]*humanaleRouter/
    );
  }
);

test(
  "cloud context packet remains compatible with trusted desktop memory validator",
  async () => {
    const [
      packet,
      desktopValidator
    ] =
      await Promise.all([
        read(
          "src/humanale/context-packet.ts"
        ),
        readFile(
          new URL(
            "desktop/memory-context.mjs",
            repositoryRoot
          ),
          "utf8"
        )
      ]);

    for (const target of [
      "reasoner",
      "planner",
      "agent"
    ]) {
      assert.match(
        packet,
        new RegExp(
          '"' +
          target +
          '"'
        )
      );

      assert.match(
        desktopValidator,
        new RegExp(
          "'" +
          target +
          "'"
        )
      );
    }

    for (const mode of [
      "ask",
      "auto-safe"
    ]) {
      assert.match(
        packet,
        new RegExp(
          '"' +
          mode +
          '"'
        )
      );

      assert.match(
        desktopValidator,
        new RegExp(
          "'" +
          mode +
          "'"
        )
      );
    }

    assert.match(
      packet,
      /MAX_CONTEXT_ENTRIES[\s\S]*6/
    );

    assert.match(
      packet,
      /MAX_CONTEXT_CHARS[\s\S]*1_600/
    );

    assert.match(
      desktopValidator,
      /count>6/
    );

    assert.match(
      desktopValidator,
      /text\.length>1600/
    );

    for (const field of [
      "version",
      "target",
      "mode",
      "approved",
      "count",
      "chars",
      "entryIds",
      "text"
    ]) {
      assert.match(
        packet,
        new RegExp(
          field
        )
      );

      assert.match(
        desktopValidator,
        new RegExp(
          field
        )
      );
    }
  }
);

test(
  "cloud bridge never edits or imports HumanALE face assets",
  async () => {
    const [
      packet,
      service,
      routes
    ] =
      await Promise.all([
        read(
          "src/humanale/context-packet.ts"
        ),
        read(
          "src/services/humanale-cloud.service.ts"
        ),
        read(
          "src/routes/humanale.routes.ts"
        )
      ]);

    const source =
      packet +
      service +
      routes;

    assert.doesNotMatch(
      source,
      /reference-face|face-rig|avatar\.js|humanale-hologram\/dist\/assets/
    );

    assert.doesNotMatch(
      source,
      /node:fs|writeFile|copyFile|rename|unlink/
    );
  }
);
