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


## Phase 11B — NARA AI Gateway

Current B1 implementation adds a server-side AI gateway behind the authenticated NARA session.

### Endpoints

```text
GET  /api/ai/providers
POST /api/ai/chat
POST /api/ai/stream
```

All AI endpoints require an authenticated NARA Owner session. POST endpoints also require the current NARA CSRF token in:

```http
X-CSRF-Token: <token>
```

### OpenAI provider

The first production adapter uses the OpenAI Responses API from the NARA backend.

Provider credentials remain server-side:

```text
Browser / HumanALE
        │
        ▼
NARA Backend
        │
        ├── authenticated session
        ├── CSRF
        ├── request validation
        ├── rate limit
        ├── provider selection
        └── OPENAI_API_KEY (server environment only)
                │
                ▼
          OpenAI Responses API
```

The request explicitly uses `store: false`. No tools are enabled by the NARA chat endpoint.

### Streaming

`POST /api/ai/stream` returns Server-Sent Events:

```text
event: request
event: provider
event: delta
event: done
event: error
```

If the selected provider fails before any text delta is emitted, the gateway may try the next configured provider. Once any text has been emitted, fallback is disabled for that response so output from multiple providers cannot be mixed.

### Fallback framework

`AI_PROVIDER_ORDER` defines automatic provider priority. B1 includes the OpenAI adapter and a provider-neutral fallback engine. Additional provider adapters are added in later B steps without changing the public API routes.

### Usage logging

`ai_usage_logs` stores operational metrics only:

- request UUID
- Owner UUID
- provider
- model
- success/error/aborted status
- input/output character counts
- provider token usage when available
- latency
- safe error code
- fallback source

It intentionally has no prompt, message, response-content, API-key, cookie or authorization columns.

### AI environment

```env
OPENAI_API_KEY=
OPENAI_MODEL=gpt-6-astra
AI_PROVIDER_ORDER=openai
AI_REQUEST_TIMEOUT_MS=120000
AI_MAX_OUTPUT_TOKENS=2048
```

Do not commit a real provider key. Production keys belong in server environment variables or a deployment secret manager.
