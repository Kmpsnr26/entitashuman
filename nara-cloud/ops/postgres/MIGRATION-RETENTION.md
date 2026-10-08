# PostgreSQL migration, backup, retention and recovery runbook

**Repository preparation only.** These instructions do not authorize database access, migrations, deletion, deployment, DNS changes or production recovery. Use only an explicitly approved disposable staging database during a later, separately authorized exercise. No command below targets a live database by default.

## Preconditions and approvals

1. Identify the environment and database **by name**, confirm the change window and obtain explicit operator approval before connecting or running migrations.
2. Confirm that `nara-cloud`'s `npm run db:migrate` executes `src/db/migrate.ts`; review the SQL in that source at the exact commit to be deployed. The current migration uses a transaction but is not a general-purpose versioned migration framework. Review future schema changes for idempotency, locks, backfills and rollback feasibility.
3. Verify PostgreSQL client/server version compatibility and available disk space. Use a least-privilege backup role, and a separate, approved migration role where DDL is necessary.
4. Set `PGHOST`, `PGPORT`, `PGDATABASE` (a database name, not a URL), `PGUSER` and a protected `PGPASSFILE` (0600 on Unix). Never put a password or `DATABASE_URL` in shell arguments or a committed file.
5. Set `BACKUP_DIR` to a protected directory on a private filesystem; use `umask 077`. The generated dump is **unencrypted** until encrypted by a separately approved mechanism. Do not upload or copy it to third-party storage unencrypted.

## Backup and verification (only after approval)

From the repository root, with the approved connection environment already set:

```bash
# Example for a future approved staging maintenance window; NOT run by CI.
BACKUP_DIR=/protected/staging-backups RETENTION_DAYS=14 \
  bash nara-cloud/ops/postgres/backup.sh
```

`backup.sh` creates a unique custom-format `nara-*.dump` plus `.sha256` file, checks the archive catalog, and cleans up partial outputs on failure. It **does not** prove a successful restore. Before any migration, run `bash nara-cloud/ops/postgres/restore-dry-run.sh /protected/staging-backups/EXACT_FILE.dump` with the exact operator-selected file. This checks the checksum and archive catalog only; it makes no database changes.

## Migration gate (only after approval)

1. Record the intended source commit, environment, change owner, and timestamp in an operations record outside Git.
2. Obtain a fresh backup, pass checksum/catalog checks, and independently demonstrate recovery into a **disposable** database before proceeding.
3. Confirm that `DATABASE_URL` is injected from the approved server secret store, points to the **staging** database, and is not logged. No credentials should be pasted into chat, tickets or CI logs.
4. In the authorized staging environment only, run `npm --prefix nara-cloud run db:migrate` and then the database-backed regression tests. Stop on any migration or security-test failure; do not improvise SQL fixes against an active database.
5. Record schema version/commit, test results and rollback decision. Production migrations require a separate approval and rehearsal.

## Retention (non-destructive by design)

`RETENTION_DAYS` is a **listing threshold**, not an automatic deletion policy. The backup script prints candidate `nara-*.dump` and `nara-*.dump.sha256` paths older than the threshold; it does not remove them. Preserve backup/checksum pairs and maintain at least one verified recovery point outside the retention window before considering any deletion. Check legal/operational retention requirements, encryption status, independent copy, restore-test recency, and ownership. Any deletion requires separate explicit operator authorization; this repository provides no automated prune command.

## Recovery rehearsal (separate disposable database only)

1. Verify the checksum and catalog with `restore-dry-run.sh`; treat success as **preflight only**.
2. Use a newly created, isolated, explicitly approved disposable database, never the source or production database. Do not use `--clean`, `--if-exists` or `dropdb` against an active database.
3. In an approved isolated environment, restore the custom archive with `pg_restore --no-owner --no-acl --exit-on-error` targeting that disposable database, then verify expected tables, row counts, constraints, ownership, and application-level authentication/session behavior using non-sensitive fixtures. Do not use real owner credentials for test verification.
4. Run read-only smoke checks against the recovered application/database and record evidence of success/failure. Tear down the disposable environment only under its own approval.
5. Switching application traffic, overwriting a database, or changing production is **out of scope** and requires separate authorization and a tested recovery plan.

## Tests available without live infrastructure

- `bash nara-cloud/ops/tests/operations.test.sh` uses fake PostgreSQL/HTTP tools to test failure paths; it is not a real restore.
- `bash nara-cloud/ops/tests/postgres-roundtrip.test.sh` is **CI-only** (`CI=true`, isolated PostgreSQL 17 service and constrained connection) and restores fixture rows into a separate disposable database. Never run it against production.
- `bash nara-cloud/ops/postgres/restore-dry-run.sh PATH_TO_DUMP` reads a local archive only, but requires an existing archive/checksum and `pg_restore`.

**BLOCKED_REQUIRES_USER:** actual database credentials, staging server access, backup encryption and storage selection, DNS/TLS, OAuth consent and any live migration/restore/deployment all require separate explicit approval. Never commit real secrets.
