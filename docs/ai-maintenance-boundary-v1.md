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
