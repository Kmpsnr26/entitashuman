# NARA Cloud Phase 11E — Encrypted USB Backup

## Status

This source checkpoint adds an encrypted NARA Memory backup artifact intended to be saved to removable media such as a USB drive.

The server does **not** accept arbitrary filesystem paths and does **not** write directly to a mounted USB device. Instead, the authenticated Owner requests an encrypted `.nara` backup file and chooses where to save it on the client device.

Execution verification remains pending until `npm run verify` can execute in a usable checkout.

## API

`POST /api/backups/usb`

Requirements:

- active Owner session
- valid CSRF token
- shared backup rate limiter
- JSON body with `passphrase`

Passphrase input:

- minimum 16 characters
- maximum 256 characters
- not stored in PostgreSQL
- not written to audit metadata
- not included in the encrypted envelope

Successful response:

- `Content-Type: application/vnd.nara.backup+json`
- attachment filename ending in `.nara`
- no-store cache headers
- encrypted, versioned JSON envelope

## Cryptography

The backup envelope uses:

- encryption/authentication: AES-256-GCM
- KDF: scrypt
- per-backup salt: 32 random bytes
- per-backup IV: 12 random bytes
- GCM authentication tag: 16 bytes
- AAD binds the NARA backup format/version/kind/algorithm/KDF

scrypt parameters:

- N = 32768
- r = 8
- p = 1
- max memory = 64 MiB
- derived key = 32 bytes

Derived key buffers and temporary plaintext buffers are overwritten after use where the Node.js runtime exposes mutable buffers.

JavaScript strings themselves cannot be reliably zeroized by application code, so the passphrase is intentionally kept ephemeral and never persisted/logged.

## Envelope

The `.nara` JSON envelope contains only the cryptographic format metadata required to decrypt the ciphertext:

- format marker
- version
- backup kind
- algorithm
- KDF + parameters
- creation timestamp
- salt
- IV
- authentication tag
- ciphertext

Memory content is inside the ciphertext.

## Integrity

AES-GCM authentication is mandatory.

Changing ciphertext, tag, IV, AAD-bound format assumptions, or using a different passphrase causes decryption to fail instead of returning unauthenticated plaintext.

Regression tests cover:

- encrypt/decrypt round trip
- plaintext absent from envelope
- passphrase absent from envelope
- wrong passphrase rejection
- ciphertext tamper rejection

## Size bounds

The plaintext backup is limited to 5,000,000 bytes before encryption.

The inherited memory exporter also remains bounded to 5,000 records.

If the plaintext limit is exceeded, NARA returns `USB_BACKUP_TOO_LARGE`; it does not silently truncate the backup.

## Filesystem boundary

This phase intentionally does not add:

- arbitrary destination path input
- drive-letter input
- mount-path input
- `node:fs` writes
- removable-device enumeration
- automatic deletion/overwrite of files

This avoids server-side path traversal and accidental writes to unrelated storage.

The browser/desktop client decides where the returned encrypted artifact is saved.

## Audit boundary

A successful export records only bounded metadata:

- event type `NARA_USB_BACKUP_CREATED`
- record count
- encrypted response byte count
- algorithm label
- KDF label

Audit metadata excludes:

- passphrase
- memory content
- ciphertext
- salt
- IV
- GCM tag

## Preserved upstream boundaries

Phase 11E does not alter:

- Owner authentication/session/SSO
- CSRF behavior
- Google Drive credentials
- AI provider credentials
- AI provider health telemetry
- prompt-free AI usage logs
- streaming fallback semantics
- HumanALE avatar/reference-face assets

## Verification gate

Before Phase 11E can be marked `VERIFIED`:

1. `npm run build`
2. `npm run test:unit`
3. `npm run verify`
4. execute encryption round-trip tests
5. execute wrong-passphrase and tamper tests
6. verify Owner auth + CSRF on the USB route
7. download an encrypted backup in a controlled environment
8. decrypt that artifact using the same passphrase and verify the snapshot
9. scan final diff for secrets and unrelated files

Until those checks execute successfully, Phase 11E remains `VERIFICATION_PENDING`.
