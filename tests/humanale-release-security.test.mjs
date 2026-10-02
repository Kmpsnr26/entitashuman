import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';

const root=new URL('../',import.meta.url);
test('release security binds artifact hashes and source to trusted inputs and requires a pinned production signer',{
 skip:process.platform!=='win32'
},()=>{
 const scratch=mkdtempSync(path.join(fileURLToPath(new URL('../../',import.meta.url)),'release-security-test-'));
 try{
  mkdirSync(path.join(scratch,'scripts'));
  const target=path.join(scratch,'scripts','humanale-release-security.ps1');
  writeFileSync(target,readFileSync(new URL('scripts/humanale-release-security.ps1',root)));
  writeFileSync(path.join(scratch,'capacitor.config.json'),JSON.stringify({appId:'id.my.aleprinting.humanale'}));
  writeFileSync(path.join(scratch,'package.json'),JSON.stringify({version:'2.5.0'}));
  const installer=path.join(scratch,'fixture-installer.exe'),apk=path.join(scratch,'fixture.apk');
  const installerBytes='trusted installer build fixture',apkBytes='trusted Android build fixture';
  writeFileSync(installer,installerBytes);writeFileSync(apk,apkBytes);
  const sha=value=>createHash('sha256').update(value).digest('hex');
  const sourceCommit='1234567890abcdef1234567890abcdef12345678',certPin='a'.repeat(64);
  const native=path.join(scratch,'fake-native.cjs');
  writeFileSync(native,`
const args=process.argv.slice(2),mode=process.env.HUMANALE_RELEASE_TEST_CASE;
if(args.includes('rev-parse'))console.log('${sourceCommit}');
else if(args.includes('--show-current'))console.log('main');
else if(args.includes('verify')){
 console.log('Signer #1 certificate DN: '+(mode==='debug'?'CN=Android Debug, O=Android, C=US':'CN=HumanALE Production'));
 console.log('Signer #1 certificate SHA-256 digest: '+(mode==='wrong-signer'?'${'b'.repeat(64)}':mode==='malformed-signer'?'bad-digest':'${certPin}'));
 if(mode==='multiple-signers'){
  console.log('Signer #2 certificate DN: CN=Unapproved signer');
  console.log('Signer #2 certificate SHA-256 digest: ${'b'.repeat(64)}');
 }
 if(mode==='invalid-apk')process.exitCode=1;
}else if(args.includes('badging')){
 if(mode==='manifest-empty'){}else if(mode==='manifest-malformed')console.log('package: unreadable');
 else console.log("package: name='"+(mode==='manifest-wrong-package'?'unrelated.app':'id.my.aleprinting.humanale')+"' versionCode='"+(mode==='manifest-wrong-code'?'2005001':'2005000')+"' versionName='"+(mode==='manifest-wrong-version'?'2.4.0':'2.5.0')+"'");
 if(mode==='manifest-debuggable')console.log('application-debuggable');
 if(mode==='manifest-exit')process.exitCode=1;
}else {console.error('Unexpected mock command');process.exitCode=1;}
`);
  for(const command of ['git','apksigner','aapt'])writeFileSync(path.join(scratch,command+'.cmd'),`@echo off\r\n"${process.execPath}" "${native}" %*\r\n`);
  const harness=path.join(scratch,'harness.ps1');
  writeFileSync(harness,`
param($Target, $Installer, $Apk, $Output, $Source, $InstallerHash, $ApkHash, $Pin)
function global:Get-AuthenticodeSignature {
 param($FilePath)
 $status = if ($env:HUMANALE_RELEASE_TEST_CASE -eq 'invalid-windows') { 'NotSigned' } else { 'Valid' }
 [PSCustomObject]@{Status=$status;SignerCertificate=[PSCustomObject]@{Subject='CN=Fixture HumanALE'}}
}
if ($env:HUMANALE_RELEASE_TEST_CASE -eq 'aapt-missing') {
 function global:Get-Command { param($Name,$ErrorAction) if ($Name -ne 'aapt') { Microsoft.PowerShell.Core\\Get-Command $Name -ErrorAction SilentlyContinue } }
}
$values = @{InstallerPath=$Installer;ApkPath=$Apk;OutputPath=$Output;ArtifactCommit=$Source;ExpectedInstallerSha256=$InstallerHash;ExpectedApkSha256=$ApkHash;AndroidReleaseCertSha256=$Pin}
switch ($env:HUMANALE_RELEASE_TEST_CASE) {
 'missing-inputs' { $values.Remove('ArtifactCommit');$values.Remove('ExpectedInstallerSha256');$values.Remove('ExpectedApkSha256') }
 'missing-installer-hash' { $values.Remove('ExpectedInstallerSha256') }
 'missing-apk-hash' { $values.Remove('ExpectedApkSha256') }
 'unpinned' { $values.Remove('AndroidReleaseCertSha256') }
}
& $Target @values
exit $LASTEXITCODE
`);
  const cases=['pass','missing-inputs','missing-installer-hash','missing-apk-hash','unpinned','debug','wrong-signer','malformed-signer','multiple-signers','invalid-apk','invalid-windows','commit-mismatch','malformed-commit','installer-mismatch','apk-mismatch','installer-replaced','apk-replaced','manifest-debuggable','manifest-empty','manifest-malformed','manifest-exit','aapt-missing','manifest-wrong-package','manifest-wrong-version','manifest-wrong-code'];
  for(const mode of cases){
   writeFileSync(installer,mode==='installer-replaced'?'different old installer':installerBytes);
   writeFileSync(apk,mode==='apk-replaced'?'different old APK':apkBytes);
   const output=path.join(scratch,mode+'.json');
   writeFileSync(output,JSON.stringify({fullyValidated:true,state:'RELEASE_SECURITY_PASS',candidate:sourceCommit}));
   const commit=mode==='commit-mismatch'?'f'.repeat(40):mode==='malformed-commit'?'bad-sha':sourceCommit;
   const installerHash=mode==='installer-mismatch'?'f'.repeat(64):sha(installerBytes);
   const apkHash=mode==='apk-mismatch'?'f'.repeat(64):sha(apkBytes);
   const run=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',harness,target,installer,apk,output,commit,installerHash,apkHash,certPin],{
    encoding:'utf8',timeout:20000,env:{...process.env,PATH:scratch+path.delimiter+process.env.PATH,HUMANALE_RELEASE_TEST_CASE:mode}
   });
   assert.equal(run.status,mode==='pass'?0:2,`${mode}: ${run.error||''}\n${run.stdout}\n${run.stderr}`);
   const result=JSON.parse(readFileSync(output,'utf8').replace(/^\uFEFF/,''));
   assert.equal(result.fullyValidated,mode==='pass',mode);
   assert.equal(result.state,mode==='pass'?'RELEASE_SECURITY_PASS':'RELEASE_SECURITY_INCOMPLETE',mode);
   assert.equal(result.checkoutCommit,sourceCommit);
   assert.equal(result.windows.installerSha256,sha(readFileSync(installer)));
   assert.equal(result.android.apkSha256,sha(readFileSync(apk)));
   const unverified=['missing-inputs','missing-installer-hash','missing-apk-hash','commit-mismatch','malformed-commit','installer-mismatch','apk-mismatch','installer-replaced','apk-replaced'].includes(mode);
   assert.equal(result.artifactSourceVerified,!unverified,mode);
   assert.equal(result.candidate,unverified?'unknown':sourceCommit,mode);
   if(['unpinned','debug','wrong-signer','malformed-signer','multiple-signers','invalid-apk'].includes(mode))assert.equal(result.android.productionSignerMatched,false,mode);
   if(mode==='pass')assert.equal(result.android.productionSignerMatched,true);
   if(mode==='pass')assert.equal(result.android.nonDebuggable,true);
   if(mode.startsWith('manifest-')||mode==='aapt-missing')assert.equal(result.android.productionManifestVerified,false,mode);
  }
 }finally{rmSync(scratch,{recursive:true,force:true});}
});
