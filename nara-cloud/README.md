# NARA Cloud

Server-side identity, SSO session, one-time ticket, PostgreSQL and future AI/Memory backend for HumanALE/NARA.

## Security boundary

NARA identity is independent from ChatGPT/OpenAI login.

- Owner identity: NARA Auth Server
- Password hashing: Argon2id
- Auth SSO session: PostgreSQL-backed cookie session
- NARA app session: separate PostgreSQL-backed cookie session
- SSO handoff: HMAC-hashed one-time ticket, 90-second lifetime
- Database: PostgreSQL
- OpenAI and other model providers: future NARA AI Gateway only
- API keys: server-side environment/secret manager only
- Browser/renderer never receives provider API keys

## Local service topology

```text
127.0.0.1:4100   NARA Auth Server
127.0.0.1:4200   NARA Application Backend
127.0.0.1:5432   PostgreSQL
```

Production should place an HTTPS reverse proxy/tunnel in front of 4100/4200. Do not expose those Node ports directly to the Internet.

## Environment

Copy `.env.example` to `.env` outside source control and replace every placeholder secret.

Production target origins:

```text
PUBLIC_AUTH_ORIGIN=https://aleprinting.my.id
PUBLIC_NARA_ORIGIN=https://nara.aleprinting.my.id
```

The Owner login route is:

```text
https://aleprinting.my.id/ownernara/login
```

## Development commands

```bash
npm install
npm run build
npm run db:migrate
npm test
npm run dev:auth
npm run dev:nara
```

Create the first Owner only after migration:

```bash
npm run create-owner
```

The script blocks a second active Owner and reads the password without echoing it to the terminal.

## Phase A scope

Implemented:

- PostgreSQL schema
- single active Owner constraint
- Argon2id password hashing
- Auth Server
- CSRF
- login rate limiting
- PostgreSQL sessions
- active-account re-check
- one-time SSO ticket
- 90-second ticket expiration
- NARA callback/session
- audit log sanitizer
- logout/session hardening

Not yet implemented:

- public production deployment
- AI Gateway
- cloud Memory API
- Google Drive OAuth/backup
- encrypted USB backup
- passkeys/2FA/device management
