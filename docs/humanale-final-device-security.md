# HumanALE Final Device + Security Gates

## Android runtime

Requirements:
- Android Platform Tools (adb) available in PATH
- one Android device connected with USB debugging authorized
- target APK available locally

Run:

    .\scripts\humanale-android-runtime.ps1 -ApkPath "C:\path\HumanALE.apk"

PASS requires install success plus real-device operator validation.

## Release security

Run:

    .\scripts\humanale-release-security.ps1 -InstallerPath "C:\path\HumanALE-God-Engine-Setup-2.5.0-x64.exe" -ApkPath "C:\path\HumanALE-Android-2.5.0.apk"

PASS requires Windows Authenticode status = Valid and Android APK passing apksigner verify.
If signing credentials are absent, the gate remains incomplete.

## Publication fail-closed gate

Production publication is blocked unless `scripts/humanale-release-publication-gate.mjs` confirms:

- workflow is running from `main`;
- readiness certificate build branch is `main`;
- certificate state is `FINAL_READY`;
- `integrationUnlocked === true`;
- Creator Final Approval is explicitly recorded;
- all nine required readiness gates are `pass`;
- certificate version matches `package.json`;
- certificate build commit is an ancestor of the publication commit.

Windows public distribution additionally requires these Actions secrets:

- `WINDOWS_SIGNING_PFX_BASE64`
- `WINDOWS_SIGNING_PFX_PASSWORD`

The Windows publish path signs the portable executable, lets electron-builder sign the installer using the same certificate, and rejects publication unless `Get-AuthenticodeSignature` returns `Valid` for both.

Android publication remains protected by the existing keystore secrets and `apksigner verify`.

A manual `publish_release=true` input never bypasses these checks.
