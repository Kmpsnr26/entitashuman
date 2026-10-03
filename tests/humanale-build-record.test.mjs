import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createHumanALEBuildRecord,packagedRuntimeSha256} from '../scripts/humanale-build-record.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const runtimeFiles={'package.json':'{}','public/app.js':'app','desktop/main.cjs':'desktop',
  'Z.txt':'upper','a.txt':'lower','é.txt':'accent','empty.txt':''};

function fixture(t,platform='windows'){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'humanale-build-record-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const write=(name,content)=>{
    const file=path.join(root,name);
    fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,content);
    return file;
  };
  write('package.json',JSON.stringify({version:'2.5.0'}));
  const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git('init','--quiet');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
  git('add','package.json');git('-c','commit.gpgsign=false','commit','--quiet','-m','fixture');
  const sourceCommit=git('rev-parse','HEAD');
  const environment={GITHUB_ACTIONS:'true',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_REF:'refs/heads/main',
    GITHUB_SHA:sourceCommit,GITHUB_REPOSITORY:'Kmpsnr26/entitashuman',GITHUB_RUN_ID:'1234',GITHUB_RUN_ATTEMPT:'2',
    GITHUB_WORKFLOW_REF:`Kmpsnr26/entitashuman/.github/workflows/${platform==='windows'?'verify':'android-apk'}.yml@refs/heads/main`};
  const runtime=path.join(root,'HumanALE-God-Engine-Desktop/resources/app');
  if(platform==='windows'){
    write('release/HumanALE-God-Engine-Setup-2.5.0-x64.exe','installer');
    write('release/HumanALE-God-Engine-Portable-2.5.0-x64.zip','portable');
    write('HumanALE-God-Engine-Desktop/HumanALE-God-Engine.exe','executable');
    for(const [name,value] of Object.entries(runtimeFiles).reverse())write('HumanALE-God-Engine-Desktop/resources/app/'+name,value);
  }else write('release/HumanALE-Android-2.5.0.apk','apk');
  return {root,write,environment,runtime,record:()=>createHumanALEBuildRecord({repoRoot:root,platform,
    packagedDirectory:platform==='windows'?path.join(root,'HumanALE-God-Engine-Desktop'):undefined,environment})};
}

test('Windows build record binds final public artifacts, executable and canonical runtime vector',t=>{
  const f=fixture(t),record=f.record();
  assert.equal(record.protocol,'humanale-build-record/1');
  assert.deepEqual(record.build,{version:'2.5.0',sourceCommit:f.environment.GITHUB_SHA,
    repository:'Kmpsnr26/entitashuman',ref:'refs/heads/main',platform:'windows',
    workflow:f.environment.GITHUB_WORKFLOW_REF,runId:'1234',runAttempt:'2'});
  assert.deepEqual(record.artifacts.windowsInstaller,{fileName:'HumanALE-God-Engine-Setup-2.5.0-x64.exe',size:9,
    sha256:hash('installer'),sourceCommit:f.environment.GITHUB_SHA});
  assert.equal(record.artifacts.windowsPortable.sha256,hash('portable'));
  assert.equal(record.windowsRuntime.executable.sha256,hash('executable'));
  // Independent fixed vector includes ordinal uppercase/lowercase/non-ASCII order and an empty file.
  assert.equal(record.windowsRuntime.runtimeSha256,'53fd91f280fb30efe36382e94100e74ea48a29500c122fdc596bafd0de1762c2');
  f.write('HumanALE-God-Engine-Desktop/resources/app/public/app.js','changed');
  assert.notEqual(f.record().windowsRuntime.runtimeSha256,record.windowsRuntime.runtimeSha256);
  assert.equal(f.record().windowsRuntime.executable.sha256,record.windowsRuntime.executable.sha256);
});

test('Android record only includes explicit public fields and the final APK',t=>{
  const f=fixture(t,'android');
  f.write('release/android-signing.jks','fixture-secret-never-include');
  f.write('.env','fixture-secret-never-include');
  f.environment.ANDROID_KEYSTORE_PASSWORD='fixture-secret-never-include';
  f.environment.GITHUB_TOKEN='fixture-secret-never-include';
  const record=f.record(),json=JSON.stringify(record);
  assert.deepEqual(Object.keys(record.artifacts),['androidApk']);
  assert.deepEqual(record.artifacts.androidApk,{fileName:'HumanALE-Android-2.5.0.apk',size:3,
    sha256:hash('apk'),sourceCommit:f.environment.GITHUB_SHA});
  assert.equal(record.windowsRuntime,undefined);
  assert.doesNotMatch(json,/fixture-secret|\.jks|\.env|TOKEN|PASSWORD|PASS|integrationUnlocked/);
});

test('Windows digests follow explicit extracted package contents rather than the loose build tree',t=>{
  const f=fixture(t),extracted=path.join(f.root,'extracted-portable');
  fs.cpSync(path.join(f.root,'HumanALE-God-Engine-Desktop'),extracted,{recursive:true});
  const original=f.record();
  f.write('HumanALE-God-Engine-Desktop/resources/app/loose-only.txt','not distributed');
  fs.writeFileSync(path.join(extracted,'HumanALE-God-Engine.exe'),'distributed executable');
  const record=createHumanALEBuildRecord({repoRoot:f.root,platform:'windows',packagedDirectory:extracted,environment:f.environment});
  assert.equal(record.windowsRuntime.runtimeSha256,original.windowsRuntime.runtimeSha256);
  assert.notEqual(record.windowsRuntime.runtimeSha256,f.record().windowsRuntime.runtimeSha256);
  assert.equal(record.windowsRuntime.executable.sha256,hash('distributed executable'));
  assert.throws(()=>createHumanALEBuildRecord({repoRoot:f.root,platform:'windows',environment:f.environment}),/extracted packaged directory/);
});

test('build record rejects missing or malformed run/source/workflow identity',t=>{
  const f=fixture(t),original={...f.environment};
  for(const [field,value] of [
    ['GITHUB_SHA','abc'],['GITHUB_SHA','b'.repeat(40)],['GITHUB_RUN_ID',''],['GITHUB_RUN_ID','1.2'],
    ['GITHUB_RUN_ATTEMPT','0'],['GITHUB_REPOSITORY','../repo'],['GITHUB_REF','refs/heads/feature'],
    ['GITHUB_ACTIONS','false'],['GITHUB_EVENT_NAME','push'],['GITHUB_WORKFLOW_REF','wrong-workflow']
  ]){
    Object.assign(f.environment,original,{[field]:value});
    assert.throws(f.record,undefined,field+'='+value);
  }
  Object.assign(f.environment,original);
  assert.throws(()=>createHumanALEBuildRecord({repoRoot:f.root,platform:'__proto__',environment:f.environment}),/Platform/);
  f.write('package.json',JSON.stringify({version:'2.5.0/../malformed'}));
  assert.throws(f.record,/package version/);
});

test('missing, empty, wrong-version and ambiguous final artifacts are rejected',t=>{
  const f=fixture(t,'android'),apk=path.join(f.root,'release/HumanALE-Android-2.5.0.apk');
  fs.unlinkSync(apk);assert.throws(f.record,/Missing or ambiguous/);
  f.write('release/HumanALE-Android-2.4.0.apk','old');assert.throws(f.record,/Missing or ambiguous/);
  fs.unlinkSync(path.join(f.root,'release/HumanALE-Android-2.4.0.apk'));
  f.write('release/HumanALE-Android-2.5.0.apk','');assert.throws(f.record,/nonempty/);
  f.write('release/HumanALE-Android-2.5.0.apk','apk');
  f.write('release/HumanALE-Android-2.5.0-aligned.apk','not-final');assert.throws(f.record,/Missing or ambiguous/);
});

test('runtime required files, regular file roots and symlink boundaries are enforced',t=>{
  const f=fixture(t),required=path.join(f.runtime,'public/app.js');
  fs.unlinkSync(required);assert.throws(f.record,/Missing packaged runtime entry/);
  fs.mkdirSync(required);assert.throws(f.record,/Missing packaged runtime entry/);
  fs.rmdirSync(required);f.write('HumanALE-God-Engine-Desktop/resources/app/public/app.js','app');
  const outside=path.join(f.root,'outside');fs.mkdirSync(outside);
  const link=path.join(f.runtime,'linked');fs.symlinkSync(outside,link,process.platform==='win32'?'junction':'dir');
  assert.throws(f.record,/symlinks\/reparse/);fs.unlinkSync(link);
  const resources=path.join(f.root,'HumanALE-God-Engine-Desktop/resources');
  fs.renameSync(resources,path.join(f.root,'resources-original'));fs.symlinkSync(path.join(f.root,'resources-original'),resources,process.platform==='win32'?'junction':'dir');
  assert.throws(f.record,/real directory/);
});

test('artifact symlinks cannot substitute an unreviewed file', {skip:process.platform==='win32'},t=>{
  const f=fixture(t,'android'),apk=path.join(f.root,'release/HumanALE-Android-2.5.0.apk');
  fs.unlinkSync(apk);const outside=f.write('unrelated.apk','different');fs.symlinkSync(outside,apk);
  assert.throws(f.record,/regular file/);
  fs.unlinkSync(apk);fs.renameSync(path.join(f.root,'release'),path.join(f.root,'release-original'));
  fs.symlinkSync(path.join(f.root,'release-original'),path.join(f.root,'release'),'dir');
  assert.throws(f.record,/real directory/);
});

test('CLI emits a public sidecar, hashes multiple read chunks and refuses to overwrite it',t=>{
  const f=fixture(t,'android'),bytes=Buffer.alloc(2*1024*1024+17,37);
  f.write('release/HumanALE-Android-2.5.0.apk',bytes);
  const script=f.write('scripts/humanale-build-record.mjs',fs.readFileSync(new URL('../scripts/humanale-build-record.mjs',import.meta.url)));
  const args=[script,'--platform','android'];
  const options={encoding:'utf8',timeout:20000,env:{...process.env,...f.environment,ANDROID_KEYSTORE_PASSWORD:'fixture-secret-never-include'}};
  const first=spawnSync(process.execPath,args,options);
  assert.equal(first.status,0,first.stdout+first.stderr);
  assert.doesNotMatch(first.stdout+first.stderr,/fixture-secret/);
  const output=path.join(f.root,'release/humanale-build-record-android.json');
  const original=fs.readFileSync(output,'utf8'),record=JSON.parse(original);
  assert.equal(record.artifacts.androidApk.sha256,hash(bytes));
  assert.equal(record.artifacts.androidApk.size,bytes.length);
  const second=spawnSync(process.execPath,args,options);
  assert.equal(second.status,1);assert.equal(fs.readFileSync(output,'utf8'),original);
});

for(const lineEnding of ['LF','CRLF'])test(`signed workflows record only after verification, upload sidecars and retain publication gates (${lineEnding})`,()=>{
  const root=new URL('../',import.meta.url);
  const readWorkflow=name=>{
    const source=fs.readFileSync(new URL('.github/workflows/'+name,root),'utf8').replace(/\r\n/g,'\n');
    return lineEnding==='CRLF'?source.replace(/\n/g,'\r\n'):source;
  };
  const windows=readWorkflow('verify.yml');
  const android=readWorkflow('android-apk.yml');
  assert.ok(windows.indexOf('name: Verify Windows Authenticode')<windows.indexOf('name: Record signed Windows build identities'));
  assert.ok(windows.indexOf('--platform windows')<windows.indexOf('name: Upload verified Windows artifacts'));
  assert.match(windows,/name: Record signed Windows build identities\r?\n\s+if: github.event_name == 'workflow_dispatch' && inputs.build_signed_artifact/);
  assert.match(windows,/release\/humanale-build-record-windows\.json/);
  assert.match(windows,/Expand-Archive -LiteralPath \$zip -DestinationPath \$extracted/);
  assert.match(windows,/Get-AuthenticodeSignature -FilePath \(Join-Path \$extracted 'HumanALE-God-Engine\.exe'\)/);
  assert.match(windows,/--platform windows --packaged-directory \$extracted/);
  assert.ok(windows.indexOf('Expand-Archive -LiteralPath $zip')<windows.indexOf('--platform windows'));
  assert.match(windows,/Authenticode verification failed for \$\{target\}:/);
  assert.doesNotMatch(windows,/Authenticode verification failed for \$target:/);
  assert.ok(android.indexOf('"$apksigner" verify')<android.indexOf('--platform android'));
  assert.ok(android.indexOf('--platform android')<android.indexOf('name: Upload signed Android artifact'));
  assert.match(android,/release\/humanale-build-record-android\.json/);
  assert.equal((android.match(/- "scripts\/humanale-build-record\.mjs"/g)||[]).length,2);
  assert.equal((android.match(/- "tests\/humanale-build-record\.test\.mjs"/g)||[]).length,2);
  for(const source of [windows,android])assert.match(source,/node scripts\/humanale-release-publication-gate\.mjs --artifacts release --platform/);
});
