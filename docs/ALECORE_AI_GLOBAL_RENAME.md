# AleCore AI — Global Identity Migration

Status: **in progress; isolated branch only**

Target product identity: **AleCore AI**.

The legacy product/core identity is being replaced across first-party source, desktop integration, cloud services, UI copy, configuration, scripts, tests, documentation, generated first-party bundles, and repository paths. This is a coordinated migration, not a blind global text substitution.

## Safety invariants

- Work only on `codex/alecore-ai-global-rename-20261124` until reviewed.
- Do not rewrite `main`, force-push, or merge as part of the rename.
- Preserve third-party package names, upstream OpenCode identifiers, vendor APIs, and external protocol names when changing them would break compatibility.
- Rename exported symbols and environment variables only together with every consumer, tests, examples, and deployment configuration.
- Where persisted event names, database columns, deployed environment variables, cookies, session tables, or authentication ticket audiences need compatibility, use an explicit versioned migration or documented alias rather than silently changing the wire format.
- Keep existing user data, credentials, secrets, database contents, and backup formats untouched.
- Never claim local tests or builds passed when only GitHub source inspection was possible.

## Staged execution

1. **Inventory and guardrails** — record all legacy identifiers and introduce a repeatable repository-wide audit. **Foundation committed.**
2. **Core source and paths** — migrate core directory/file names, imports, exports, symbols, and internal event identifiers in dependency-aware groups. An additive `alecore-ai/index.js` facade exposes the new orchestrator identity while retaining `NaraOrchestrator` as a deprecated alias. The product identity now points to the existing `adult-robot-id` voice profile; no unimplemented voice preset is advertised.
3. **Desktop and cloud** — in progress. The desktop main process now loads the AleCore coordinator facade; cloud package scripts expose `dev:alecore` and `start:alecore`, and the system prompt exports `ALECORE_AI_SYSTEM_PROMPT` with a deprecated legacy alias. Legacy service paths, environment variables, cookies, session tables, routes, and ticket audiences remain unchanged until their consumers and persisted contracts are migrated together.
4. **Studio and product UI** — migrate visible names, accessibility labels, voice text, page metadata, and assets where they contain first-party identity.
5. **Tests and automation** — migrate test paths/assertions, CI workflows, scripts, fixtures, and generated first-party bundles from their authoritative sources.
6. **Compatibility and validation** — run focused tests, full test suite, lint/typecheck/build, secret scan, and a final legacy-reference audit.
7. **Review** — publish a draft PR with a path map, compatibility notes, test evidence, and any intentionally retained upstream/vendor references.

## Audit command

```sh
node scripts/alecore-rename-audit.mjs
node scripts/alecore-rename-audit.mjs --strict
```

Report mode is non-blocking during migration. Strict mode is a release gate and is expected to fail until all first-party legacy identifiers have been migrated or explicitly excluded by a reviewed, narrowly scoped policy.

## Current branch inventory

- Branch: `codex/alecore-ai-global-rename-20261124`
- Base: `main` at `741045aa5925dd27058499a1daadf16a606ad9aa`.
- Latest inspected branch head at the time of this update: `65607c18a3d73654bc6289595a706ce62e0c3acb`.
- Repository tree inspected before the latest desktop wiring commit: 470 entries, including directories.
- Path inventory at that inspection: 258 paths contain a case-insensitive `nara` substring (path count, not file count).
- The desktop main process now uses `desktop/alecore-agent-coordinator.mjs`; the implementation is still backed by the legacy module to preserve behavior.
- Root and cloud package scripts expose AleCore-named entry points alongside the legacy scripts. Cloud origins, cookie names, session tables, ticket audience, and route paths remain compatibility contracts and are not renamed in isolation.
- Core snapshots preserve the legacy `identity` field while adding `productIdentity`; `integrationPlan().identity` uses the AleCore identity and exposes `legacyIdentity` explicitly.
- No broad text replacement has been performed. Renames are additive and consumer-aware.

## Completion criteria

The migration is complete only when first-party product-facing references and internal identifiers consistently use AleCore AI, the final audit has no unapproved findings, all required CI checks pass, and a reviewer can trace every compatibility exception. Tests and builds must be executed on a real checkout before completion is declared.
