import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {powershellCommand,powershellSkip,powershellEnv} from './helpers/powershell.mjs';

// Execute acceptance script logic with fixture reports, without claiming hardware GPU validation.
const root=new URL('../',import.meta.url);

test('standalone GPU acceptance requires a fresh physical report and restores caller GPU mode',{
 skip:powershellSkip
},()=>{
 const scratch=mkdtempSync(path.join(fileURLToPath(new URL('../../',import.meta.url)),'gpu-runner-test-'));
 try{
  for(const directory of ['scripts','artifacts','node_modules/electron/dist','node_modules/three']){
   mkdirSync(path.join(scratch,directory),{recursive:true});
  }
  const target=path.join(scratch,'scripts','alecore-ai-neural-gpu-acceptance.ps1');
  writeFileSync(target,readFileSync(new URL('scripts/alecore-ai-neural-gpu-acceptance.ps1',root)));
  for(const filename of ['node_modules/electron/package.json','node_modules/three/package.json','node_modules/electron/dist/electron.exe']){
   writeFileSync(path.join(scratch,filename),'mock dependency; never executed');
  }
  const checks=Object.fromEntries([
   'customSettingsPanel','r4VisualDefaults','customSettingsRuntime','customSettingsPersistence',
   'r5AudioControls','r5AudioProfileRuntime','r7VoiceIdentityControls','r7VoiceProfileRuntime',
   'r7VoicePreviewSafe','nodeVoiceNarration','mechanicalCoreRings','galacticEnvironment'
  ].map(name=>[name,true]));
  const goodReport={passed:true,gpu:{requestedMode:'hardware',hardwareAcceleration:true,modeMatched:true},webgl:{renderer:'ANGLE NVIDIA hardware'},checks};
  const reportPath=path.join(scratch,'artifacts','alecore-ai-neural-live-report.json');
  const fixture=path.join(scratch,'fixture.json');
  const restoration=path.join(scratch,'restoration.json');
  const harness=path.join(scratch,'harness.ps1');
  writeFileSync(harness,`
param($Target, $Fixture, $ReportPath, $Restoration)
$ErrorActionPreference = 'Stop'
if ($env:HUMANALE_GPU_TEST_INITIAL -eq 'absent') { Remove-Item Env:ALECORE_AI_GPU_MODE -ErrorAction SilentlyContinue }
else { $env:ALECORE_AI_GPU_MODE = 'software' }
$global:GpuFixture = $Fixture
$global:GpuReportPath = $ReportPath
function global:npm {
 if ($args[0] -eq '--version') { $global:LASTEXITCODE=0; return 'mock-npm' }
 if ($env:ALECORE_AI_GPU_MODE -ne 'hardware') { throw 'Child GPU mode must be hardware' }
 if ($env:HUMANALE_GPU_TEST_CASE -eq 'throw') { throw 'Mock child failed' }
 $global:LASTEXITCODE = 0
 if ($env:HUMANALE_GPU_TEST_CASE -eq 'noop') { return }
 if ($env:HUMANALE_GPU_TEST_CASE -eq 'malformed') { Set-Content -LiteralPath $global:GpuReportPath -Value '{bad json'; return }
 $report = Get-Content -LiteralPath $global:GpuFixture -Raw | ConvertFrom-Json
 $now = [DateTimeOffset]::UtcNow
 $report | Add-Member -NotePropertyName startedAt -NotePropertyValue $now.ToString('o') -Force
 $report | Add-Member -NotePropertyName completedAt -NotePropertyValue $now.ToString('o') -Force
 if ($env:HUMANALE_GPU_TEST_CASE -eq 'invalid-time') { $report.startedAt = 'not-a-timestamp' }
 if ($env:HUMANALE_GPU_TEST_CASE -eq 'replay') { $report.startedAt = '2020-01-01T00:00:00Z'; $report.completedAt = '2020-01-01T00:01:00Z' }
 if ($env:HUMANALE_GPU_TEST_CASE -eq 'future') { $report.completedAt = $now.AddHours(1).ToString('o') }
 if ($env:HUMANALE_GPU_TEST_CASE -eq 'reversed') { $report.completedAt = $now.AddSeconds(-1).ToString('o') }
 $report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $global:GpuReportPath -Encoding UTF8
 if ($env:HUMANALE_GPU_TEST_CASE -eq 'exit-failure') { $global:LASTEXITCODE = 1 }
}
try { & $Target -SkipInstall; $status = $LASTEXITCODE }
finally { @{ gpuMode = $env:ALECORE_AI_GPU_MODE } | ConvertTo-Json | Set-Content -LiteralPath $Restoration -Encoding UTF8 }
exit $status
`);
  const scenarios=[
   ['noop',{},1],['invalid-time',{},1],['replay',{},1],['future',{},1],['reversed',{},1],['malformed',{},1],
   ['software',{webgl:{renderer:'Google SwiftShader'}},1],
   ['string-pass',{passed:'true'},1],['string-mode',{gpu:{modeMatched:'true'}},1],
   ['hardware-off',{gpu:{hardwareAcceleration:false}},1],['wrong-mode',{gpu:{requestedMode:'software'}},1],
   ['check-false',{checks:{nodeVoiceNarration:false}},1],['check-string',{checks:{nodeVoiceNarration:'true'}},1],
   ['exit-failure',{},1],['throw',{},1],['success',{},0],['success-absent',{},0]
  ];
  for(const [mode,changes,expectedExit] of scenarios){
   const report={...goodReport,...changes,gpu:{...goodReport.gpu,...changes.gpu},webgl:{...goodReport.webgl,...changes.webgl},checks:{...checks,...changes.checks}};
   writeFileSync(fixture,JSON.stringify(report));
   writeFileSync(reportPath,JSON.stringify({...goodReport,startedAt:'2020-01-01T00:00:00Z',completedAt:'2020-01-01T00:01:00Z'}));
   const run=spawnSync(powershellCommand,['-NoProfile','-ExecutionPolicy','Bypass','-File',harness,target,fixture,reportPath,restoration],{
    encoding:'utf8',timeout:20000,env:powershellEnv({HUMANALE_GPU_TEST_CASE:mode,HUMANALE_GPU_TEST_INITIAL:mode==='success-absent'?'absent':'software'})
   });
   assert.equal(run.status,expectedExit,`${mode}: ${run.error||''}\n${run.stdout}\n${run.stderr}`);
   const restored=JSON.parse(readFileSync(restoration,'utf8').replace(/^\uFEFF/,''));
   assert.equal(restored.gpuMode,mode==='success-absent'?null:'software',`${mode}: caller environment must be restored`);
   if(mode==='noop'||mode==='throw')assert.equal(existsSync(reportPath),false,'prior successful report must be removed');
   if(expectedExit===0)assert.match(run.stdout,/\[PASS\]/);
   else assert.doesNotMatch(run.stdout,/\[PASS\]/,`${mode} cannot announce success`);
  }
 }finally{rmSync(scratch,{recursive:true,force:true});}
});
