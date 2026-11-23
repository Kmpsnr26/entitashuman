# HumanALE Final Readiness — Current Certificate

Release-candidate branch: `codex/release-2.5.0-final-candidate`

Certificate commit baseline: `69bdf34da732c982484a88e103cdf52fd4bcab8c`

## Current state

- HumanALE real Windows acceptance: **PASS**
- Final readiness: **LOCKED**
- Required gates passed: **6 / 9**
- Required gates pending: **3 / 9**
- Final HumanALE↔AleCore AI integration: **LOCKED**

## Gates now passed

- runtime-core
- visual-avatar
- voice-sensors
- live-studio
- desktop-runtime
- integration-boundary

## Remaining technical gates

### 1. performance-stability

Run the fixed Windows installer on the target PC and measure HumanALE after 30–60 seconds idle:

- CPU
- RAM
- renderer stability
- no repeated errors
- no runaway background activity

This gate must not be marked PASS from CI alone.

### 2. android-runtime

The debug APK build is green, but final Android readiness still requires:

- production signing secrets configured
- signed Android release workflow
- `apksigner` verification
- install/run on a real Android device

### 3. release-security

CodeQL is green, but final distribution security still requires:

- Windows Authenticode signing for public distribution
- Android production signing
- final release-security review before publication

## Creator boundary

Even after all nine technical gates pass, integration must remain locked until the creator explicitly approves final HumanALE↔AleCore AI integration.

No runtime code may infer creator approval from CI, a real-device PASS, or a release certificate.

## Development follow-up — 3 October 2026

The historical certificate above remains bound to `69bdf34`; its six PASS gates
must not be inherited by the newer candidate. Development fixes are based on
`main` commit `b06b400` and do not update the certificate or unlock integration.

- Credential environment names ending in `_FILE`/`_PATH` are now filtered, and
  patch inspection rejects corresponding sensitive accesses without excessive
  backtracking on large identifiers.
- Signed Windows/Android workflows now emit public build records after signature
  verification. Windows runtime hashes come from the finalized portable ZIP.
  These records support independent build review; they do not grant acceptance.
- Linux cloud verification with Node.js 22.23.3: 667 tests passed, eight platform
  checks skipped, zero failures, and web build passed. A local subreaper is used
  to clean up orphan descendants in this container.
- AleCore AI Cloud: TypeScript build and 101 unit tests passed; PostgreSQL migrations,
  three database tests, and one live Owner SSO/runtime E2E test passed using a
  dedicated localhost-only test database. Production providers were not called.

Codex agents implemented and independently reviewed the fixes. GitHub Copilot
CLI was installed and scoped tasks were attempted; the corrected invocation
timed out without a model response. A read-only Copilot review was also requested
in PR #214, but no Copilot contribution has been established.
Native signed builds, target-PC performance, real Android acceptance, and
Creator Final Approval remain outstanding. No release was published.
