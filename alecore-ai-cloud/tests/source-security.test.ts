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
        "src/apps/aleServer.ts"
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
  "AleCore AI identity is independent from ChatGPT login",
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
        "src/apps/aleServer.ts"
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
      /ALECORE_AI_SESSION_SECRET/
    );
  }
);

test(
  "callback and logout include hardening controls",
  async () => {
    const nara =
      await read(
        "src/apps/aleServer.ts"
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
      /requireCsrf/
    );

    assert.match(
      nara,
      /requireTrustedOrigin/
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
          "src/apps/aleServer.ts"
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

test(
  "multi-provider gateway registers only server-side configured adapters",
  async () => {
    const [
      routes,
      gemini,
      anthropic,
      compatible,
      env
    ] = await Promise.all([
      read(
        "src/routes/ai.routes.ts"
      ),
      read(
        "src/ai/providers/gemini.provider.ts"
      ),
      read(
        "src/ai/providers/anthropic.provider.ts"
      ),
      read(
        "src/ai/providers/openai-compatible.provider.ts"
      ),
      read(
        "src/config/env.ts"
      )
    ]);

    assert.match(
      routes,
      /new OpenAiProvider\(\)/
    );

    assert.match(
      routes,
      /new GeminiProvider\(\)/
    );

    assert.match(
      routes,
      /new AnthropicProvider\(\)/
    );

    assert.match(
      routes,
      /new OpenAiCompatibleProvider\(\)/
    );

    assert.match(
      gemini,
      /env\.GEMINI_API_KEY/
    );

    assert.match(
      anthropic,
      /env\.ANTHROPIC_API_KEY/
    );

    assert.match(
      compatible,
      /env\.COMPAT_API_KEY/
    );

    assert.doesNotMatch(
      routes,
      /GEMINI_API_KEY|ANTHROPIC_API_KEY|COMPAT_API_KEY/
    );

    assert.match(
      env,
      /COMPAT_PROVIDER_ID memakai ID provider yang dicadangkan/
    );

    assert.match(
      env,
      /COMPAT_API_BASE_URL wajib HTTPS di production/
    );
  }
);

test(
  "provider health status exposes no credentials or request content",
  async () => {
    const [
      gateway,
      health,
      routes
    ] = await Promise.all([
      read(
        "src/ai/gateway.ts"
      ),
      read(
        "src/ai/provider-health.ts"
      ),
      read(
        "src/routes/ai.routes.ts"
      )
    ]);

    assert.match(
      gateway,
      /AI_PROVIDER_CIRCUIT_OPEN/
    );

    assert.match(
      gateway,
      /AI_NO_HEALTHY_PROVIDER/
    );

    assert.match(
      gateway,
      /health\.snapshot/
    );

    assert.match(
      health,
      /"ready"/
    );

    assert.match(
      health,
      /"degraded"/
    );

    assert.match(
      health,
      /"unavailable"/
    );

    assert.match(
      health,
      /half-open/
    );

    assert.match(
      health,
      /consecutiveFailures/
    );

    assert.match(
      health,
      /successRate/
    );

    assert.match(
      health,
      /averageLatencyMs/
    );

    assert.match(
      health,
      /lastErrorCode/
    );

    assert.match(
      routes,
      /AI_PROVIDER_CIRCUIT_OPEN/
    );

    assert.match(
      routes,
      /AI_UPSTREAM_REJECTED/
    );

    assert.doesNotMatch(
      routes,
      /code:\s*error\.code/
    );

    assert.doesNotMatch(
      health,
      /API_KEY|Authorization|prompt|message|content|cookie|session/
    );
  }
);

test(
  "provider adapters do not reflect upstream error identifiers into internal codes",
  async () => {
    const [
      openai,
      gemini,
      anthropic,
      compatible
    ] = await Promise.all([
      read(
        "src/ai/providers/openai.provider.ts"
      ),
      read(
        "src/ai/providers/gemini.provider.ts"
      ),
      read(
        "src/ai/providers/anthropic.provider.ts"
      ),
      read(
        "src/ai/providers/openai-compatible.provider.ts"
      )
    ]);

    const source =
      openai +
      gemini +
      anthropic +
      compatible;

    assert.match(
      openai,
      /OPENAI_UPSTREAM_ERROR/
    );

    assert.match(
      gemini,
      /GEMINI_UPSTREAM_ERROR/
    );

    assert.match(
      anthropic,
      /ANTHROPIC_UPSTREAM_ERROR/
    );

    assert.match(
      compatible,
      /COMPAT_UPSTREAM_ERROR/
    );

    assert.doesNotMatch(
      source,
      /code:\s*String\s*\(/
    );

    assert.doesNotMatch(
      source,
      /code\s*=\s*String\s*\(/
    );
  }
);

