# AleCore AI ↔ HumanALE Integration Contract v1

Status: **simulation only / not connected to production HumanALE**

This directory prepares the final integration boundary while HumanALE Real Test v5 remains isolated. Nothing here imports, starts, restarts, patches, or controls the current HumanALE desktop/runtime process.

## Safety boundary

Until HumanALE is declared `FINAL_READY`:

- do not wire this bridge into `desktop/`, `public/`, the avatar renderer, or HumanALE startup;
- do not change HumanALE Real Test scripts from this integration work;
- do not open a real socket/IPC connection from AleCore AI to the live HumanALE process;
- use `createMockHumanALE()` for all integration development and tests;
- merge only after the branch quality gates are green and the HumanALE baseline is no longer under active acceptance testing.

## Protocol

Protocol version: `1.0.0`.

Every message contains:

```js
{
  version: '1.0.0',
  id: 'unique-message-id',
  timestamp: 1234567890,
  source: 'ALECORE_AI' | 'HUMANALE',
  target: 'HUMANALE' | 'ALECORE_AI',
  type: 'allowlisted.event',
  payload: {},
  correlationId?: 'request-id',
  metadata?: {}
}
```

Messages are rejected when the direction, endpoint pair, event type, timestamp, payload, or JSON compatibility is invalid.

### AleCore AI → HumanALE allowlist

- `avatar.expression`
- `avatar.motion`
- `speech.start`
- `speech.stop`
- `system.state`
- `system.ping`

### HumanALE → AleCore AI allowlist

- `avatar.ready`
- `avatar.state`
- `user.interaction`
- `runtime.health`
- `runtime.error`
- `system.pong`

The allowlist intentionally excludes arbitrary shell, terminal, file-system, GitHub, or code-execution commands.

## HumanALE health state model

States:

`OFFLINE → STARTING → READY ↔ BUSY`

Failure/recovery path:

`READY/BUSY → DEGRADED/ERROR → RECOVERING → READY`

`OFFLINE` is permitted from active/error states for controlled shutdown or loss of process. Invalid transitions throw unless an explicit synchronization path is used by the bridge when consuming an authoritative HumanALE health event.

## Bridge behavior

`createAleHumanALEBridge()` provides:

- bounded outbound queue;
- strict protocol validation before enqueue;
- unique outbound message IDs;
- acknowledgement ID matching;
- deterministic retry budget;
- dead-letter capture after permanent/exhausted failures;
- inbound deduplication;
- bounded inbound/ack/dead-letter histories;
- HumanALE health synchronization;
- transport replacement without coupling the bridge to Electron, HTTP, WebSocket, or IPC.

A transport only needs:

```js
{
  async send(message) {
    return { ok: true, ackId: message.id, status: 'ACK' };
  }
}
```

## Simulation

`createMockHumanALE()` behaves like a controlled HumanALE endpoint. It can:

- acknowledge valid AleCore AI messages;
- reject invalid messages;
- simulate offline mode;
- simulate a fixed number of transient failures;
- emit valid HumanALE → AleCore AI events;
- expose received-message state for tests.

This is the only endpoint that should be used until the real HumanALE baseline has passed Real Test v5 and is frozen.

## Final integration gate

Only after both sides are independently accepted:

1. HumanALE reaches `REAL_TEST_PASS` and then `FINAL_READY`.
2. Freeze and tag the accepted HumanALE baseline.
3. AleCore AI integration tests and existing repository CI remain green.
4. Implement one real transport adapter behind the same `send(message)` interface.
5. Run handshake only: `system.ping` ↔ `system.pong`, then `runtime.health`.
6. Enable avatar state/expression commands.
7. Enable speech intent only after avatar state is stable.
8. Add disconnect/recovery tests.
9. Do not enable arbitrary execution through this bridge.

The bridge is intentionally an integration boundary, not a privilege-escalation channel.
