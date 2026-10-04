param(
 [Parameter(Mandatory=$true)][string]$Executable,
 [Parameter(Mandatory=$true)][string]$ManagerPath
)
$ErrorActionPreference = 'Stop'
$exe = (Resolve-Path -LiteralPath $Executable).Path
$manager = (Resolve-Path -LiteralPath $ManagerPath).Path
$script = Join-Path $PSScriptRoot 'terminal-smoke.mjs'
$logRoot = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [IO.Path]::GetTempPath() }
$prefix = Join-Path $logRoot ('humanale-packaged-pty-' + [guid]::NewGuid().ToString('N'))
$stdout = $prefix + '.stdout.log'
$stderr = $prefix + '.stderr.log'
$previousMode = $env:ELECTRON_RUN_AS_NODE
$smoke = $null
try {
 $env:ELECTRON_RUN_AS_NODE = '1'
 $arguments = '"{0}" --manager-path "{1}"' -f $script, $manager
 $smoke = Start-Process -FilePath $exe -ArgumentList $arguments -WorkingDirectory (Get-Location).Path -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
 # Start-Process -Wait waits descendants too; use the owned executable's handle.
 if (-not $smoke.WaitForExit(40000)) { throw 'Packaged terminal smoke exceeded 40 seconds.' }
 $smoke.Refresh()
 if ($smoke.ExitCode -ne 0) { throw "Packaged terminal smoke exited with code $($smoke.ExitCode)." }
 # The executable has exited; allow only a bounded redirect-writer flush.
 $flushWait = [Diagnostics.Stopwatch]::StartNew()
 do {
  $output = Get-Content -LiteralPath $stdout -Raw
  if ($output -match '(?m)^HumanALE god egine terminal PTY smoke passed:') { break }
  Start-Sleep -Milliseconds 100
 } while ($flushWait.ElapsedMilliseconds -lt 2000)
 if ($output -notmatch '(?m)^HumanALE god egine terminal PTY smoke passed:') { throw 'Packaged terminal success marker is missing.' }
 Write-Host $output.Trim()
 Write-Host '::notice title=Packaged Windows PTY::Interactive CMD and restarted process cleanup passed.'
} catch {
 $failure = $_.Exception.Message
 if ($smoke -and -not $smoke.HasExited) {
  try { $smoke.Kill($true); $null = $smoke.WaitForExit(5000) } catch { Write-Warning 'Owned smoke process cleanup failed.' }
 }
 $details = @($stdout, $stderr) | ForEach-Object { if (Test-Path -LiteralPath $_) { Get-Content -LiteralPath $_ -Tail 40 } }
 $diagnostic = ($failure + "`n" + ($details -join "`n"))
 if ($diagnostic.Length -gt 6000) { $diagnostic = $diagnostic.Substring(0,6000) }
 $diagnostic = $diagnostic.Replace('%','%25').Replace("`r",'%0D').Replace("`n",'%0A')
 Write-Host "::error title=Packaged Windows PTY failed::$diagnostic"
 throw
} finally {
 $env:ELECTRON_RUN_AS_NODE = $previousMode
 if ($smoke) { $smoke.Dispose() }
}
