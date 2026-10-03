The debug APK workflow runs `runtime-smoke.sh` on an official Android35 Google APIs x86_64 image with hardware acceleration required. It installs and launches the generated APK, connects to its actual debuggable WebView, reloads the app while capturing errors, checks the avatar and conversation, opens settings, sends a local command, and checks an actual assistant response. The shell also requires the native process to remain alive in the foreground and rejects native app or renderer crashes.

Run on a Linux host with Android SDK command-line tools, Java21, Node22 and accessible `/dev/kvm`:

```sh
bash scripts/android/runtime-smoke.sh android/app/build/outputs/apk/debug/app-debug.apk release/android-runtime
```

The helper fails explicitly when KVM is unavailable. It creates an isolated temporary AVD and owns only emulator serial5580; an existing emulator at that serial causes refusal. Cleanup captures logcat, crash log, activities, WebView provider and screenshot, then shuts down only the emulator it started. CI uploads evidence even when validation fails. No Android or Chromium sandbox is disabled.

`webview-report.json` covers DOM, browser input and JavaScript/resource checks. `runtime-result.json` is the overall result, including KVM, boot and native process/foreground/crash checks; use it to decide whether the entire smoke passed. CI also prints these checks and writes a job summary.

This is debug runtime validation. It does not certify physical sensors, provider credentials, production signing or device acceptance, and does not bypass release or Creator publication gates.
