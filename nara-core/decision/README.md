# NARA Core Decision Engine v1

Status: **isolated core module / not wired into HumanALE runtime**

The Decision Engine converts a normalized action request plus externally supplied runtime facts into one auditable outcome:

- `ALLOW`
- `REQUIRE_APPROVAL`
- `DEFER`
- `BLOCK`

It does not execute the action itself. Execution remains the responsibility of a later Skill Executor / Orchestrator stage.

## Design goals

1. **Fail closed.** Unknown actions, malformed requests, denied capabilities, and safety-stop conditions never become executable work.
2. **Policy before execution.** Capability, dependency, lifecycle gate, and approval checks occur before an action can be allowed.
3. **No hidden reasoning storage.** Records contain compact reason codes and an audit summary only. They do not store private chain-of-thought.
4. **Deterministic tests.** The engine is pure with respect to action policy and runtime facts; time and ID generation are injectable.
5. **Bounded state.** Decision history and deduplication state are bounded by `historyLimit`.
6. **No HumanALE mutation.** This module imports no Electron, desktop, renderer, avatar, or HumanALE Real Test files.

## Request shape

```js
{
  id: 'decision-123',            // optional when using the engine
  action: 'reason',
  actor: 'system',
  capability: 'reason',          // required for actions using $request capability
  target: 'optional-target',
  label: 'short audit label',
  requiredDependencies: ['github']
}
```

Runtime facts are supplied separately and therefore cannot be self-approved by the request:

```js
{
  safetyStop: false,
  capabilities: {
    reason: 'ready',
    sync: 'ready'
  },
  deniedCapabilities: [],
  dependencies: {
    github: 'connected'
  },
  gates: {
    'humanale.final_ready': false,
    'integration.contract_validated': true
  },
  approvals: {
    owner: false
  }
}
```

## Default actions

| Action | Risk | Capability | Approval / gate |
| --- | --- | --- | --- |
| `observe` | low | none | none |
| `reason` | low | `reason` | none |
| `plan` | low | `plan` | none |
| `memory.read` | low | `memory.read` | none |
| `memory.write` | medium | `memory.write` | none |
| `skill.execute` | medium | request-supplied | none |
| `external.read` | medium | request-supplied | dependencies as requested |
| `external.write` | high | request-supplied | owner approval |
| `system.execute` | high | request-supplied | owner approval |
| `integration.handshake` | medium | `sync` | HumanALE final-ready + contract validated |
| `integration.command` | high | `sync` | same gates + owner approval |

This policy is deliberately conservative. A later permission/session layer can supply scoped approvals without changing the decision-record format.

## Decision precedence

The engine evaluates in this order:

1. action exists;
2. safety stop;
3. action enabled;
4. capability declared;
5. capability allowed and ready;
6. dependencies ready;
7. lifecycle gates ready;
8. explicit approvals present;
9. allow.

This order prevents approval from bypassing a denied capability or lifecycle gate.

## Audit output

A decision stores:

- engine and policy versions;
- request ID, actor, action, target, and label;
- outcome and risk;
- reason codes;
- missing approvals/dependencies/gates;
- capability;
- timestamps;
- a bounded audit summary;
- a deterministic confidence field describing rule completeness, not subjective model certainty.

If an Event Bus is supplied, the engine emits only safe metadata through:

- `decision.completed`
- `decision.allowed`
- `decision.approval_required`
- `decision.deferred`
- `decision.blocked`

No prompt text, chain-of-thought, credentials, or arbitrary payload is emitted.

## HumanALE integration gate

The default `integration.handshake` and `integration.command` policies remain deferred until both runtime facts are true:

- `humanale.final_ready`
- `integration.contract_validated`

Therefore this engine can be developed now without authorizing a real HumanALE connection while Real Test v5 is still active.

## Next stage

After this module is validated, the next isolated module should be the **Memory Manager**, then **Skill Executor**. Wiring Decision Engine → Skill Executor should happen only after both modules have their own tests and permission boundary.
