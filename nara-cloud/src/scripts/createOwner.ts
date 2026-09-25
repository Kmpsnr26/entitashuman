import {
  randomUUID
} from "node:crypto";

import {
  createInterface
} from "node:readline/promises";

import {
  stdin as input,
  stdout as output
} from "node:process";

import {
  pool
} from "../db/pool.js";

import {
  hashPassword
} from "../security/password.js";

import {
  audit
} from "../services/audit.service.js";

const readline = createInterface({
  input,
  output
});

function validEmail(
  value: string
): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function readHidden(
  prompt: string
): Promise<string> {
  if (
    !input.isTTY ||
    typeof input.setRawMode !== "function"
  ) {
    throw new Error(
      "Pembuatan Owner harus dijalankan dari terminal interaktif."
    );
  }

  output.write(prompt);

  input.setRawMode(true);
  input.resume();
  input.setEncoding("utf8");

  return new Promise<string>(
    (resolve, reject) => {
      let value = "";

      const cleanup = (): void => {
        input.off("data", onData);
        input.setRawMode(false);
        input.pause();
        output.write("\n");
      };

      const onData = (
        chunk: string | Buffer
      ): void => {
        const text =
          typeof chunk === "string"
            ? chunk
            : chunk.toString("utf8");

        for (const character of text) {
          if (
            character === "\r" ||
            character === "\n"
          ) {
            cleanup();
            resolve(value);
            return;
          }

          if (character === "\u0003") {
            cleanup();
            reject(
              new Error("Dibatalkan.")
            );
            return;
          }

          if (
            character === "\u007f" ||
            character === "\b"
          ) {
            value = value.slice(0, -1);
            continue;
          }

          if (
            character.charCodeAt(0) <
            32
          ) {
            continue;
          }

          value += character;
        }
      };

      input.on("data", onData);
    }
  );
}

async function main(): Promise<void> {
  console.log("");
  console.log(
    "=== CREATE NARA OWNER ==="
  );
  console.log("");

  const existing =
    await pool.query<{
      count: number;
    }>(
      `
        SELECT
          COUNT(*)::int AS count
        FROM owner_users
        WHERE is_active = TRUE
      `
    );

  if (
    (
      existing.rows[0]?.count ??
      0
    ) > 0
  ) {
    throw new Error(
      "Owner aktif sudah ada. Pembuatan Owner kedua diblokir."
    );
  }

  const email =
    (
      await readline.question(
        "Owner email: "
      )
    )
      .trim()
      .toLowerCase();

  if (
    !validEmail(email) ||
    email.length > 254
  ) {
    throw new Error(
      "Format email tidak valid."
    );
  }

  const displayName =
    (
      await readline.question(
        "Owner name: "
      )
    )
      .trim();

  if (
    displayName.length < 2 ||
    displayName.length > 80
  ) {
    throw new Error(
      "Nama Owner harus 2–80 karakter."
    );
  }

  readline.pause();

  const password =
    await readHidden(
      "Owner password: "
    );

  const confirmPassword =
    await readHidden(
      "Ulangi password: "
    );

  if (
    password !==
    confirmPassword
  ) {
    throw new Error(
      "Konfirmasi password tidak sama."
    );
  }

  const passwordHash =
    await hashPassword(
      password
    );

  const id = randomUUID();

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
      id,
      email,
      passwordHash,
      displayName
    ]
  );

  await audit({
    userId: id,
    eventType:
      "OWNER_CREATED",
    metadata: {
      source:
        "create-owner"
    }
  });

  console.log("");
  console.log(
    "NARA Owner berhasil dibuat."
  );
  console.log(
    `ID: ${id}`
  );
  console.log(
    `Email: ${email}`
  );
}

try {
  await main();
} catch (error) {
  console.error(
    "[CREATE OWNER ERROR]",
    error instanceof Error
      ? error.message
      : error
  );

  process.exitCode = 1;
} finally {
  readline.close();
  await pool.end();
}
