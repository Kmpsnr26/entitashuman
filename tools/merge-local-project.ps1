param(
  [Parameter(Mandatory=$false)]
  [string]$SourcePath = (Get-Location).Path,
  [string]$WorkPath
)

$ErrorActionPreference = 'Stop'
$Repo = 'https://github.com/Kmpsnr26/entitashuman.git'
$Branch = 'integrate/local-20260920'

$SourcePath = (Resolve-Path $SourcePath).Path
if (-not $WorkPath) {
  $WorkPath = Join-Path (Split-Path $SourcePath -Parent) 'entitashuman-github-merge'
}

Write-Host "Source : $SourcePath"
Write-Host "Target : $WorkPath"
Write-Host "Branch : $Branch"

if ($SourcePath -eq $WorkPath) {
  throw 'SourcePath dan WorkPath tidak boleh sama.'
}

if (Test-Path (Join-Path $WorkPath '.git')) {
  Push-Location $WorkPath
  git fetch origin
  git checkout $Branch
  git reset --hard "origin/$Branch"
  Pop-Location
} elseif (Test-Path $WorkPath) {
  throw "Folder target sudah ada tetapi bukan checkout Git: $WorkPath"
} else {
  git clone --branch $Branch --single-branch $Repo $WorkPath
}

$excludeDirs = @(
  '.git','node_modules','Dudidam-Desktop','dist','build','.cache','coverage'
)
$excludeFiles = @(
  '.env','.env.local','.env.production','.env.development',
  '*.pem','*.p12','*.pfx','*.key'
)

$roboArgs = @($SourcePath,$WorkPath,'/E','/COPY:DAT','/DCOPY:DAT','/R:2','/W:1','/NFL','/NDL','/NP')
foreach ($dir in $excludeDirs) { $roboArgs += @('/XD',(Join-Path $SourcePath $dir)) }
$roboArgs += '/XF'
$roboArgs += $excludeFiles

& robocopy @roboArgs
$roboCode = $LASTEXITCODE
if ($roboCode -ge 8) {
  throw "Robocopy gagal dengan exit code $roboCode"
}

Push-Location $WorkPath
try {
  git status --short
  git diff --check

  git add -A

  $staged = git diff --cached --name-only
  if (-not $staged) {
    Write-Host 'Tidak ada perubahan lokal yang perlu digabung.'
    exit 0
  }

  $secretPatterns = @(
    'sk-[A-Za-z0-9_-]{20,}',
    'gh[pousr]_[A-Za-z0-9]{20,}',
    'AIza[0-9A-Za-z_-]{20,}',
    '-----BEGIN (RSA |EC |OPENSSH |)?PRIVATE KEY-----'
  )

  $suspect = @()
  foreach ($file in $staged) {
    if (-not (Test-Path $file -PathType Leaf)) { continue }
    try {
      $content = Get-Content -Raw -LiteralPath $file -ErrorAction Stop
      foreach ($pattern in $secretPatterns) {
        if ($content -match $pattern) {
          $suspect += "$file :: $pattern"
        }
      }
    } catch {}
  }

  if ($suspect.Count -gt 0) {
    git reset
    Write-Host 'Push dibatalkan karena pola secret terdeteksi:' -ForegroundColor Red
    $suspect | ForEach-Object { Write-Host " - $_" -ForegroundColor Red }
    throw 'Hapus credential dari proyek lokal lalu jalankan ulang.'
  }

  if (Test-Path 'package.json') {
    if (Test-Path 'package-lock.json') {
      npm ci
    } else {
      npm install
    }
    npm test
    if ($LASTEXITCODE -ne 0) { throw 'npm test gagal; commit dibatalkan.' }
  }

  git diff --cached --check
  git commit -m 'Integrate local project 2026-09-20'
  git push origin $Branch

  Write-Host ''
  Write-Host 'Selesai: proyek lokal sudah dipush ke branch integrasi.' -ForegroundColor Green
  Write-Host "Branch: $Branch"
} finally {
  Pop-Location
}
