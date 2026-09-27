# NARA Core Scoped Approval Manager v1

Status: **isolated approval ledger / not an authentication system**

Approval Manager v1 turns a broad `owner approval` concept into a bounded, scoped, expiring internal record.

It does not authenticate the human owner. The later trusted UI / host boundary must be responsible for deciding who is allowed to call `decide(..., {authority:'owner'})`.

## Approval request

A request contains metadata only:

```js
{
  id: 'approval-1',
  capability: 'memory.sensitive.read',
  scope: 'workflow.wf-123',
  requestedBy: 'workflow',
  ttlMs: 600000,
  singleUse: true
}
```

Strict field allowlisting rejects arbitrary payloads, prompts, credentials, tool output, or context blobs.

## States

- `PENDING`
- `APPROVED`
- `DENIED`
- `REVOKED`
- `EXPIRED`
- `CONSUMED`

## Exact matching

Authorization requires exact:

- approval ID;
- capability;
- scope.

There are no wildcards or implicit scope inheritance in v1.

This prevents an approval for one workflow/capability from being reused for another.

## Single-use

Requests are single-use by default.

Successful `authorize()` consumes an approved single-use request unless `consume:false` is explicitly used for a non-mutating preflight check.

## Expiry

Default TTL: 10 minutes.

Maximum TTL: 1 hour.

PENDING and APPROVED requests expire automatically when read/checked/swept after their expiry time.

## Owner decision boundary

Only calls carrying `authority:'owner'` may approve, deny, or revoke.

This is a role assertion, not authentication. Production wiring must expose these mutation calls only through a trusted owner-controlled host/UI boundary.

## No auto approval

The manager cannot approve based on:

- model output;
- Learning Engine recommendation;
- workflow status;
- Supervisor recommendation;
- skill request.

Approval is always an explicit mutation call.

## Intended usage

Examples of future scoped capabilities:

- `memory.sensitive.read` + `workflow.<id>`
- `external.write` + `github.repo.<name>`
- `humanale.command` + `session.<id>`

A later runtime adapter can convert a successful exact authorization into a narrowly scoped decision context.

## Privacy

History/Event Bus contains IDs, capability, scope, lifecycle state, and timestamps only.

No raw request content or secrets are accepted.

## HumanALE isolation

Approval Manager does not import or call HumanALE. It cannot grant integration by itself; later wiring must still check HumanALE `FINAL_READY` and the integration contract gates.
