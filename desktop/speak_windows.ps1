param(
  [ValidateSet('status','synthesize')][string]$Mode = 'status',
  [string]$OutputPath
)

$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$speaker = $null
$nativeSpeaker = $null
$speechStream = $null
$readStream = $null
$fileStream = $null
try {
  $voice = $null
  $nativeVoice = $null
  try {
    Add-Type -AssemblyName System.Speech
    $speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer
    $voice = $speaker.GetInstalledVoices() | Where-Object {
      $_.Enabled -and $_.VoiceInfo.Culture.Name -eq 'id-ID' -and $_.VoiceInfo.Name -eq 'Microsoft Andika'
    } | Select-Object -First 1
  } catch {}
  # Windows PowerShell 5 SAPI can omit installed OneCore voices. WinRT exposes
  # those voices without changing registry entries or installing another runtime.
  if (-not $voice) {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $nativeVoice = [Windows.Media.SpeechSynthesis.SpeechSynthesizer,Windows.Media.SpeechSynthesis,ContentType=WindowsRuntime]::AllVoices | Where-Object {
      $_.Language -eq 'id-ID' -and $_.DisplayName -eq 'Microsoft Andika'
    } | Select-Object -First 1
  }
  if ($Mode -eq 'status') {
    [Console]::Out.WriteLine((@{configured = [bool]($voice -or $nativeVoice); engine = 'windows-andika'} | ConvertTo-Json -Compress))
    exit 0
  }
  if (-not $voice -and -not $nativeVoice) { throw 'Suara Windows Indonesia tidak tersedia.' }
  $text = [Console]::In.ReadToEnd().Trim()
  if ($text.Length -lt 1 -or $text.Length -gt 2000) { throw 'Teks suara harus berisi 1-2000 karakter.' }
  if (-not $OutputPath -or -not [System.IO.Path]::IsPathRooted($OutputPath)) { throw 'Tujuan WAV tidak valid.' }
  if ($voice) {
    $speaker.SelectVoice($voice.VoiceInfo.Name)
    $speaker.Rate = 0
    $speaker.SetOutputToWaveFile($OutputPath)
    $speaker.Speak($text)
    $speaker.SetOutputToNull()
  } else {
    $nativeSpeaker = New-Object Windows.Media.SpeechSynthesis.SpeechSynthesizer
    $nativeSpeaker.Voice = $nativeVoice
    $operation = $nativeSpeaker.SynthesizeTextToStreamAsync($text)
    $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
      $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetGenericArguments().Count -eq 1 -and
      $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
    } | Select-Object -First 1
    $streamType = [Windows.Media.SpeechSynthesis.SpeechSynthesisStream,Windows.Media.SpeechSynthesis,ContentType=WindowsRuntime]
    $task = $asTask.MakeGenericMethod($streamType).Invoke($null, @($operation))
    $task.Wait()
    $speechStream = $task.Result
    $readStream = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($speechStream)
    $fileStream = [System.IO.File]::Open($OutputPath, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write)
    $readStream.CopyTo($fileStream)
  }
} catch {
  [Console]::Error.WriteLine('Suara Windows Indonesia gagal disiapkan atau dibuat.')
  exit 1
} finally {
  if ($fileStream) { $fileStream.Dispose() }
  if ($readStream) { $readStream.Dispose() }
  if ($speechStream) { $speechStream.Dispose() }
  if ($nativeSpeaker) { $nativeSpeaker.Dispose() }
  if ($speaker) { $speaker.Dispose() }
}
