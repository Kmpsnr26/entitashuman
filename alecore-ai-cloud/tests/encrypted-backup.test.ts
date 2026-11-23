import test from "node:test";
import { createCipheriv, scrypt } from "node:crypto";
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
  "AleCore AI-test-passphrase-only-not-a-real-secret-2026";

function snapshot():
  MemoryBackupSnapshot {
  return {
    schemaVersion:
      1,

    kind:
      "alecore-ai-memory",

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
      "ALECORE_AI_ENCRYPTED_BACKUP"
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
      "alecore-ai-memory"
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

    assert.ok(
      decrypted.memories[0]!
        .createdAt instanceof
        Date
    );

    assert.ok(
      decrypted.memories[0]!
        .updatedAt instanceof
        Date
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


test(
  "encrypted USB backup rejects malformed and non-canonical Base64 before decryption",
  async () => {
    const encrypted =
      await encryptMemoryBackup(
        snapshot(),
        passphrase
      );

    for (
      const invalid of [
        {
          ...encrypted,
          salt:
            "!!!!"
        },
        {
          ...encrypted,
          iv:
            encrypted.iv +
            "===="
        }
      ]
    ) {
      await assert.rejects(
        () =>
          decryptMemoryBackup(
            invalid,
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
            "USB_BACKUP_INVALID_ENVELOPE"
          );

          return true;
        }
      );
    }
  }
);

test(
  "encrypted USB backup rejects oversized ciphertext before allocating a decoded payload",
  async () => {
    const encrypted =
      await encryptMemoryBackup(
        snapshot(),
        passphrase
      );

    const oversized = {
      ...encrypted,
      ciphertext:
        "AAAA".repeat(
          1_666_668
        )
    };

    await assert.rejects(
      () =>
        decryptMemoryBackup(
          oversized,
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
          "USB_BACKUP_INVALID_ENVELOPE"
        );

        return true;
      }
    );
  }
);


test(
  "encrypted USB backup rejects unauthenticated envelope timestamps",
  async () => {
    const encrypted =
      await encryptMemoryBackup(
        snapshot(),
        passphrase
      );

    await assert.rejects(
      () =>
        decryptMemoryBackup(
          {
            ...encrypted,
            createdAt:
              "2026-09-26T03:31:00.000Z"
          },
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
          "USB_BACKUP_INVALID_ENVELOPE"
        );
        return true;
      }
    );
  }
);

test(
  "encrypted USB backup rejects malformed decrypted record shapes",
  async () => {
    const invalid =
      snapshot();

    (
      invalid.memories[0] as
        unknown as {
          title:
            unknown;
        }
    ).title =
      123;

    const encrypted =
      await encryptMemoryBackup(
        invalid,
        passphrase
      );

    await assert.rejects(
      () =>
        decryptMemoryBackup(
          encrypted,
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
          "USB_BACKUP_INVALID_ENVELOPE"
        );
        return true;
      }
    );
  }
);

test(
  "legacy encrypted Ale memory backups remain readable",
  async () => {
    const original = snapshot();
    const legacySnapshot = {
      ...original,
      kind: "nara-memory"
    };
    const passphraseValue = passphrase;
    const salt = Buffer.alloc(32, 1);
    const iv = Buffer.alloc(12, 2);
    const key = await new Promise<Buffer>((resolve, reject) => {
      scrypt(
        passphraseValue,
        salt,
        32,
        { N: 32_768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
        (error, derived) => error ? reject(error) : resolve(Buffer.from(derived))
      );
    });
    try {
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(Buffer.from(
        "NARA_ENCRYPTED_BACKUP|1|nara-memory|aes-256-gcm|scrypt",
        "utf8"
      ));
      const ciphertext = Buffer.concat([
        cipher.update(Buffer.from(JSON.stringify(legacySnapshot), "utf8")),
        cipher.final()
      ]);
      const envelope = {
        format: "NARA_ENCRYPTED_BACKUP",
        version: 1,
        kind: "nara-memory",
        algorithm: "aes-256-gcm",
        kdf: "scrypt",
        kdfParams: { N: 32_768, r: 8, p: 1 },
        createdAt: original.exportedAt,
        salt: salt.toString("base64"),
        iv: iv.toString("base64"),
        tag: cipher.getAuthTag().toString("base64"),
        ciphertext: ciphertext.toString("base64")
      };
      const restored = await decryptMemoryBackup(envelope, passphraseValue);
      assert.equal(restored.kind, "alecore-ai-memory");
      assert.equal(restored.memories[0]!.content, original.memories[0]!.content);
    } finally {
      key.fill(0);
    }
  }
);
