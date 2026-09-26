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
  Write-Host "[1/4] Memasang dependency terkunci..." -ForegroundColor Yellow
  & npm ci
  if ($LASTEXITCODE -ne 0) { Fail "npm ci gagal." }
} else {
  Write-Host ""
  Write-Host "[1/4] Dependency tersedia." -ForegroundColor Green
}

if (-not (Test-Path $electronExe)) {
  Write-Host "[2/4] Menyiapkan binary Electron..." -ForegroundColor Yellow
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
Write-Host "[3/4] Menjalankan browser acceptance dengan GPU hardware..." -ForegroundColor Yellow
& npm run smoke:neural-gpu
$smokeExit = $LASTEXITCODE

$reportPath = Join-Path $artifactDir 'nara-neural-live-report.json'
$screenshotPath = Join-Path $artifactDir 'nara-neural-live.png'

if (-not (Test-Path $reportPath)) {
  Fail "Report tidak dibuat. Exit code smoke: $smokeExit"
}

$report = Get-Content $reportPath -Raw | ConvertFrom-Json
Write-Host ""
Write-Host "[4/4] Hasil acceptance" -ForegroundColor Cyan
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
Write-Host "Report               : $reportPath"
Write-Host "Screenshot           : $screenshotPath"

$failed = @()
foreach ($property in $report.checks.PSObject.Properties) {
  if ($property.Value -ne $true) {
    $failed += $property.Name
  }
}

if ($smokeExit -ne 0 -or $report.passed -ne $true -or $report.gpu.modeMatched -ne $true -or $failed.Count -gt 0) {
  if ($failed.Count -gt 0) {
    Write-Host "Failed checks        : $($failed -join ', ')" -ForegroundColor Red
  }
  Fail "Physical GPU acceptance belum lolos."
}

Write-Host ""
Write-Host "[PASS] NARA Neural Space 3D lolos physical GPU acceptance." -ForegroundColor Green
exit 0
