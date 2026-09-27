# NARA Core Workflow Orchestrator v1

Status: **isolated coordinator / no HumanALE runtime wiring**

Workflow Orchestrator v1 coordinates already-defined component interfaces in this order:

```
Decision
  ↓ ALLOW
Memory context
  ↓
Skill execution
  ↓
Verification
  ↓
Learning evidence
```

It uses dependency injection and does not import Decision Engine, Memory Manager, Skill Executor, Verification Engine, Learning Engine, Electron, or HumanALE directly.

## Why dependency injection

The engines are being developed and validated independently. The orchestrator therefore depends only on narrow interfaces:

- `decisionEngine.decide()`
- `memoryManager.prepareContext()`
- `memoryManager.useContext()`
- `skillExecutor.execute()`
- `verificationEngine.verify()`
- `verificationEngine.toLearningSignal()`
- `learningEngine.observeExecution()`
- `learningEngine.ingest()`

This keeps orchestration testable before any production wiring.

## Stop conditions

The orchestrator stops immediately when:

- Decision is BLOCK;
- Decision is DEFER;
- approval is required;
- decision capability does not match the requested skill;
- sensitive context is requested through the generic workflow path;
- Skill Executor blocks, defers, fails, or times out;
- no verifier is supplied;
- verification fails/errors/blocks.

There is no automatic retry, repair, fallback shell, policy bypass, or self-modification.

## Sensitive context

`includeSensitive: true` is explicitly blocked by Workflow v1.

A later dedicated approval/session flow must bind sensitive-context permission to a scoped authorization. Until that exists, the generic orchestrator cannot request sensitive memory.

## Verification requirement

A completed skill is not considered a completed workflow until verification returns PASS.

This prevents “execution returned something” from being treated as validated success.

## Learning behavior

Execution metadata is offered to Learning Engine after execution.

PASS/FAIL verification metadata is converted through Verification Engine and offered to Learning Engine.

Learning failures do not alter the workflow verdict because learning is observational and downstream. The workflow records only whether each learning signal was accepted.

The orchestrator never calls `learningEngine.propose()` and never applies recommendations.

## Privacy boundary

Workflow history contains only:

- workflow/request/skill IDs;
- workflow status/reason;
- compact decision metadata;
- context ID/count/bytes;
- execution status/reason/duration;
- verification verdict/reason/count/duration;
- learning-recorded booleans.

It never stores input, memory values, execution output, verification artifact, prompt text, credentials, or chain-of-thought.

## Idempotency and concurrency

- completed workflow IDs return their retained record with `duplicate: true`;
- duplicate active workflow IDs are blocked;
- global concurrent workflows are bounded;
- workflow history is bounded.

## HumanALE isolation

No HumanALE runtime/renderer/bridge code is imported or modified. The workflow cannot activate the NARA ↔ HumanALE bridge.
