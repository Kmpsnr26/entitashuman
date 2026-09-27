# NARA Core Memory Manager v1

Status: **isolated working-memory module / not wired into HumanALE runtime**

Memory Manager v1 provides bounded, in-process working memory for NARA Core. It does **not** create permanent user memory, write to disk, sync to cloud storage, or modify HumanALE.

## Goals

- deterministic bounded storage;
- finite JSON-only values;
- per-entry byte limits;
- optional TTL expiration;
- priority and pinning;
- capacity eviction that never removes pinned entries automatically;
- explicit sensitivity labels;
- context selection with item and byte budgets;
- sensitive-memory exclusion by default;
- safe Event Bus telemetry that never emits stored values.

## Entry shape

```js
{
  id: 'task-context-1',
  kind: 'working',          // working | episodic | reference
  source: 'nara',
  sensitivity: 'normal',   // normal | sensitive
  priority: 0.7,           // 0..1
  pinned: false,
  tags: ['project','task'],
  ttlMs: 60000,            // optional
  value: { ... }           // finite JSON-compatible data
}
```

The manager rejects `sensitivity: 'secret'` by design. Credentials, passwords, tokens, private keys, and similar secrets must be handled by a dedicated secret store rather than NARA working memory.

## Capacity and lifecycle

Default limits:

- 200 entries;
- 16 KiB per value;
- 16 tags per entry;
- TTL up to 30 days;
- context maximum 12 entries;
- context maximum 48 KiB;
- 50 retained context records;
- context records expire after 5 minutes.

When capacity is full, the lowest-priority oldest **unpinned** entry is evicted. If every entry is pinned, the write fails rather than silently deleting pinned memory.

## Context preparation

`prepareContext()` selects entries deterministically using:

1. pinned state;
2. number of requested tag matches;
3. priority;
4. recency;
5. ID tie-breaker.

Context selection obeys both entry-count and byte budgets.

Sensitive entries are excluded unless the caller explicitly sets `includeSensitive: true`. This flag is only a low-level capability; a later permission layer should decide whether it may be set for a specific workflow.

## Event Bus privacy boundary

The manager may emit:

- `memory.write`
- `memory.complete`
- `memory.read`
- `memory.expired`
- `memory.evicted`
- `memory.deleted`
- `memory.cleared`
- `context.prepare`
- `context.blocked`
- `context.approved`
- `context.used`

Only metadata such as IDs, counts, kinds, sensitivity labels, and byte sizes are emitted. Stored `value` content is never sent to the Event Bus.

## Relationship to Decision Engine

The intended later flow is:

```
request
  ↓
Decision Engine
  ↓ ALLOW
Memory Manager.prepareContext()
  ↓
Skill Executor
```

That wiring is intentionally not implemented in v1. Decision Engine and Memory Manager remain independently testable modules.

## HumanALE isolation

This module does not import:

- Electron;
- `desktop/`;
- `public/`;
- avatar/renderer files;
- HumanALE integration transport;
- HumanALE Real Test scripts.

It is safe to develop while HumanALE Real Test v5 remains active.
