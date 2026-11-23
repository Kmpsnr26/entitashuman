# NARA Cloud staging operations

Repository-side scaffolding only. This does not deploy or alter DNS, firewalls, hosting, or production.

Targets:
- staging-auth.aleprinting.my.id -> reverse proxy -> 127.0.0.1:4100
- staging-nara.aleprinting.my.id -> reverse proxy -> 127.0.0.1:4200

Node services must remain localhost-bound and TLS must terminate at the reverse proxy.

Secrets must be supplied through the server environment/secret store. Never commit real credentials. Provider and Google OAuth credentials remain server-side.

PostgreSQL operations must create a fresh backup before restore. Restore into a disposable database first, verify it, and require explicit operator approval before destructive replacement.

Run scripts with `bash` from any working directory, using an explicit backup path. For CLI backup, set the libpq `PGHOST`, `PGPORT`, `PGDATABASE`, and `PGUSER` environment variables and a protected `PGPASSFILE`; application `DATABASE_URL` is not passed on the command line. The dump stays local and unencrypted until the operator encrypts it for transfer. See `SECRETS.md` for authentication and file permissions.

`restore-dry-run.sh` is an archive preflight: it checks the checksum and reads the archive catalog without connecting to a database. It cannot establish that a full restore or application recovery will succeed. No script here performs an actual restore.

## Local script checks

Run `bash nara-cloud/ops/tests/operations.test.sh` from the repository root. It substitutes fake PostgreSQL and HTTP tools and checks credential arguments, inherited private umask, backup cleanup on failures, checksum behavior across working directories, tamper rejection, connection/retention input validation, and health-response failures. It creates temporary files only in `ops/tests/.work` and removes its own temporary directory afterward. These checks do not establish real PostgreSQL recovery, Unix filesystem permissions on Windows, TLS configuration, or staging deployment.

The NARA Cloud Verify job also parses the staging template against the actual runtime schema, then runs `ops/tests/postgres-roundtrip.test.sh` with PostgreSQL 17 clients against its isolated PostgreSQL 17 service. That integration test creates two disposable `nara_ops_*` databases, restores a real custom archive, and compares recovered fixture rows. It never restores into the service's existing `nara` database. This confirms the tested archive path and fixture recovery; production recovery still needs independent validation using representative data.

Deployment readiness:
1. CI has actually executed checkout, install, TypeScript/tests, and audit.
2. DNS and TLS are approved and provisioned.
3. Server runtime and PostgreSQL client tools are available.
4. Secrets exist only in the server secret store with restrictive permissions.
5. Services bind only to localhost.
6. Reverse proxy exposes HTTPS only.
7. Migration and backup archive checks pass, and recovery is independently tested in a disposable database.
8. Smoke tests pass after deployment.
9. Production promotion requires separate approval.

External requirements include DNS records, server/hosting access, TLS issuance, OAuth consent/client credentials, provider API credentials, GitHub runner capacity, and deployment authorization.
