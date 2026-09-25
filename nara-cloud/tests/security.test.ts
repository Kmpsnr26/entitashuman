import test from "node:test";
import assert from "node:assert/strict";

import {
  createCsrfToken,
  verifyCsrf
} from "../src/security/csrf.js";

import {
  hashPassword,
  verifyPassword
} from "../src/security/password.js";

import {
  sanitizeAuditMetadata
} from "../src/services/audit.service.js";

test(
  "Argon2id hashes and verifies Owner passwords",
  async () => {
    const password =
      "NARA-owner-test-password-2026";

    const hash =
      await hashPassword(password);

    assert.match(
      hash,
      /^\$argon2id\$/
    );

    assert.equal(
      await verifyPassword(
        hash,
        password
      ),
      true
    );

    assert.equal(
      await verifyPassword(
        hash,
        "wrong-password-value"
      ),
      false
    );

    assert.equal(
      await verifyPassword(
        null,
        "unknown-owner-password"
      ),
      false
    );

    await assert.rejects(
      () =>
        hashPassword("short"),
      /12–256/
    );
  }
);

test(
  "CSRF tokens are random and timing-safe comparable",
  () => {
    const first =
      createCsrfToken();

    const second =
      createCsrfToken();

    assert.notEqual(
      first,
      second
    );

    assert.equal(
      verifyCsrf(
        first,
        first
      ),
      true
    );

    assert.equal(
      verifyCsrf(
        first,
        second
      ),
      false
    );

    assert.equal(
      verifyCsrf(
        first,
        undefined
      ),
      false
    );
  }
);

test(
  "audit metadata redacts credential-like keys",
  () => {
    const sanitized =
      sanitizeAuditMetadata({
        provider:
          "openai",

        password:
          "super-secret",

        nested: {
          accessToken:
            "token-value",

          safe:
            "ok"
        },

        list: [
          {
            api_key:
              "should-hide"
          }
        ]
      });

    const serialized =
      JSON.stringify(
        sanitized
      );

    assert.match(
      serialized,
      /"provider":"openai"/
    );

    assert.match(
      serialized,
      /\[REDACTED\]/
    );

    assert.equal(
      serialized.includes(
        "super-secret"
      ),
      false
    );

    assert.equal(
      serialized.includes(
        "token-value"
      ),
      false
    );

    assert.equal(
      serialized.includes(
        "should-hide"
      ),
      false
    );
  }
);
