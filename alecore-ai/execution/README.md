# AleCore AI Skill Executor v1

Status: **isolated execution boundary / no arbitrary command execution**

Skill Executor v1 is the controlled boundary between an approved AleCore AI decision and a registered skill handler.

It does not discover code dynamically, import arbitrary modules, execute shell commands, evaluate strings, or connect to HumanALE.

## Required authorization

Every execution requires a decision object with:

```js
{
  id: 'decision-1',
  outcome: 'ALLOW',
  capability: 'reason'
}
```

The decision capability must exactly match the requested `skillId`. A missing decision, non-ALLOW outcome, or capability mismatch is blocked.

This allows Decision Engine v1 to remain the policy authority while Skill Executor only enforces the execution contract.

## Handler registration

Handlers must be explicitly registered in-process:

```js
executor.register({
  id: 'reason',
  timeoutMs: 5000,
  handler: async (input,{signal}) => {
    return {ok:true};
  }
});
```

No string-to-code conversion, arbitrary path import, command line, or shell fallback exists.

## Safety boundaries

Default limits:

- maximum 4 concurrent executions;
- default timeout 5 seconds;
- maximum handler timeout 30 seconds;
- maximum input 32 KiB;
- maximum output 64 KiB;
- bounded history of 100 execution records.

Inputs and outputs must be finite JSON-compatible data. Circular objects, functions, symbols, non-finite numbers, oversized payloads, and unsupported values fail closed.

## Runtime behavior

Possible statuses:

- `COMPLETED`
- `FAILED`
- `BLOCKED`
- `DEFERRED`
- `TIMEOUT`

Concurrency saturation produces `DEFERRED`, not an unbounded queue.

Timeout triggers `AbortController.abort()`. Skill handlers should observe the provided `signal` for cooperative cancellation.

## Skill Registry support

If an existing AleCore AI Skill Registry is supplied, the executor verifies that the skill exists and is enabled, and updates registry start/finish counters.

The executor itself still requires a locally registered handler. A registry entry alone is not executable code.

## Telemetry privacy

Event Bus events include only:

- execution ID;
- request ID;
- skill ID;
- decision ID;
- status/reason;
- timeout/duration metadata.

Input and output payload contents are never emitted.

## Intended future flow

```
request
  ↓
Decision Engine
  ↓ ALLOW
Memory Manager.prepareContext()
  ↓
Skill Executor
  ↓
registered handler
  ↓
verification
```

This PR implements only the isolated Skill Executor. It does not wire the pipeline together.

## HumanALE isolation

No imports or modifications touch Electron, HumanALE renderer/avatar, desktop runtime, integration transport, or Real Test scripts.
