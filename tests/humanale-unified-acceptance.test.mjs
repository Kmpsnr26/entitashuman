import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

const root=new URL('../',import.meta.url);
const read=path=>readFile(new URL(path,root),'utf8');

test('V3.6 one-click wrapper runs HumanALE unified smoke and physical NARA GPU acceptance',async()=>{
  const [bat,ps1]=await Promise.all([
    read('HumanALE-Unified-Acceptance.bat'),
    read('scripts/humanale-unified-acceptance.ps1')
  ]);

  assert.match(bat,/NARA \+ HumanALE V3 - Unified Physical Acceptance/);
  assert.match(bat,/scripts\\humanale-unified-acceptance\.ps1/);
  assert.match(ps1,/desktop\\main\.cjs/);
  assert.match(ps1,/--ci-smoke/);
  assert.match(ps1,/DUDIDAM_CAPTURE_SMOKE/);
  assert.match(ps1,/nara-neural-gpu-acceptance\.ps1/);
  assert.match(ps1,/NARA Core \+ HumanALE Unified Runtime V3 lolos physical acceptance/);
});

test('V3.6 acceptance produces bounded evidence without embedding Creator credentials',async()=>{
  const ps1=await read('scripts/humanale-unified-acceptance.ps1');
  for(const marker of [
    'humanale-unified-acceptance.json',
    'humanale-unified.png',
    'nara-neural-live-report.json',
    'creator-owner-gate',
    'unified-runtime-v3',
    'renderer-event-deny'
  ])assert.equal(ps1.includes(marker),true,marker+' missing');

  assert.doesNotMatch(ps1,/NARA_CREATOR_PASSWORD|password\s*=|access[_-]?token|api[_-]?key/i);
  assert.match(ps1,/\$passed = \$desktopPassed -and \$gpuPassed/);
  assert.match(ps1,/gpuModeMatched/);
});

test('V3.6 acceptance leaves optional provider and local-voice smoke disabled by default',async()=>{
  const ps1=await read('scripts/humanale-unified-acceptance.ps1');
  assert.doesNotMatch(ps1,/DUDIDAM_COPILOT_SMOKE\s*=\s*['"]1['"]/);
  assert.doesNotMatch(ps1,/DUDIDAM_VOICE_SMOKE\s*=\s*['"]1['"]/);
});

test('physical acceptance rejects missing, invalid, stale and software GPU reports',{
  skip:process.platform!=='win32'
},async()=>{
  const ps1=await read('scripts/humanale-unified-acceptance.ps1');
  const helper=ps1.match(/function Read-CurrentPhysicalGpuEvidence \{[\s\S]*?\r?\n\}/)?.[0];
  assert.ok(helper,'executable GPU evidence reader is missing');
  const directory=await mkdtemp(join(tmpdir(),'humanale-gpu-evidence-'));
  const reportPath=join(directory,'report.json').replace(/'/g,"''");
  const code=`${helper}
$path = '${reportPath}'
$start = [DateTimeOffset]::UtcNow
$end = $start.AddMinutes(1)
$results = [ordered]@{}
$results.missing = (Read-CurrentPhysicalGpuEvidence -Path $path -StartedAt $start -CompletedAt $end).accepted
'{broken' | Set-Content -LiteralPath $path -Encoding UTF8
$results.invalid = (Read-CurrentPhysicalGpuEvidence -Path $path -StartedAt $start -CompletedAt $end).accepted
function Write-Report($started, $completed, $passed, $matched, $accelerated, $mode, $renderer) {
  @{startedAt=$started;completedAt=$completed;passed=$passed;gpu=@{modeMatched=$matched;hardwareAcceleration=$accelerated;requestedMode=$mode};webgl=@{renderer=$renderer}} | ConvertTo-Json | Set-Content -LiteralPath $path -Encoding UTF8
}
Write-Report $start.AddSeconds(1).ToString('o') $end.AddSeconds(-1).ToString('o') $true $true $true 'hardware' 'ANGLE NVIDIA GPU'
$results.fresh = (Read-CurrentPhysicalGpuEvidence -Path $path -StartedAt $start -CompletedAt $end).accepted
Write-Report $start.AddDays(-1).ToString('o') $start.AddDays(-1).AddSeconds(10).ToString('o') $true $true $true 'hardware' 'ANGLE NVIDIA GPU'
$results.stale = (Read-CurrentPhysicalGpuEvidence -Path $path -StartedAt $start -CompletedAt $end).accepted
Write-Report $start.AddSeconds(1).ToString('o') $end.AddSeconds(1).ToString('o') $true $true $true 'hardware' 'ANGLE NVIDIA GPU'
$results.future = (Read-CurrentPhysicalGpuEvidence -Path $path -StartedAt $start -CompletedAt $end).accepted
Write-Report $end.ToString('o') $start.ToString('o') $true $true $true 'hardware' 'ANGLE NVIDIA GPU'
$results.reversed = (Read-CurrentPhysicalGpuEvidence -Path $path -StartedAt $start -CompletedAt $end).accepted
Write-Report $start.ToString('o') $end.ToString('o') $true $true $true 'software' 'SwiftShader'
$results.software = (Read-CurrentPhysicalGpuEvidence -Path $path -StartedAt $start -CompletedAt $end).accepted
Write-Report $start.ToString('o') $end.ToString('o') $false $true $true 'hardware' 'ANGLE NVIDIA GPU'
$results.failed = (Read-CurrentPhysicalGpuEvidence -Path $path -StartedAt $start -CompletedAt $end).accepted
Write-Report $start.ToString('o') $end.ToString('o') 'true' $true $true 'hardware' 'ANGLE NVIDIA GPU'
$results.stringPass = (Read-CurrentPhysicalGpuEvidence -Path $path -StartedAt $start -CompletedAt $end).accepted
Write-Report $start.ToString('o') $end.ToString('o') $true $true $false 'hardware' 'ANGLE NVIDIA GPU'
$results.noAcceleration = (Read-CurrentPhysicalGpuEvidence -Path $path -StartedAt $start -CompletedAt $end).accepted
Write-Report $start.ToString('o') $end.ToString('o') $true $true $true 'hardware' 'SwiftShader'
$results.forgedHardware = (Read-CurrentPhysicalGpuEvidence -Path $path -StartedAt $start -CompletedAt $end).accepted
$results | ConvertTo-Json -Compress
`;
  try{
    const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(code,'utf16le').toString('base64')],{encoding:'utf8',timeout:30000});
    assert.equal(result.status,0,result.stderr||result.error?.message);
    assert.deepEqual(JSON.parse(result.stdout.trim()),{
      missing:false,invalid:false,fresh:true,stale:false,future:false,reversed:false,
      software:false,failed:false,stringPass:false,noAcceleration:false,forgedHardware:false
    });
  }finally{
    await rm(directory,{recursive:true,force:true});
  }
});

test('GPU invocation clears previous PASS evidence and cannot pass without a new report',{
  skip:process.platform!=='win32'
},async()=>{
  const ps1=await read('scripts/humanale-unified-acceptance.ps1');
  const helper=ps1.match(/function Read-CurrentPhysicalGpuEvidence \{[\s\S]*?\r?\n\}/)?.[0];
  const stage=ps1.slice(ps1.indexOf('$gpuScript ='),ps1.indexOf('\nWrite-Host ""',ps1.indexOf('$gpuScript =')));
  const passedLine=ps1.match(/^\$passed = .*$/m)?.[0];
  assert.ok(helper&&stage&&passedLine);
  const directory=await mkdtemp(join(tmpdir(),'humanale-gpu-invocation-'));
  const reportPath=join(directory,'report.json').replace(/'/g,"''");
  const code=`${helper}
$neuralReportPath = '${reportPath}'
'{"passed":true,"gpu":{"modeMatched":true}}' | Set-Content -LiteralPath $neuralReportPath -Encoding UTF8
function powershell.exe { $global:LASTEXITCODE = 0 }
${stage}
$desktopPassed = $true
${passedLine}
@{passed=$passed;reportExists=(Test-Path -LiteralPath $neuralReportPath);gpuExit=$gpuExit;reason=$neuralEvidence.reason} | ConvertTo-Json -Compress
`;
  try{
    const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(code,'utf16le').toString('base64')],{encoding:'utf8',timeout:30000});
    assert.equal(result.status,0,result.stderr||result.error?.message);
    assert.deepEqual(JSON.parse(result.stdout.trim()),{passed:false,reportExists:false,gpuExit:0,reason:'missing-report'});
  }finally{
    await rm(directory,{recursive:true,force:true});
  }
});
