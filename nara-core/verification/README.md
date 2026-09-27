# NARA Core Verification Engine v1

Status: **isolated post-execution verifier / no repair or re-execution**

Verification Engine v1 checks a completed skill result through explicitly registered verifier handlers.

It never executes the original skill, retries failed work, changes source code, patches policy, alters memory, or activates HumanALE integration.

## Required input

Verification requires metadata from a completed execution:

```js
{
  executionId: 'exec-1',
  skillId: 'reason',
  status: 'COMPLETED'
}
```

Non-completed executions are not verifiable and are blocked before any verifier handler runs.

## Artifact boundary

The artifact being checked must be finite JSON-compatible data and fit within the configured byte limit.

Artifacts are passed to verifier handlers, but they are never stored in verification history and never emitted to the Event Bus.

## Verifiers

Verifier handlers are explicitly registered:

```js
engine.register({
  id: 'schema-check',
  timeoutMs: 3000,
  handler: async (artifact,{signal}) => ({
    ok: artifact?.ok === true,
    code: 'EXPECTED_OK',
    summary: 'Expected output flag is present.'
  })
});
```

There is no dynamic module discovery, shell fallback, eval, arbitrary import, or command execution.

## Verdicts

- `PASS`: all checks passed.
- `FAIL`: at least one normal check failed.
- `ERROR`: at least one verifier errored or timed out.
- `BLOCKED`: preconditions were not satisfied.

Verification does not perform repair after FAIL or ERROR.

## Limits

Default limits:

- 4 concurrent verification reports;
- 3 second default verifier timeout;
- 15 second maximum verifier timeout;
- 64 KiB maximum artifact;
- 8 checks per verification;
- 100 bounded report-history entries.

## Privacy boundary

History and Event Bus telemetry contain only:

- verification/request/execution/skill IDs;
- verdict/reason;
- verifier IDs;
- bounded codes and summaries;
- check counts;
- durations.

The artifact itself is omitted.

## Learning adapter

`toLearningSignal()` converts only PASS/FAIL report metadata into a Learning Engine-compatible signal.

ERROR/BLOCKED reports return `null`, preventing infrastructure failures from being mislabeled as skill-quality evidence.

## Intended flow

```
Decision Engine
      ↓
Memory Manager
      ↓
Skill Executor
      ↓
Verification Engine
      ↓
Learning Engine
      ↓
review proposal only
```

Each stage remains separately testable. Wiring them together is a later workflow/orchestration task.

## HumanALE isolation

No Electron, desktop, public renderer, avatar, HumanALE bridge, or Real Test file is imported or modified.
