import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {assertPackagedPty} from '../scripts/terminal-package-check.mjs';

async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'humanale-packaged-pty-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const app=join(root,'portable','resources','app');
 await mkdir(join(app,'desktop'),{recursive:true});
 await mkdir(join(app,'node_modules'),{recursive:true});
 const manager=join(app,'desktop','terminal-manager.mjs');
 await writeFile(manager,'export {};\n');
 return {root,app,manager:pathToFileURL(manager)};
}
async function moduleAt(root){
 const directory=join(root,'node_modules','node-pty');
 await mkdir(directory,{recursive:true});
 await writeFile(join(directory,'package.json'),JSON.stringify({name:'node-pty',main:'index.js'}));
 await writeFile(join(directory,'index.js'),'module.exports={};\n');
 return join(directory,'index.js');
}

test('packaged PTY check rejects fallback to the source installation',async t=>{
 const {root,manager}=await fixture(t);
 await moduleAt(root);
 await assert.rejects(assertPackagedPty(manager),/inside this app/);
});

test('packaged PTY check requires the module inside the selected app',async t=>{
 const {root,app,manager}=await fixture(t);
 await moduleAt(root);
 const packaged=await moduleAt(app);
 assert.equal(await assertPackagedPty(manager),packaged);
});
