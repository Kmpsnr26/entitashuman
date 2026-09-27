# NARA ↔ HumanALE Integration Readiness Gate v1

Status: **pure readiness evaluation / no activation capability**

This module exists to prevent premature NARA ↔ HumanALE live integration.

It can answer whether simulation prerequisites are complete and whether live integration prerequisites are complete. It cannot connect, start, restart, patch, or activate either system.

## Readiness levels

- `NOT_READY`
- `SIMULATION_READY`
- `LIVE_READY`

## Simulation gates

Simulation readiness requires:

- Decision Engine validated
- Memory Manager validated
- Skill Executor validated
- Verification Engine validated
- Learning Engine validated
- Workflow Orchestrator validated
- Supervisor validated
- Scoped Approval Manager validated
- Integration Contract validated
- Mock Bridge validated
- CodeQL passed
- quality gate passed

HumanALE final readiness is intentionally not required for simulation-only work.

## Live gates

Live readiness requires every simulation gate plus:

- `humanale.real_test_pass`
- `humanale.final_ready`
- `humanale.baseline_frozen`

Therefore a green NARA stack cannot make live integration ready by itself.

## Strict facts

Input is a strict boolean map. Unknown fields are rejected.

No arbitrary payload, logs, prompts, secrets, or runtime objects can enter the readiness record.

## No bypass

There is deliberately no:

- `activate()`
- `forceReady()`
- `skipGate()`
- `override()`
- auto-merge
- auto-connect

`canActivateLive()` returns a boolean only. It does not perform an action.

## Current project usage

While HumanALE Real Test v5 remains active, the expected maximum state is:

`SIMULATION_READY`

Live integration must remain false until HumanALE reaches:

`REAL_TEST_PASS → FINAL_READY → baseline frozen`

and all NARA/integration/security gates remain true.
