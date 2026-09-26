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
  "USB backup uses authenticated encryption and a memory-hard KDF",
  async () => {
    const source =
      await read(
        "src/services/encrypted-backup.service.ts"
      );

    assert.match(
      source,
      /aes-256-gcm/
    );

    assert.match(
      source,
      /scrypt/
    );

    assert.match(
      source,
      /randomBytes\(32\)/
    );

    assert.match(
      source,
      /randomBytes\(12\)/
    );

    assert.match(
      source,
      /getAuthTag/
    );

    assert.match(
      source,
      /setAuthTag/
    );

    assert.match(
      source,
      /setAAD/
    );

    assert.match(
      source,
      /5_000_000/
    );

    assert.doesNotMatch(
      source,
      /node:fs|writeFile|createWriteStream|unlink|rmSync/
    );
  }
);

test(
  "USB backup route requires Owner auth, CSRF and never accepts a filesystem path",
  async () => {
    const routes =
      await read(
        "src/routes/backup.routes.ts"
      );

    assert.match(
      routes,
      /router\.use\([\s\S]*requireApiAuth/
    );

    assert.match(
      routes,
      /router\.post\([\s\S]*"\/usb"[\s\S]*requireCsrf/
    );

    assert.match(
      routes,
      /passphrase:[\s\S]*\.min\(16\)[\s\S]*\.max\(256\)/
    );

    assert.match(
      routes,
      /Content-Disposition/
    );

    assert.match(
      routes,
      /application\/vnd\.nara\.backup\+json/
    );

    assert.doesNotMatch(
      routes,
      /usbPath|filePath|destinationPath|mountPath|driveLetter/
    );

    assert.doesNotMatch(
      routes,
      /node:fs|writeFile|createWriteStream/
    );
  }
);

test(
  "USB backup audit metadata excludes passphrase and memory content",
  async () => {
    const routes =
      await read(
        "src/routes/backup.routes.ts"
      );

    const eventIndex =
      routes.indexOf(
        "NARA_USB_BACKUP_CREATED"
      );

    assert.notEqual(
      eventIndex,
      -1
    );

    const auditWindow =
      routes.slice(
        eventIndex,
        eventIndex + 1_000
      );

    assert.match(
      auditWindow,
      /recordCount/
    );

    assert.match(
      auditWindow,
      /encryptedBytes/
    );

    assert.doesNotMatch(
      auditWindow,
      /passphrase|content|ciphertext|salt|iv|tag/
    );
  }
);
