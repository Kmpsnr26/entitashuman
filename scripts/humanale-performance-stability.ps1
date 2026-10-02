param(
  [int[]]$ProcessId,
  [int]$DurationSeconds = 60,
  [int]$IntervalSeconds = 5,
  [string]$ArtifactCommit,
  [string]$ExpectedExecutableSha256,
  [string]$ExpectedRuntimeSha256,
  [switch]$ObserveOnly,
  [string]$OutputPath = "$PSScriptRoot\humanale-performance-stability-result.json"
)

$ErrorActionPreference = "Stop"
if (Test-Path -LiteralPath $OutputPath) { Remove-Item -LiteralPath $OutputPath -Force -ErrorAction Stop }
if (-not (Get-Command Get-FileHash -ErrorAction SilentlyContinue)) {
  Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Utility') -ErrorAction Stop
}

if ($DurationSeconds -lt 30 -or $DurationSeconds -gt 300) { throw "DurationSeconds harus 30..300 detik." }
if ($IntervalSeconds -lt 1 -or $IntervalSeconds -gt 10) { throw "IntervalSeconds harus 1..10 detik." }

$repoRoot = Split-Path -Parent $PSScriptRoot
$candidate = "unknown"
$checkoutCommit = "unknown"
$branch = "unknown"
try {
  $checkoutCommit = (& git -C $repoRoot rev-parse HEAD 2>$null).Trim()
  $branch = (& git -C $repoRoot branch --show-current 2>$null).Trim()
} catch {}

function Get-PackagedRuntimeSha256([string]$ExecutablePath) {
  $resourcesRoot = Join-Path (Split-Path -Parent $ExecutablePath) 'resources'
  $resources = Get-Item -LiteralPath $resourcesRoot -Force -ErrorAction Stop
  if (-not $resources.PSIsContainer -or ($resources.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Packaged resources root must be a real directory.' }
  $runtimeRoot = Join-Path $resourcesRoot 'app'
  $runtime = Get-Item -LiteralPath $runtimeRoot -Force -ErrorAction Stop
  if (-not $runtime.PSIsContainer -or ($runtime.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    throw 'Packaged runtime root must be a real directory.'
  }
  foreach ($required in @('package.json','public\app.js','desktop\main.cjs')) {
    if (-not (Test-Path -LiteralPath (Join-Path $runtimeRoot $required) -PathType Leaf)) { throw "Missing packaged runtime entry: $required" }
  }
  $records = [Collections.Generic.List[string]]::new()
  $pending = [Collections.Generic.Stack[string]]::new()
  $pending.Push($runtime.FullName)
  while ($pending.Count -gt 0) {
    foreach ($entry in Get-ChildItem -LiteralPath $pending.Pop() -Force -ErrorAction Stop) {
      if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Runtime reparse entry rejected: $($entry.Name)" }
      if ($entry.PSIsContainer) { $pending.Push($entry.FullName); continue }
      $relative = $entry.FullName.Substring($runtime.FullName.Length + 1).Replace('\','/')
      $hash = (Get-FileHash -LiteralPath $entry.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
      $records.Add($relative + "`0" + $hash + "`n")
    }
  }
  $records.Sort([StringComparer]::Ordinal)
  $digest = [Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [Text.UTF8Encoding]::new($false).GetBytes([string]::Join('', $records))
    return [BitConverter]::ToString($digest.ComputeHash($bytes)).Replace('-','').ToLowerInvariant()
  } finally { $digest.Dispose() }
}

function Get-HumanALECandidates {
  Get-Process -ErrorAction SilentlyContinue |
    Where-Object { $_.ProcessName -match 'HumanALE|electron' } |
    Select-Object Id, ProcessName, @{n='WorkingSetMB';e={[math]::Round($_.WorkingSet64/1MB,1)}}, MainWindowTitle
}

if (-not $ProcessId -or $ProcessId.Count -eq 0) {
  if ($ObserveOnly) { throw "ObserveOnly memerlukan ProcessId eksplisit agar tidak menunggu input operator." }
  Write-Host "HumanALE Performance Stability Runner" -ForegroundColor Green
  Write-Host "Candidate: $candidate"
  Write-Host "Branch: $branch"
  Write-Host ""
  $candidates = @(Get-HumanALECandidates)
  if ($candidates.Count -eq 0) {
    throw "Tidak menemukan proses HumanALE/electron. Jalankan HumanALE terlebih dahulu."
  }
  $candidates | Format-Table -AutoSize
  Write-Host ""
  $raw = (Read-Host "Masukkan PID HumanALE yang diuji. Untuk beberapa proses gunakan koma, contoh 1234,5678").Trim()
  if (-not $raw) { throw "PID wajib diisi." }
  $ProcessId = @($raw -split ',' | ForEach-Object {
    $v = 0
    if (-not [int]::TryParse($_.Trim(), [ref]$v)) { throw "PID tidak valid: $_" }
    $v
  })
}

$ProcessId = @($ProcessId | Sort-Object -Unique)
if ($ProcessId.Count -gt 32 -or @($ProcessId | Where-Object { $_ -le 0 }).Count -gt 0) {
  throw "Pilih maksimal 32 PID positif."
}
$logicalCpu = [Environment]::ProcessorCount
$sampleCount = [math]::Ceiling($DurationSeconds / $IntervalSeconds)
$samples = @()
$disappeared = @{}

Write-Host ""
Write-Host "Mengukur HumanALE selama $DurationSeconds detik ($sampleCount sample)..." -ForegroundColor Cyan
Write-Host "Biarkan HumanALE idle; jangan menjalankan workload/test lain selama pengukuran."

$previousCpu = @{}
$processIdentities = @{}
$processIdentityVerified = $true
$executablePath = ''
$executableSha256 = ''
$runtimeSha256 = ''
$previousAt = Get-Date

foreach ($pidValue in $ProcessId) {
  $p = Get-Process -Id $pidValue -ErrorAction SilentlyContinue
  if (-not $p) { throw "PID $pidValue tidak ditemukan sebelum pengukuran." }
  $previousCpu[$pidValue] = [double]$p.CPU
  try {
    $processPath = [string]$p.Path
    $startTicks = $p.StartTime.ToUniversalTime().Ticks
  } catch { $processPath = ''; $startTicks = 0 }
  if (-not $executablePath) { $executablePath = $processPath }
  $processIdentities["$pidValue"] = @{ path=$processPath; startTicks=$startTicks }
  if ([string]::IsNullOrWhiteSpace($processPath) -or $startTicks -le 0 -or
      [IO.Path]::GetFileName($processPath) -notin @('HumanALE-God-Engine.exe','HumanALE god egine.exe') -or
      $processPath -ne $executablePath) { $processIdentityVerified = $false }
}
if ($processIdentityVerified) {
  try { $executableSha256 = (Get-FileHash -LiteralPath $executablePath -Algorithm SHA256).Hash.ToLowerInvariant() }
  catch { $processIdentityVerified = $false }
  try { $runtimeSha256 = Get-PackagedRuntimeSha256 $executablePath }
  catch { $runtimeSha256 = '' }
}
# Exclude initialization/hash work from the first CPU interval.
foreach ($pidValue in $ProcessId) {
  $p = Get-Process -Id $pidValue -ErrorAction SilentlyContinue
  if (-not $p) { $disappeared["$pidValue"]=$true; $processIdentityVerified=$false; continue }
  try {
    if ([string]$p.Path -ne $processIdentities["$pidValue"].path -or
        $p.StartTime.ToUniversalTime().Ticks -ne $processIdentities["$pidValue"].startTicks) {
      $processIdentityVerified=$false; $disappeared["$pidValue"]=$true
    }
    $previousCpu[$pidValue]=[double]$p.CPU
  } catch { $processIdentityVerified=$false; $disappeared["$pidValue"]=$true }
}
$previousAt = Get-Date

for ($i=1; $i -le $sampleCount; $i++) {
  Start-Sleep -Seconds $IntervalSeconds
  $now = Get-Date
  $elapsed = [math]::Max(0.001, ($now - $previousAt).TotalSeconds)
  $rows = @()
  $totalWs = 0.0
  $totalCpuPercent = 0.0

  foreach ($pidValue in $ProcessId) {
    $p = Get-Process -Id $pidValue -ErrorAction SilentlyContinue
    if (-not $p) {
      $disappeared["$pidValue"] = $true
      continue
    }
    $identityMatches = $false
    try {
      $identityMatches = [string]$p.Path -eq $processIdentities["$pidValue"].path -and
        $p.StartTime.ToUniversalTime().Ticks -eq $processIdentities["$pidValue"].startTicks
    } catch {}
    if (-not $identityMatches) {
      $processIdentityVerified = $false
      $disappeared["$pidValue"] = $true
      continue
    }
    $cpuNow = [double]$p.CPU
    $cpuDelta = [math]::Max(0, $cpuNow - [double]$previousCpu[$pidValue])
    $cpuPercent = ($cpuDelta / $elapsed / $logicalCpu) * 100
    $wsMb = $p.WorkingSet64 / 1MB
    $rows += [ordered]@{
      pid = $pidValue
      process = $p.ProcessName
      cpuPercent = [math]::Round($cpuPercent,2)
      workingSetMB = [math]::Round($wsMb,1)
      responding = $p.Responding
    }
    $totalWs += $wsMb
    $totalCpuPercent += $cpuPercent
    $previousCpu[$pidValue] = $cpuNow
  }

  $samples += [ordered]@{
    at = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    cpuPercent = [math]::Round($totalCpuPercent,2)
    workingSetMB = [math]::Round($totalWs,1)
    processes = $rows
  }
  $previousAt = $now
  Write-Progress -Activity "HumanALE performance stability" -Status "$i / $sampleCount" -PercentComplete (($i/$sampleCount)*100)
}

Write-Progress -Activity "HumanALE performance stability" -Completed

$cpuValues = @($samples | ForEach-Object { [double]$_.cpuPercent })
$ramValues = @($samples | ForEach-Object { [double]$_.workingSetMB })
$responding = -not ($samples.processes | Where-Object { $_.responding -eq $false })
$allProcessesStayedAlive = $disappeared.Count -eq 0

$avgCpu = if ($cpuValues.Count) { ($cpuValues | Measure-Object -Average).Average } else { 0 }
$peakCpu = if ($cpuValues.Count) { ($cpuValues | Measure-Object -Maximum).Maximum } else { 0 }
$avgRam = if ($ramValues.Count) { ($ramValues | Measure-Object -Average).Average } else { 0 }
$peakRam = if ($ramValues.Count) { ($ramValues | Measure-Object -Maximum).Maximum } else { 0 }
$ramDelta = if ($ramValues.Count -gt 1) { $ramValues[-1] - $ramValues[0] } else { 0 }

Write-Host ""
Write-Host ("CPU avg: {0:N2}% | peak: {1:N2}%" -f $avgCpu,$peakCpu)
Write-Host ("RAM avg: {0:N1} MB | peak: {1:N1} MB | delta: {2:N1} MB" -f $avgRam,$peakRam,$ramDelta)
Write-Host "Process stayed alive: $allProcessesStayedAlive"
Write-Host "Responding during samples: $responding"
Write-Host ""

$operatorStable = $false
if (-not $ObserveOnly) {
  $operator = (Read-Host "Selama $DurationSeconds detik apakah HumanALE tetap stabil, responsif, tanpa crash/error/flicker berulang? [Y/N]").Trim().ToUpperInvariant()
  $operatorStable = $operator -eq "Y"
}
$hashStillMatches = $false
$runtimeStillMatches = $false
if ($processIdentityVerified) {
  try { $hashStillMatches = (Get-FileHash -LiteralPath $executablePath -Algorithm SHA256).Hash -eq $executableSha256 }
  catch {}
  try { $runtimeStillMatches = $runtimeSha256 -match '^[a-f0-9]{64}$' -and (Get-PackagedRuntimeSha256 $executablePath) -eq $runtimeSha256 }
  catch {}
}
$runtimeSourceVerified = $processIdentityVerified -and $runtimeStillMatches -and
  $ExpectedRuntimeSha256 -match '^[a-f0-9]{64}$' -and $ExpectedRuntimeSha256 -eq $runtimeSha256 -and
  $ArtifactCommit -match '^[a-f0-9]{40}$' -and $ArtifactCommit -eq $checkoutCommit
$artifactSourceVerified = $processIdentityVerified -and $hashStillMatches -and
  $ArtifactCommit -match '^[a-f0-9]{40}$' -and $ArtifactCommit -eq $checkoutCommit -and
  $ExpectedExecutableSha256 -match '^[a-f0-9]{64}$' -and $ExpectedExecutableSha256 -eq $executableSha256 -and $runtimeSourceVerified
if ($artifactSourceVerified) { $candidate = $ArtifactCommit.ToLowerInvariant() }

$pass = $artifactSourceVerified -and $allProcessesStayedAlive -and $responding -and $operatorStable -and -not $ObserveOnly
$payload = [ordered]@{
  protocol = "humanale-performance-stability/1"
  candidate = $candidate
  checkoutCommit = $checkoutCommit
  artifactSourceVerified = $artifactSourceVerified
  executablePath = $executablePath
  executableSha256 = $executableSha256
  runtimeSha256 = $runtimeSha256
  runtimeSourceVerified = $runtimeSourceVerified
  processIdentityVerified = $processIdentityVerified
  processIdentities = $processIdentities
  observeOnly = [bool]$ObserveOnly
  branch = $branch
  generatedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  durationSeconds = $DurationSeconds
  intervalSeconds = $IntervalSeconds
  logicalProcessors = $logicalCpu
  processIds = $ProcessId
  state = $(if ($pass) { "PERFORMANCE_STABILITY_PASS" } else { "PERFORMANCE_STABILITY_INCOMPLETE" })
  fullyValidated = $pass
  metrics = [ordered]@{
    avgCpuPercent = [math]::Round($avgCpu,2)
    peakCpuPercent = [math]::Round($peakCpu,2)
    avgWorkingSetMB = [math]::Round($avgRam,1)
    peakWorkingSetMB = [math]::Round($peakRam,1)
    workingSetDeltaMB = [math]::Round($ramDelta,1)
    allProcessesStayedAlive = $allProcessesStayedAlive
    responding = $responding
    operatorStable = $operatorStable
  }
  samples = $samples
}

$payload | ConvertTo-Json -Depth 10 | Set-Content -Encoding UTF8 $OutputPath
Write-Host "Hasil tersimpan: $OutputPath"
Write-Host $payload.state -ForegroundColor $(if($pass){'Green'}else{'Yellow'})
if ($pass) { exit 0 } else { exit 2 }
