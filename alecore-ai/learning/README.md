# AleCore AI Learning Engine v1

Status: **isolated evidence and proposal engine / no self-modification**

Learning Engine v1 records bounded operational evidence and produces review proposals. It does not change code, policy, permissions, skill registration, runtime configuration, HumanALE, or its own behavior.

## What it learns from

Only a strict metadata schema is accepted:

- signal ID;
- signal kind;
- skill ID;
- outcome;
- latency;
- feedback class;
- authority class;
- timestamp;
- weight from 0 to 1;
- safe identifier tags.

Any extra field is rejected. This intentionally blocks accidental ingestion of prompts, user content, tool payloads, model output, secrets, or arbitrary blobs.

Supported signal kinds:

- `execution`
- `verification`
- `feedback`

Supported outcomes:

- `success`
- `failure`
- `timeout`
- `blocked`
- `deferred`
- `neutral`

## Metrics

For each skill, the engine computes transparent bounded metrics:

- weighted reliability;
- weighted failure rate;
- weighted timeout rate;
- negative feedback rate;
- mean latency;
- p95 latency;
- maximum observed latency;
- bounded recent sample count.

It also keeps lifetime counters while raw signal history remains bounded.

## Proposal system

The engine may create only three review proposals:

- `REVIEW_RELIABILITY`
- `REVIEW_TIMEOUT`
- `REVIEW_FEEDBACK`

A proposal contains evidence and always has:

```js
{
  status: 'review_required',
  requiresApproval: true,
  autoApply: false
}
```

There is deliberately no `apply()`, `patch()`, `execute()`, policy mutation, source-code write, or skill-registration mutation API.

## Thresholds

Defaults:

- at least 5 relevant samples before a proposal;
- failure rate >= 35% → reliability review;
- timeout rate >= 25% → timeout review;
- negative feedback rate >= 40% → feedback review.

Thresholds are configuration for this module only. Changing them does not change any external policy or executor setting.

## Bounded state

Defaults:

- maximum 100 tracked skills;
- maximum 64 retained signals per skill;
- maximum 256 retained global signals;
- maximum latency observation 5 minutes;
- maximum 100 proposal records.

Duplicate signal IDs are idempotent while the ID remains represented in retained state.

## Adapters

The engine can translate metadata from later runtime layers:

- `observeExecution()` maps Skill Executor status to learning outcomes;
- `observeVerification()` records verifier success/failure;
- `recordFeedback()` records owner feedback classes.

These adapters consume metadata only and do not import the other modules.

## Event Bus privacy

Events:

- `learning.signal.recorded`
- `learning.proposal.created`

contain only safe metadata. There is no field for prompt text, raw input/output, memory value, credentials, or chain-of-thought.

## Intended architecture

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
review proposal
      ↓
human/policy review
```

Learning Engine is intentionally downstream of execution and verification. It observes outcomes; it does not control them.

## HumanALE isolation

The module imports no Electron, renderer, avatar, HumanALE integration transport, or Real Test code. It cannot activate HumanALE integration.
