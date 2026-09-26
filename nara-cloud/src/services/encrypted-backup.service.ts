import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scrypt
} from "node:crypto";

import type {
  MemoryBackupSnapshot
} from "./backup-export.service.js";

const USB_BACKUP_MAX_PLAINTEXT_BYTES =
  5_000_000;

const SCRYPT_N =
  32_768;

const SCRYPT_R =
  8;

const SCRYPT_P =
  1;

const SCRYPT_MAXMEM =
  64 * 1024 * 1024;

const AAD =
  Buffer.from(
    "NARA_ENCRYPTED_BACKUP|1|nara-memory|aes-256-gcm|scrypt",
    "utf8"
  );

export interface EncryptedBackupEnvelope {
  format:
    "NARA_ENCRYPTED_BACKUP";
  version:
    1;
  kind:
    "nara-memory";
  algorithm:
    "aes-256-gcm";
  kdf:
    "scrypt";
  kdfParams: {
    N: number;
    r: number;
    p: number;
  };
  createdAt:
    string;
  salt:
    string;
  iv:
    string;
  tag:
    string;
  ciphertext:
    string;
}

export class EncryptedBackupError
  extends Error {
  readonly code:
    | "USB_BACKUP_TOO_LARGE"
    | "USB_BACKUP_INVALID_ENVELOPE"
    | "USB_BACKUP_DECRYPT_FAILED";

  constructor(
    code:
      EncryptedBackupError["code"]
  ) {
    super(code);
    this.name =
      "EncryptedBackupError";
    this.code = code;
  }
}

function deriveKey(
  passphrase: string,
  salt: Buffer
): Promise<Buffer> {
  return new Promise(
    (
      resolve,
      reject
    ) => {
      scrypt(
        passphrase,
        salt,
        32,
        {
          N:
            SCRYPT_N,
          r:
            SCRYPT_R,
          p:
            SCRYPT_P,
          maxmem:
            SCRYPT_MAXMEM
        },
        (
          error,
          derivedKey
        ) => {
          if (error) {
            reject(error);
            return;
          }

          resolve(
            Buffer.from(
              derivedKey
            )
          );
        }
      );
    }
  );
}

function isEnvelope(
  value: unknown
): value is EncryptedBackupEnvelope {
  if (
    typeof value !== "object" ||
    value === null
  ) {
    return false;
  }

  const envelope =
    value as
      Partial<EncryptedBackupEnvelope>;

  return (
    envelope.format ===
      "NARA_ENCRYPTED_BACKUP" &&
    envelope.version ===
      1 &&
    envelope.kind ===
      "nara-memory" &&
    envelope.algorithm ===
      "aes-256-gcm" &&
    envelope.kdf ===
      "scrypt" &&
    typeof envelope.createdAt ===
      "string" &&
    typeof envelope.salt ===
      "string" &&
    typeof envelope.iv ===
      "string" &&
    typeof envelope.tag ===
      "string" &&
    typeof envelope.ciphertext ===
      "string" &&
    envelope.kdfParams?.N ===
      SCRYPT_N &&
    envelope.kdfParams?.r ===
      SCRYPT_R &&
    envelope.kdfParams?.p ===
      SCRYPT_P
  );
}

function parseBase64(
  value: string,
  expectedBytes?:
    number
): Buffer {
  const buffer =
    Buffer.from(
      value,
      "base64"
    );

  if (
    buffer.length === 0 ||
    (
      expectedBytes !==
        undefined &&
      buffer.length !==
        expectedBytes
    )
  ) {
    throw new EncryptedBackupError(
      "USB_BACKUP_INVALID_ENVELOPE"
    );
  }

  return buffer;
}

export async function encryptMemoryBackup(
  snapshot: MemoryBackupSnapshot,
  passphrase: string
): Promise<EncryptedBackupEnvelope> {
  const plaintext =
    Buffer.from(
      JSON.stringify(
        snapshot
      ),
      "utf8"
    );

  if (
    plaintext.length >
    USB_BACKUP_MAX_PLAINTEXT_BYTES
  ) {
    throw new EncryptedBackupError(
      "USB_BACKUP_TOO_LARGE"
    );
  }

  const salt =
    randomBytes(32);

  const iv =
    randomBytes(12);

  const key =
    await deriveKey(
      passphrase,
      salt
    );

  try {
    const cipher =
      createCipheriv(
        "aes-256-gcm",
        key,
        iv
      );

    cipher.setAAD(
      AAD
    );

    const ciphertext =
      Buffer.concat([
        cipher.update(
          plaintext
        ),
        cipher.final()
      ]);

    const tag =
      cipher.getAuthTag();

    return {
      format:
        "NARA_ENCRYPTED_BACKUP",

      version:
        1,

      kind:
        "nara-memory",

      algorithm:
        "aes-256-gcm",

      kdf:
        "scrypt",

      kdfParams: {
        N:
          SCRYPT_N,
        r:
          SCRYPT_R,
        p:
          SCRYPT_P
      },

      createdAt:
        snapshot.exportedAt,

      salt:
        salt.toString(
          "base64"
        ),

      iv:
        iv.toString(
          "base64"
        ),

      tag:
        tag.toString(
          "base64"
        ),

      ciphertext:
        ciphertext.toString(
          "base64"
        )
    };
  } finally {
    key.fill(0);
    plaintext.fill(0);
  }
}

export async function decryptMemoryBackup(
  input: unknown,
  passphrase: string
): Promise<MemoryBackupSnapshot> {
  if (!isEnvelope(input)) {
    throw new EncryptedBackupError(
      "USB_BACKUP_INVALID_ENVELOPE"
    );
  }

  const salt =
    parseBase64(
      input.salt,
      32
    );

  const iv =
    parseBase64(
      input.iv,
      12
    );

  const tag =
    parseBase64(
      input.tag,
      16
    );

  const ciphertext =
    parseBase64(
      input.ciphertext
    );

  const key =
    await deriveKey(
      passphrase,
      salt
    );

  let plaintext:
    Buffer | null =
      null;

  try {
    const decipher =
      createDecipheriv(
        "aes-256-gcm",
        key,
        iv
      );

    decipher.setAAD(
      AAD
    );

    decipher.setAuthTag(
      tag
    );

    plaintext =
      Buffer.concat([
        decipher.update(
          ciphertext
        ),
        decipher.final()
      ]);

    if (
      plaintext.length >
      USB_BACKUP_MAX_PLAINTEXT_BYTES
    ) {
      throw new EncryptedBackupError(
        "USB_BACKUP_TOO_LARGE"
      );
    }

    const parsed:
      unknown =
        JSON.parse(
          plaintext.toString(
            "utf8"
          )
        );

    if (
      typeof parsed !==
        "object" ||
      parsed === null ||
      (
        parsed as {
          schemaVersion?:
            unknown;
        }
      ).schemaVersion !==
        1 ||
      (
        parsed as {
          kind?:
            unknown;
        }
      ).kind !==
        "nara-memory" ||
      !Array.isArray(
        (
          parsed as {
            memories?:
              unknown;
          }
        ).memories
      )
    ) {
      throw new EncryptedBackupError(
        "USB_BACKUP_INVALID_ENVELOPE"
      );
    }

    return parsed as
      MemoryBackupSnapshot;
  } catch (error) {
    if (
      error instanceof
        EncryptedBackupError
    ) {
      throw error;
    }

    throw new EncryptedBackupError(
      "USB_BACKUP_DECRYPT_FAILED"
    );
  } finally {
    key.fill(0);
    plaintext?.fill(0);
  }
}

export {
  USB_BACKUP_MAX_PLAINTEXT_BYTES
};
