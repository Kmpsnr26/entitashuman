# NARA Core Supervisor / Recovery v1

Status: **isolated health supervisor / recommendation-only recovery**

Supervisor v1 observes component health and protects later workflows with a circuit-breaker model.

It does not restart, kill, spawn, patch, install, execute commands, write source code, or control HumanALE.

## Component health

Registered components report only metadata:

- component ID;
- health status;
- latency;
- safe error code;
- timestamp.

Statuses:

- `healthy`
- `degraded`
- `error`
- `offline`
- `stale`

No free-text error body is accepted.

## Circuit breaker

Each component has:

- heartbeat timeout;
- rolling error window;
- error threshold;
- cooldown period.

Repeated `error`, `offline`, or `stale` incidents open the circuit.

Circuit states:

- `CLOSED`
- `OPEN`
- `HALF_OPEN`

An OPEN circuit blocks `canRun()`.

After cooldown, the supervisor only recommends / permits a health probe. It does not automatically run one.

`beginProbe()` and `completeProbe()` change only supervisor state. They do not launch external processes.

## Recovery recommendations

Possible review-only recommendations:

- `NONE`
- `WAIT_COOLDOWN`
- `RUN_HEALTH_PROBE`
- `REVIEW_COMPONENT`
- `CHECK_DEPENDENCY`

Every recommendation has:

```js
{
  status: 'review_required',
  requiresApproval: true,
  autoExecute: false
}
```

There is no restart/repair/kill/process-control API.

## Stale detection

`sweep()` compares the current timestamp with each component's last health report.

Expired heartbeat → `stale` incident.

Enough recent incidents → circuit OPEN.

This is internal health-state management only.

## Intended future use

Workflow Orchestrator may later call `canRun(componentId)` before executing a dependent stage.

That wiring should happen only after the isolated Supervisor and Workflow modules are independently validated.

## Privacy

Supervisor history stores safe IDs, status values, error codes, latency, and timestamps only.

It has no fields for raw logs, prompts, execution output, memory values, secrets, or chain-of-thought.

## HumanALE isolation

HumanALE may eventually expose a health endpoint to this supervisor, but v1 has no HumanALE transport and cannot restart or modify HumanALE.
