# AI Autopilot Transaction v1

Status: **one-shot trusted orchestration only / realtime OFF / Draft PR OFF**

This module defines the transaction order that must exist before continuous autopilot can be enabled.

## Fixed order

```
detect
  ↓
reproduce
  ↓
patch
  ↓
inspect
  ↓
test
  ↓
verify
  ↓
PASS
```

Any failure after patch invokes rollback before the transaction can retry or finish.

## Authority boundary

Autopilot v1 does not have authority for:

- Owner / Creator mutation
- Creator Final Approval
- credential or secret access
- git push
- git merge
- release publication
- Draft PR creation

Draft PR will be a later **Trusted Git Broker** stage, not an Agent capability.

## Retry boundary

Default maximum attempts: 2.

A failure may retry only after rollback succeeds.

If rollback fails, the transaction terminates fail-closed.

## Broker interface

The controller requires an injected trusted broker with:

- `detect()`
- `reproduce()`
- `patch()`
- `inspect()`
- `test()`
- `verify()`
- `rollback()`

The state machine itself does not spawn shells or mutate Git.

This separation keeps policy/orchestration testable before wiring it to HumanALE Agent Hub and the maintenance transaction.

## Realtime

There is intentionally no timer, watcher, interval, filesystem watcher, CI polling loop, or background process in v1.

Only `runOnce()` exists.

Realtime must remain OFF until:

1. AI Maintenance Boundary is green.
2. This transaction layer is green.
3. Trusted broker wiring is green.
4. Draft PR broker is separately reviewed.
