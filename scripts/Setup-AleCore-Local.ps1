[CmdletBinding()]
param(
    [ValidatePattern('^[A-Za-z0-9._:/-]{1,160}$')]
    [string]$Model = 'qwen3.5:2b',
    [string]$ModelsDirectory = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Stop-WithGuidance([string]$Message) {
    Write-Host ""
    Write-Host $Message -ForegroundColor Yellow
    exit 2
}

$ollamaCommand = Get-Command 'ollama' -ErrorAction SilentlyContinue
if (-not $ollamaCommand) {
    Stop-WithGuidance "Ollama belum terpasang. Pasang aplikasi resmi dari https://ollama.com/download/windows, buka Ollama sekali, lalu jalankan skrip ini kembali."
}

$userModels = [Environment]::GetEnvironmentVariable('OLLAMA_MODELS', 'User')
$effectiveModels = if (-not [string]::IsNullOrWhiteSpace($ModelsDirectory)) {
    [IO.Path]::GetFullPath($ModelsDirectory)
} elseif (-not [string]::IsNullOrWhiteSpace($userModels)) {
    $userModels
} elseif (Test-Path 'D:\') {
    'D:\AleCoreAI\Models'
} else {
    Join-Path $env:USERPROFILE '.ollama\models'
}

New-Item -ItemType Directory -Force -Path $effectiveModels | Out-Null

if ([string]::IsNullOrWhiteSpace($userModels) -or
    [IO.Path]::GetFullPath($userModels) -ne [IO.Path]::GetFullPath($effectiveModels)) {
    [Environment]::SetEnvironmentVariable('OLLAMA_MODELS', $effectiveModels, 'User')
    Write-Host "Folder model disiapkan: $effectiveModels"
    Write-Host "OLLAMA_MODELS disimpan sebagai environment variable untuk akun Windows ini."
    Write-Host "Sekarang keluar dari Ollama melalui ikon system tray, buka Ollama kembali, lalu jalankan skrip ini sekali lagi."
    exit 2
}

$env:OLLAMA_MODELS = $effectiveModels
Write-Host "Folder model: $effectiveModels"

try {
    $tags = Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/tags' -Method Get -TimeoutSec 4
} catch {
    Stop-WithGuidance "Ollama belum merespons di 127.0.0.1:11434. Pastikan aplikasi Ollama sedang berjalan, kemudian jalankan skrip ini kembali."
}

$installed = @($tags.models | Where-Object {
    $_.name -eq $Model -or $_.model -eq $Model
})
if ($installed.Count -eq 0) {
    Write-Host "Mengunduh model $Model. Ukuran unduhan beberapa GB; jangan tutup PowerShell sampai selesai."
    & $ollamaCommand.Source pull $Model
    if ($LASTEXITCODE -ne 0) {
        Stop-WithGuidance "Pengunduhan model gagal. Periksa koneksi internet dan ruang penyimpanan, lalu jalankan skrip ini kembali."
    }
} else {
    Write-Host "Model $Model sudah tersedia. Tidak perlu mengunduh ulang."
}

try {
    $verified = Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/tags' -Method Get -TimeoutSec 4
} catch {
    Stop-WithGuidance "Ollama tidak dapat diperiksa setelah proses model. Buka kembali Ollama dan jalankan skrip ini lagi."
}
$verifiedModel = @($verified.models | Where-Object {
    $_.name -eq $Model -or $_.model -eq $Model
})
if ($verifiedModel.Count -eq 0) {
    Stop-WithGuidance "Ollama selesai, tetapi model $Model belum muncul pada daftar model. Periksa output unduhan."
}

Write-Host ""
Write-Host "AleCore Local siap digunakan." -ForegroundColor Green
Write-Host "Model : $Model"
Write-Host "API   : http://127.0.0.1:11434"
Write-Host "Pilih AleCore Local pada pengaturan percakapan AleCore AI, lalu tekan Periksa lagi."
