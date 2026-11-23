# AleCore AI — Global Identity Migration

Status: **in progress; isolated branch only**

Target product identity: **AleCore AI**.

The legacy product/core identity is being replaced across first-party source, desktop integration, cloud services, UI copy, configuration, scripts, tests, documentation, and repository paths. This is a coordinated migration, not a blind global text substitution.

## Safety invariants

- Work only on `codex/alecore-ai-global-rename-20261124` until reviewed.
- Do not rewrite `main`, force-push, or merge as part of the rename.
- Preserve third-party package names, upstream OpenCode identifiers, vendor APIs, and external protocol names when changing them would break compatibility.
- Rename exported symbols and environment variables only together with every consumer, tests, examples, and deployment configuration.
- Where persisted event names, database columns, or deployed environment variables need compatibility, use an explicit versioned migration or documented alias rather than silently changing the wire format.
- Keep existing user data, credentials, secrets, database contents, and backup formats untouched.

## Staged execution

1. **Inventory and guardrails** — record all legacy identifiers and introduce a repeatable repository-wide audit.
2. **Core source and paths** — migrate core directory/file names, imports, exports, symbols, and internal event identifiers in dependency-aware groups.
3. **Desktop and cloud** — migrate desktop coordinator, cloud service, routes, environment examples, and package metadata; preserve external API contracts.
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

## Current baseline

- Branch: `codex/alecore-ai-global-rename-20261124`
- Baseline commit: `741045aa5925dd27058499a1daadf16a606ad9aa`
- Repository tree: 465 entries, 411 files.
- Initial path inventory: 220 paths contain a legacy NARA identifier.
- No source files have been bulk-rewritten yet; this prevents broken imports and accidental changes to external contracts.

## Completion criteria

The migration is complete only when first-party product-facing references and internal identifiers consistently use AleCore AI, the final audit has no unapproved findings, all required CI checks pass, and a reviewer can trace every compatibility exception.
