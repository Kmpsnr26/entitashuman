import {
  after,
  before,
  test
} from "node:test";

import assert from "node:assert/strict";

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
  consumeTicket,
  isTicketCodeFormatValid,
  issueTicket
} from "../src/security/ticket.js";

let ownerId = "";

before(async () => {
  await pool.query(
    "DELETE FROM owner_users"
  );

  ownerId =
    randomUUID();

  const passwordHash =
    await hashPassword(
      "AleCore AI-database-test-password-2026"
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
      ownerId,
      "owner-test@example.invalid",
      passwordHash,
      "AleCore AI Test Owner"
    ]
  );
});

after(async () => {
  await pool.end();
});

test(
  "database enforces a single active Owner",
  async () => {
    const passwordHash =
      await hashPassword(
        "AleCore AI-second-owner-password-2026"
      );

    await assert.rejects(
      () =>
        pool.query(
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
            "second-owner@example.invalid",
            passwordHash,
            "Second Owner"
          ]
        ),
      /duplicate key|unique/i
    );
  }
);

test(
  "SSO ticket is hashed, latest-only and one-time",
  async () => {
    const callback =
      "http://127.0.0.1:4200/auth/callback";

    const first =
      await issueTicket(
        ownerId,
        "nara",
        callback
      );

    assert.equal(
      isTicketCodeFormatValid(first),
      true
    );

    const firstRow =
      await pool.query<{
        code_hash: string;
      }>(
        `
          SELECT code_hash
          FROM login_tickets
          WHERE user_id = $1
            AND audience = 'nara'
        `,
        [ownerId]
      );

    assert.equal(
      firstRow.rowCount,
      1
    );

    assert.notEqual(
      firstRow.rows[0]?.code_hash,
      first
    );

    assert.equal(
      firstRow.rows[0]?.code_hash.length,
      64
    );

    const second =
      await issueTicket(
        ownerId,
        "nara",
        callback
      );

    assert.notEqual(
      first,
      second
    );

    const count =
      await pool.query<{
        count: number;
      }>(
        `
          SELECT
            COUNT(*)::int AS count
          FROM login_tickets
          WHERE user_id = $1
            AND audience = 'nara'
        `,
        [ownerId]
      );

    assert.equal(
      count.rows[0]?.count,
      1
    );

    assert.equal(
      await consumeTicket(
        first,
        "nara",
        callback
      ),
      null
    );

    assert.equal(
      await consumeTicket(
        second,
        "nara",
        callback
      ),
      ownerId
    );

    assert.equal(
      await consumeTicket(
        second,
        "nara",
        callback
      ),
      null
    );
  }
);

test(
  "expired SSO ticket cannot be consumed",
  async () => {
    const callback =
      "http://127.0.0.1:4200/auth/callback";

    const ticket =
      await issueTicket(
        ownerId,
        "nara",
        callback
      );

    await pool.query(
      `
        UPDATE login_tickets
        SET
          expires_at =
            NOW() - INTERVAL '1 second'
        WHERE user_id = $1
          AND audience = 'nara'
      `,
      [ownerId]
    );

    assert.equal(
      await consumeTicket(
        ticket,
        "nara",
        callback
      ),
      null
    );
  }
);
