[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$InstallerPath,
    [Parameter(Mandatory = $true)]
    [string]$InstallRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$installer = (Resolve-Path -LiteralPath $InstallerPath -ErrorAction Stop).Path
$runnerTemp = [IO.Path]::GetFullPath($env:RUNNER_TEMP)
$target = [IO.Path]::GetFullPath($InstallRoot)
$tempPrefix = $runnerTemp.TrimEnd([char[]]@([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)) + [IO.Path]::DirectorySeparatorChar

if (-not $target.StartsWith($tempPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'InstallRoot must be a child of RUNNER_TEMP. Refusing to install or clean another directory.'
}
if (Test-Path -LiteralPath $target) {
    throw "InstallRoot already exists; refusing to overwrite it: $target"
}

$previousElectronRunAsNode = [Environment]::GetEnvironmentVariable('ELECTRON_RUN_AS_NODE', 'Process')
$installerInstalled = $false
$failure = $null

function Invoke-OwnedProcess {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [string[]]$ArgumentList = @(),
        [int]$TimeoutMs = 90000,
        [string]$Label = 'process'
    )

    $process = Start-Process -FilePath $FilePath -ArgumentList $ArgumentList -PassThru -WindowStyle Hidden
    try {
        if (-not $process.WaitForExit($TimeoutMs)) {
            try { $process.Kill($true) } catch {}
            throw "$Label exceeded its timeout ($TimeoutMs ms)."
        }
        $process.Refresh()
        if ($process.ExitCode -ne 0) {
            throw "$Label exited with code $($process.ExitCode)."
        }
        return $process.ExitCode
    } finally {
        $process.Dispose()
    }
}

try {
    New-Item -ItemType Directory -Path $target -Force | Out-Null

    Write-Host "Installing NSIS package to isolated path: $target"
    Invoke-OwnedProcess -FilePath $installer -ArgumentList @('/S', "/D=$target") -TimeoutMs 180000 -Label 'NSIS silent installation'
    $installerInstalled = $true

    $application = Get-ChildItem -LiteralPath $target -Filter '*.exe' -File |
        Where-Object { $_.Name -notmatch '^(?i:uninstall)' } |
        Select-Object -First 1
    if (-not $application) {
        throw "Installed application executable was not found in $target."
    }

    $manager = Join-Path $target 'resources\app\desktop\terminal-manager.mjs'
    if (-not (Test-Path -LiteralPath $manager -PathType Leaf)) {
        throw "Installed terminal manager is missing: $manager"
    }

    Write-Host "Smoke terminal using installed executable: $($application.FullName)"
    $env:ELECTRON_RUN_AS_NODE = '1'
    & (Join-Path $PSScriptRoot 'terminal-package-smoke.ps1') -Executable $application.FullName -ManagerPath $manager

    if ($null -eq $previousElectronRunAsNode) {
        Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
    } else {
        $env:ELECTRON_RUN_AS_NODE = $previousElectronRunAsNode
    }

    Write-Host 'Smoke full packaged application from installed location.'
    Invoke-OwnedProcess -FilePath $application.FullName -ArgumentList @('--ci-smoke') -TimeoutMs 120000 -Label 'Installed desktop --ci-smoke'

    Write-Host 'Installed NSIS application smoke passed.'
} catch {
    $failure = $_
} finally {
    if ($null -eq $previousElectronRunAsNode) {
        Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
    } else {
        $env:ELECTRON_RUN_AS_NODE = $previousElectronRunAsNode
    }

    $uninstallFailure = $null
    if ($installerInstalled) {
        $uninstaller = Get-ChildItem -LiteralPath $target -Filter 'Uninstall*.exe' -File -ErrorAction SilentlyContinue |
            Select-Object -First 1
        if (-not $uninstaller) {
            $uninstallFailure = [InvalidOperationException]::new('NSIS uninstaller was not found in the temporary install directory.')
        } else {
            try {
                Write-Host 'Uninstalling isolated NSIS test installation.'
                Invoke-OwnedProcess -FilePath $uninstaller.FullName -ArgumentList @('/S') -TimeoutMs 90000 -Label 'NSIS silent uninstall'
            } catch {
                $uninstallFailure = $_
            }
        }
    }

    if (Test-Path -LiteralPath $target) {
        Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction SilentlyContinue
    }
}

if ($null -ne $failure) {
    throw $failure
}
if ($null -ne $uninstallFailure) {
    throw $uninstallFailure
}
