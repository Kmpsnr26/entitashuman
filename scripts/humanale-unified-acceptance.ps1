param(
  [switch]$SkipInstall
)

$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

function Fail([string]$Message) {
  Write-Host ""
  Write-Host "[FAIL] $Message" -ForegroundColor Red
  exit 1
}

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " NARA + HumanALE V3 Unified Physical Acceptance" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "Repository: $Root"

$gitHead = $null
if (Get-Command git -ErrorAction SilentlyContinue) {
  try { $gitHead = (git rev-parse HEAD 2>$null).Trim() } catch {}
}
if ($gitHead) { Write-Host "Git HEAD   : $gitHead" }

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Fail "Node.js tidak ditemukan di PATH." }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { Fail "npm tidak ditemukan di PATH." }

$electronPackage = Join-Path $Root 'node_modules\electron\package.json'
$electronExe = Join-Path $Root 'node_modules\electron\dist\electron.exe'
if (-not $SkipInstall -and -not (Test-Path $electronPackage)) {
  Write-Host ""
  Write-Host "[1/6] Memasang dependency terkunci..." -ForegroundColor Yellow
  & npm ci
  if ($LASTEXITCODE -ne 0) { Fail "npm ci gagal." }
} else {
  Write-Host ""
  Write-Host "[1/6] Dependency tersedia." -ForegroundColor Green
}

if (-not (Test-Path $electronExe)) {
  Write-Host "[2/6] Menyiapkan binary Electron..." -ForegroundColor Yellow
  $installer = Join-Path $Root 'node_modules\.bin\install-electron.cmd'
  if (-not (Test-Path $installer)) { Fail "install-electron.cmd tidak ditemukan. Jalankan npm ci." }
  & $installer --no
  if ($LASTEXITCODE -ne 0) { Fail "Download/install binary Electron gagal." }
} else {
  Write-Host "[2/6] Binary Electron tersedia." -ForegroundColor Green
}

$artifactDir = Join-Path $Root 'artifacts'
New-Item -ItemType Directory -Force -Path $artifactDir | Out-Null
$desktopShot = Join-Path $artifactDir 'humanale-unified.png'
$reportPath = Join-Path $artifactDir 'humanale-unified-acceptance.json'
$neuralReportPath = Join-Path $artifactDir 'nara-neural-live-report.json'

Write-Host "[3/6] Menjalankan HumanALE desktop unified runtime smoke..." -ForegroundColor Yellow
$env:DUDIDAM_CAPTURE_SMOKE = $desktopShot
& $electronExe (Join-Path $Root 'desktop\main.cjs') --ci-smoke
$desktopExit = $LASTEXITCODE
Remove-Item Env:DUDIDAM_CAPTURE_SMOKE -ErrorAction SilentlyContinue

$desktopPassed = $desktopExit -eq 0
if ($desktopPassed) {
  Write-Host "Desktop unified runtime : PASS" -ForegroundColor Green
} else {
  Write-Host "Desktop unified runtime : FAIL ($desktopExit)" -ForegroundColor Red
}

Write-Host "[4/6] Menjalankan NARA Neural physical GPU acceptance..." -ForegroundColor Yellow
$gpuScript = Join-Path $PSScriptRoot 'nara-neural-gpu-acceptance.ps1'
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $gpuScript -SkipInstall
$gpuExit = $LASTEXITCODE
$gpuPassed = $gpuExit -eq 0

$neuralReport = $null
if (Test-Path $neuralReportPath) {
  try { $neuralReport = Get-Content $neuralReportPath -Raw -Encoding UTF8 | ConvertFrom-Json } catch {}
}

Write-Host ""
Write-Host "[5/6] Unified result" -ForegroundColor Cyan
Write-Host "Desktop Runtime Host   : $desktopPassed"
Write-Host "Creator Gate smoke     : $desktopPassed"
Write-Host "NARA Core V2/V3 bridge : $desktopPassed"
Write-Host "Renderer sensory gate  : $desktopPassed"
Write-Host "Physical GPU gate      : $gpuPassed"
if ($neuralReport) {
  Write-Host "GPU mode matched       : $($neuralReport.gpu.modeMatched)"
  Write-Host "Renderer               : $($neuralReport.webgl.renderer)"
  Write-Host "Performance            : $($neuralReport.hud.performance)"
}

$passed = $desktopPassed -and $gpuPassed -and (
  $null -eq $neuralReport -or (
    $neuralReport.passed -eq $true -and
    $neuralReport.gpu.modeMatched -eq $true
  )
)

$report = [ordered]@{
  version = 1
  completedAt = (Get-Date).ToUniversalTime().ToString('o')
  gitHead = $gitHead
  passed = $passed
  desktop = [ordered]@{
    passed = $desktopPassed
    exitCode = $desktopExit
    screenshot = $desktopShot
    checks = @(
      'creator-owner-gate'
      'unified-runtime-v3'
      'nara-core-identity'
      'humanale-body-state'
      'sensory-dispatch'
      'renderer-event-deny'
      'detached-panel'
    )
  }
  neural = [ordered]@{
    passed = $gpuPassed
    exitCode = $gpuExit
    report = $neuralReportPath
    gpuModeMatched = if ($neuralReport) { $neuralReport.gpu.modeMatched } else { $null }
    renderer = if ($neuralReport) { $neuralReport.webgl.renderer } else { $null }
    performance = if ($neuralReport) { $neuralReport.hud.performance } else { $null }
  }
}
$report | ConvertTo-Json -Depth 8 | Set-Content -Path $reportPath -Encoding UTF8

Write-Host "Report                 : $reportPath"
Write-Host "Desktop screenshot     : $desktopShot"
Write-Host "Neural report          : $neuralReportPath"

Write-Host ""
Write-Host "[6/6] Release gate" -ForegroundColor Cyan
if (-not $passed) {
  Fail "NARA + HumanALE V3 unified acceptance belum lolos."
}

Write-Host "[PASS] NARA Core + HumanALE Unified Runtime V3 lolos physical acceptance." -ForegroundColor Green
exit 0
