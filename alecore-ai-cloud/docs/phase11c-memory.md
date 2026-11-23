# AleCore AI Cloud Phase 11C — Memory Engine

## Status

Source checkpoint implements the first authenticated, owner-scoped Memory Engine API.

Execution verification remains pending until `npm run verify` can run in a usable repository runner/checkout. No build or unit-test pass is claimed by this document.

## Storage model

Phase 11C extends the existing `alecore_ai_memory` table with:

- `project_key TEXT`
- `conversation_id UUID`
- memory scopes `short_term`, `long_term`, `project`, and `conversation`
- owner/scope/update index
- owner/project/update partial index

Legacy memory types remain accepted by the database migration so existing rows are not invalidated.

The executable migration is wired into `src/db/migrate.ts`. The standalone `src/db/phase11c-memory.sql` file is retained as the phase schema reference/checkpoint.

## API

Mounted at `/api/memory`.

Available operations:

- `GET /api/memory` — list the authenticated Owner's memories
- `GET /api/memory/:id` — read one memory belonging to the authenticated Owner
- `POST /api/memory` — create memory; requires CSRF
- `DELETE /api/memory/:id` — delete only the authenticated Owner's memory; requires CSRF

List filters:

- `scope`
- `projectKey`
- `conversationId`
- `limit` from 1 to 50

Create limits include:

- title: 1–160 characters
- content: up to 100,000 characters
- tags: at most 32 entries, 64 characters each
- importance: 1–5
- project scope requires `projectKey`
- conversation scope requires `conversationId`

## Security boundaries

- every Memory API route passes through `requireApiAuth`
- POST and DELETE pass through `requireCsrf`
- every read/delete query includes `owner_id`
- conversation relationships are accepted only when the conversation belongs to the same Owner
- missing/non-owned memory IDs both return `MEMORY_NOT_FOUND`
- provider credentials are not referenced by Memory source
- Memory work does not change AI provider routing, prompt-free usage logs, or the no-fallback-after-first-text-delta invariant
- no HumanALE avatar/reference-face assets are modified

## Regression coverage

`tests/memory-source.test.ts` checks:

- Phase 11C schema is present in the executable migration
- required scopes/indexes exist
- memory service read/delete operations stay owner-scoped
- conversation ownership is checked
- list size remains bounded to 50
- API authentication and CSRF boundaries remain present
- `/api/memory` remains mounted by the AleCore AI server
- provider credential identifiers are absent from Memory routes/service

The test is included in `npm run test:unit` and therefore `npm run verify`.

## Verification gate

Before marking Phase 11C `VERIFIED`:

1. run `npm run build`
2. run `npm run test:unit`
3. run `npm run verify`
4. run the database migration against an isolated PostgreSQL test database
5. confirm create/list/get/delete owner-isolation behavior against the migrated schema
6. scan the final diff for secrets and unrelated asset changes

Until those checks execute successfully, Phase 11C remains `VERIFICATION_PENDING`.
