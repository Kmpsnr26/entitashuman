# AleCore Cloud Phase 11D — Google Drive Memory Backup

## Status

Source checkpoint implements an authenticated, server-side Google Drive backup path for AleCore Memory data.

Execution verification remains pending until `npm run verify` and a controlled Google Drive integration test can run. No build, unit-test, database, or live Drive pass is claimed by this document.

## Scope

Phase 11D backs up only Owner-scoped rows from `nara_memory`.

The backup intentionally excludes:

- Owner passwords
- auth/session tables
- login tickets
- cookies and CSRF tokens
- provider credentials
- AI usage logs
- raw provider telemetry
- application environment variables

The exported JSON envelope contains:

- schema version
- export timestamp
- memory records and their Memory Engine fields

The export does not include the Owner email or OAuth credentials.

## API

Mounted at `/api/backups`.

- `GET /api/backups/google-drive`
  - requires Owner authentication
  - returns only safe capability state: configured + maximum multipart payload bytes
- `POST /api/backups/google-drive`
  - requires Owner authentication
  - requires CSRF
  - rate limited to 5 requests/hour
  - exports the authenticated Owner's memory
  - uploads the JSON backup to the configured Google Drive folder
  - returns only safe file metadata

## Google Drive credentials

The following environment variables must be configured together:

- `GOOGLE_DRIVE_CLIENT_ID`
- `GOOGLE_DRIVE_CLIENT_SECRET`
- `GOOGLE_DRIVE_REFRESH_TOKEN`
- `GOOGLE_DRIVE_BACKUP_FOLDER_ID`

They remain server-side.

The OAuth token endpoint and Drive upload endpoint are hardcoded by source. Browser input cannot choose a credential endpoint, Drive API base URL, refresh token, or folder credential.

## Upload bounds

The Drive API multipart path is used only for small payloads.

AleCore Cloud applies a conservative application limit of 4,500,000 bytes, below the Google Drive multipart guidance limit of 5 MB.

The memory exporter is additionally bounded to 5,000 rows.

If either limit is exceeded, the request fails with a normalized application error. The implementation does not silently truncate the backup.

A later phase may add resumable upload for larger archives, but this checkpoint does not bypass the multipart bound.

## Failure handling

Upstream OAuth and Drive failures are mapped into AleCore Cloud error classes:

- `GOOGLE_DRIVE_NOT_CONFIGURED`
- `GOOGLE_DRIVE_BACKUP_TOO_LARGE`
- `GOOGLE_DRIVE_AUTH_FAILED`
- `GOOGLE_DRIVE_RATE_LIMITED`
- `GOOGLE_DRIVE_UNAVAILABLE`
- `GOOGLE_DRIVE_REQUEST_FAILED`

Raw Google response bodies are not copied into browser responses or audit metadata.

Access tokens and refresh tokens are never returned by the API.

## Audit boundary

Successful backup creation records:

- event type
- backup record count
- Drive-reported file size

The audit event does not record:

- memory content
- Google access token
- Google refresh token
- client secret
- Authorization header

## Regression coverage

`tests/backup-source.test.ts` checks:

- export query is Owner-scoped
- exporter is bounded
- session, password, and usage-log tables are not exported
- Google endpoints are fixed in server source
- multipart payload remains bounded
- routes preserve Owner auth and CSRF
- backup trigger remains rate limited
- route source does not reference Drive secrets/tokens
- Google Drive configuration remains all-or-none
- backup router stays mounted under `/api/backups`

The test is included in `npm run test:unit` and therefore `npm run verify`.

## Verification gate

Before Phase 11D can become `VERIFIED`:

1. `npm run build`
2. `npm run test:unit`
3. `npm run verify`
4. isolated PostgreSQL migration + Memory Engine validation
5. fake-fetch/unit validation of OAuth and multipart request construction
6. controlled test Drive upload with non-production credentials/folder
7. verify uploaded JSON can be parsed and matches the exported row count
8. final source scan for secrets and unrelated files

Until those checks execute successfully, Phase 11D remains `VERIFICATION_PENDING`.
