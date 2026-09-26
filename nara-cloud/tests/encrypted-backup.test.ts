import test from "node:test";
import assert from "node:assert/strict";

import type {
  MemoryBackupSnapshot
} from "../src/services/backup-export.service.js";

import {
  decryptMemoryBackup,
  encryptMemoryBackup,
  EncryptedBackupError
} from "../src/services/encrypted-backup.service.js";

const passphrase =
  "NARA-test-passphrase-only-not-a-real-secret-2026";

function snapshot():
  MemoryBackupSnapshot {
  return {
    schemaVersion:
      1,

    kind:
      "nara-memory",

    exportedAt:
      "2026-09-26T03:30:00.000Z",

    memories: [
      {
        id:
          "11111111-1111-4111-8111-111111111111",
        scope:
          "long_term",
        title:
          "Encrypted backup test",
        content:
          "Sensitive memory text must not appear in the envelope.",
        tags:
          ["test"],
        importance:
          3,
        projectKey:
          null,
        conversationId:
          null,
        createdAt:
          new Date(
            "2026-09-26T03:00:00.000Z"
          ),
        updatedAt:
          new Date(
            "2026-09-26T03:15:00.000Z"
          )
      }
    ]
  };
}

test(
  "encrypted USB backup round-trips and hides plaintext",
  async () => {
    const original =
      snapshot();

    const encrypted =
      await encryptMemoryBackup(
        original,
        passphrase
      );

    assert.equal(
      encrypted.format,
      "NARA_ENCRYPTED_BACKUP"
    );

    assert.equal(
      encrypted.algorithm,
      "aes-256-gcm"
    );

    assert.equal(
      encrypted.kdf,
      "scrypt"
    );

    const serialized =
      JSON.stringify(
        encrypted
      );

    assert.equal(
      serialized.includes(
        original.memories[0]!
          .content
      ),
      false
    );

    assert.equal(
      serialized.includes(
        passphrase
      ),
      false
    );

    const decrypted =
      await decryptMemoryBackup(
        encrypted,
        passphrase
      );

    assert.equal(
      decrypted.schemaVersion,
      1
    );

    assert.equal(
      decrypted.kind,
      "nara-memory"
    );

    assert.equal(
      decrypted.exportedAt,
      original.exportedAt
    );

    assert.equal(
      decrypted.memories.length,
      1
    );

    assert.equal(
      decrypted.memories[0]!
        .content,
      original.memories[0]!
        .content
    );
  }
);

test(
  "encrypted USB backup rejects a wrong passphrase",
  async () => {
    const encrypted =
      await encryptMemoryBackup(
        snapshot(),
        passphrase
      );

    await assert.rejects(
      () =>
        decryptMemoryBackup(
          encrypted,
          "different-passphrase-that-is-long-enough"
        ),
      (
        error:
          unknown
      ) => {
        assert.ok(
          error instanceof
            EncryptedBackupError
        );

        assert.equal(
          error.code,
          "USB_BACKUP_DECRYPT_FAILED"
        );

        return true;
      }
    );
  }
);

test(
  "encrypted USB backup detects ciphertext tampering",
  async () => {
    const encrypted =
      await encryptMemoryBackup(
        snapshot(),
        passphrase
      );

    const bytes =
      Buffer.from(
        encrypted.ciphertext,
        "base64"
      );

    bytes[0] =
      bytes[0]! ^ 1;

    const tampered = {
      ...encrypted,
      ciphertext:
        bytes.toString(
          "base64"
        )
    };

    await assert.rejects(
      () =>
        decryptMemoryBackup(
          tampered,
          passphrase
        ),
      (
        error:
          unknown
      ) => {
        assert.ok(
          error instanceof
            EncryptedBackupError
        );

        assert.equal(
          error.code,
          "USB_BACKUP_DECRYPT_FAILED"
        );

        return true;
      }
    );
  }
);
