param(
  [string]$InstallerPath,
  [string]$ApkPath,
  [string]$OutputPath = "$PSScriptRoot\humanale-release-security-result.json"
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$candidate = "unknown"
$branch = "unknown"
try {
  $candidate = (& git -C $repoRoot rev-parse HEAD 2>$null).Trim()
  $branch = (& git -C $repoRoot branch --show-current 2>$null).Trim()
} catch {}

$windowsSignature = "missing-artifact"
$windowsSigner = ""
if($InstallerPath -and (Test-Path $InstallerPath)){
  $sig = Get-AuthenticodeSignature -FilePath $InstallerPath
  $windowsSignature = [string]$sig.Status
  if($sig.SignerCertificate){$windowsSigner=$sig.SignerCertificate.Subject}
}

$androidSignature = "missing-artifact"
$androidVerifier = ""
if($ApkPath -and (Test-Path $ApkPath)){
  $apksigner = Get-Command apksigner -ErrorAction SilentlyContinue
  if($apksigner){
    $verify = (& apksigner verify --verbose --print-certs $ApkPath 2>&1) -join " "
    $androidVerifier = $verify
    $androidSignature = $(if($LASTEXITCODE -eq 0){"verified"}else{"invalid"})
  } else {
    $androidSignature = "apksigner-unavailable"
  }
}

$windowsPass = $windowsSignature -eq "Valid"
$androidPass = $androidSignature -eq "verified"
$pass = $windowsPass -and $androidPass
$payload=[ordered]@{
  protocol="humanale-release-security/1"
  candidate=$candidate
  branch=$branch
  generatedAt=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  windows=[ordered]@{installerPath=$InstallerPath;signatureStatus=$windowsSignature;signer=$windowsSigner;pass=$windowsPass}
  android=[ordered]@{apkPath=$ApkPath;signatureStatus=$androidSignature;verifier=$androidVerifier;pass=$androidPass}
  state=$(if($pass){"RELEASE_SECURITY_PASS"}else{"RELEASE_SECURITY_INCOMPLETE"})
  fullyValidated=$pass
}
$payload|ConvertTo-Json -Depth 8|Set-Content -Encoding UTF8 $OutputPath
Write-Host "Windows Authenticode: $windowsSignature"
Write-Host "Android signature: $androidSignature"
Write-Host "Hasil tersimpan: $OutputPath"
Write-Host $payload.state -ForegroundColor $(if($pass){"Green"}else{"Yellow"})
if($pass){exit 0}else{exit 2}