# AleCore AI — Checkpoint & Handoff

**Checkpoint date:** 2026-11-24 (Asia/Jakarta)  
**Purpose:** Preserve the exact remote source baseline and the next safe recovery steps. This is a handoff note, not a release approval.

## 1. GitHub source of truth

- Repository: https://github.com/Kmpsnr26/entitashuman
- Working PR: [#262 — Add AleCore Local offline conversation provider](https://github.com/Kmpsnr26/entitashuman/pull/262)
- PR status at checkpoint: **OPEN / DRAFT / NOT MERGED**
- PR head branch: `codex/alecore-ai-local-provider-20261124`
- Exact head commit: `5cc877337cf046fd0135d5b12e343a2d480a4232`
- PR base branch: `codex/release-followup-alecore-local-validation-20261124`
- Exact base commit: `860e9c2b04933681d5c737e538f71d0e7ff36f9d`
- PR scope at checkpoint: 39 commits, 19 changed files, 622 additions, 29 deletions.
- A separate checkpoint branch is based on the exact PR head above. Do not merge this documentation branch into the release branch.

The PR description states that Ollama and model weights are not bundled in the desktop installer/portable ZIP. The first milestone is Windows local inference. Android does not yet connect to a Windows-hosted model; a separate authenticated local-network bridge is required. Never expose the raw Ollama port to a LAN.

## 2. Latest CI results for exact head 5cc8773

Workflow run IDs recorded from GitHub Actions:

| Workflow | Run ID | Result | Notes |
|---|---:|---|---|
| Private source security | 45389051508 | PASS | Security scan passed |
| Cloud Auto Repair | 45389051459 | PASS | Workflow passed |
| Verify and package | 45389051452 | FAIL | Linux quality gate failed; Windows package job skipped |
| Build Android APK | 45389051500 | FAIL | Verify-web-app stage failed; APK build stages were skipped |
| NARA Cloud Verify | 45389051608 | FAIL | Root validation failed; Neural Space WebGL and nara-cloud jobs passed |

The Linux quality gate reported **748 tests: 747 passed, 1 failed**. The Android workflow also stopped during the web verification step; this is not evidence of an Android SDK/Gradle/APK packaging failure because the APK build steps were skipped. The Windows runtime/package job was skipped because the Linux gate failed. Therefore, there is no verified Windows or Android artifact for this exact PR head yet.

### Exact failing assertion

- File: `tests/assistant.test.mjs`
- Test: `AleCore Local is the first-party offline desktop conversation provider`
- Assertion location in the CI checkout: around line 684
- Failure: the test expects the obsolete inline source pattern:
  `aiProvider=apiProviders.includes(savedProvider)?savedProvider:'alecore-local'`
- Current implementation imports `selectDefaultConversationProvider` in `public/app.js`; the helper is in `public/provider-selection.js`. The helper returns `chatgpt` outside desktop mode, preserves an allowed saved provider, and defaults to `alecore-local` on desktop.
- Next safe fix: update the test to verify the helper's behavior and the actual helper call/wiring. Do not change production behavior simply to satisfy the obsolete regex.
- Latest CI log shows the remaining test suite passed; the reported count is 747/748.

### Other latest checks

- `Neural Space realtime WebGL`: PASS.
- `nara-cloud` database/security/SSO/runtime job: PASS.
- Earlier Windows package success on commit `25917dd` is an **older commit** and must not be presented as validation of `5cc8773`.

## 3. Local worktree state reported before this checkpoint

These local records were supplied in the working session and have **not been uploaded by this checkpoint branch**:

1. Original repository worktree was on branch `codex/opencode-agent-skill-migration-phase2`, HEAD `c200dd7423ca0e69040fdd29f1c2724d50f2b232`. It had unstaged tracked modifications in:
   - `desktop/nara-agent-coordinator.mjs`
   - `nara-core/engine/autopilot.js`
   - `nara-core/engine/task-scheduler.js`
2. That original worktree also had three unusual untracked filenames, likely from malformed PowerShell input. Preserve and inspect them locally; do not blindly add them to the repo or delete them.
3. `stash@{0}` was retained for `tests/nara-dispatcher-phase4.test.mjs`. Do not pop or drop it until its contents are safely exported and verified.
4. Candidate validation worktree branch `codex/alecore-ai-candidate-validation-20261124` was reported at older commit `25917dd`, clean at last check.
5. PTY hardening worktree branch `codex/alecore-terminal-shutdown-hardening-20261124` was reported at older commit `25917dd`, clean at last check.
6. A portable ZIP named `HumanALE-God-Engine-Portable.zip` was reported locally at approximately 181.8 MB and ignored by Git. This checkpoint does not contain that ZIP.
7. The original worktree's dispatcher patch had passed focused dispatcher tests (6/6), `npm run verify` (706 total; 704 passed, 0 failed, 2 skipped) and terminal smoke at that separate local commit. Those results are not a substitute for CI on PR head `5cc8773`.

**Important:** GitHub's connector cannot read uncommitted files, local stashes, ignored ZIPs, local credentials, or model data from the Windows PC. These remain local-only until deliberately backed up. No local-only file has been claimed as uploaded by this checkpoint.

## 4. PTY / terminal investigation status

- The local `node-pty` tests were reported as 7/7 passing.
- A Windows ConPTY DLL child-process probe showed the child had stopped after terminal kill in the tested case.
- A separate probe initially hung; the process was later reported absent. This is only a narrow test and is not sufficient to declare production process-tree shutdown fully reliable.
- The investigation identified a potential asynchronous process-list / kill ordering race in node-pty Windows shutdown, including upstream discussion. Do not enable an experimental ConPTY DLL path as the production default based only on the single probe.
- No PTY production source patch, commit, push, or merge was made as part of that investigation.

## 5. Safe resume sequence

1. Start from the exact PR head `5cc877337cf046fd0135d5b12e343a2d480a4232` in a **new isolated worktree**. Do not reset either existing local candidate worktree.
2. Fix the stale behavior assertion in `tests/assistant.test.mjs` using the exported `selectDefaultConversationProvider` helper. Add assertions for desktop default, non-desktop default, and preservation of an allowed saved provider.
3. Run the focused assistant test, then the complete `npm run verify` and build checks locally.
4. Push the verified fix to the PR head branch only after reviewing the diff and confirming no local-only changes are mixed in.
5. Rerun GitHub Actions on the new exact commit. Require Linux quality gate PASS, Windows runtime/package PASS with installer smoke and retained artifacts, and Android build/runtime checks PASS before declaring build readiness.
6. Keep PR #262 in Draft until build gates pass and real local inference is accepted on the target Windows PC.
7. Preserve the original worktree's three modified files, stash, and unusual untracked files by exporting a reviewed backup patch/archive locally. Only then decide whether those changes belong in a separate backup branch.
8. Continue PTY hardening independently. Verify terminal kill, child/descendant process cleanup, restart, app shutdown, repeated cycles, and absence of orphan processes before changing production defaults.
9. Only after fresh Windows and Android artifacts exist, perform real-world installation/launch tests. Android-to-Windows model connectivity remains a separate design/security milestone.

## 6. Data safety

Do not commit secrets or machine-specific private data: `.env` files with real values, API keys, passwords, owner access keys, signing keystores/private keys, certificates, private tokens, or local user data. Keep secrets backed up in a secure password manager or encrypted offline backup. Do not commit large model weights or generated runtime caches to Git; use a separately managed artifact/model storage location.

## 7. What this checkpoint means

- The exact PR source baseline and this handoff record are stored on GitHub.
- The PR has not been merged, released, or fully validated.
- Local-only modifications, stashes, ignored ZIPs, secrets, and model files are **not** included in this GitHub checkpoint.
- No local files were deleted or overwritten by creating this checkpoint.
