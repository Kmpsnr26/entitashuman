import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=new URL('../',import.meta.url);
const nativePSModules=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','Modules');

test('Android runtime validator rejects failed launch, dead process, and wrong foreground before operator approval',{
 skip:process.platform!=='win32'
},()=>{
 const scratch=mkdtempSync(path.join(fileURLToPath(new URL('../../',import.meta.url)),'android-runner-test-'));
 try{
  mkdirSync(path.join(scratch,'scripts'));
  const script=path.join(scratch,'scripts','humanale-android-runtime.ps1');
  writeFileSync(script,readFileSync(new URL('scripts/humanale-android-runtime.ps1',root)));
  const apk=path.join(scratch,'fixture.apk');
  writeFileSync(apk,'mock APK; never installed on a device');
  const git=(...args)=>execFileSync('git',args,{cwd:scratch,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git('init','--quiet');
  git('config','user.name','Test');
  git('config','user.email','test@example.invalid');
  git('config','commit.gpgsign','false');
  git('add','.');
  git('commit','--quiet','-m','mock device candidate');
  const candidate=git('rev-parse','HEAD');
  const apkHash=createHash('sha256').update(readFileSync(apk)).digest('hex');
  const fakeAdb=path.join(scratch,'fake-adb.cjs');
  writeFileSync(fakeAdb,`
const fs=require('node:fs');
const args=process.argv.slice(2), mode=process.env.HUMANALE_ADB_TEST_CASE;
fs.appendFileSync(process.env.HUMANALE_ADB_TEST_LOG,JSON.stringify(args)+'\\n');
if(args[0]==='devices'){console.log('List of devices attached\\nfixture-device\\tdevice');}
else if(args.includes('get-current-user')){
 const log=fs.readFileSync(process.env.HUMANALE_ADB_TEST_LOG,'utf8');
 if(mode==='user-invalid')console.log('unverified');
 else if(mode==='user-exit'){console.log('0');process.exitCode=1;}
 else if(mode==='user-changed'&&log.split('get-current-user').length>2)console.log('10');
 else console.log(mode==='nonzero-user'?'10':'0');
}
else if(args.includes('install')||args.includes('path')){
 if(!args.includes('--user')){console.error('Protected profile 150 cannot be accessed');process.exitCode=1;}
 else console.log(args.includes('install')?'Success':'package:/data/app/fixture/base.apk');
}
else if(args.includes('monkey')){
 if(mode==='launch-exit'){console.log('Events injected: 1');process.exitCode=1;}
 else if(mode==='launch-empty'){console.log('No activity launched');}
 else if(mode==='launch-crash'){console.log('Events injected: 1; // CRASH: fixture');}
 else console.log('Events injected: 1');
}
else if(args.includes('pidof')){
 if(mode==='dead-process'){process.exitCode=1;}else console.log('1234');
}
else if(args.includes('dumpsys')){
 if(args[args.length-1]!=='window'){console.error('Android 16 windows subcommand omits current focus');process.exit(1);}
 if(mode==='wrong-focus'||mode==='stale-focused-app')console.log('mCurrentFocus=Window{abc u0 another.app/MainActivity}');
 else if(mode==='notification-shade')console.log('mCurrentFocus=Window{abc u0 NotificationShade}');
 else console.log('mCurrentFocus=Window{abc u'+(mode==='nonzero-user'?'10':mode==='wrong-user-focus'?'150':'0')+' id.my.aleprinting.humanale/MainActivity}');
 if(mode==='stale-focused-app'||mode==='notification-shade')console.log('mFocusedApp=ActivityRecord{abc u0 id.my.aleprinting.humanale/MainActivity}');
 if(mode==='focus-exit')process.exitCode=1;
}
else {console.error('Unexpected mock ADB invocation');process.exitCode=1;}
`);
  writeFileSync(path.join(scratch,'adb.cmd'),`@echo off\r\n"${process.execPath}" "${fakeAdb}" %*\r\n`);
  const harness=path.join(scratch,'harness.ps1');
  writeFileSync(harness,`param($Target, $Apk, $Output)\nfunction global:Start-Sleep { param($Seconds) }\nfunction global:Read-Host { param($Prompt) return $env:HUMANALE_ADB_TEST_ANSWER }\n$serial=if($env:HUMANALE_ADB_TEST_CASE -eq 'wrong-serial'){'different-device'}else{'fixture-device'}\n& $Target -ApkPath $Apk -OutputPath $Output -ArtifactCommit $env:HUMANALE_ADB_TEST_COMMIT -ExpectedApkSha256 $env:HUMANALE_ADB_TEST_HASH -DeviceSerial $serial\nexit $LASTEXITCODE\n`);
  const scenarios=[
   ['launch-exit','Y',1,'Peluncuran HumanALE gagal'],
   ['launch-empty','Y',1,'Peluncuran HumanALE gagal'],
   ['launch-crash','Y',1,'Peluncuran HumanALE gagal'],
   ['dead-process','Y',1,'Proses HumanALE tidak hidup'],
   ['wrong-focus','Y',1,'aplikasi foreground'],
   ['stale-focused-app','Y',1,'aplikasi foreground'],
   ['notification-shade','Y',1,'aplikasi foreground'],
   ['focus-exit','Y',1,'aplikasi foreground'],
   ['wrong-user-focus','Y',1,'aplikasi foreground'],
   ['user-invalid','Y',1,'User Android aktif tidak dapat diverifikasi'],
   ['user-exit','Y',1,'User Android aktif tidak dapat diverifikasi'],
   ['user-changed','Y',1,'User Android aktif berubah'],
   ['wrong-serial','Y',1,'DeviceSerial yang dipilih'],
   ['nonzero-user','Y',0,'ANDROID_RUNTIME_PASS'],
   ['success','N',2,'ANDROID_RUNTIME_INCOMPLETE'],
   ['success','Y',0,'ANDROID_RUNTIME_PASS']
  ];
  for(const [mode,answer,exitCode,message] of scenarios){
   const output=path.join(scratch,`${mode}-${answer}.json`);
   writeFileSync(output,JSON.stringify({state:'ANDROID_RUNTIME_PASS',fullyValidated:true}));
   const log=path.join(scratch,`${mode}-${answer}.calls`);
   const run=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',harness,script,apk,output],{
    encoding:'utf8',timeout:20000,
    env:{...process.env,PSModulePath:nativePSModules,PATH:scratch+path.delimiter+process.env.PATH,HUMANALE_ADB_TEST_CASE:mode,HUMANALE_ADB_TEST_ANSWER:answer,HUMANALE_ADB_TEST_LOG:log,HUMANALE_ADB_TEST_COMMIT:candidate,HUMANALE_ADB_TEST_HASH:apkHash}
   });
   assert.equal(run.status,exitCode,`${mode}: ${run.error||''}\n${run.stdout}\n${run.stderr}`);
   assert.match(run.stdout+run.stderr,new RegExp(message),mode);
   const deviceCalls=readFileSync(log,'utf8').trim().split('\n').map(line=>JSON.parse(line)).filter(args=>args[0]!=='devices');
   for(const args of deviceCalls){assert.equal(args[0],'-s');assert.equal(args[1],'fixture-device','all device commands must target the mock');}
   for(const args of deviceCalls.filter(args=>args.includes('dumpsys'))){assert.deepEqual(args.slice(-3),['shell','dumpsys','window'],'read full window service focus on Android 16');}
   if(exitCode===1){
    assert.equal(existsSync(output),false,'failed reruns cannot retain an earlier PASS');
    if(['wrong-serial','user-invalid','user-exit'].includes(mode))assert.ok(!readFileSync(log,'utf8').includes('install'),'device preflight must fail before installation');
   }
   else{
    const evidence=JSON.parse(readFileSync(output,'utf8').replace(/^\uFEFF/,''));
    assert.equal(evidence.launchSuccess,true);
    assert.equal(evidence.processAlive,true);
    assert.equal(evidence.foregroundMatches,true);
    assert.equal(evidence.fullyValidated,answer==='Y');
    assert.equal(evidence.operatorPass,answer==='Y');
    assert.equal(evidence.artifactSourceVerified,true);
    assert.equal(evidence.apkSha256,apkHash);
    assert.equal(evidence.deviceUserId,mode==='nonzero-user'?10:0);
    const calls=readFileSync(log,'utf8').trim().split('\n').map(line=>JSON.parse(line));
    for(const args of calls.filter(args=>args.includes('install')||args.includes('path'))){
     assert.equal(args[args.indexOf('--user')+1],mode==='nonzero-user'?'10':'0');
    }
   }
  }
  for(const [mode,sourceCommit,hash] of [['old-source','0'.repeat(40),apkHash],['wrong-bytes',candidate,'0'.repeat(64)],['missing-source','',apkHash]]){
   const log=path.join(scratch,mode+'.calls');
   const output=path.join(scratch,mode+'.json');
   const run=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',harness,script,apk,output],{
    encoding:'utf8',timeout:20000,
    env:{...process.env,PSModulePath:nativePSModules,PATH:scratch+path.delimiter+process.env.PATH,HUMANALE_ADB_TEST_CASE:'success',HUMANALE_ADB_TEST_ANSWER:'Y',HUMANALE_ADB_TEST_LOG:log,HUMANALE_ADB_TEST_COMMIT:sourceCommit,HUMANALE_ADB_TEST_HASH:hash}
   });
   assert.equal(run.status,1,run.stdout+run.stderr);
   assert.match(run.stdout+run.stderr,/Identitas APK/);
   assert.equal(existsSync(log),false,'unverified artifact must be rejected before device commands');
   assert.equal(existsSync(output),false);
  }
 }finally{rmSync(scratch,{recursive:true,force:true});}
});
test('final device/security runners remain evidence-driven and fail closed',async()=>{
 const [android,security]=await Promise.all([
  readFile(new URL('scripts/humanale-android-runtime.ps1',root),'utf8'),
  readFile(new URL('scripts/humanale-release-security.ps1',root),'utf8')
 ]);
 assert.match(android,/humanale-android-runtime\/1/);
 assert.match(android,/install -r/);
 assert.match(android,/operatorPass/);
 assert.match(android,/ANDROID_RUNTIME_PASS/);
 assert.match(security,/Get-AuthenticodeSignature/);
 assert.match(security,/apksigner verify/);
 assert.match(security,/RELEASE_SECURITY_PASS/);
 assert.doesNotMatch(android+security,/integrationUnlocked|authority-control|NARA.*dispatch/i);
});

test('release workflows require final readiness and signed Windows artifacts',async()=>{
 const [verify,android,gate]=await Promise.all([
  readFile(new URL('.github/workflows/verify.yml',root),'utf8'),
  readFile(new URL('.github/workflows/android-apk.yml',root),'utf8'),
  readFile(new URL('scripts/humanale-release-publication-gate.mjs',root),'utf8')
 ]);
 assert.match(verify,/Enforce release publication gate[\s\S]*humanale-release-publication-gate\.mjs/);
 assert.match(android,/Enforce release publication gate[\s\S]*humanale-release-publication-gate\.mjs/);
 assert.match(verify,/WINDOWS_SIGNING_PFX_BASE64/);
 assert.match(verify,/WINDOWS_SIGNING_PFX_PASSWORD/);
 assert.match(verify,/Build signed Windows installer/);
 assert.match(verify,/CSC_LINK/);
 assert.match(verify,/Get-AuthenticodeSignature/);
 assert.match(verify,/signature\.Status -ne "Valid"/);
 assert.match(gate,/FINAL_READY/);
 assert.match(gate,/integrationUnlocked/);
 assert.match(gate,/creatorApproval/);
 assert.match(gate,/githubRefName/);
});

test('signed candidate builds cannot publish and publication keeps its gate',async()=>{
 const [verify,android]=await Promise.all([
  readFile(new URL('.github/workflows/verify.yml',root),'utf8'),
  readFile(new URL('.github/workflows/android-apk.yml',root),'utf8')
 ]);
 const windowsBuild=verify.split(/\r?\n  windows:\r?\n/)[1]?.split(/\r?\n  release-windows:\r?\n/)[0];
 const windowsPublish=verify.split(/\r?\n  release-windows:\r?\n/)[1];
 const androidBuild=android.split(/\r?\n  release:\r?\n/)[1]?.split(/\r?\n  publish-android:\r?\n/)[0];
 const androidPublish=android.split(/\r?\n  publish-android:\r?\n/)[1];
 for(const [workflow,build,publish] of [[verify,windowsBuild,windowsPublish],[android,androidBuild,androidPublish]]){
  assert.match(workflow,/build_signed_artifact:[\s\S]*?default: false/);
  assert.ok(build && publish,'separate signed-build and publication jobs are required');
  assert.match(build,/if: github\.event_name == 'workflow_dispatch' && inputs\.build_signed_artifact/);
  assert.doesNotMatch(build,/inputs\.build_signed_artifact \|\| inputs\.publish_release/);
  assert.match(build,/refs\/heads\/main/);
  assert.doesNotMatch(build,/humanale-release-publication-gate\.mjs|gh release (create|upload)/);
  assert.match(publish,/if: github\.event_name == 'workflow_dispatch' && inputs\.publish_release/);
  assert.match(publish,/Enforce release publication gate[\s\S]*?Download/);
  assert.match(publish,/humanale-release-publication-gate\.mjs/);
  assert.match(publish,/gh release (create|upload)/);
  assert.match(publish,/humanale-certified-artifact-run\.mjs/);
  assert.match(publish,/run-id: \$\{\{ steps\.certified-artifact\.outputs\.run-id \}\}/);
  assert.match(publish,/github-token: \$\{\{ github\.token \}\}/);
  assert.match(publish,/--artifacts release --platform/);
 }
 assert.match(androidBuild,/permissions:\s*\n\s*contents: read/);
 assert.match(androidPublish,/permissions:\s*\n\s*contents: write/);
 assert.match(windowsBuild,/Verify Windows Authenticode/);
 assert.match(androidBuild,/Sign and verify production APK/);
 assert.match(androidPublish,/needs: apk/);
 assert.doesNotMatch(androidPublish,/needs: release/);
});
