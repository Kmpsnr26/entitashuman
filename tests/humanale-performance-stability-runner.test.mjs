import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync,symlinkSync,unlinkSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {powershellCommand,powershellSkip,powershellEnv,writeNodeCommandShim} from './helpers/powershell.mjs';

const root=new URL('../',import.meta.url);

test('performance stability runner is bounded and operator-evidence based',async()=>{
 const src=await readFile(new URL('scripts/humanale-performance-stability.ps1',root),'utf8');
 assert.match(src,/DurationSeconds = 60/);
 assert.match(src,/IntervalSeconds = 5/);
 assert.match(src,/humanale-performance-stability\/1/);
 assert.match(src,/PERFORMANCE_STABILITY_PASS/);
 assert.match(src,/allProcessesStayedAlive/);
 assert.match(src,/operatorStable/);
 assert.match(src,/rev-parse HEAD/);
 assert.doesNotMatch(src,/NARA.*dispatch|integrationUnlocked|authority-control/i);
});

test('Windows stability rejects stale/process-mismatched evidence and observation never grants acceptance',{
 skip:powershellSkip
},()=>{
 const scratch=mkdtempSync(path.join(fileURLToPath(new URL('../../',import.meta.url)),'stability-runner-test-'));
 try{
  mkdirSync(path.join(scratch,'scripts'));mkdirSync(path.join(scratch,'other'));
  const target=path.join(scratch,'scripts','humanale-performance-stability.ps1');
  writeFileSync(target,readFileSync(new URL('scripts/humanale-performance-stability.ps1',root)));
  const portableExecutable=path.join(scratch,'HumanALE-God-Engine.exe');
  const bytes='trusted packaged executable fixture',hash=createHash('sha256').update(bytes).digest('hex');
  const commit='a'.repeat(40);
  const runtime=path.join(scratch,'resources','app');
  mkdirSync(path.join(runtime,'public'),{recursive:true});mkdirSync(path.join(runtime,'desktop'));
  const runtimeFiles={'package.json':'{}','public/app.js':'trusted application source','desktop/main.cjs':'trusted desktop source'};
  const runtimeHash=createHash('sha256').update(Object.keys(runtimeFiles).sort().map(name=>name+'\0'+createHash('sha256').update(runtimeFiles[name]).digest('hex')+'\n').join('')).digest('hex');
  const native=path.join(scratch,'git.cjs');
  writeFileSync(native,`console.log(process.argv.includes('rev-parse')?'${commit}':'main');`);
  writeNodeCommandShim(scratch,'git',native);
  const harness=path.join(scratch,'harness.ps1');
  writeFileSync(harness,`
param($Target, $Executable, $Output, $Commit, $Hash, $RuntimeHash)
$global:FixtureExe=$Executable
$global:FixtureCalls=@{}
function global:Get-Process {
 param([int]$Id,$ErrorAction)
 $count = 1 + [int]$global:FixtureCalls[$Id]; $global:FixtureCalls[$Id]=$count
 if ($env:HUMANALE_STABILITY_TEST_CASE -eq 'dead' -and $count -gt 1) { return }
 $start=[datetime]'2026-10-02T00:00:00Z'
 if ($env:HUMANALE_STABILITY_TEST_CASE -eq 'pid-reused' -and $count -gt 1) { $start=$start.AddMinutes(1) }
 $processPath=$global:FixtureExe
 if ($env:HUMANALE_STABILITY_TEST_CASE -eq 'path-mismatch' -and $Id -eq 222) { $processPath=Join-Path (Split-Path $processPath) 'other\\HumanALE-God-Engine.exe' }
 if ($env:HUMANALE_STABILITY_TEST_CASE -eq 'dev-electron') { $processPath=Join-Path (Split-Path $processPath) 'electron.exe' }
 [PSCustomObject]@{ Id=$Id;ProcessName='HumanALE-God-Engine';Path=$processPath;StartTime=$start;CPU=0;WorkingSet64=100MB;Responding=($env:HUMANALE_STABILITY_TEST_CASE -ne 'unresponsive') }
}
function global:Start-Sleep {
 param($Seconds)
 if ($env:HUMANALE_STABILITY_TEST_CASE -eq 'file-replaced') { Set-Content -LiteralPath $global:FixtureExe -Value 'different executable' }
 if ($env:HUMANALE_STABILITY_TEST_CASE -eq 'runtime-mutated') { Set-Content -LiteralPath (Join-Path (Split-Path $global:FixtureExe) 'resources\\app\\public\\app.js') -Value 'changed application source' }
}
function global:Read-Host {
 param($Prompt)
 if ($env:HUMANALE_STABILITY_TEST_CASE -like 'observe*') { throw 'ObserveOnly must never prompt for approval' }
 if ($env:HUMANALE_STABILITY_TEST_CASE -eq 'operator-no') { return 'N' }
 return 'Y'
}
$values=@{ProcessId=@(111);DurationSeconds=30;IntervalSeconds=10;ArtifactCommit=$Commit;ExpectedExecutableSha256=$Hash;ExpectedRuntimeSha256=$RuntimeHash;OutputPath=$Output}
switch ($env:HUMANALE_STABILITY_TEST_CASE) {
 'missing-inputs' { $values.Remove('ArtifactCommit');$values.Remove('ExpectedExecutableSha256') }
 'missing-runtime-hash' { $values.Remove('ExpectedRuntimeSha256') }
 'runtime-hash-mismatch' { $values.ExpectedRuntimeSha256='bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }
 'commit-mismatch' { $values.ArtifactCommit='bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }
 'hash-mismatch' { $values.ExpectedExecutableSha256='bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }
 'path-mismatch' { $values.ProcessId=@(111,222) }
 'observe-only' { $values.ObserveOnly=$true }
 'observe-no-pid' { $values.Remove('ProcessId');$values.ObserveOnly=$true }
 'duration-too-long' { $values.DurationSeconds=301 }
 'invalid-pid' { $values.ProcessId=@(0) }
}
& $Target @values
exit $LASTEXITCODE
`);
  const cases=['pass','installer-pass','operator-no','observe-only','missing-inputs','commit-mismatch','hash-mismatch','path-mismatch','pid-reused','dev-electron','dead','unresponsive','file-replaced','observe-no-pid','duration-too-long','invalid-pid','missing-runtime-hash','runtime-hash-mismatch','runtime-mutated','runtime-reparse'];
  for(const mode of cases){
   const executable=mode==='installer-pass'?path.join(scratch,'HumanALE god egine.exe'):portableExecutable;
   writeFileSync(executable,bytes);
   for(const [name,content] of Object.entries(runtimeFiles))writeFileSync(path.join(runtime,name),content);
   const link=path.join(runtime,'linked');
   if(mode==='runtime-reparse')symlinkSync(path.join(scratch,'other'),link,'junction');
   const output=path.join(scratch,mode+'.json');
   writeFileSync(output,JSON.stringify({state:'PERFORMANCE_STABILITY_PASS',fullyValidated:true}));
   const run=spawnSync(powershellCommand,['-NoProfile','-ExecutionPolicy','Bypass','-File',harness,target,executable,output,commit,hash,runtimeHash],{
    encoding:'utf8',timeout:20000,env:powershellEnv({PATH:scratch+path.delimiter+process.env.PATH,HUMANALE_STABILITY_TEST_CASE:mode})
   });
   if(mode==='runtime-reparse')unlinkSync(link);
   const rejectsBeforeSampling=['observe-no-pid','duration-too-long','invalid-pid'].includes(mode);
   const passed=mode==='pass'||mode==='installer-pass';
   assert.equal(run.status,passed?0:rejectsBeforeSampling?1:2,`${mode}: ${run.error||''}\n${run.stdout}\n${run.stderr}`);
   if(rejectsBeforeSampling){ assert.equal(existsSync(output),false,'failed preflight must remove old PASS');continue; }
   const result=JSON.parse(readFileSync(output,'utf8').replace(/^\uFEFF/,''));
   assert.equal(result.fullyValidated,passed,mode);
   assert.equal(result.checkoutCommit,commit);
   assert.equal(result.metrics.operatorStable,!['observe-only','operator-no'].includes(mode),mode);
   if(mode==='observe-only')assert.equal(result.observeOnly,true);
   if(['missing-inputs','commit-mismatch','hash-mismatch','path-mismatch','pid-reused','dev-electron','file-replaced','missing-runtime-hash','runtime-hash-mismatch','runtime-mutated','runtime-reparse'].includes(mode)){
    assert.equal(result.artifactSourceVerified,false,mode);assert.equal(result.candidate,'unknown',mode);
   }
   if(mode==='pid-reused'){assert.equal(result.processIdentityVerified,false);assert.equal(result.metrics.allProcessesStayedAlive,false);}
   if(passed){assert.equal(result.artifactSourceVerified,true);assert.equal(result.processIdentityVerified,true);assert.equal(result.executableSha256,hash);assert.equal(result.runtimeSourceVerified,true);assert.equal(result.runtimeSha256,runtimeHash);}
   if(mode==='runtime-mutated'){assert.equal(result.executableSha256,hash);assert.equal(result.runtimeSourceVerified,false);}
  }
 }finally{rmSync(scratch,{recursive:true,force:true});}
});
