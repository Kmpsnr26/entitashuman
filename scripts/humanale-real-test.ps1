param(
  [string]$OutputPath = "$PSScriptRoot\humanale-real-test-result.json"
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$candidate = "unknown"
$branch = "unknown"
try {
  $candidate = (& git -C $repoRoot rev-parse HEAD 2>$null).Trim()
  $branch = (& git -C $repoRoot branch --show-current 2>$null).Trim()
} catch {
  # Keep fail-safe metadata values when Git is unavailable.
}

$checks = @(
  @{ id="visual-motion"; label="Blink, gaze, lips, ears, neural/core motion" },
  @{ id="voice-id"; label="Microphone + STT/TTS Indonesia + Wake ALE" },
  @{ id="display-scaling"; label="Windows scaling 100% / 125% / 150%" },
  @{ id="panel-interaction"; label="Click-through + detached panel" },
  @{ id="desktop-install"; label="Installer/portable pada PC target" }
)

function Read-Status([string]$label) {
  while ($true) {
    Write-Host ""
    Write-Host "CHECK: $label" -ForegroundColor Cyan
    Write-Host "[P] PASS   [F] FAIL   [B] BLOCKED   [S] SKIP/PENDING"
    $answer = (Read-Host "Pilih status").Trim().ToUpperInvariant()
    switch ($answer) {
      "P" { return "pass" }
      "F" { return "fail" }
      "B" { return "blocked" }
      "S" { return "pending" }
      default { Write-Host "Input tidak valid. Ketik satu huruf saja: P, F, B, atau S." -ForegroundColor Yellow }
    }
  }
}

Write-Host "HumanALE Visual Studio - REAL DEVICE TEST RUNNER" -ForegroundColor Green
Write-Host "Candidate: $candidate"`nWrite-Host "Branch: $branch"
Write-Host "Catatan: runner ini hanya mencatat bukti operator. Ia tidak mengubah Nara Core atau membuka integrasi final."

$results = @{}
foreach ($check in $checks) {
  $status = Read-Status $check.label
  $note = Read-Host "Catatan singkat (opsional)"
  $results[$check.id] = @{
    status = $status
    source = "operator-windows-real-test"
    note = $note
    timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  }
}

$allPass = $true
foreach ($check in $checks) {
  if ($results[$check.id].status -ne "pass") { $allPass = $false }
}

$payload = @{
  protocol = "humanale-visual-real-test/1"
  candidate = $candidate`n  branch = $branch
  generatedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  fullyValidated = $allPass
  state = $(if ($allPass) { "REAL_TEST_PASS" } else { "REAL_TEST_INCOMPLETE" })
  evidence = $results
}

$payload | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 $OutputPath

Write-Host ""
Write-Host "Hasil tersimpan: $OutputPath"
if ($allPass) {
  Write-Host "REAL_TEST_PASS - seluruh pemeriksaan perangkat nyata PASS." -ForegroundColor Green
  exit 0
} else {
  Write-Host "REAL_TEST_INCOMPLETE - masih ada FAIL/BLOCKED/PENDING." -ForegroundColor Yellow
  exit 2
}
