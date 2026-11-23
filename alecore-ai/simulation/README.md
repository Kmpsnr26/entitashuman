# AleCore AI Unified Simulation Stack v1

Status: **simulation-only integration harness**

This layer combines the independently tested AleCore AI v1 components in one branch and exercises them together without merging them to `main` and without activating a real HumanALE transport.

## Real components composed

- Decision Engine
- Memory Manager
- Skill Executor
- Verification Engine
- Learning Engine
- Workflow Orchestrator
- Supervisor / Recovery
- Scoped Approval Manager
- AleCore AI ↔ HumanALE Integration Contract
- Mock HumanALE

## What is proven

The E2E suite uses the real component implementations, not per-test stubs, for:

`Decision → Memory → Skill Executor → Verification → Learning → Workflow result`

A second E2E path requires an exact single-use approval before a bounded `humanale.command` simulation can deliver one allowlisted `system.ping` to **Mock HumanALE**.

Supervisor health is checked before workflow execution. An opened circuit blocks the stack before Decision/Executor work starts, and recovery remains recommendation-only.

The real `integration.handshake` Decision Engine action is also evaluated with `humanale.final_ready=false`; it must remain `DEFER`.

## Fail-closed boundaries

This harness intentionally does **not** expose:

- the bridge `setTransport()` function;
- a real HumanALE transport;
- a final-integration activation function;
- automatic owner approval;
- creator final approval;
- shell/eval/dynamic code execution;
- auto-repair or automatic Supervisor recovery.

Scoped Approval Manager owner authority is only a role assertion inside the simulation. It is not authentication and must not be treated as Creator Final Approval.

## Release boundary

Passing this stack means **Unified AleCore AI Simulation PASS** only.

It does not close the remaining HumanALE release gates:

- performance-stability;
- Android real-device signed runtime;
- Windows + Android release signing;
- Creator Final Approval.

It also does not authorize merging PR #78 or publishing v2.5.0.


## Readiness Gate v1.1

The unified stack now composes the strict AleCore AI ↔ HumanALE readiness evaluator.

Default unified-simulation evidence reaches `SIMULATION_READY` only. Live readiness additionally requires HumanALE real-test pass, FINAL_READY, frozen baseline, and explicit `humanale.creator_final_approval`.

If any simulation/security readiness fact becomes false, the unified stack stops before workflow execution.

Even a `LIVE_READY` evaluation cannot activate a real transport. This simulation harness still exposes no transport switch, activation function, merge, release, or Creator approval mutation.
