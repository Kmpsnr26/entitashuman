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

const NARA_ORIGIN =
  process.env.PUBLIC_NARA_ORIGIN ??
  "http://127.0.0.1:4200";

const CALLBACK =
  `${NARA_ORIGIN}/auth/callback`;

const OWNER_EMAIL =
  "runtime-owner@example.invalid";

const OWNER_PASSWORD =
  "NARA-runtime-e2e-password-2026";

const OWNER_NAME =
  "NARA Runtime Owner";

const BACKUP_PASSPHRASE =
  "NARA-runtime-e2e-backup-passphrase-2026";

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
          `\n[NARA E2E child exit ${code}]\n${output}\n`
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
    NARA_ORIGIN + path,
    {
      method:
        "POST",
      redirect:
        "manual",
      headers: {
        Cookie:
          cookie,
        Origin:
          NARA_ORIGIN,
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
    "DELETE FROM nara_app_sessions"
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
    "src/apps/naraServer.ts"
  );

  await Promise.all([
    waitForHealth(
      AUTH_ORIGIN +
      "/health"
    ),
    waitForHealth(
      NARA_ORIGIN +
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
    "DELETE FROM nara_app_sessions"
  );

  await pool.end();
});

test(
  "NARA live runtime completes Owner SSO, memory, HumanALE context, backup and logout",
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
          "nara-auth"
      }
    );

    const naraHealth =
      await fetch(
        NARA_ORIGIN +
        "/health"
      );

    assert.equal(
      naraHealth.status,
      200
    );

    assert.deepEqual(
      await json(
        naraHealth
      ),
      {
        ok:
          true,
        service:
          "nara-app"
      }
    );

    const unauthorized =
      await fetch(
        NARA_ORIGIN +
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
      /\/ownernara\/authorize/
    );

    const loginPage =
      await fetch(
        AUTH_ORIGIN +
        "/ownernara/login?return_to=" +
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
        "/ownernara/login",
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
        "/ownernara/login",
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
      NARA_ORIGIN
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

    const naraCookie =
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
        NARA_ORIGIN +
        "/",
        {
          headers: {
            Cookie:
              naraCookie
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
      /NARA ONLINE/
    );

    const me =
      await fetch(
        NARA_ORIGIN +
        "/api/me",
        {
          headers: {
            Cookie:
              naraCookie
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
        NARA_ORIGIN +
        "/api/memory/",
        {
          method:
            "POST",
          headers: {
            Cookie:
              naraCookie,
            Origin:
              NARA_ORIGIN,
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
        NARA_ORIGIN +
        "/api/memory/",
        {
          method:
            "POST",
          headers: {
            Cookie:
              naraCookie,
            Origin:
              NARA_ORIGIN,
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
        naraCookie,
        csrf,
        {
          scope:
            "long_term",
          title:
            "Runtime E2E memory",
          content:
            "Catatan aman dari pengujian runtime NARA.",
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
        NARA_ORIGIN +
        "/api/memory/?scope=long_term&limit=20",
        {
          headers: {
            Cookie:
              naraCookie
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
        naraCookie,
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
        naraCookie,
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
        naraCookie,
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
        naraCookie,
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
        naraCookie,
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
        NARA_ORIGIN +
        "/api/backups/google-drive",
        {
          headers: {
            Cookie:
              naraCookie
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
        naraCookie,
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
        naraCookie,
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
      /application\/vnd\.nara\.backup\+json/
    );

    assert.match(
      backup.headers.get(
        "content-disposition"
      ) ?? "",
      /nara-memory-backup-.*\.nara/
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
            "Catatan aman dari pengujian runtime NARA."
      )
    );

    const deleted =
      await fetch(
        NARA_ORIGIN +
        "/api/memory/" +
        memoryId,
        {
          method:
            "DELETE",
          headers: {
            Cookie:
              naraCookie,
            Origin:
              NARA_ORIGIN,
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
        NARA_ORIGIN +
        "/api/memory/" +
        memoryId,
        {
          headers: {
            Cookie:
              naraCookie
          }
        }
      );

    assert.equal(
      missing.status,
      404
    );

    const logout =
      await fetch(
        NARA_ORIGIN +
        "/logout",
        {
          method:
            "POST",
          headers: {
            Cookie:
              naraCookie,
            Origin:
              NARA_ORIGIN,
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
        NARA_ORIGIN +
        "/api/me",
        {
          headers: {
            Cookie:
              naraCookie
          }
        }
      );

    assert.equal(
      afterLogout.status,
      401
    );
  }
);
