# HumanALE Final Readiness — Current Certificate

Release-candidate branch: `codex/release-2.5.0-final-candidate`

Certificate commit baseline: `69bdf34da732c982484a88e103cdf52fd4bcab8c`

## Current state

- HumanALE real Windows acceptance: **PASS**
- Final readiness: **LOCKED**
- Required gates passed: **6 / 9**
- Required gates pending: **3 / 9**
- Final HumanALE↔Nara Core integration: **LOCKED**

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

Even after all nine technical gates pass, integration must remain locked until the creator explicitly approves final HumanALE↔Nara Core integration.

No runtime code may infer creator approval from CI, a real-device PASS, or a release certificate.
