# NARA Cloud secret-management checklist

This file defines names and handling rules only. It contains no credentials.

## Required application secrets
- `DATABASE_URL`: PostgreSQL connection string. Server-side only.
- `AUTH_SESSION_SECRET`: unique random auth-session signing/encryption secret.
- `NARA_SESSION_SECRET`: different random NARA-session secret.
- `TICKET_PEPPER`: different high-entropy server-side pepper.
- `OPENAI_API_KEY`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`: provider credentials. Server-side only.

## Google Drive backup
- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_SECRET`
- `GOOGLE_OAUTH_REDIRECT_URI`
- `GOOGLE_OAUTH_REFRESH_TOKEN`

Request the minimum Drive scope required by the backup design. Encrypt refresh tokens at rest. OAuth consent and live credentials are external actions and are not required to keep preparing repository-side staging scaffolding.

## Backup encryption
- `BACKUP_ENCRYPTION_KEY`: use a dedicated high-entropy key or a secret-store/KMS reference. Never reuse a session secret.

## Handling rules
1. Store real values in the server secret store or protected environment, never Git.
2. Keep provider/OAuth/backup credentials out of browser bundles, logs, health responses, and error payloads.
3. Use different secrets between staging and production.
4. Restrict secret-file/service-account permissions to the service identity.
5. Rotate credentials after suspected disclosure and document rotation timestamps outside source control.
6. Backups containing application data must be encrypted before copying to removable or third-party storage.
7. Production secret changes and OAuth consent require explicit operator authorization.
