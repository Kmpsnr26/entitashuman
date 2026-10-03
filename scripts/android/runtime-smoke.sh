#!/usr/bin/env bash
# Real debug APK / WebView acceptance smoke. Requires KVM; never falls back to TCG.
set -Eeuo pipefail
apk=${1:?Usage: runtime-smoke.sh APK EVIDENCE_DIRECTORY}
evidence=${2:?Usage: runtime-smoke.sh APK EVIDENCE_DIRECTORY}
mkdir -p "$evidence"
evidence=$(realpath "$evidence")
apk=$(realpath "$apk")
sdk=${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}
test -n "$sdk" || { echo 'ANDROID_HOME or ANDROID_SDK_ROOT is required' >&2; exit 1; }
adb_bin="$sdk/platform-tools/adb"
emulator="$sdk/emulator/emulator"
serial=emulator-5580
emulator_pid=''
runtime_dir=''
avd_name=''
cdp_port=''
acceleration_pass=false
booted=false
native_pass=false
stage='KVM prerequisite'
diagnostic_file=''
adb_device() { timeout 10 "$adb_bin" -s "$serial" "$@"; }
emit_failure() {
  error_code=$1
  node - "$stage" "$error_code" "$diagnostic_file" <<'JS'
const fs=require('node:fs');
const [stage,code,file]=process.argv.slice(2);
let diagnostic='';
if(file&&fs.existsSync(file)) diagnostic=fs.readFileSync(file,'utf8').split('\n').slice(-20).join('\n').slice(-4000);
const escape=value=>value.replaceAll('%','%25').replaceAll('\r','%0D').replaceAll('\n','%0A');
console.log(`::error title=Android runtime stage failed::${escape(`${stage}; exit ${code}${diagnostic?'\n'+diagnostic:''}`)}`);
JS
}
cleanup() {
  result=$?
  trap - EXIT INT TERM ERR
  if [ -n "$emulator_pid" ] && kill -0 "$emulator_pid" 2>/dev/null && [ "$(adb_device shell getprop ro.boot.qemu.avd_name 2>/dev/null | tr -d '\r')" = "$avd_name" ]; then
    adb_device logcat -d > "$evidence/logcat.txt" 2>&1 || true
    adb_device logcat -b crash -d > "$evidence/crash.txt" 2>&1 || true
    adb_device shell dumpsys activity activities > "$evidence/activities.txt" 2>&1 || true
    adb_device shell dumpsys webviewupdate > "$evidence/webview.txt" 2>&1 || true
    adb_device exec-out screencap -p > "$evidence/android-final.png" 2>/dev/null || true
    if [ -n "$cdp_port" ]; then adb_device forward --remove "tcp:$cdp_port" >/dev/null 2>&1 || true; fi
    adb_device emu kill >/dev/null 2>&1 || true
  fi
  if [ -n "$emulator_pid" ]; then
    for unused in $(seq 1 10); do
      kill -0 "$emulator_pid" 2>/dev/null || break
      sleep 1
    done
    kill -KILL "$emulator_pid" 2>/dev/null || true
    wait "$emulator_pid" 2>/dev/null || true
  fi
  if [ -n "$runtime_dir" ]; then rm -rf -- "$runtime_dir"; fi
  if [ "$result" -ne 0 ]; then emit_failure "$result" || true; fi
  printf '%s\n' "$result" > "$evidence/exit-code.txt"
  node - "$evidence" "$result" "$acceleration_pass" "$booted" "$native_pass" <<'JS'
const fs = require('node:fs');
const [directory, code, acceleration, booted, native] = process.argv.slice(2);
const result = {schema:'humanale-android-ci-runtime-result/1',status:code==='0'?'passed':'failed',exitCode:Number(code),hardwareAcceleration:acceleration==='true',bootCompleted:booted==='true',nativeProcessForegroundAndCrashChecks:native==='true',physicalDeviceAcceptance:false};
if(fs.existsSync(directory+'/apk-sha256.txt')) result.apkSha256=fs.readFileSync(directory+'/apk-sha256.txt','utf8').split(/\s+/)[0];
fs.writeFileSync(directory+'/runtime-result.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
console.log('::notice title=Android APK overall result::'+JSON.stringify(result));
if(process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,`\nAndroid APK overall result: **${result.status}**. KVM: ${result.hardwareAcceleration}; boot: ${result.bootCompleted}; process/foreground/crash checks: ${result.nativeProcessForegroundAndCrashChecks}. Physical-device acceptance pending.\n`);
JS
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
test -r /dev/kvm && test -w /dev/kvm || { echo '::error::KVM is unavailable: runtime acceptance was not run' >&2; exit 1; }
test -x "$adb_bin" && test -s "$apk"
sha256sum "$apk" > "$evidence/apk-sha256.txt"
sdkmanager="$sdk/cmdline-tools/latest/bin/sdkmanager"
avdmanager="$sdk/cmdline-tools/latest/bin/avdmanager"
stage='Install official Android system image'; diagnostic_file="$evidence/sdk-install.txt"
timeout 360 "$sdkmanager" --install 'system-images;android-35;google_apis;x86_64' 'emulator' 'platform-tools' > "$evidence/sdk-install.txt" 2>&1
stage='Acceleration capability'; diagnostic_file="$evidence/acceleration.txt"
"$emulator" -accel-check > "$evidence/acceleration.txt" 2>&1
acceleration_pass=true
echo 'PASS: KVM hardware acceleration available'
echo '::notice title=Android acceleration::KVM hardware acceleration available'
runtime_dir=$(mktemp -d "${TMPDIR:-/tmp}/humanale-android-smoke.XXXXXX")
avd_name="humanale-runtime-${runtime_dir##*.}"
export ANDROID_AVD_HOME="$runtime_dir/avd"
export ANDROID_EMULATOR_HOME="$runtime_dir/emulator"
mkdir -p "$ANDROID_AVD_HOME" "$ANDROID_EMULATOR_HOME"
stage='Create isolated AVD'; diagnostic_file="$evidence/avd-create.txt"
printf 'no\n' | "$avdmanager" create avd --name "$avd_name" --package 'system-images;android-35;google_apis;x86_64' > "$evidence/avd-create.txt" 2>&1
if "$adb_bin" devices | awk '{print $1}' | grep -qx "$serial"; then
  echo "Refusing to replace existing $serial" >&2; exit 1
fi
stage='Boot accelerated emulator'; diagnostic_file="$evidence/emulator.txt"
"$emulator" -avd "$avd_name" -port 5580 -accel on -no-window -no-audio -no-boot-anim -no-snapshot -no-metrics -gpu swiftshader -cores 2 -memory 2048 > "$evidence/emulator.txt" 2>&1 &
emulator_pid=$!
for unused in $(seq 1 90); do
  kill -0 "$emulator_pid" 2>/dev/null || { echo 'Emulator exited before boot' >&2; exit 1; }
  if [ "$(adb_device shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ]; then booted=true; break; fi
  sleep 2
done
test "$booted" = true || { echo 'Android boot timed out' >&2; exit 1; }
test "$(adb_device shell getprop ro.boot.qemu.avd_name | tr -d '\r')" = "$avd_name" || { echo 'Unexpected emulator owns the selected serial' >&2; exit 1; }
echo 'PASS: owned Android emulator boot completed'
echo '::notice title=Android boot::Owned accelerated emulator boot completed'
stage='Install debug APK'; diagnostic_file="$evidence/install.txt"
adb_device shell settings put global window_animation_scale 0
adb_device shell settings put global transition_animation_scale 0
adb_device shell settings put global animator_duration_scale 0
adb_device shell input keyevent 82
adb_device install -r "$apk" > "$evidence/install.txt" 2>&1
adb_device logcat -c
stage='Launch HumanALE activity'; diagnostic_file="$evidence/launch.txt"
adb_device shell am start -W -n id.my.aleprinting.humanale/.MainActivity > "$evidence/launch.txt" 2>&1
stage='Find HumanALE WebView socket'; diagnostic_file="$evidence/crash.txt"
socket=''
for unused in $(seq 1 60); do
  app_pid=$(adb_device shell pidof id.my.aleprinting.humanale 2>/dev/null | tr -d '\r' | awk '{print $1}' || true)
  if [ -n "$app_pid" ]; then
    socket=$(adb_device shell cat /proc/net/unix | tr -d '\r' | sed -n "s/.*@\(webview_devtools_remote_${app_pid}\)$/\1/p")
  fi
  [ -n "$socket" ] && break
  sleep 1
done
test -n "$socket" || { echo 'HumanALE WebView debugging socket did not appear' >&2; exit 1; }
cdp_port=$(adb_device forward tcp:0 "localabstract:$socket" | tr -d '\r')
stage='WebView DOM and interaction'; diagnostic_file="$evidence/webview-report.json"
node scripts/android/runtime-smoke.mjs "http://127.0.0.1:$cdp_port" "$evidence"
stage='Native process, foreground and crash checks'; diagnostic_file="$evidence/crash.txt"
adb_device shell pidof id.my.aleprinting.humanale > "$evidence/process.txt"
adb_device shell dumpsys activity activities > "$evidence/foreground.txt"
adb_device logcat -b crash -d > "$evidence/crash.txt"
node scripts/android/runtime-smoke.mjs --native "$evidence"
native_pass=true
echo 'Android KVM WebView runtime smoke passed'
