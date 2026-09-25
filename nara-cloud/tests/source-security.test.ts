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
  "servers bind to configured host and never store email in session",
  async () => {
    const [
      auth,
      nara
    ] = await Promise.all([
      read(
        "src/apps/authServer.ts"
      ),
      read(
        "src/apps/naraServer.ts"
      )
    ]);

    assert.match(
      auth,
      /env\.BIND_HOST/
    );

    assert.match(
      nara,
      /env\.BIND_HOST/
    );

    assert.doesNotMatch(
      auth,
      /req\.session\.email\s*=/
    );

    assert.doesNotMatch(
      nara,
      /req\.session\.email\s*=/
    );
  }
);

test(
  "NARA identity is independent from ChatGPT login",
  async () => {
    const [
      auth,
      nara,
      env
    ] = await Promise.all([
      read(
        "src/apps/authServer.ts"
      ),
      read(
        "src/apps/naraServer.ts"
      ),
      read(
        "src/config/env.ts"
      )
    ]);

    const source =
      auth +
      nara +
      env;

    assert.doesNotMatch(
      source,
      /chatgpt|codex login|auth\.json/i
    );

    assert.match(
      source,
      /AUTH_SESSION_SECRET/
    );

    assert.match(
      source,
      /NARA_SESSION_SECRET/
    );
  }
);

test(
  "callback and logout include hardening controls",
  async () => {
    const nara =
      await read(
        "src/apps/naraServer.ts"
      );

    assert.match(
      nara,
      /isTicketCodeFormatValid/
    );

    assert.match(
      nara,
      /Cache-Control/
    );

    assert.match(
      nara,
      /verifyCsrf/
    );

    assert.match(
      nara,
      /clearCookie/
    );

    assert.match(
      nara,
      /escapeHtml/
    );
  }
);

test(
  "production config rejects unsafe origins, placeholders and public bind",
  async () => {
    const source =
      await read(
        "src/config/env.ts"
      );

    assert.match(
      source,
      /superRefine/
    );

    assert.match(
      source,
      /wajib HTTPS di production/
    );

    assert.match(
      source,
      /tidak boleh bind langsung ke semua interface/
    );

    assert.match(
      source,
      /harus berbeda/
    );

    assert.match(
      source,
      /masih memakai placeholder/
    );
  }
);

test(
  "AI Gateway keeps provider keys server-side and protects mutation routes",
  async () => {
    const [
      provider,
      routes,
      usage,
      server
    ] =
      await Promise.all([
        read(
          "src/ai/providers/openai.provider.ts"
        ),
        read(
          "src/routes/ai.routes.ts"
        ),
        read(
          "src/services/ai-usage.service.ts"
        ),
        read(
          "src/apps/naraServer.ts"
        )
      ]);

    assert.match(
      provider,
      /env\.OPENAI_API_KEY/
    );

    assert.match(
      provider,
      /store:\s*false/
    );

    assert.doesNotMatch(
      routes,
      /OPENAI_API_KEY/
    );

    assert.match(
      routes,
      /requireApiAuth/
    );

    assert.match(
      routes,
      /requireCsrf/
    );

    assert.match(
      server,
      /"\/api\/ai"/
    );

    assert.doesNotMatch(
      usage,
      /prompt|message|content/i
    );
  }
);

test(
  "streaming fallback is implemented in gateway rather than exposing provider credentials",
  async () => {
    const gateway =
      await read(
        "src/ai/gateway.ts"
      );

    assert.match(
      gateway,
      /if \(\s*emitted/
    );

    assert.match(
      gateway,
      /fallbackFrom/
    );

    assert.doesNotMatch(
      gateway,
      /OPENAI_API_KEY|Authorization/
    );
  }
);
