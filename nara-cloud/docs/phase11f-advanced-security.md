# NARA Cloud Phase 11F — Advanced Security

## Status

This source checkpoint adds defense-in-depth request hardening without changing NARA data contracts or provider credentials.

Execution verification remains pending until `npm run verify` runs in a usable checkout.

## Trusted mutation origin

Production mutation requests now pass through a centralized `requireTrustedOrigin` middleware.

The policy:

- rejects `Sec-Fetch-Site: cross-site`
- accepts an exact `Origin` match with `PUBLIC_NARA_ORIGIN`
- otherwise accepts a valid `Referer` whose origin exactly matches `PUBLIC_NARA_ORIGIN`
- rejects missing origin evidence in production
- keeps development/test behavior relaxed so local tooling is not broken

The policy is applied in addition to CSRF protection, not instead of it.

Protected mutations include:

- AI chat
- AI streaming
- Memory create
- Memory delete
- Google Drive backup trigger
- encrypted USB backup export
- logout

## CSRF preservation

All existing CSRF boundaries remain.

Phase 11F centralizes logout on the shared `requireCsrf` middleware instead of duplicating CSRF verification inside `naraServer.ts`.

This keeps one validation implementation and reduces drift.

## JSON media type enforcement

Endpoints that consume JSON now require an explicit JSON media type.

Accepted:

- `application/json`
- `application/*+json`

Invalid media types return:

- HTTP 415
- `JSON_CONTENT_TYPE_REQUIRED`

Applied to:

- AI chat
- AI stream
- Memory create
- encrypted USB backup export

Endpoints that do not require a JSON body, such as Google Drive backup trigger and logout, are not forced to send an empty JSON document.

## API cache boundary

A centralized `apiNoStore` middleware is mounted on `/api` before API routers.

This means authentication failures and other early API responses also inherit:

- `Cache-Control: no-store, max-age=0`
- `Pragma: no-cache`

Existing route-level no-store headers remain compatible.

## Preserved boundaries

Phase 11F does not alter:

- Owner authentication identity
- SSO ticket semantics
- session regeneration
- session cookie policy
- provider credentials
- provider routing order
- provider-health circuit behavior
- prompt-free AI usage logs
- no-fallback-after-first-text-delta rule
- Memory owner isolation
- Drive backup owner isolation
- encrypted backup format
- HumanALE avatar/reference-face assets

## Regression coverage

`tests/advanced-security.test.ts` covers the pure origin decision policy:

- exact Origin accepted
- exact-origin Referer accepted
- cross-site rejected
- sibling origin rejected
- missing evidence rejected in production enforcement
- malformed Referer rejected
- development enforcement disabled

`tests/advanced-security-source.test.ts` checks:

- global API no-store is mounted before API routers
- AI mutations use origin + JSON + CSRF guards
- Memory mutations use origin + CSRF, with JSON on create
- Backup mutations use origin + CSRF, with JSON on encrypted USB export
- logout uses centralized origin + CSRF middleware
- legacy inline `validOrigin` is removed
- JSON media-type guard fails closed with HTTP 415

The existing source-security regression was updated to validate centralized `requireCsrf` / `requireTrustedOrigin` rather than the removed inline CSRF implementation.

## Verification gate

Before Phase 11F can be marked `VERIFIED`:

1. `npm run build`
2. `npm run test:unit`
3. `npm run verify`
4. execute trusted-origin unit tests
5. validate production rejection of cross-site mutation requests
6. validate same-origin AI/Memory/Backup/logout flows
7. validate JSON 415 behavior without weakening CSRF
8. re-run static secret scan
9. confirm no HumanALE reference asset changes

Until those checks execute successfully, Phase 11F remains `VERIFICATION_PENDING`.
