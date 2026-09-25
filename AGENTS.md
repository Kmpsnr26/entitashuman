# HumanALE shared agent rules

This file is the common operating contract for Copilot CLI, Codex-compatible agents, and other repository-aware coding agents.

## Mission
Improve HumanALE safely and concretely: inspect -> reproduce -> diagnose -> patch -> test -> review -> report.

## Parallel-work protocol
1. Split broad tasks by independent scope before editing.
2. Use separate agents for diagnosis, tests, security, platform-specific work, and release review.
3. One agent owns a file at a time. If scopes overlap, investigate in parallel but serialize edits.
4. Each agent returns:
   - evidence,
   - root cause or finding,
   - files affected,
   - proposed/implemented change,
   - commands run and exact result,
   - unresolved risks.
5. The coordinating agent reconciles conflicting findings and runs final verification.

## Project commands
- Install: `npm ci`
- Tests: `npm test`
- Build: `npm run build`
- Full verification: `npm run verify`
- Windows terminal smoke test: `npm run smoke:terminal`
- Desktop package: `npm run package:desktop`
- Windows installer: `npm run package:installer`

## Guardrails
- Never fabricate a successful command or green CI result.
- Never replace a root-cause fix with a disabled test.
- Never expose or commit secrets.
- Do not push directly to `main` for substantial changes; use a branch and PR.
- Treat existing GitHub Actions as required quality gates.
- Prefer deterministic, reproducible fixes over timing hacks.
- Keep patches narrowly scoped and easy to revert.

## Final review
Before declaring success, check:
- functional correctness,
- regression risk,
- error handling,
- test coverage,
- security boundaries,
- Windows desktop behavior,
- Android impact when shared web assets/config changed,
- packaging/release impact when build files changed.