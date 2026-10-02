param(
  [string]$InstallerPath,
  [string]$ApkPath,
  [string]$ArtifactCommit,
  [string]$ExpectedInstallerSha256,
  [string]$ExpectedApkSha256,
  [string]$AndroidReleaseCertSha256,
  [string]$OutputPath = "$PSScriptRoot\humanale-release-security-result.json"
)

$ErrorActionPreference = "Stop"
if (Test-Path -LiteralPath $OutputPath) {
  Remove-Item -LiteralPath $OutputPath -Force -ErrorAction Stop
}
if (-not (Get-Command Get-FileHash -ErrorAction SilentlyContinue)) {
  Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Utility') -ErrorAction Stop
}
$repoRoot = Split-Path -Parent $PSScriptRoot
$candidate = "unknown"
$checkoutCommit = "unknown"
$branch = "unknown"
try {
  $checkoutCommit = (& git -C $repoRoot rev-parse HEAD 2>$null).Trim()
  $branch = (& git -C $repoRoot branch --show-current 2>$null).Trim()
} catch {}

$windowsSignature = "missing-artifact"
$windowsSigner = ""
$installerSha256 = ""
if($InstallerPath -and (Test-Path -LiteralPath $InstallerPath -PathType Leaf)){
  $InstallerPath = (Resolve-Path -LiteralPath $InstallerPath).Path
  $installerSha256 = (Get-FileHash -LiteralPath $InstallerPath -Algorithm SHA256).Hash.ToLowerInvariant()
  $sig = Get-AuthenticodeSignature -FilePath $InstallerPath
  $windowsSignature = [string]$sig.Status
  if($sig.SignerCertificate){$windowsSigner=$sig.SignerCertificate.Subject}
}

$androidSignature = "missing-artifact"
$androidVerifier = ""
$apkSha256 = ""
$androidSignerSha256 = ""
$productionSignerMatched = $false
if($ApkPath -and (Test-Path -LiteralPath $ApkPath -PathType Leaf)){
  $ApkPath = (Resolve-Path -LiteralPath $ApkPath).Path
  $apkSha256 = (Get-FileHash -LiteralPath $ApkPath -Algorithm SHA256).Hash.ToLowerInvariant()
  $apksigner = Get-Command apksigner -ErrorAction SilentlyContinue
  if($apksigner){
    $verify = (& apksigner verify --verbose --print-certs $ApkPath 2>&1) -join "`n"
    $androidVerifier = $verify
    $androidSignature = $(if($LASTEXITCODE -eq 0){"verified"}else{"invalid"})
    $certificateDigests = [regex]::Matches($verify, '(?im)^Signer #(\d+) certificate SHA-256 digest:\s*([a-f0-9]{64})\s*$')
    $certificateNames = [regex]::Matches($verify, '(?im)^Signer #(\d+) certificate DN:[^\r\n]+$')
    if ($certificateDigests.Count -eq 1 -and $certificateNames.Count -eq 1 -and
        $certificateDigests[0].Groups[1].Value -eq '1' -and $certificateNames[0].Groups[1].Value -eq '1') {
      $androidSignerSha256 = $certificateDigests[0].Groups[2].Value.ToLowerInvariant()
      $productionSignerMatched = $androidSignature -eq 'verified' -and
        $AndroidReleaseCertSha256 -match '^[a-f0-9]{64}$' -and
        $androidSignerSha256 -eq $AndroidReleaseCertSha256 -and
        $verify -notmatch '(?im)^Signer #\d+ certificate DN:.*\bAndroid Debug\b'
    }
  } else {
    $androidSignature = "apksigner-unavailable"
  }
}

$installerHashMatched = $ExpectedInstallerSha256 -match '^[a-f0-9]{64}$' -and $installerSha256 -eq $ExpectedInstallerSha256
$apkHashMatched = $ExpectedApkSha256 -match '^[a-f0-9]{64}$' -and $apkSha256 -eq $ExpectedApkSha256
# Expected source/hash values must come from an independently trusted build record.
# Reading HEAD or hashing an arbitrary artifact cannot establish its build provenance.
$sourceVerified = $ArtifactCommit -match '^[a-f0-9]{40}$' -and
  $checkoutCommit -match '^[a-f0-9]{40}$' -and $ArtifactCommit -eq $checkoutCommit -and
  $installerHashMatched -and $apkHashMatched
if ($sourceVerified) { $candidate = $ArtifactCommit.ToLowerInvariant() }
$windowsPass = $sourceVerified -and $windowsSignature -eq "Valid"
$androidPass = $sourceVerified -and $androidSignature -eq "verified" -and $productionSignerMatched
$pass = $windowsPass -and $androidPass
$payload=[ordered]@{
  protocol="humanale-release-security/1"
  candidate=$candidate
  checkoutCommit=$checkoutCommit
  artifactSourceVerified=$sourceVerified
  branch=$branch
  generatedAt=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  windows=[ordered]@{installerPath=$InstallerPath;installerSha256=$installerSha256;expectedSha256=$ExpectedInstallerSha256;hashMatched=$installerHashMatched;signatureStatus=$windowsSignature;signer=$windowsSigner;pass=$windowsPass}
  android=[ordered]@{apkPath=$ApkPath;apkSha256=$apkSha256;expectedSha256=$ExpectedApkSha256;hashMatched=$apkHashMatched;signatureStatus=$androidSignature;signerCertificateSha256=$androidSignerSha256;productionSignerMatched=$productionSignerMatched;verifier=$androidVerifier;pass=$androidPass}
  state=$(if($pass){"RELEASE_SECURITY_PASS"}else{"RELEASE_SECURITY_INCOMPLETE"})
  fullyValidated=$pass
}
$payload|ConvertTo-Json -Depth 8|Set-Content -Encoding UTF8 $OutputPath
Write-Host "Windows Authenticode: $windowsSignature"
Write-Host "Android signature: $androidSignature"
Write-Host "Hasil tersimpan: $OutputPath"
Write-Host $payload.state -ForegroundColor $(if($pass){"Green"}else{"Yellow"})
if($pass){exit 0}else{exit 2}
