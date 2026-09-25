# NARA Cloud staging operations

Repository-side scaffolding only. This does not deploy or alter DNS, firewalls, hosting, or production.

Targets:
- staging-auth.aleprinting.my.id -> reverse proxy -> 127.0.0.1:4100
- staging-nara.aleprinting.my.id -> reverse proxy -> 127.0.0.1:4200

Node services must remain localhost-bound and TLS must terminate at the reverse proxy.

Secrets must be supplied through the server environment/secret store. Never commit real credentials. Provider and Google OAuth credentials remain server-side.

PostgreSQL operations must create a fresh backup before restore. Restore into a disposable database first, verify it, and require explicit operator approval before destructive replacement.

Deployment readiness:
1. CI has actually executed checkout, install, TypeScript/tests, and audit.
2. DNS and TLS are approved and provisioned.
3. Server runtime and PostgreSQL client tools are available.
4. Secrets exist only in the server secret store with restrictive permissions.
5. Services bind only to localhost.
6. Reverse proxy exposes HTTPS only.
7. Migration and rollback backup are verified.
8. Smoke tests pass after deployment.
9. Production promotion requires separate approval.

External requirements include DNS records, server/hosting access, TLS issuance, OAuth consent/client credentials, provider API credentials, GitHub runner capacity, and deployment authorization.
