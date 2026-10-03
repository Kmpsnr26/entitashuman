import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const workflows={windows:'verify.yml',android:'android-apk.yml'};

function requireDirectory(directory){
  const stat=fs.lstatSync(directory);
  if(stat.isSymbolicLink()||!stat.isDirectory())throw new Error('Expected a real directory: '+directory);
}

function fileIdentity(file){
  const stat=fs.lstatSync(file);
  if(stat.isSymbolicLink()||!stat.isFile()||stat.size<=0)throw new Error('Expected a nonempty regular file: '+file);
  const hash=createHash('sha256');
  const fd=fs.openSync(file,'r');
  try{
    const buffer=Buffer.alloc(1024*1024);
    let count;
    while((count=fs.readSync(fd,buffer,0,buffer.length,null))!==0)hash.update(buffer.subarray(0,count));
  }finally{fs.closeSync(fd);}
  return {fileName:path.basename(file),size:stat.size,sha256:hash.digest('hex')};
}

// Matches PowerShell StringComparer.Ordinal over relativePath + NUL + hash + LF.
export function packagedRuntimeSha256(runtimeRoot){
  requireDirectory(runtimeRoot);
  const entries=new Map();
  function visit(directory,prefix=''){
    for(const name of fs.readdirSync(directory)){
      if(/[\0\r\n\\]/.test(name))throw new Error('Unsupported runtime entry name.');
      const entry=path.join(directory,name),relative=prefix+name,stat=fs.lstatSync(entry);
      if(stat.isSymbolicLink())throw new Error('Runtime symlinks/reparse entries are forbidden.');
      if(stat.isDirectory())visit(entry,relative+'/');
      else if(stat.isFile())entries.set(relative,fileIdentityAllowEmpty(entry));
      else throw new Error('Runtime must contain only regular files/directories.');
    }
  }
  visit(runtimeRoot);
  for(const required of ['package.json','public/app.js','desktop/main.cjs']){
    if(!entries.has(required))throw new Error('Missing packaged runtime entry: '+required);
  }
  const digest=createHash('sha256');
  for(const relative of [...entries.keys()].sort())digest.update(relative+'\0'+entries.get(relative)+'\n','utf8');
  return digest.digest('hex');
}

function fileIdentityAllowEmpty(file){
  // Empty bundled files still participate in the canonical runtime digest.
  const stat=fs.lstatSync(file);
  if(stat.isSymbolicLink()||!stat.isFile())throw new Error('Expected regular runtime file.');
  if(stat.size===0)return createHash('sha256').digest('hex');
  return fileIdentity(file).sha256;
}

export function createHumanALEBuildRecord({repoRoot,platform,packagedDirectory,environment=process.env}={}){
  if(!Object.hasOwn(workflows,platform))throw new Error('Platform must be windows or android.');
  const root=path.resolve(repoRoot),env=environment;
  const sourceCommit=env.GITHUB_SHA;
  if(env.GITHUB_ACTIONS!=='true'||env.GITHUB_EVENT_NAME!=='workflow_dispatch'||env.GITHUB_REF!=='refs/heads/main'){
    throw new Error('Build records require a manually dispatched main Actions run.');
  }
  if(!/^[a-f0-9]{40}$/.test(sourceCommit||''))throw new Error('Invalid source commit.');
  if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(env.GITHUB_REPOSITORY||''))throw new Error('Invalid repository identity.');
  if(!/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID||'')||!/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ATTEMPT||'')){
    throw new Error('Missing Actions run identity.');
  }
  const workflow=env.GITHUB_REPOSITORY+'/.github/workflows/'+workflows[platform]+'@refs/heads/main';
  if(env.GITHUB_WORKFLOW_REF!==workflow)throw new Error('Unexpected workflow identity.');
  const head=execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  if(head!==sourceCommit)throw new Error('Actions source commit does not match checkout.');
  const packagePath=path.join(root,'package.json');
  fileIdentity(packagePath);
  const version=JSON.parse(fs.readFileSync(packagePath,'utf8')).version;
  if(!/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(version||''))throw new Error('Invalid package version.');
  const release=path.join(root,'release');
  requireDirectory(release);
  const names=fs.readdirSync(release);
  const artifacts={};
  function artifact(id,expected,pattern){
    const matches=names.filter(name=>pattern.test(name));
    if(matches.length!==1||matches[0]!==expected)throw new Error('Missing or ambiguous '+id+' artifact.');
    artifacts[id]={...fileIdentity(path.join(release,expected)),sourceCommit};
  }
  let windowsRuntime;
  if(platform==='windows'){
    artifact('windowsInstaller',`HumanALE-God-Engine-Setup-${version}-x64.exe`,/^HumanALE-God-Engine-Setup-.*-x64\.exe$/);
    artifact('windowsPortable',`HumanALE-God-Engine-Portable-${version}-x64.zip`,/^HumanALE-God-Engine-Portable-.*-x64\.zip$/);
    // The signed workflow supplies a fresh extraction of the finalized portable ZIP.
    // Hashing the loose packaging tree could include files omitted by archiving.
    if(!packagedDirectory)throw new Error('Windows records require the extracted packaged directory.');
    const desktop=path.resolve(packagedDirectory);
    requireDirectory(desktop);
    const executable=fileIdentity(path.join(desktop,'HumanALE-God-Engine.exe'));
    requireDirectory(path.join(desktop,'resources'));
    windowsRuntime={executable, runtimeSha256:packagedRuntimeSha256(path.join(desktop,'resources','app'))};
  }else{
    artifact('androidApk',`HumanALE-Android-${version}.apk`,/^HumanALE-Android-.*\.apk$/);
  }
  return {
    protocol:'humanale-build-record/1',
    build:{version,sourceCommit,repository:env.GITHUB_REPOSITORY,ref:env.GITHUB_REF,platform,
      workflow,runId:env.GITHUB_RUN_ID,runAttempt:env.GITHUB_RUN_ATTEMPT},
    artifacts,
    ...(windowsRuntime?{windowsRuntime}:{})
  };
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const args=process.argv.slice(2);
    if(args[0]!=='--platform'||(args[1]==='windows'
      ? args.length!==4||args[2]!=='--packaged-directory'||!args[3]
      : args.length!==2)){
      throw new Error('Usage: node scripts/humanale-build-record.mjs --platform android | --platform windows --packaged-directory <extracted-portable-directory>');
    }
    const repoRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
    const record=createHumanALEBuildRecord({repoRoot,platform:args[1],packagedDirectory:args[3]});
    const output=path.join(repoRoot,'release',`humanale-build-record-${args[1]}.json`);
    fs.writeFileSync(output,JSON.stringify(record,null,2)+'\n',{encoding:'utf8',flag:'wx'});
    console.log('Public build record: '+path.basename(output));
  }catch(error){
    console.error(error instanceof Error?error.message:String(error));
    process.exitCode=1;
  }
}
