# HumanALE / NARA AI Maintenance Boundary v1

Status: **repair-only boundary before realtime autopilot**

The AI Agent role is a software-maintenance technician. It is not an Owner, ownership administrator, credential administrator, release publisher, or Creator Final Approval authority.

## Allowed maintenance capabilities

- program.read
- program.edit
- program.test
- program.build
- program.debug
- program.rollback
- ci.inspect
- ci.repair
- runtime.health.read
- git.diff.inspect

These capabilities apply only inside the explicitly selected Git checkout.

## Permanently denied to AI agents

- Owner / Creator identity mutation
- ownership grant or revoke
- password / credential / secret mutation or retrieval
- access / role / privilege grants
- Creator Final Approval
- release publication or signing authority
- git push / merge / branch switching
- root / administrator privilege escalation
- disabling authentication, sandbox, security or approval boundaries

The denylist is not an approval queue. An AI agent cannot self-request, learn, infer, or auto-approve any denied capability.

## Work mode start gate

Work mode is fail-closed:

1. the task is evaluated by the maintenance boundary;
2. forbidden authority/credential/release mutations are rejected;
3. the selected project must be a Git checkout;
4. the worktree must be clean before AI editing starts;
5. workers receive the same maintenance boundary in their work prompt.

The clean-worktree requirement prevents an agent from silently mixing its repair with uncommitted human changes.

## Existing executor containment

- GitHub Copilot work mode receives file-view/edit tools only and builtin MCPs remain disabled.
- Codex runs ephemeral with ignored user config and workspace-write sandbox.
- Cursor runs with sandbox enabled.
- Claude Code keeps no session persistence and its Bash allowlist is limited to project test/verify commands.
- Planner and Reviewer remain read-only.

## Not enabled yet

Realtime autopilot is intentionally not enabled by this change. The next layer must add:

- change-set inspection;
- protected-path enforcement;
- test/build verification;
- automatic rollback of a failed AI patch;
- bounded retry count;
- Draft PR/checkpoint handoff;
- health/circuit integration.

Only after those controls are green should the realtime detect → patch → test → verify loop be enabled.


## Stage 2 — transaction guard and rollback

Maintenance work is now treated as a bounded transaction:

1. Work mode starts only from a clean Git worktree.
2. After the worker/reviewer pipeline returns, Git changed paths are enumerated.
3. Protected paths are checked in code, not only in the agent prompt.
4. Touching any protected path fails the run.
5. Any work-mode exception triggers `git reset --hard HEAD` plus `git clean -fd`.
6. Because the worktree was required to be clean at the start, rollback only removes changes created by that AI run; ignored local files remain untouched.

Protected areas include Owner identity/authentication and database ownership boundaries, NARA permission code, environment secrets, all GitHub workflows, package scripts/dependency manifests, release signing config, final-readiness certificate, and the Agent Hub / maintenance policy itself.

A successful repair returns its changed-path list as maintenance metadata. Realtime autopilot remains disabled until a bounded retry/verification controller is added.


## Stage 3 — bounded autopilot controller

A bounded maintenance autopilot controller is now defined, but it is not a background daemon.

Behavior:

1. accepts one explicit maintenance task;
2. reuses the same repair-only policy and clean-worktree preflight;
3. always routes work through HumanALE Orchestrator;
4. allows at most **two** attempts;
5. after each successful agent patch, independently runs `npm run verify`;
6. returns PASS only when deterministic verification succeeds;
7. if verification fails, resets the AI patch to HEAD before the next attempt;
8. after the final failed verification, rolls back and stops;
9. authority/protected-path/rollback violations are non-retryable and stop immediately.

No timer, infinite loop, scheduler, release action, Owner action, or background execution is introduced by this stage.

The next stage may expose this controller through a controlled UI/health trigger and Draft-PR checkpoint flow. That trigger must remain opt-in and must not turn the controller into unrestricted continuous execution.
