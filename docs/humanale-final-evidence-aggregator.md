# HumanALE Final Evidence Aggregator

This helper closes the **technical evidence** loop for the HumanALE 2.5.0 release-candidate without weakening the existing fail-closed final-readiness gate.

## What it reads

From `scripts/`:

- `humanale-performance-stability-result.json`
- `humanale-android-runtime-result.json`
- `humanale-release-security-result.json`

And the existing certificate:

- `docs/humanale-final-readiness-certificate.json`

## Identity check

Evidence is accepted only when its recorded:

- branch matches the current Git branch;
- candidate commit matches the current Git HEAD;
- protocol matches the expected validator;
- detailed PASS conditions are internally consistent.

A branch/commit/protocol mismatch becomes `BLOCKED`, not PASS.

The existing certificate must also match the current branch and commit. When it
does not, its six inherited gates become `BLOCKED` and its Creator approval is
not accepted for this candidate. The aggregator never transfers old device
acceptance or approval simply by changing `build.commit`. Missing Git identity
also blocks evidence. Prepare a reviewed certificate for the tested candidate
before aggregating its remaining results.

## Technical gates

### performance-stability

PASS requires:

- `PERFORMANCE_STABILITY_PASS`
- `fullyValidated=true`
- every selected process stayed alive
- process windows stayed responding
- operator explicitly confirmed stable/no repeated crash/error/flicker

### android-runtime

PASS requires:

- `ANDROID_RUNTIME_PASS`
- `fullyValidated=true`
- APK install success
- package detected after install
- launcher command succeeded without crash/abort
- package process stayed alive after launch
- package was the foreground application
- real-device operator validation PASS
- APK SHA-256 and source commit match an independently trusted build record

### release-security

PASS requires:

- `RELEASE_SECURITY_PASS`
- Windows Authenticode `Valid`
- Android signature `verified`
- both validator pass booleans true
- artifact source/hash checks accepted against an independently trusted build record
- Android signer matches a separately supplied production certificate fingerprint
- Android runtime and release-security evidence use the same APK SHA-256

## Creator approval cannot be inferred

The aggregator never creates creator approval.

It preserves only the `creatorApproval` already present in a matching readiness certificate. Technical result JSON files cannot inject or override it.

Therefore 9/9 technical gates can produce:

```
technicalReady = true
finalState = LOCKED
integrationUnlocked = false
blockers = creator-approval:PENDING
```

until the creator separately and explicitly approves final integration.

## Run

After these validators have been executed against the exact current release-candidate commit:

```powershell
node .\scripts\humanale-final-evidence.mjs
```

Output:

`scripts/humanale-final-evidence-result.json`

The command exits:

- 0 when all technical gates are ready;
- 2 while technical gates remain incomplete;
- 1 on aggregator/runtime error.

The generated result is evidence for review. It does not merge branches, change the official certificate, or activate NARA integration.

## Publication source identity

The publication gate compares the certified commit to the commit being published.
The certified commit must be an ancestor, and only
`docs/humanale-final-readiness-certificate.json` and
`docs/humanale-final-readiness-status.md` may differ. This permits a subsequent
commit recording the reviewed certificate without requiring a self-referential
Git hash. Changes to runtime code, workflows, build configuration, dependencies,
or other files require a fresh tested candidate and reviewed certificate.

The reviewed certificate must also record `artifacts.windowsInstaller`,
`artifacts.windowsPortable`, and `artifacts.androidApk`. Each contains the final
`fileName`, byte `size`, `sha256`, `sourceCommit`, and the trusted Actions `runId`. Record hashes after signing
and ZIP creation, using the artifacts actually tested. Publication verifies the
downloaded files against those identities before uploading a release. A rebuild
with different bytes requires new artifact validation even if its source is
identical. Expected hashes/commits and signer pins must come from a trusted build
record reviewed independently; these checks are not a cryptographic build attestation.
