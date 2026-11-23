import test from 'node:test';
import assert from 'node:assert/strict';
import {cp,readFile,mkdtemp,mkdir,rm,writeFile,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const run=promisify(execFile);
const repo=new URL('../',import.meta.url);
async function fixture(t){
  const root=await mkdtemp(join(tmpdir(),'humanale-web-build-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  for(const path of ['build.mjs','public','sites/humanale-hologram/dist','worker.mjs']){
    await mkdir(dirname(join(root,path)),{recursive:true});
    await cp(new URL(path,repo),join(root,path),{recursive:true});
  }
  return root;
}

test('fresh web build packages every HTML script and its local module dependencies',async t=>{
  const root=await fixture(t);
  await run(process.execPath,['build.mjs'],{cwd:root});
  const client=join(root,'dist/client');
  const html=await readFile(join(client,'index.html'),'utf8');
  const pending=[...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/g)].map(match=>resolve(client,'.'+match[1]));
  const visited=new Set();
  while(pending.length){
    const path=pending.pop();
    if(visited.has(path))continue;
    visited.add(path);
    const source=await readFile(path,'utf8');
    for(const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)["'](\.{1,2}\/[^"']+)["']/g)){
      pending.push(resolve(dirname(path),match[1]));
    }
  }
  for(const file of ['alecore-ai-memory.js','alecore-ai-context-bridge.js']){
    assert.ok(visited.has(join(client,'humanale',file)),`${file} must be loaded by the packaged HTML`);
    assert.equal(await readFile(join(client,'humanale',file),'utf8'),await readFile(join(root,'sites/humanale-hologram/dist',file),'utf8'));
  }
});

test('web rebuild removes assets deleted from source and optional stale hosting metadata',async t=>{
  const root=await fixture(t);
  await writeFile(join(root,'public/removed-source.js'),'old asset');
  await mkdir(join(root,'.openai'),{recursive:true});
  await writeFile(join(root,'.openai/hosting.json'),JSON.stringify({project_id:'fixture',static:{directory:'public'}}));
  await run(process.execPath,['build.mjs'],{cwd:root});
  await stat(join(root,'dist/client/removed-source.js'));
  await stat(join(root,'dist/.openai/hosting.json'));
  await rm(join(root,'public/removed-source.js'));
  await rm(join(root,'.openai/hosting.json'));
  await run(process.execPath,['build.mjs'],{cwd:root});
  await assert.rejects(stat(join(root,'dist/client/removed-source.js')),error=>error.code==='ENOENT');
  await assert.rejects(stat(join(root,'dist/.openai/hosting.json')),error=>error.code==='ENOENT');
  await stat(join(root,'dist/client/index.html'));
  await stat(join(root,'dist/server/index.js'));
});
