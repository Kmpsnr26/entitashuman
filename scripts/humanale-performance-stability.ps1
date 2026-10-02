param(
  [int[]]$ProcessId,
  [int]$DurationSeconds = 60,
  [int]$IntervalSeconds = 5,
  [string]$OutputPath = "$PSScriptRoot\humanale-performance-stability-result.json"
)

$ErrorActionPreference = "Stop"

if ($DurationSeconds -lt 30) { throw "DurationSeconds minimal 30 detik." }
if ($IntervalSeconds -lt 1 -or $IntervalSeconds -gt 10) { throw "IntervalSeconds harus 1..10 detik." }

$repoRoot = Split-Path -Parent $PSScriptRoot
$candidate = "unknown"
$branch = "unknown"
try {
  $candidate = (& git -C $repoRoot rev-parse HEAD 2>$null).Trim()
  $branch = (& git -C $repoRoot branch --show-current 2>$null).Trim()
} catch {}

function Get-HumanALECandidates {
  Get-Process -ErrorAction SilentlyContinue |
    Where-Object { $_.ProcessName -match 'HumanALE|electron' } |
    Select-Object Id, ProcessName, @{n='WorkingSetMB';e={[math]::Round($_.WorkingSet64/1MB,1)}}, MainWindowTitle
}

if (-not $ProcessId -or $ProcessId.Count -eq 0) {
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
$logicalCpu = [Environment]::ProcessorCount
$sampleCount = [math]::Ceiling($DurationSeconds / $IntervalSeconds)
$samples = @()
$disappeared = @{}

Write-Host ""
Write-Host "Mengukur HumanALE selama $DurationSeconds detik ($sampleCount sample)..." -ForegroundColor Cyan
Write-Host "Biarkan HumanALE idle; jangan menjalankan workload/test lain selama pengukuran."

$previousCpu = @{}
$previousAt = Get-Date

foreach ($pidValue in $ProcessId) {
  $p = Get-Process -Id $pidValue -ErrorAction SilentlyContinue
  if (-not $p) { throw "PID $pidValue tidak ditemukan sebelum pengukuran." }
  $previousCpu[$pidValue] = [double]$p.CPU
}

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

$operator = (Read-Host "Selama 60 detik apakah HumanALE tetap stabil, responsif, tanpa crash/error/flicker berulang? [Y/N]").Trim().ToUpperInvariant()
$operatorStable = $operator -eq "Y"

$pass = $allProcessesStayedAlive -and $responding -and $operatorStable
$payload = [ordered]@{
  protocol = "humanale-performance-stability/1"
  candidate = $candidate
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
