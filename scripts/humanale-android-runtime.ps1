param(
  [string]$ApkPath,
  [string]$PackageName = "id.my.aleprinting.humanale",
  [string]$OutputPath = "$PSScriptRoot\humanale-android-runtime-result.json"
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$candidate = "unknown"
$branch = "unknown"
try {
  $candidate = (& git -C $repoRoot rev-parse HEAD 2>$null).Trim()
  $branch = (& git -C $repoRoot branch --show-current 2>$null).Trim()
} catch {}

$adb = Get-Command adb -ErrorAction SilentlyContinue
if (-not $adb) { throw "ADB tidak ditemukan. Instal Android Platform Tools dan pastikan adb ada di PATH." }
if (-not $ApkPath) { throw "Gunakan -ApkPath untuk menunjuk APK HumanALE yang akan diuji." }
$ApkPath = (Resolve-Path $ApkPath).Path

$devicesRaw = & adb devices
$deviceLines = @($devicesRaw | Select-Object -Skip 1 | Where-Object { $_ -match "\sdevice$" })
if ($deviceLines.Count -eq 0) { throw "Tidak ada Android device berstatus device. Aktifkan USB debugging dan otorisasi komputer ini." }
if ($deviceLines.Count -gt 1) { throw "Hubungkan satu perangkat Android saja untuk validator final." }
$serial = ($deviceLines[0] -split "\s+")[0]

Write-Host "HumanALE Android Runtime Validator" -ForegroundColor Green
Write-Host "Candidate: $candidate"
Write-Host "Branch: $branch"
Write-Host "Device: $serial"
Write-Host "APK: $ApkPath"

$installOutput = & adb -s $serial install -r $ApkPath 2>&1
if ($LASTEXITCODE -ne 0 -or ($installOutput -join " ") -notmatch "Success") { throw "Instalasi APK gagal." }
$installed = (& adb -s $serial shell pm path $PackageName 2>&1) -join " "
if ($LASTEXITCODE -ne 0 -or $installed -notmatch "package:") { throw "Package HumanALE tidak terdeteksi setelah instalasi." }
$launch = (& adb -s $serial shell monkey -p $PackageName -c android.intent.category.LAUNCHER 1 2>&1) -join " "
Start-Sleep -Seconds 5
$focused = (& adb -s $serial shell dumpsys window windows 2>&1 | Select-String -Pattern "mCurrentFocus|mFocusedApp" | Select-Object -First 5) -join " "

Write-Host "Periksa perangkat Android secara nyata: avatar tampil, UI responsif, izin mic/camera sesuai kebutuhan, tidak crash/blank, layout tidak rusak."
$answer = (Read-Host "Apakah semua pemeriksaan perangkat nyata PASS? [Y/N]").Trim().ToUpperInvariant()
$operatorPass = $answer -eq "Y"

$payload = [ordered]@{
  protocol = "humanale-android-runtime/1"
  candidate = $candidate
  branch = $branch
  generatedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  packageName = $PackageName
  deviceSerial = $serial
  apkPath = $ApkPath
  installSuccess = $true
  packageDetected = $true
  launchCommand = $launch
  focusEvidence = $focused
  operatorPass = $operatorPass
  state = $(if($operatorPass){"ANDROID_RUNTIME_PASS"}else{"ANDROID_RUNTIME_INCOMPLETE"})
  fullyValidated = $operatorPass
}
$payload | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 $OutputPath
Write-Host "Hasil tersimpan: $OutputPath"
Write-Host $payload.state -ForegroundColor $(if($operatorPass){"Green"}else{"Yellow"})
if($operatorPass){exit 0}else{exit 2}