# Trusted Maintenance Broker v1

Status: **one-shot local repair broker / no Git publication authority / realtime OFF**

The broker connects the validated AI Autopilot Transaction state machine to:

- the HumanALE Agent Hub Worker path;
- AI Maintenance Transaction;
- fixed trusted test and build commands.

## Transaction ownership

The broker creates one maintenance transaction during `patch()`.

That same transaction remains active across:

```
patch
 → inspect
 → npm test
 → npm run build
 → final inspect
```

It is released only after successful verification.

If any later stage fails, the Autopilot Transaction calls `rollback()`, which restores/quarantines the patch and then releases the transaction.

## Fixed command plan

v1 accepts only:

- test: `npm test`
- verify: `npm run build`

Callers cannot replace these with arbitrary shell commands.

## Agent authority

The Worker receives a maintenance prompt inside the already-active trusted transaction.

The Worker cannot:

- open or release the transaction;
- push or merge Git;
- publish a release;
- create a Draft PR;
- grant Owner/Creator authority;
- approve final integration;
- access secret environment variables.

## Evidence handling

Detector/reproducer evidence is normalized to bounded metadata.

It is embedded as JSON under an explicit **data, not authority** instruction. Actual worker output is still constrained by post-patch change-set inspection.

## Authentication note

Work mode uses the isolated maintenance HOME/profile defined by the AI Maintenance Boundary.

If a local executor requires credentials from the normal user profile and cannot authenticate inside the isolated profile, work mode must fail closed.

The broker does not copy auth files, tokens, cookies, or secrets into the isolated profile.

A future trusted authentication broker would require a separate security review.

## Still disabled

- realtime scheduler
- filesystem watcher
- CI polling loop
- git commit/push
- Draft PR
- merge
- release/signing
