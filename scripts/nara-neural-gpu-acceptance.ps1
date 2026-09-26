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
Write-Host " NARA Neural Space 3D - Physical GPU Acceptance" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "Repository: $Root"
$gitHead = $null
if (Get-Command git -ErrorAction SilentlyContinue) {
  try { $gitHead = (git rev-parse HEAD 2>$null).Trim() } catch {}
}
if ($gitHead) { Write-Host "Git HEAD   : $gitHead" }

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Fail "Node.js tidak ditemukan di PATH."
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Fail "npm tidak ditemukan di PATH."
}

$nodeVersion = node --version
$npmVersion = npm --version
Write-Host "Node: $nodeVersion"
Write-Host "npm : $npmVersion"

$electronPackage = Join-Path $Root 'node_modules\electron\package.json'
$threePackage = Join-Path $Root 'node_modules\three\package.json'
$electronExe = Join-Path $Root 'node_modules\electron\dist\electron.exe'

if (-not $SkipInstall -and ((-not (Test-Path $electronPackage)) -or (-not (Test-Path $threePackage)))) {
  Write-Host ""
  Write-Host "[1/5] Memasang dependency terkunci..." -ForegroundColor Yellow
  & npm ci
  if ($LASTEXITCODE -ne 0) { Fail "npm ci gagal." }
} else {
  Write-Host ""
  Write-Host "[1/4] Dependency tersedia." -ForegroundColor Green
}

if (-not (Test-Path $electronExe)) {
  Write-Host "[2/5] Menyiapkan binary Electron..." -ForegroundColor Yellow
  $installer = Join-Path $Root 'node_modules\.bin\install-electron.cmd'
  if (-not (Test-Path $installer)) { Fail "install-electron.cmd tidak ditemukan. Jalankan npm ci." }
  & $installer --no
  if ($LASTEXITCODE -ne 0) { Fail "Download/install binary Electron gagal." }
} else {
  Write-Host "[2/4] Binary Electron tersedia." -ForegroundColor Green
}

$artifactDir = Join-Path $Root 'artifacts'
New-Item -ItemType Directory -Force -Path $artifactDir | Out-Null

$env:NARA_GPU_MODE = 'hardware'
Write-Host "[3/5] Menjalankan browser acceptance dengan GPU hardware..." -ForegroundColor Yellow
& npm run smoke:neural-gpu
$smokeExit = $LASTEXITCODE

$reportPath = Join-Path $artifactDir 'nara-neural-live-report.json'
$screenshotPath = Join-Path $artifactDir 'nara-neural-live.png'

if (-not (Test-Path $reportPath)) {
  Fail "Report tidak dibuat. Exit code smoke: $smokeExit"
}

$report = Get-Content $reportPath -Raw -Encoding UTF8 | ConvertFrom-Json
Write-Host ""
Write-Host "[4/5] Hasil GPU + Neural acceptance" -ForegroundColor Cyan
Write-Host "Passed              : $($report.passed)"
Write-Host "GPU mode requested  : $($report.gpu.requestedMode)"
Write-Host "HW acceleration     : $($report.gpu.hardwareAcceleration)"
Write-Host "GPU mode matched    : $($report.gpu.modeMatched)"
Write-Host "WebGL               : $($report.webgl.version)"
Write-Host "Renderer            : $($report.webgl.renderer)"
Write-Host "FPS                  : $($report.hud.performance)"
Write-Host "Roots                : $($report.hud.roots)"
Write-Host "Routes               : $($report.hud.routes)"
Write-Host "Last route           : $($report.hud.lastRoute)"
Write-Host "Custom panel         : $($report.checks.customSettingsPanel)"
Write-Host "Brain/Binary default : $($report.checks.r4VisualDefaults)"
Write-Host "Guardian runtime     : $($report.checks.customSettingsRuntime)"
Write-Host "R5 audio controls    : $($report.checks.r5AudioControls)"
Write-Host "R5 audio profile     : $($report.checks.r5AudioProfileRuntime)"
Write-Host "Node voice narration : $($report.checks.nodeVoiceNarration)"
Write-Host "Report               : $reportPath"
Write-Host "Screenshot           : $screenshotPath"

$failed = @()
foreach ($property in $report.checks.PSObject.Properties) {
  if ($property.Value -ne $true) {
    $failed += $property.Name
  }
}

$requiredRevisionChecks = @(
  'customSettingsPanel',
  'r4VisualDefaults',
  'customSettingsRuntime',
  'customSettingsPersistence',
  'r5AudioControls',
  'r5AudioProfileRuntime',
  'nodeVoiceNarration',
  'mechanicalCoreRings',
  'galacticEnvironment'
)
$missingRevisionChecks = @()
foreach ($name in $requiredRevisionChecks) {
  $property = $report.checks.PSObject.Properties[$name]
  if ($null -eq $property -or $property.Value -ne $true) {
    $missingRevisionChecks += $name
  }
}

Write-Host ""
Write-Host "[5/5] Release-candidate revision gates" -ForegroundColor Cyan
if ($missingRevisionChecks.Count -eq 0) {
  Write-Host "R4/R5 gates          : PASS" -ForegroundColor Green
} else {
  Write-Host "R4/R5 gates          : FAIL -> $($missingRevisionChecks -join ', ')" -ForegroundColor Red
}

if ($smokeExit -ne 0 -or $report.passed -ne $true -or $report.gpu.modeMatched -ne $true -or $failed.Count -gt 0 -or $missingRevisionChecks.Count -gt 0) {
  if ($failed.Count -gt 0) {
    Write-Host "Failed checks        : $($failed -join ', ')" -ForegroundColor Red
  }
  Fail "Physical GPU acceptance belum lolos."
}

Write-Host ""
Write-Host "[PASS] NARA R5 release candidate lolos physical GPU + visual/audio acceptance." -ForegroundColor Green
exit 0
