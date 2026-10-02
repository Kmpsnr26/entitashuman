# HumanALE Final Device + Security Gates

## Android runtime

Requirements:
- Android Platform Tools (adb) available in PATH
- one Android device connected with USB debugging authorized
- target APK available locally
- independent trusted build record with the APK's full source commit and SHA-256

Run:

    .\scripts\humanale-android-runtime.ps1 -ApkPath "C:\path\HumanALE.apk" -ArtifactCommit $trustedBuildCommit -ExpectedApkSha256 $trustedApkSha256

PASS requires source/hash matching, successful install/launch, a live process in
the foreground, and real-device operator validation. The expected values must
come from the independently trusted build record described below.

## Release security

Run with values supplied by an independently trusted build/CI record:

```powershell
.\scripts\humanale-release-security.ps1 `
  -InstallerPath "C:\path\HumanALE-God-Engine-Setup-2.5.0-x64.exe" `
  -ApkPath "C:\path\HumanALE-Android-2.5.0.apk" `
  -ArtifactCommit $trustedBuildCommit `
  -ExpectedInstallerSha256 $trustedInstallerSha256 `
  -ExpectedApkSha256 $trustedApkSha256 `
  -AndroidReleaseCertSha256 $approvedProductionCertificateSha256
```

The four expected values must come from a separate trusted source: the full
40-character commit of the build, its recorded final signed installer/APK
SHA-256 hashes, and the previously approved production Android signing
certificate SHA-256 fingerprint. Fingerprints and hashes are public data;
private keys and passwords are not validator inputs. Do not derive or approve
expected values by reading the candidate artifacts or the validation checkout.
The placeholder variables above must be populated from that trusted record.

PASS requires all of the following:

- The supplied build commit exactly matches the current Git checkout.
- Both final artifact hashes match the independently recorded 64-character hashes.
- Windows Authenticode status is `Valid`.
- Android `apksigner verify` succeeds, reports one signer, and that signer's
  certificate SHA-256 equals the approved production fingerprint.
- The Android certificate DN does not identify `Android Debug`.

Missing or mismatched source/hash inputs produce `artifactSourceVerified: false`,
`candidate: "unknown"`, and `RELEASE_SECURITY_INCOMPLETE`. `checkoutCommit`
records the checkout separately; it never substitutes for the artifact's build
identity. A missing or mismatched production signer pin also prevents PASS.
The result records actual artifact hashes and `android.productionSignerMatched`.
An old result file is removed before validation so a failed rerun cannot reuse
an earlier PASS.

This is an explicit human trusted-record boundary, not a cryptographic build
attestation. Matching supplied hashes prevents accidental artifact substitution,
but the validator cannot authenticate a forged or incorrectly supplied build
record. A signature verifies the artifact's signature; it does not by itself
prove which source commit produced the artifact. Windows publisher identity
still relies on Windows Authenticode trust and the trusted artifact hash; this
validator does not pin a Windows publisher certificate. APK manifest flags such
as `debuggable` are not checked by this validator.

Tests run the validator with mock signature providers and no installation:

    node --test tests/humanale-release-security.test.mjs

## Publication fail-closed gate

Production publication is blocked unless `scripts/humanale-release-publication-gate.mjs` confirms:

- workflow is running from `main`;
- readiness certificate build branch is `main`;
- certificate state is `FINAL_READY`;
- `integrationUnlocked === true`;
- Creator Final Approval is explicitly recorded;
- all nine required readiness gates are `pass`;
- certificate version matches `package.json`;
- certificate build commit is an ancestor of the publication commit, and only
  `docs/humanale-final-readiness-certificate.json` and
  `docs/humanale-final-readiness-status.md` may differ.
- certificate artifact identities record the tested Windows installer, Windows
  portable ZIP, and Android APK; downloaded artifact bytes must match the
  recorded SHA-256 hashes before publication.

Windows public distribution additionally requires these Actions secrets:

- `WINDOWS_SIGNING_PFX_BASE64`
- `WINDOWS_SIGNING_PFX_PASSWORD`

The `build_signed_artifact` preparation path signs the portable executable, lets
electron-builder sign the installer using the same certificate, and verifies
`Get-AuthenticodeSignature` is `Valid` for both before upload.

Android publication remains protected by the existing keystore secrets and `apksigner verify`.

A manual `publish_release=true` input never bypasses these checks.

## Reuse the accepted build

Record the successful manual Actions `runId` in each certificate artifact entry.
The two Windows entries must come from the same Windows run; the Android entry
records its Android signing run. Both runs must be from `main` at the certified
source commit in the canonical repository. The resolver verifies the workflow
path, successful completion, repository/source identity, and the availability of
exactly one matching unexpired artifact. Publication downloads from those run
IDs using read-only Actions access, then verifies the accepted byte hashes.

`publish_release` alone does not sign a fresh candidate. Routine checks may
still execute, but their rebuilt outputs are not published. If a certified
artifact expires, is deleted, or no longer matches the accepted hashes, create
and validate a new signed candidate and record a new reviewed certificate.
