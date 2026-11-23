# AleCore AI Cloud

Server-side identity, SSO session, one-time ticket, PostgreSQL and future AI/Memory backend for HumanALE/AleCore AI.

## Security boundary

AleCore AI identity is independent from ChatGPT/OpenAI login.

- Owner identity: AleCore AI Auth Server
- Password hashing: Argon2id
- Auth SSO session: PostgreSQL-backed cookie session
- AleCore AI app session: separate PostgreSQL-backed cookie session
- SSO handoff: HMAC-hashed one-time ticket, 90-second lifetime
- Database: PostgreSQL
- OpenAI and other model providers: future AleCore AI AI Gateway only
- API keys: server-side environment/secret manager only
- Browser/renderer never receives provider API keys

## Local service topology

```text
127.0.0.1:4100   AleCore AI Auth Server
127.0.0.1:4200   AleCore AI Application Backend
127.0.0.1:5432   PostgreSQL
```

Production should place an HTTPS reverse proxy/tunnel in front of 4100/4200. Do not expose those Node ports directly to the Internet.

## Environment

Copy `.env.example` to `.env` outside source control and replace every placeholder secret.

Production target origins:

```text
PUBLIC_AUTH_ORIGIN=https://aleprinting.my.id
PUBLIC_ALECORE_AI_ORIGIN=https://ale.aleprinting.my.id
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
- AleCore AI callback/session
- audit log sanitizer
- logout/session hardening

Not yet implemented:

- public production deployment
- AI Gateway
- cloud Memory API
- Google Drive OAuth/backup
- encrypted USB backup
- passkeys/2FA/device management


## Phase 11B — AleCore AI AI Gateway

Current B1 implementation adds a server-side AI gateway behind the authenticated AleCore AI session.

### Endpoints

```text
GET  /api/ai/providers
POST /api/ai/chat
POST /api/ai/stream
```

All AI endpoints require an authenticated AleCore AI Owner session. POST endpoints also require the current AleCore AI CSRF token in:

```http
X-CSRF-Token: <token>
```

### OpenAI provider

The first production adapter uses the OpenAI Responses API from the AleCore AI backend.

Provider credentials remain server-side:

```text
Browser / HumanALE
        │
        ▼
AleCore AI Backend
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

The request explicitly uses `store: false`. No tools are enabled by the AleCore AI chat endpoint.

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


## Phase 11B2 — Multi-provider routing

AleCore AI AI Gateway now supports four adapter slots behind the same authenticated API contract:

```text
AleCore AI AI Gateway
     │
     ├── OpenAI Responses API
     ├── Gemini generateContent / streamGenerateContent
     ├── Anthropic Messages API
     └── OpenAI-compatible Chat Completions
```

Automatic routing uses:

```env
AI_PROVIDER_ORDER=openai,gemini,anthropic,compatible
```

A provider with no server-side credential is considered unconfigured and is skipped in automatic routing. Explicitly requesting an unconfigured provider returns an availability error instead of silently selecting a different provider.

### Gemini

```env
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.8-flash
```

The API key is sent only from the AleCore AI backend using the Gemini API authentication header. The browser never receives it.

### Anthropic

```env
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-sonnet-4-6
```

The backend uses the Anthropic Messages API and SSE message/content-block lifecycle for streaming.

### OpenAI-compatible provider

This adapter is intentionally configured only by server environment:

```env
COMPAT_PROVIDER_ID=compatible
COMPAT_API_BASE_URL=
COMPAT_API_KEY=
COMPAT_MODEL=
```

All three connection values are required together. The provider ID cannot impersonate the built-in `openai`, `gemini`, `anthropic`, or `auto` identifiers. Production compatible-provider URLs must use HTTPS.

The request body cannot supply an arbitrary provider base URL, which prevents the public AI API from becoming a user-controlled server-side HTTP proxy.

### Fallback safety

Fallback is allowed only when:

1. automatic provider mode is selected;
2. the failure is classified retryable;
3. there is another configured provider; and
4. no streamed text has been emitted yet.

Once a provider emits the first text delta, AleCore AI will not switch to another provider for that response.


## Phase 11B3 — Provider health and circuit breaker

AleCore AI tracks provider health in process memory without storing prompts, responses, cookies, sessions or credentials.

Public provider state returned by `GET /api/ai/providers` is intentionally simple:

```text
ready
degraded
unavailable
```

Internally, the circuit breaker uses:

```text
healthy
   │ retryable failure
   ▼
degraded
   │ threshold reached
   ▼
open
   │ cooldown elapsed
   ▼
half-open
   │
   ├── successful active probe ──> healthy
   ├── retryable active-probe failure ──> open
   └── client-abandoned probe ──> half-open (lease released)
```

Public mapping:

```text
healthy    -> ready
degraded   -> degraded
half-open  -> degraded
open       -> unavailable
not configured -> unavailable
```

Environment controls:

```env
AI_BREAKER_FAILURE_THRESHOLD=3
AI_BREAKER_COOLDOWN_MS=60000
```

Automatic routing skips providers whose circuit is open. Explicit requests to an open provider return a safe availability error and do not call the upstream provider until a half-open probe is permitted.

Only retryable operational provider failures can change circuit state or increment the consecutive-failure breaker count. A non-retryable upstream/request-specific failure remains visible in bounded telemetry but does not degrade, open or re-open the circuit. User/client aborts are not counted as provider failures.

The gateway-level `AI_REQUEST_TIMEOUT_MS` deadline is different from a client abort: when that deadline expires, the provider attempt is recorded as the retryable `AI_PROVIDER_TIMEOUT` failure. Automatic routing may then fall back to the next healthy provider, and repeated timeouts can open the provider circuit. A client disconnect/abort still releases the attempt without poisoning provider health. The first abort cause is retained so a later client disconnect cannot retroactively turn an already-fired provider timeout into a client abort.

Provider-facing telemetry and browser error responses use AleCore AI-owned normalized error codes. Arbitrary error-code strings supplied by an upstream provider are not copied into provider-health status or reflected directly to the browser.

Retryability is conservative. HTTP transport status and a small provider-specific transient allowlist are used only to decide whether fallback/circuit health may change. Unknown or request-specific stream error identifiers are treated as non-retryable. For OpenAI HTTP 429 responses, known account/spend/usage-limit identifiers (including quota-style error types) are treated as non-retryable while ordinary rate-limit responses remain retryable; the upstream identifier is used only for that classification and is not retained in telemetry or returned to the browser. Anthropic HTTP 429 is treated as transient only when the response carries a Retry-After hint, preventing long-lived spend-cap conditions from poisoning provider health. A successful HTTP response that contains no usable text is also non-retryable because it can represent request/model semantics rather than an operational provider outage.

The health telemetry is bounded and process-local. It includes only operational metadata:

- public state
- internal circuit state
- consecutive retryable failures
- bounded success/failure sample counts
- success rate
- exponential moving average latency
- last latency
- sanitized last error code
- safe success/failure/open/probe timestamps
- half-open probe state

Counters are compacted when the configured in-memory sample bound is reached, so the process does not keep an unbounded request history.

It does **not** contain:

- API keys
- Authorization headers
- prompts
- response text
- cookies
- session IDs
- passwords
- provider base credentials

Streaming keeps the B2 no-mix invariant: after any text delta is emitted, AleCore AI will not switch to another provider for that response. Downstream/output callback failures are isolated from upstream provider health: they release any active half-open probe lease, do not increment provider failure counters, and never trigger fallback to another provider. Attempt-observer/logging callback failures are treated as non-authoritative telemetry failures and cannot change routing or breaker state.

If a half-open probe is cancelled or abandoned by the client, AleCore AI only releases the single-probe lease. The circuit remains half-open so a later request can perform a real provider-health probe without extending the cooldown because of client behavior.

Each half-open probe receives an internal lease ID. Only the currently active probe lease may close or re-open the half-open circuit. A normal request that started before the circuit opened, or an older released probe that completes late, is still counted in bounded telemetry but cannot override the newer breaker state.
