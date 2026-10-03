# Trusted Checkpoint v1

This stage follows the HumanALE Orchestrator real-maintenance acceptance.

## Purpose

A verified AI maintenance patch may be converted into one **local Git checkpoint commit** by a trusted broker. The AI Worker itself still has no Git publication authority.

Pipeline:

    clean source checkout
        ↓
    Trusted Checkpoint Broker
        ↓
    isolated temporary Git worktree
    automation/maintenance/<finding>-<fingerprint>
        ↓
    HumanALE maintenance transaction
        ↓
    patch → inspect → trusted test → trusted build/verify
        ↓
    VERIFY_PASS receipt
    (base HEAD + exact diff fingerprint)
        ↓
    re-compute diff fingerprint
        ↓
    exact match required
        ↓
    one local checkpoint commit

## Diff binding

VERIFY_PASS is not sufficient by itself.

The trusted maintenance verifier records:

- base commit SHA;
- base branch;
- SHA-256 fingerprint of the complete tracked diff plus untracked file evidence;
- changed-file count;
- current bounded change size.

Before committing, the checkpoint broker computes the fingerprint again. Any change after verification causes a fail-closed refusal.

## Authority

The broker may:

- create an isolated temporary worktree;
- create a deterministic automation/maintenance/* local branch;
- create exactly one local commit after a bound VERIFY_PASS;
- close the temporary worktree while preserving the local checkpoint branch.

The broker cannot:

- push;
- merge;
- create or mark a PR ready;
- publish a release;
- sign artifacts;
- change Owner/Creator authority;
- read or write credentials.

A checkpointed branch cannot be removed through the ordinary discard path.

## Next stage

Remote push and Draft PR creation remain a separate Trusted Draft PR Broker stage with an independent security review.
