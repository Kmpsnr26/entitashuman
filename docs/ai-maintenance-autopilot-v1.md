# Safe AI Maintenance Autopilot Loop v1

Status: **one-shot / bounded / realtime OFF**

This layer sits on top of AI Maintenance Boundary v1.

It does not weaken the maintenance boundary and cannot bypass the Git transaction, protected paths, secret isolation, Owner/Creator authority rules, or rollback logic.

## Pipeline

```
strict finding
   ↓
queue + dedupe
   ↓
Agent Hub maintenance transaction
   ↓
Planner (read-only)
   ↓
Worker patch
   ↓
actual Git change-set inspection
   ↓
Reviewer (read-only)
   ↓
Trusted verifier
   ↓
PASS → VERIFIED_PATCH / checkpoint required
FAIL → rollback + at most one retry
```

## Finding schema

Only these fields are accepted:

- `id`
- `source`: `ci | runtime | test | manual`
- `code`
- `summary`
- `severity`: `low | medium | high`
- `timestamp`

Arbitrary `payload`, raw logs, credentials, tool instructions, or extra fields are rejected.

Finding summaries are checked against the same maintenance authority policy. A finding that asks to change Owner, credentials, access, release authority, security boundaries, or similar denied actions is rejected before work starts.

## Retry

Maximum attempts: **2**.

A trusted verification failure can receive one retry after the first attempt has been rolled back by Agent Hub.

Boundary violations, protected-path attempts, dirty worktrees, secret-file presence, repository lock conflicts, branch/HEAD drift, and manual-recovery states are not retried.

## Verification

The Worker and Reviewer cannot mark a patch verified.

Trusted verification is performed by `maintenance-verifier.mjs` with fixed profiles only:

- `focused` → `npm test`
- `full` → `npm run verify`

The autopilot uses `full`.

No arbitrary shell command from the finding, user prompt, Worker, or model is accepted by the verifier.

## Checkpoint boundary

A successful run ends as:

```
VERIFIED
checkpointRequired = true
```

The controller then refuses another finding.

Safe Autopilot v1 deliberately has no method to clear that checkpoint. A later **Trusted Draft PR Broker** must own the next step.

## Explicitly absent in v1

There is no:

- realtime scheduler;
- filesystem watcher;
- setInterval monitoring loop;
- Git push;
- Git merge;
- release publish;
- signing;
- Creator Final Approval;
- Draft PR creation;
- auto-merge.

Those are separate authority surfaces and must not be smuggled into the repair controller.
