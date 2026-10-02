# NARA Cloud secret-management checklist

This file defines names and handling rules only. It contains no credentials.

## Required application secrets
- `DATABASE_URL`: PostgreSQL connection string. Server-side only.
- `AUTH_SESSION_SECRET`: unique random auth-session signing/encryption secret.
- `NARA_SESSION_SECRET`: different random NARA-session secret.
- `TICKET_PEPPER`: different high-entropy server-side pepper.
- `OPENAI_API_KEY`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`: provider credentials. Server-side only.

## Google Drive backup
- `GOOGLE_DRIVE_CLIENT_ID`
- `GOOGLE_DRIVE_CLIENT_SECRET`
- `GOOGLE_DRIVE_REFRESH_TOKEN`
- `GOOGLE_DRIVE_BACKUP_FOLDER_ID`

The application requires all four together. The folder ID selects the destination; an OAuth redirect URI is not a runtime backup setting. Optional provider and Drive entries stay commented out in the staging template: empty strings fail runtime validation. Uncomment the entire Drive group only after supplying non-empty values.

Request the minimum Drive scope required by the backup design. Encrypt refresh tokens at rest. OAuth consent and live credentials are external actions and are not required to keep preparing repository-side staging scaffolding.

## Backup encryption
- `BACKUP_ENCRYPTION_KEY`: use a dedicated high-entropy key or a secret-store/KMS reference. Never reuse a session secret.

The PostgreSQL CLI script creates a local, unencrypted custom-format dump. It does not consume `BACKUP_ENCRYPTION_KEY` or upload to Drive. Encrypt that dump separately before copying it outside the protected server directory.

## PostgreSQL CLI authentication
Set `PGHOST`, `PGPORT`, `PGDATABASE` (database name only), and `PGUSER` for the backup operator. Supply passwords through a protected `PGPASSFILE` or the standard PostgreSQL password file with mode 0600 on Unix. The backup script uses libpq environment settings and `--no-password`; it does not pass the application's `DATABASE_URL` to `pg_dump`.

Avoid `PGPASSWORD`, since process environments can be visible to other users. See [PostgreSQL environment variables](https://www.postgresql.org/docs/current/libpq-envars.html) and [password files](https://www.postgresql.org/docs/current/libpq-pgpass.html). Backup files are created under `umask 077`; existing directory permissions remain the operator's responsibility.

## Handling rules
1. Store real values in the server secret store or protected environment, never Git.
2. Keep provider/OAuth/backup credentials out of browser bundles, logs, health responses, and error payloads.
3. Use different secrets between staging and production.
4. Restrict secret-file/service-account permissions to the service identity.
5. Rotate credentials after suspected disclosure and document rotation timestamps outside source control.
6. Backups containing application data must be encrypted before copying to removable or third-party storage.
7. Production secret changes and OAuth consent require explicit operator authorization.
