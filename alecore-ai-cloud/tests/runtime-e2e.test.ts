import {
  after,
  before,
  test
} from "node:test";

import assert from "node:assert/strict";

import {
  spawn,
  type ChildProcess
} from "node:child_process";

import {
  randomUUID
} from "node:crypto";

import {
  pool
} from "../src/db/pool.js";

import {
  hashPassword
} from "../src/security/password.js";

import {
  decryptMemoryBackup
} from "../src/services/encrypted-backup.service.js";

const AUTH_ORIGIN =
  process.env.PUBLIC_AUTH_ORIGIN ??
  "http://127.0.0.1:4100";

const ALECORE_AI_ORIGIN =
  process.env.PUBLIC_ALECORE_AI_ORIGIN ??
  "http://127.0.0.1:4200";

const CALLBACK =
  `${ALECORE_AI_ORIGIN}/auth/callback`;

const OWNER_EMAIL =
  "runtime-owner@example.invalid";

const OWNER_PASSWORD =
  "AleCore AI-runtime-e2e-password-2026";

const OWNER_NAME =
  "AleCore AI Runtime Owner";

const BACKUP_PASSPHRASE =
  "AleCore AI-runtime-e2e-backup-passphrase-2026";

const children:
  ChildProcess[] = [];

function cookiePair(
  response: Response
): string {
  const value =
    response.headers.get(
      "set-cookie"
    );

  assert.ok(
    value,
    "Expected Set-Cookie header"
  );

  return value.split(";")[0]!;
}

async function waitForHealth(
  url: string
): Promise<void> {
  const deadline =
    Date.now() + 15_000;

  let lastError:
    unknown;

  while (
    Date.now() <
    deadline
  ) {
    try {
      const response =
        await fetch(url);

      if (response.ok) {
        return;
      }

      lastError =
        new Error(
          `Health status ${response.status}`
        );
    } catch (error) {
      lastError =
        error;
    }

    await new Promise(
      resolve =>
        setTimeout(
          resolve,
          150
        )
    );
  }

  throw new Error(
    `Service did not become healthy: ${url}; ${String(lastError)}`
  );
}

function startServer(
  path: string
): ChildProcess {
  const child =
    spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        path
      ],
      {
        cwd:
          process.cwd(),
        env:
          process.env,
        stdio: [
          "ignore",
          "pipe",
          "pipe"
        ]
      }
    );

  let output =
    "";

  child.stdout?.on(
    "data",
    chunk => {
      output +=
        chunk.toString();
    }
  );

  child.stderr?.on(
    "data",
    chunk => {
      output +=
        chunk.toString();
    }
  );

  child.once(
    "exit",
    code => {
      if (
        code !== null &&
        code !== 0
      ) {
        process.stderr.write(
          `\n[AleCore AI E2E child exit ${code}]\n${output}\n`
        );
      }
    }
  );

  children.push(
    child
  );

  return child;
}

async function json(
  response: Response
): Promise<any> {
  return response.json();
}

async function postJson(
  path: string,
  cookie: string,
  csrf: string,
  body: unknown
): Promise<Response> {
  return fetch(
    ALECORE_AI_ORIGIN + path,
    {
      method:
        "POST",
      redirect:
        "manual",
      headers: {
        Cookie:
          cookie,
        Origin:
          ALECORE_AI_ORIGIN,
        "Content-Type":
          "application/json",
        "X-CSRF-Token":
          csrf
      },
      body:
        JSON.stringify(
          body
        )
    }
  );
}

before(async () => {
  await pool.query(
    "DELETE FROM owner_users"
  );

  await pool.query(
    "DELETE FROM owner_auth_sessions"
  );

  await pool.query(
    "DELETE FROM alecore_ai_app_sessions"
  );

  const passwordHash =
    await hashPassword(
      OWNER_PASSWORD
    );

  await pool.query(
    `
      INSERT INTO owner_users
      (
        id,
        email,
        password_hash,
        display_name
      )
      VALUES ($1, $2, $3, $4)
    `,
    [
      randomUUID(),
      OWNER_EMAIL,
      passwordHash,
      OWNER_NAME
    ]
  );

  startServer(
    "src/apps/authServer.ts"
  );

  startServer(
    "src/apps/aleServer.ts"
  );

  await Promise.all([
    waitForHealth(
      AUTH_ORIGIN +
      "/health"
    ),
    waitForHealth(
      ALECORE_AI_ORIGIN +
      "/health"
    )
  ]);
});

after(async () => {
  for (
    const child of
      children
  ) {
    if (
      child.exitCode ===
        null
    ) {
      child.kill(
        "SIGTERM"
      );
    }
  }

  await pool.query(
    "DELETE FROM owner_users"
  );

  await pool.query(
    "DELETE FROM owner_auth_sessions"
  );

  await pool.query(
    "DELETE FROM alecore_ai_app_sessions"
  );

  await pool.end();
});

test(
  "AleCore AI live runtime completes Owner SSO, memory, HumanALE context, backup and logout",
  async () => {
    const authHealth =
      await fetch(
        AUTH_ORIGIN +
        "/health"
      );

    assert.equal(
      authHealth.status,
      200
    );

    assert.deepEqual(
      await json(
        authHealth
      ),
      {
        ok:
          true,
        service:
          "alecore-ai-auth"
      }
    );

    const aleHealth =
      await fetch(
        ALECORE_AI_ORIGIN +
        "/health"
      );

    assert.equal(
      aleHealth.status,
      200
    );

    assert.deepEqual(
      await json(
        aleHealth
      ),
      {
        ok:
          true,
        service:
          "alecore-ai-app"
      }
    );

    const unauthorized =
      await fetch(
        ALECORE_AI_ORIGIN +
        "/api/me",
        {
          redirect:
            "manual"
        }
      );

    assert.equal(
      unauthorized.status,
      401
    );

    const unauthorizedBody =
      await json(
        unauthorized
      );

    assert.equal(
      unauthorizedBody.error,
      "AUTHENTICATION_REQUIRED"
    );

    assert.match(
      unauthorizedBody.login,
      /\/owner-alecore-ai\/authorize/
    );

    const loginPage =
      await fetch(
        AUTH_ORIGIN +
        "/owner-alecore-ai/login?return_to=" +
        encodeURIComponent(
          CALLBACK
        ),
        {
          redirect:
            "manual"
        }
      );

    assert.equal(
      loginPage.status,
      200
    );

    const ownerCookie =
      cookiePair(
        loginPage
      );

    const html =
      await loginPage.text();

    const csrfMatch =
      html.match(
        /name="csrf_token"\s+value="([^"]+)"/
      );

    assert.ok(
      csrfMatch
    );

    const loginCsrf =
      csrfMatch[1]!;

    const rejectedCsrfLogin =
      await fetch(
        AUTH_ORIGIN +
        "/owner-alecore-ai/login",
        {
          method:
            "POST",
          redirect:
            "manual",
          headers: {
            Cookie:
              ownerCookie,
            "Content-Type":
              "application/x-www-form-urlencoded"
          },
          body:
            new URLSearchParams({
              email:
                OWNER_EMAIL,
              password:
                OWNER_PASSWORD,
              csrf_token:
                "invalid-csrf-token-value",
              return_to:
                CALLBACK
            })
        }
      );

    assert.equal(
      rejectedCsrfLogin.status,
      403
    );

    const login =
      await fetch(
        AUTH_ORIGIN +
        "/owner-alecore-ai/login",
        {
          method:
            "POST",
          redirect:
            "manual",
          headers: {
            Cookie:
              ownerCookie,
            "Content-Type":
              "application/x-www-form-urlencoded"
          },
          body:
            new URLSearchParams({
              email:
                OWNER_EMAIL,
              password:
                OWNER_PASSWORD,
              csrf_token:
                loginCsrf,
              return_to:
                CALLBACK
            })
        }
      );

    assert.equal(
      login.status,
      303
    );

    const callbackLocation =
      login.headers.get(
        "location"
      );

    assert.ok(
      callbackLocation
    );

    const callbackUrl =
      new URL(
        callbackLocation
      );

    assert.equal(
      callbackUrl.origin,
      ALECORE_AI_ORIGIN
    );

    assert.equal(
      callbackUrl.pathname,
      "/auth/callback"
    );

    assert.ok(
      callbackUrl.searchParams
        .get("code")
    );

    const callback =
      await fetch(
        callbackUrl,
        {
          redirect:
            "manual"
        }
      );

    assert.equal(
      callback.status,
      303
    );

    assert.equal(
      callback.headers.get(
        "location"
      ),
      "/"
    );

    const aleCookie =
      cookiePair(
        callback
      );

    const replayedCallback =
      await fetch(
        callbackUrl,
        {
          redirect:
            "manual"
        }
      );

    assert.equal(
      replayedCallback.status,
      401
    );

    const home =
      await fetch(
        ALECORE_AI_ORIGIN +
        "/",
        {
          headers: {
            Cookie:
              aleCookie
          },
          redirect:
            "manual"
        }
      );

    assert.equal(
      home.status,
      200
    );

    assert.match(
      await home.text(),
      /AleCore AI ONLINE/
    );

    const me =
      await fetch(
        ALECORE_AI_ORIGIN +
        "/api/me",
        {
          headers: {
            Cookie:
              aleCookie
          }
        }
      );

    assert.equal(
      me.status,
      200
    );

    const meBody =
      await json(
        me
      );

    assert.equal(
      meBody.authenticated,
      true
    );

    assert.equal(
      meBody.displayName,
      OWNER_NAME
    );

    assert.equal(
      typeof meBody.csrfToken,
      "string"
    );

    assert.ok(
      meBody.csrfToken.length >=
        20
    );

    const csrf =
      meBody.csrfToken as
        string;

    const missingCsrf =
      await fetch(
        ALECORE_AI_ORIGIN +
        "/api/memory/",
        {
          method:
            "POST",
          headers: {
            Cookie:
              aleCookie,
            Origin:
              ALECORE_AI_ORIGIN,
            "Content-Type":
              "application/json"
          },
          body:
            JSON.stringify({
              scope:
                "long_term",
              title:
                "Must be rejected",
              content:
                "No CSRF token."
            })
        }
      );

    assert.equal(
      missingCsrf.status,
      403
    );

    assert.equal(
      (
        await json(
          missingCsrf
        )
      ).error,
      "INVALID_CSRF_TOKEN"
    );

    const wrongContentType =
      await fetch(
        ALECORE_AI_ORIGIN +
        "/api/memory/",
        {
          method:
            "POST",
          headers: {
            Cookie:
              aleCookie,
            Origin:
              ALECORE_AI_ORIGIN,
            "Content-Type":
              "text/plain",
            "X-CSRF-Token":
              csrf
          },
          body:
            "not-json"
        }
      );

    assert.equal(
      wrongContentType.status,
      415
    );

    assert.equal(
      (
        await json(
          wrongContentType
        )
      ).error,
      "JSON_CONTENT_TYPE_REQUIRED"
    );

    const created =
      await postJson(
        "/api/memory/",
        aleCookie,
        csrf,
        {
          scope:
            "long_term",
          title:
            "Runtime E2E memory",
          content:
            "Catatan aman dari pengujian runtime AleCore AI.",
          tags:
            [
              "e2e",
              "runtime"
            ],
          importance:
            4
        }
      );

    assert.equal(
      created.status,
      201
    );

    const createdBody =
      await json(
        created
      );

    const memoryId =
      createdBody.memory.id as
        string;

    assert.match(
      memoryId,
      /^[0-9a-f-]{36}$/i
    );

    const list =
      await fetch(
        ALECORE_AI_ORIGIN +
        "/api/memory/?scope=long_term&limit=20",
        {
          headers: {
            Cookie:
              aleCookie
          }
        }
      );

    assert.equal(
      list.status,
      200
    );

    const listBody =
      await json(
        list
      );

    assert.ok(
      listBody.memories.some(
        (
          memory:
            { id: string }
        ) =>
          memory.id ===
            memoryId
      )
    );

    const previewResponse =
      await postJson(
        "/api/humanale/context",
        aleCookie,
        csrf,
        {
          target:
            "planner",
          mode:
            "ask",
          approved:
            false,
          scope:
            "long_term"
        }
      );

    assert.equal(
      previewResponse.status,
      200
    );

    const previewBody =
      await json(
        previewResponse
      );

    assert.equal(
      previewBody.context,
      null
    );

    assert.ok(
      previewBody.preview
    );

    assert.equal(
      previewBody.preview.approved,
      false
    );

    assert.ok(
      previewBody.preview.entryIds
        .includes(
          memoryId
        )
    );

    assert.ok(
      previewBody.preview.chars <=
        1_600
    );

    const approvalWithoutPreview =
      await postJson(
        "/api/humanale/context",
        aleCookie,
        csrf,
        {
          target:
            "planner",
          mode:
            "ask",
          approved:
            true,
          scope:
            "long_term"
        }
      );

    assert.equal(
      approvalWithoutPreview.status,
      400
    );

    assert.equal(
      (
        await json(
          approvalWithoutPreview
        )
      ).error,
      "HUMANALE_CONTEXT_PREVIEW_REQUIRED"
    );

    const staleApproval =
      await postJson(
        "/api/humanale/context",
        aleCookie,
        csrf,
        {
          target:
            "planner",
          mode:
            "ask",
          approved:
            true,
          scope:
            "long_term",
          entryIds: [
            randomUUID()
          ]
        }
      );

    assert.equal(
      staleApproval.status,
      409
    );

    assert.equal(
      (
        await json(
          staleApproval
        )
      ).error,
      "HUMANALE_CONTEXT_STALE"
    );

    const approvedResponse =
      await postJson(
        "/api/humanale/context",
        aleCookie,
        csrf,
        {
          target:
            "planner",
          mode:
            "ask",
          approved:
            true,
          scope:
            "long_term",
          entryIds:
            previewBody.preview
              .entryIds
        }
      );

    assert.equal(
      approvedResponse.status,
      200
    );

    const approvedBody =
      await json(
        approvedResponse
      );

    assert.equal(
      approvedBody.context
        .approved,
      true
    );

    assert.deepEqual(
      approvedBody.context
        .entryIds,
      previewBody.preview
        .entryIds
    );

    const autoSafe =
      await postJson(
        "/api/humanale/context",
        aleCookie,
        csrf,
        {
          target:
            "agent",
          mode:
            "auto-safe",
          scope:
            "long_term"
        }
      );

    assert.equal(
      autoSafe.status,
      200
    );

    const autoSafeBody =
      await json(
        autoSafe
      );

    assert.equal(
      autoSafeBody.context.mode,
      "auto-safe"
    );

    assert.ok(
      autoSafeBody.context
        .entryIds
        .includes(
          memoryId
        )
    );

    assert.ok(
      autoSafeBody.context.chars <=
        1_600
    );

    const driveStatus =
      await fetch(
        ALECORE_AI_ORIGIN +
        "/api/backups/google-drive",
        {
          headers: {
            Cookie:
              aleCookie
          }
        }
      );

    assert.equal(
      driveStatus.status,
      200
    );

    const driveStatusBody =
      await json(
        driveStatus
      );

    assert.equal(
      driveStatusBody.configured,
      false
    );

    const driveUpload =
      await postJson(
        "/api/backups/google-drive",
        aleCookie,
        csrf,
        {}
      );

    assert.equal(
      driveUpload.status,
      503
    );

    assert.equal(
      (
        await json(
          driveUpload
        )
      ).error,
      "GOOGLE_DRIVE_NOT_CONFIGURED"
    );

    const backup =
      await postJson(
        "/api/backups/usb",
        aleCookie,
        csrf,
        {
          passphrase:
            BACKUP_PASSPHRASE
        }
      );

    assert.equal(
      backup.status,
      201
    );

    assert.match(
      backup.headers.get(
        "content-type"
      ) ?? "",
      /application\/vnd\.alecore-ai\.backup\+json/
    );

    assert.match(
      backup.headers.get(
        "content-disposition"
      ) ?? "",
      /alecore-ai-memory-backup-.*\.alecoreai/
    );

    const envelope =
      await json(
        backup
      );

    const decrypted =
      await decryptMemoryBackup(
        envelope,
        BACKUP_PASSPHRASE
      );

    assert.ok(
      decrypted.memories.some(
        memory =>
          memory.id ===
            memoryId &&
          memory.content ===
            "Catatan aman dari pengujian runtime AleCore AI."
      )
    );

    const deleted =
      await fetch(
        ALECORE_AI_ORIGIN +
        "/api/memory/" +
        memoryId,
        {
          method:
            "DELETE",
          headers: {
            Cookie:
              aleCookie,
            Origin:
              ALECORE_AI_ORIGIN,
            "X-CSRF-Token":
              csrf
          }
        }
      );

    assert.equal(
      deleted.status,
      204
    );

    const missing =
      await fetch(
        ALECORE_AI_ORIGIN +
        "/api/memory/" +
        memoryId,
        {
          headers: {
            Cookie:
              aleCookie
          }
        }
      );

    assert.equal(
      missing.status,
      404
    );

    const logout =
      await fetch(
        ALECORE_AI_ORIGIN +
        "/logout",
        {
          method:
            "POST",
          headers: {
            Cookie:
              aleCookie,
            Origin:
              ALECORE_AI_ORIGIN,
            "X-CSRF-Token":
              csrf
          }
        }
      );

    assert.equal(
      logout.status,
      204
    );

    const afterLogout =
      await fetch(
        ALECORE_AI_ORIGIN +
        "/api/me",
        {
          headers: {
            Cookie:
              aleCookie
          }
        }
      );

    assert.equal(
      afterLogout.status,
      401
    );
  }
);

test("AleCore AI live error boundaries and active-owner session revocation", async t => {
  for (const path of ["/api/ai/providers", "/api/memory/", "/api/backups/google-drive"]) {
    await t.test(`unauthenticated ${path} is denied`, async () => {
      const response = await fetch(ALECORE_AI_ORIGIN + path);
      assert.equal(response.status, 401);
      assert.equal((await response.json()).error, "AUTHENTICATION_REQUIRED");
    });
  }
  const page = await fetch(AUTH_ORIGIN + "/owner-alecore-ai/login?return_to=" + encodeURIComponent(CALLBACK));
  const ownerCookie = cookiePair(page);
  const loginCsrf = (await page.text()).match(/name="csrf_token"\s+value="([^"]+)"/)?.[1];
  assert.ok(loginCsrf);
  await t.test("hostile login origin is rejected before credentials are used", async () => {
    const response = await fetch(AUTH_ORIGIN + "/owner-alecore-ai/login", {
      method: "POST", redirect: "manual",
      headers: {Cookie: ownerCookie, Origin: "https://attacker.example.invalid", "Content-Type": "application/x-www-form-urlencoded"},
      body: new URLSearchParams({email: OWNER_EMAIL, password: OWNER_PASSWORD, csrf_token: loginCsrf, return_to: CALLBACK})
    });
    assert.equal(response.status, 403);
  });
  await t.test("auth malformed JSON does not become a server error", async () => {
    const response = await fetch(AUTH_ORIGIN + "/owner-alecore-ai/login", {
      method: "POST", headers: {"Content-Type": "application/json"}, body: '{"password":'
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {error: "INVALID_JSON"});
  });
  await t.test("oversized JSON returns a sanitized size error", async () => {
    const response = await fetch(ALECORE_AI_ORIGIN + "/api/memory/", {
      method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({content: "x".repeat(1024 * 1024)})
    });
    assert.equal(response.status, 413);
    assert.deepEqual(await response.json(), {error: "REQUEST_BODY_TOO_LARGE"});
  });
  const login = await fetch(AUTH_ORIGIN + "/owner-alecore-ai/login", {
    method: "POST", redirect: "manual",
    headers: { Cookie: ownerCookie, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({email: OWNER_EMAIL, password: OWNER_PASSWORD, csrf_token: loginCsrf, return_to: CALLBACK})
  });
  assert.equal(login.status, 303);
  const callback = await fetch(login.headers.get("location")!, {redirect: "manual"});
  assert.equal(callback.status, 303);
  const cookie = cookiePair(callback);
  const me = await fetch(ALECORE_AI_ORIGIN + "/api/me", {headers: {Cookie: cookie}});
  const csrf = (await me.json()).csrfToken;
  await t.test("cross-origin mutation is denied", async () => {
    const response = await fetch(ALECORE_AI_ORIGIN + "/api/memory/", {
      method: "POST", headers: {Cookie: cookie, Origin: "https://attacker.example.invalid", "Content-Type": "application/json", "X-CSRF-Token": csrf},
      body: JSON.stringify({scope: "long_term", title: "Rejected", content: "Rejected"})
    });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error, "INVALID_ORIGIN");
    const rejectedRecords = await pool.query("SELECT count(*)::int AS count FROM alecore_ai_memory WHERE title=$1", ["Rejected"]);
    assert.equal(rejectedRecords.rows[0].count, 0);
  });
  await t.test("invalid memory query is a client error", async () => {
    const response = await fetch(ALECORE_AI_ORIGIN + "/api/memory/?limit=-1", {headers: {Cookie: cookie}});
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, "INVALID_MEMORY_QUERY");
  });
  await t.test("weak backup passphrase is rejected", async () => {
    const response = await postJson("/api/backups/usb", cookie, csrf, {passphrase: "short"});
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, "INVALID_USB_BACKUP_REQUEST");
  });
  await t.test("unknown AI request fields are rejected without provider access", async () => {
    const response = await postJson("/api/ai/chat", cookie, csrf, {message: "hello", baseUrl: "https://attacker.example.invalid"});
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, "INVALID_AI_REQUEST");
  });
  await t.test("malformed JSON is a sanitized client error", async () => {
    const response = await fetch(ALECORE_AI_ORIGIN + "/api/memory/", {
      method: "POST", headers: {Cookie: cookie, Origin: ALECORE_AI_ORIGIN, "Content-Type": "application/json", "X-CSRF-Token": csrf}, body: '{"content":'
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, "INVALID_JSON");
  });
  await t.test("deactivated owner loses the existing session", async () => {
    await pool.query("UPDATE owner_users SET is_active=false WHERE email=$1", [OWNER_EMAIL]);
    try {
      const response = await fetch(ALECORE_AI_ORIGIN + "/api/me", {headers: {Cookie: cookie}});
      assert.equal(response.status, 401);
      assert.equal((await response.json()).error, "AUTHENTICATION_REQUIRED");
      const sessions = await pool.query("SELECT count(*)::int AS count FROM alecore_ai_app_sessions");
      assert.equal(sessions.rows[0].count, 0);
    } finally {
      await pool.query("UPDATE owner_users SET is_active=true WHERE email=$1", [OWNER_EMAIL]);
    }
  });
});
