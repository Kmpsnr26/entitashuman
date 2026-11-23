# NARA Cloud staging deployment and recovery checklist

This document is preparation only. It does not authorize deployment.

## Preconditions
- GitHub verification jobs execute successfully.
- DNS for staging hosts is approved and configured externally.
- TLS certificates are provisioned at the reverse proxy.
- Node services bind only to 127.0.0.1:4100 and 127.0.0.1:4200.
- PostgreSQL is reachable only from approved hosts.
- Real secrets exist only in the server secret store/environment.
- A PostgreSQL backup with checked checksum and catalog exists before migrations; restore viability is validated separately in a disposable database.

## Staging smoke tests
1. Confirm HTTPS and certificate validity for both staging hosts.
2. Confirm HTTP redirects to HTTPS if HTTP is enabled.
3. Confirm auth health endpoint returns success without leaking configuration.
4. Confirm NARA health endpoint returns success without provider credentials in the response.
5. Confirm unauthenticated protected routes are rejected.
6. Confirm session cookies use Secure, HttpOnly, and appropriate SameSite settings.
7. Confirm CSRF protection on state-changing browser requests.
8. Confirm provider API keys are absent from browser bundles and responses.
9. Run database migrations in staging, then application regression tests.
10. Create a fresh backup and run `bash ops/postgres/restore-dry-run.sh BACKUP.dump` against it. This checks checksum/catalog only; separately restore into an approved disposable database and test the recovered data.

## Recovery
- Stop application writes before an actual restore.
- Verify checksum and pg_restore catalog first.
- Restore into a separate recovery database before replacing any active database.
- Run migrations/checks and smoke tests against the recovery database.
- Switching production to recovered data requires explicit operator authorization.

## External actions still requiring authorization
DNS changes, hosting/server access, firewall changes, TLS provisioning, OAuth consent/client credentials, real provider secrets, GitHub billing/runner policy changes, production deployment, merge/release.
