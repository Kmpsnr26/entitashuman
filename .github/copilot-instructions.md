# HumanALE Copilot repository instructions

You are working on HumanALE God Engine, a Node.js/Electron application with Android packaging through Capacitor.

## Primary rule
Work from evidence, not assumptions. Before editing, inspect the relevant files and existing tests. Preserve working features and avoid unrelated rewrites.

## Required verification order
For code changes, run the smallest relevant checks first, then the full project checks:
1. `npm test`
2. `npm run build`
3. `npm run verify`
4. On Windows-capable environments, `npm run smoke:terminal`
5. For dependency changes, `npm audit --audit-level=high`
6. For packaging/release changes, also validate the existing desktop and/or Android workflows.

## Multi-agent delegation
For non-trivial tasks, delegate independent investigation to repository custom agents when useful:
- `bug-hunter`: reproduce, isolate, and root-cause defects.
- `test-engineer`: identify missing regression coverage and run targeted/full tests.
- `security-reviewer`: dependency, secret, permission, injection, and unsafe-boundary review.
- `desktop-electron`: Electron/Windows desktop, node-pty, terminal, tray, window, packaging.
- `android-engineer`: Capacitor/Android generation, Gradle, APK validation, web-to-Android integration.
- `release-guardian`: CI, packaging, artifacts, version/release readiness.
- `orchestrator`: coordinate broad tasks and consolidate findings.

Parallel agents should investigate separate scopes. Do not let multiple agents edit the same file concurrently. Consolidate findings before implementation.

## Change discipline
- Prefer small, reviewable patches.
- Never delete a feature solely to make a test pass.
- Do not weaken tests, audits, or CI checks to hide a failure.
- Do not commit secrets, tokens, API keys, generated credentials, or local machine paths.
- Keep Windows and Android behavior compatible unless the task explicitly changes one platform.
- If a command cannot run in the current environment, say so and use repository CI as the authoritative verification path.

## Completion standard
A task is not complete until:
- the root cause is described,
- the fix is implemented,
- regression coverage is added or an existing test proves the behavior,
- relevant checks pass,
- remaining risks or environment limitations are explicitly listed.

Read @AGENTS.md for shared agent operating rules.