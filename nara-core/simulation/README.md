# NARA Final Simulation Stack v1

Status: **combined end-to-end simulation / Mock HumanALE only**

This stack is the first branch that combines the individually validated NARA modules:

- Integration Contract + Mock HumanALE
- Decision Engine
- Memory Manager
- Skill Executor
- Verification Engine
- Learning Engine
- Workflow Orchestrator
- Supervisor / Recovery
- Scoped Approval Manager
- Integration Readiness Gate

It does not import the HumanALE desktop renderer, Electron runtime, release-candidate runtime, or a real IPC/HTTP/WebSocket transport.

## Execution path

```
explicit scoped simulation approval
             ↓
Integration Readiness Gate
             ↓
Supervisor health gate
             ↓
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
Mock HumanALE handshake
```

A run succeeds only as:

`SIMULATION_PASS / MOCK_HUMANALE_ONLY`

## Approval

The stack does not auto-approve itself.

A caller must:

1. call `requestApproval()`;
2. explicitly approve through `approvalManager.decide(..., {authority:'owner'})`;
3. pass the exact approval ID into `run()`.

The default approval is single-use.

## Supervisor

Every core simulation component must be reported healthy before `run()`.

The stack does not auto-heal unhealthy components.

## HumanALE boundary

The bridge transport is always `createMockHumanALE()`.

The simulation report contains:

```js
{
  mode: 'MOCK_HUMANALE_ONLY',
  liveHumanALE: false
}
```

There is no API in this module for installing a live transport.

## Readiness

For the current project state, use:

```js
finalSimulationReadinessFacts({
  humanaleRealTestPass: false,
  humanaleFinalReady: false,
  humanaleBaselineFrozen: false
})
```

This can still reach `SIMULATION_READY`, but never `LIVE_READY`.

A future live-integration implementation must be a separate reviewed change after the release-candidate certificate proves all HumanALE gates and explicit creator approval.

## Current HumanALE certificate

The HumanALE release-candidate certificate presently remains `LOCKED`. Repository evidence records 6/9 technical gates passed and 3 pending:

- performance-stability
- android-runtime
- release-security

Creator approval is also false in that certificate.

This simulation branch must not change those facts.
