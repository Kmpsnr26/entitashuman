# NARA Cloud Phase 11G — HumanALE Cloud Bridge

## Status

This source checkpoint connects the existing permission-gated HumanALE Phase 10 memory-context model to Owner-scoped NARA Cloud Memory without replacing HumanALE avatar/reference-face assets.

The bridge is additive and disabled by default from the HumanALE user's perspective: the memory source remains **Local** until the user explicitly chooses **NARA Cloud**.

Execution verification remains pending until both NARA Cloud and HumanALE verification commands can execute in a usable repository checkout.

## Architecture

Phase 11G is split into two cooperating layers.

### 11G-A — NARA Cloud server bridge

Mounted at:

- `GET /api/humanale/status`
- `POST /api/humanale/context`

Server security boundary:

- Owner session authentication is mandatory
- context POST requires trusted same-origin evidence
- context POST requires JSON media type
- context POST requires CSRF
- bridge is rate limited to 30 requests/minute
- no API/provider/Google credential is returned
- no cookie/session ID is returned
- no raw task/prompt is sent to the cloud context selector
- audit metadata contains only target, mode, count, and character count

The cloud bridge does not create a second authentication token.

### 11G-B — HumanALE desktop consumer

HumanALE Desktop uses:

- optional `NARA_CLOUD_ORIGIN`
- Electron's existing default browser session
- NARA Owner login page inside a sandboxed BrowserWindow
- session cookies kept inside Electron's Chromium session
- CSRF token obtained through authenticated `/api/me`
- fixed NARA Cloud API paths

Renderer IPC exposes only:

- `cloudStatus()`
- `cloudLogin()`
- `cloudContext(payload)`

Renderer does **not** receive:

- session cookies
- cookie jar access
- raw Electron session object
- provider credentials
- Google Drive credentials
- Authorization headers
- arbitrary cloud endpoint selection

## Cloud origin configuration

Desktop configuration:

`NARA_CLOUD_ORIGIN=https://your-nara-cloud-origin.example`

`NARA_AUTH_ORIGIN=https://your-owner-auth-origin.example`

If the Owner auth service shares the same origin as NARA Cloud, `NARA_AUTH_ORIGIN` may be left empty and the cloud origin is reused.

Requirements:

- both values are bare origins only
- no username/password in URL
- no path/query/hash
- HTTPS required
- HTTP is accepted only for loopback development (`localhost`, `127.0.0.1`, `::1`)
- login-window navigation is restricted to the configured cloud/auth origins

No NARA Cloud password, cookie, API token, or CSRF token is stored in `.env.example`.

## HumanALE permission model

HumanALE Phase 10 context modes remain authoritative:

- `off`
- `ask`
- `auto-safe`

Cloud packets use the same trusted packet contract already validated by `desktop/memory-context.mjs`:

- version = 1
- target = reasoner / planner / agent
- mode = ask / auto-safe
- approved = true before provider use
- maximum 6 entries
- maximum 1600 characters
- exact entry ID list
- exact character count
- bounded context text

The provider-facing memory block continues to label the context as **untrusted reference data**, not system instructions.

## Explicit source selection

HumanALE adds a separate memory source control:

- Local
- NARA Cloud

Default remains:

- Local

Changing the context mode does not silently select cloud memory.

A previously selected Cloud preference is not reset merely because status has not finished loading. It is reset to Local only after a real status check confirms that NARA Cloud is not configured.

## Ask-first flow

For `ask` mode:

1. HumanALE requests a cloud preview.
2. NARA Cloud returns a preview with `approved=false`.
3. No context-used audit event is written at preview time.
4. HumanALE displays the exact bounded preview to the Owner.
5. If rejected, nothing is sent to the AI provider.
6. If approved, HumanALE sends the previewed entry IDs back to NARA Cloud.
7. NARA Cloud re-fetches those exact IDs through Owner-scoped queries.
8. If an entry is missing/not owned/no longer matches filters, the approval fails as stale.
9. NARA Cloud rebuilds the packet.
10. The desktop main process validates the returned packet again using `validateMemoryContext`.
11. Only then may the existing provider bridge receive the memory context.

This avoids trusting renderer-created cloud context packets.

## Auto-safe flow

For `auto-safe` mode:

- the same bounded server selector is used
- credential-like entries are skipped
- control-character entries are skipped
- the returned packet is still revalidated by desktop main
- no prompt/task text is uploaded to choose context

## Context selection bounds

Cloud selector:

- reads only the authenticated Owner's `nara_memory`
- source query remains owner-scoped
- candidate fetch limit = 50
- final entries <= 6
- final text <= 1600 characters
- title excerpt <= 120 characters
- content excerpt <= 220 characters per selected record
- records containing common credential patterns are skipped
- records containing control characters are skipped

Credential-pattern filtering covers examples such as:

- OpenAI-shaped keys
- GitHub token/PAT shapes
- Bearer tokens
- api_key assignments
- access_token / refresh_token assignments
- password / secret assignments

The filter is defense-in-depth and does not replace the rule that real secrets must never be stored in project memory.

## Desktop login window

The NARA Cloud login BrowserWindow:

- has Node integration disabled
- has context isolation enabled
- runs sandboxed
- denies new popup windows
- permits navigation only to the exact configured NARA Cloud/Auth origins
- rejects unrelated HTTPS origins instead of treating all HTTPS destinations as trusted
- shares Electron's default session with the cloud API client
- closes automatically once the Owner session and HumanALE bridge are available

The HumanALE renderer never receives the session cookie.

## Existing boundaries preserved

At the original Phase 11G checkpoint, this bridge intentionally did not change the avatar renderer. Later consolidated hardening removed the image-based face reference entirely. The current HumanALE avatar is procedural-only and generated from code; this historical section must not be read as a current PNG/runtime dependency.
- Owner identity/session/SSO semantics
- CSRF policy
- trusted-origin policy
- provider credentials
- Google Drive credentials
- provider routing
- provider health/circuit breaker
- prompt-free AI usage logs
- streaming fallback invariant
- Memory owner isolation
- Google Drive backup data exclusions
- encrypted USB backup format

## Regression coverage

NARA Cloud tests cover:

- packet contract and bounds
- credential-like record rejection
- control-character record rejection
- Owner-auth/origin/JSON/CSRF route boundaries
- Phase 10 desktop validator compatibility
- narrow desktop cloud IPC source boundary
- absence of face/reference asset imports in cloud bridge source

HumanALE root tests cover:

- NARA Cloud origin validation
- loopback-only HTTP exception
- Owner session status using fake fetch
- CSRF header propagation
- preview flow
- approval with exact previewed entry IDs
- final packet validation through `validateMemoryContext`
- login-required behavior without invented credentials

## Verification gate

Before Phase 11G can become `VERIFIED`:

1. NARA Cloud: `npm run build`
2. NARA Cloud: `npm run test:unit`
3. NARA Cloud: `npm run verify`
4. HumanALE root: `npm test`
5. HumanALE root: `npm run build`
6. HumanALE root: `npm run verify`
7. controlled Owner login from the Electron Cloud Login window
8. verify Local remains default memory source
9. Ask-first preview/reject test
10. Ask-first preview/approve test
11. Auto-safe bounded cloud context test
12. verify session cookies are not visible to renderer
13. verify no task/prompt text is sent to cloud selector
14. final secret-pattern scan
15. final diff audit confirming no avatar/reference-face asset modifications

Until those checks execute successfully, Phase 11G remains `VERIFICATION_PENDING`.


## Consolidated integration checkpoint

As of 2026-09-26, Phase 11G is the single integration candidate targeting `main`.

Verified direct ancestry in this branch includes HumanALE/NARA phases #35-#40, #42-#47, #51, and #55-#58. PR #41 was an alternate Phase 8 implementation and is superseded by the consolidated cognition, persistent safe memory, BrainState, and Data Spine implementation. Cloud Auto Repair (#53) and parallel agent/CI tooling (#54) are also consolidated into this branch.

Before earlier phase PRs are closed, this consolidated head must pass both the NARA Cloud verification workflow and the repository-wide main-target verification workflow.
