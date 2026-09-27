import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
  MAINTENANCE_VERIFIER_PROFILES,
  TrustedMaintenanceVerifier
} from '../desktop/maintenance-verifier.mjs';

test('trusted verifier exposes only fixed npm profiles',()=>{
  assert.deepEqual(
    Object.keys(MAINTENANCE_VERIFIER_PROFILES).sort(),
    ['focused','full']
  );
  assert.deepEqual(
    [...MAINTENANCE_VERIFIER_PROFILES.full[0].args],
    ['run','verify']
  );
  assert.deepEqual(
    [...MAINTENANCE_VERIFIER_PROFILES.focused[0].args],
    ['test']
  );
});

test('trusted verifier runs the selected fixed profile and returns bounded metadata',async()=>{
  const root=await mkdtemp(join(tmpdir(),'humanale-verifier-'));
  const calls=[];
  let now=100;
  try{
    const verifier=new TrustedMaintenanceVerifier({
      now:()=>++now,
      runner:async(cwd,check)=>{
        calls.push({cwd,check});
        return {
          id:check.id,
          ok:true,
          exitCode:0,
          timedOut:false,
          outputExceeded:false,
          durationMs:12,
          failureCode:null,
          failureTail:''
        };
      }
    });
    const result=await verifier.verify({cwd:root,profile:'full'});
    assert.equal(result.ok,true);
    assert.equal(result.profile,'full');
    assert.deepEqual(calls.map(item=>item.check.id),['npm-verify']);
    assert.equal(result.checks[0].failureTail,'');
  }finally{
    await rm(root,{recursive:true,force:true});
  }
});

test('verifier stops after first failed trusted check and redacts secret-like failure text',async()=>{
  const root=await mkdtemp(join(tmpdir(),'humanale-verifier-'));
  try{
    const verifier=new TrustedMaintenanceVerifier({
      runner:async(_cwd,check)=>({
        id:check.id,
        ok:false,
        exitCode:1,
        timedOut:false,
        outputExceeded:false,
        durationMs:5,
        failureCode:'CHECK_FAILED',
        failureTail:'OPENAI_API_KEY=sk-secret-value-1234567890'
      })
    });
    const result=await verifier.verify({cwd:root,profile:'focused'});
    assert.equal(result.ok,false);
    assert.equal(result.failureCode,'CHECK_FAILED');
    assert.equal(result.checks.length,1);
    assert.equal(result.checks[0].failureTail.includes('sk-secret-value'),false);
    assert.match(result.checks[0].failureTail,/REDACTED/);
  }finally{
    await rm(root,{recursive:true,force:true});
  }
});

test('unknown verifier profile fails closed before a runner is called',async()=>{
  const root=await mkdtemp(join(tmpdir(),'humanale-verifier-'));
  let calls=0;
  try{
    const verifier=new TrustedMaintenanceVerifier({
      runner:async()=>{calls++;return {ok:true};}
    });
    await assert.rejects(
      ()=>verifier.verify({cwd:root,profile:'arbitrary-command'}),
      /profile tidak diizinkan/
    );
    assert.equal(calls,0);
  }finally{
    await rm(root,{recursive:true,force:true});
  }
});

test('verifier result contains no command string or environment dump surface',async()=>{
  const root=await mkdtemp(join(tmpdir(),'humanale-verifier-'));
  try{
    const verifier=new TrustedMaintenanceVerifier({
      runner:async(_cwd,check)=>({
        id:check.id,
        ok:true,
        exitCode:0,
        durationMs:1
      })
    });
    const serialized=JSON.stringify(await verifier.verify({cwd:root}));
    assert.equal(serialized.includes('process.env'),false);
    assert.equal(serialized.includes('OPENAI_API_KEY'),false);
    assert.equal(serialized.includes('"command"'),false);
    assert.equal(serialized.includes('"args"'),false);
  }finally{
    await rm(root,{recursive:true,force:true});
  }
});
