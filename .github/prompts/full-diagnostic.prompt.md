---
description: Run a complete multi-agent HumanALE diagnosis and verification pass.
---

Analyze the current HumanALE repository state.

Use the orchestrator approach and delegate independent investigation where useful to:
- bug-hunter
- test-engineer
- security-reviewer
- desktop-electron
- android-engineer
- release-guardian

Work in parallel only on independent scopes. Do not edit the same file concurrently.

Tasks:
1. Inspect recent and relevant code/configuration.
2. Identify reproducible bugs, runtime failures, CI failures, security issues, and missing regression tests.
3. Rank findings by concrete impact and dependency order, not by speculation.
4. Implement minimal fixes for confirmed issues.
5. Add regression coverage.
6. Run targeted checks, then the repository verification sequence.
7. Re-check the final diff for regressions.
8. Report: fixed, verified, still failing, and blocked-by-environment items.

Never hide a failure by disabling a test or weakening a quality gate.