# Trusted Maintenance Workspace + Draft PR Broker v1

This stage stacks on AI Maintenance Boundary v1 and Safe Autopilot Loop v1.

Realtime monitoring remains **OFF**.

## Authority split

The AI Worker never receives Git publication authority.

The pipeline is:

    source checkout (clean)
        ↓
    Trusted Workspace Broker
        ↓
    temporary isolated Git worktree
    automation/maintenance/<finding>-<fingerprint>
        ↓
    Agent Hub maintenance transaction
        ↓
    patch → inspect → review → trusted npm run verify
        ↓
    Trusted Workspace Broker creates one local commit
        ↓
    Trusted Draft PR Broker
        ↓
    push exact maintenance branch to origin
        ↓
    gh pr create --draft
        ↓
    verify Draft PR head/base/commit
        ↓
    cleanup temporary worktree

## Workspace safety

The workspace broker:

- requires a clean source checkout;
- rejects detached source HEAD;
- creates a deterministic maintenance branch;
- never overwrites an existing local maintenance branch;
- creates an isolated temporary Git worktree;
- requires trusted verification PASS before commit;
- creates exactly one commit directly above the recorded base HEAD;
- deletes failed/uncheckpointed temporary workspaces;
- deletes the local checkpoint branch only after a matching Draft PR exists.

## Draft PR authority

The Draft PR broker is deliberately narrow.

Allowed:

- verify origin points to the configured GitHub owner/repo;
- verify local maintenance branch HEAD;
- push the exact automation/maintenance branch to origin;
- list an existing open PR for the exact head branch;
- create a PR with --draft;
- verify the resulting Draft PR base/head/head SHA.

Not available:

- force push;
- merge;
- mark ready;
- approve;
- release;
- publish;
- signing;
- branch protection changes;
- Owner/Creator authority.

The broker sanitizes environment variables before spawning git or gh. It therefore does not forward GH_TOKEN/GITHUB_TOKEN/API keys to child commands. A local gh authenticated session or OS Git credential helper may be used by those trusted CLIs without exposing credentials to the AI Worker.

## Recovery

If trusted verification fails:

- the Agent Hub transaction rolls back/quarantines the patch;
- the isolated workspace is discarded;
- there is no publication.

If Draft PR publication fails after a verified local checkpoint:

- the checkpoint/worktree is preserved;
- the coordinator enters PUBLISH_PENDING;
- new findings are blocked;
- resumePending() retries the trusted publication path.

If Draft PR exists but local cleanup fails:

- the coordinator enters CLEANUP_PENDING;
- new findings remain blocked;
- resumePending() retries cleanup only.

## Realtime

There is still no watcher, scheduler, timer loop, automatic detector subscription, or continuous repair daemon in this stage.
