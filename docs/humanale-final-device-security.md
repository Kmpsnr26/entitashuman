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