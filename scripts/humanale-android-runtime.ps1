param(
  [string]$ApkPath,
  [string]$ArtifactCommit,
  [string]$ExpectedApkSha256,
  [string]$DeviceSerial,
  [string]$PackageName = "id.my.aleprinting.humanale",
  [string]$OutputPath = "$PSScriptRoot\humanale-android-runtime-result.json"
)

$ErrorActionPreference = "Stop"
# A failed rerun must not leave an earlier PASS at the requested result path.
if (Test-Path -LiteralPath $OutputPath) {
  Remove-Item -LiteralPath $OutputPath -Force -ErrorAction Stop
}
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
if (-not (Get-Command Get-FileHash -ErrorAction SilentlyContinue)) {
  Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Utility') -ErrorAction Stop
}
$apkSha256 = (Get-FileHash -LiteralPath $ApkPath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($ArtifactCommit -notmatch '^[0-9a-fA-F]{40}$' -or $ArtifactCommit -ne $candidate -or
    $ExpectedApkSha256 -notmatch '^[0-9a-fA-F]{64}$' -or $apkSha256 -ne $ExpectedApkSha256.ToLowerInvariant()) {
  throw "Identitas APK tidak cocok dengan catatan build terpercaya. Gunakan ArtifactCommit dan ExpectedApkSha256 dari build yang akan diuji."
}

$devicesRaw = & adb devices
$deviceLines = @($devicesRaw | Select-Object -Skip 1 | Where-Object { $_ -match "\sdevice$" })
if ($deviceLines.Count -eq 0) { throw "Tidak ada Android device berstatus device. Aktifkan USB debugging dan otorisasi komputer ini." }
if ($deviceLines.Count -gt 1) { throw "Hubungkan satu perangkat Android saja untuk validator final." }
$serial = ($deviceLines[0] -split "\s+")[0]
if ($DeviceSerial -and $DeviceSerial -cne $serial) { throw "Perangkat terhubung tidak cocok dengan DeviceSerial yang dipilih." }
$userRaw = (& adb -s $serial shell am get-current-user 2>&1) -join " "
$deviceUserId = 0
if ($LASTEXITCODE -ne 0 -or $userRaw.Trim() -notmatch '^\d{1,6}$' -or
    -not [int]::TryParse($userRaw.Trim(), [ref]$deviceUserId)) {
  throw "User Android aktif tidak dapat diverifikasi."
}

Write-Host "HumanALE Android Runtime Validator" -ForegroundColor Green
Write-Host "Candidate: $candidate"
Write-Host "Branch: $branch"
Write-Host "Device: $serial"
Write-Host "APK: $ApkPath"

$installOutput = & adb -s $serial install -r --user $deviceUserId $ApkPath 2>&1
if ($LASTEXITCODE -ne 0 -or ($installOutput -join " ") -notmatch "Success") { throw "Instalasi APK gagal." }
$installed = (& adb -s $serial shell pm path --user $deviceUserId $PackageName 2>&1) -join " "
if ($LASTEXITCODE -ne 0 -or $installed -notmatch "package:") { throw "Package HumanALE tidak terdeteksi setelah instalasi." }
$launch = (& adb -s $serial shell monkey -p $PackageName -c android.intent.category.LAUNCHER 1 2>&1) -join " "
if ($LASTEXITCODE -ne 0 -or $launch -notmatch "Events injected:\s*1\b" -or $launch -match "(?i)crash|aborted|no activities found") {
  throw "Peluncuran HumanALE gagal; monkey tidak mengonfirmasi satu launch event yang berhasil."
}
Start-Sleep -Seconds 5
$currentUser = (& adb -s $serial shell am get-current-user 2>&1) -join " "
if ($LASTEXITCODE -ne 0 -or $currentUser.Trim() -cne [string]$deviceUserId) {
  throw "User Android aktif berubah selama pengujian."
}
$processEvidence = (& adb -s $serial shell pidof $PackageName 2>&1) -join " "
if ($LASTEXITCODE -ne 0 -or $processEvidence.Trim() -notmatch "^\d+(\s+\d+)*$") {
  throw "Proses HumanALE tidak hidup setelah peluncuran."
}
$focused = (& adb -s $serial shell dumpsys window windows 2>&1 | Select-String -Pattern "mCurrentFocus" | Select-Object -First 5) -join " "
if ($LASTEXITCODE -ne 0 -or $focused -notmatch ("\bu" + $deviceUserId + "\s+" + [regex]::Escape($PackageName) + "/")) {
  throw "HumanALE tidak terdeteksi sebagai aplikasi foreground setelah peluncuran."
}

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
  deviceUserId = $deviceUserId
  apkPath = $ApkPath
  apkSha256 = $apkSha256
  artifactSourceVerified = $true
  installSuccess = $true
  packageDetected = $true
  launchSuccess = $true
  processAlive = $true
  foregroundMatches = $true
  launchCommand = $launch
  processEvidence = $processEvidence.Trim()
  focusEvidence = $focused
  operatorPass = $operatorPass
  state = $(if($operatorPass){"ANDROID_RUNTIME_PASS"}else{"ANDROID_RUNTIME_INCOMPLETE"})
  fullyValidated = $operatorPass
}
$payload | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 $OutputPath
Write-Host "Hasil tersimpan: $OutputPath"
Write-Host $payload.state -ForegroundColor $(if($operatorPass){"Green"}else{"Yellow"})
if($operatorPass){exit 0}else{exit 2}
