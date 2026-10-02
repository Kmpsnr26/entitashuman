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
- real-device operator validation PASS

### release-security

PASS requires:

- `RELEASE_SECURITY_PASS`
- Windows Authenticode `Valid`
- Android signature `verified`
- both validator pass booleans true

## Creator approval cannot be inferred

The aggregator never creates creator approval.

It preserves only the `creatorApproval` already present in the existing readiness certificate. Technical result JSON files cannot inject or override it.

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
