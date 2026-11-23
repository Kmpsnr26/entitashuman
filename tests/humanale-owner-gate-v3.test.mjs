import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

import {createOwnerStore} from '../alecore-ai/security/owner-store.mjs';
import {createHumanALEOwnerGate} from '../desktop/humanale-owner-gate.mjs';

test('unreadable Owner store fails closed and remains unchanged instead of enabling provisioning',()=>{
 const dir=mkdtempSync(join(tmpdir(),'humanale-owner-corrupt-'));
 try{
  const file=join(dir,'owner.json');writeFileSync(file,'invalid fixture');
  const gate=createHumanALEOwnerGate({store:createOwnerStore({filePath:file})});
  for(const result of [gate.status('a'),gate.login('a',{username:'creator',password:'FixtureKey123!'}),gate.provision('a',{username:'creator',password:'FixtureKey123!',confirmPassword:'FixtureKey123!'})]){
   assert.equal(result.configured,true);assert.equal(result.unlocked,false);assert.equal(result.errorCode,'owner_store_unavailable');
  }
  assert.equal(readFileSync(file,'utf8'),'invalid fixture');
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('correct Owner key waits for lockout expiry and exact characters remain significant',()=>{
 const dir=mkdtempSync(join(tmpdir(),'humanale-owner-retry-'));
 try{
  const store=createOwnerStore({filePath:join(dir,'owner.json')});store.provision({username:'creator',password:'FixtureSecret123!'});
  const gate=createHumanALEOwnerGate({store,maxAttempts:3,attemptWindowMs:10000});
  for(let i=0;i<3;i++)gate.login('a',{username:'creator',password:'wrong'});
  const denied=gate.login('a',{username:'creator',password:'FixtureSecret123!'});
  assert.equal(denied.errorCode,'rate_limited');assert.ok(denied.retryAfterMs>0&&denied.retryAfterMs<=10001);
  gate.attempts.get('a').startedAt=Date.now()-10002;
  assert.equal(gate.login('a',{username:'creator',password:'FixtureSecret123!'}).ok,true);
  assert.equal(gate.login('b',{username:'creator',password:'FixtureSecret123! '}).errorCode,'invalid_credentials');
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('V3.5 HumanALE Creator gate provisions once and never persists plaintext password',()=>{
  const dir=mkdtempSync(join(tmpdir(),'humanale-owner-gate-'));
  try{
    const file=join(dir,'owner.json');
    const store=createOwnerStore({filePath:file});
    const gate=createHumanALEOwnerGate({store,maxAttempts:5});

    assert.deepEqual(gate.status('window-a'),{
      configured:false,unlocked:false,username:null,sessionExpiresAt:0,retryAfterMs:0,errorCode:''
    });

    const mismatch=gate.provision('window-a',{
      username:'creator',
      password:'CreatorSecret123!',
      confirmPassword:'different'
    });
    assert.equal(mismatch.ok,false);
    assert.equal(store.configured(),false);

    const provisioned=gate.provision('window-a',{
      username:'creator',
      password:'CreatorSecret123!',
      confirmPassword:'CreatorSecret123!'
    });
    assert.equal(provisioned.ok,true);
    assert.equal(gate.status('window-a').unlocked,true);
    assert.equal(gate.status('window-b').unlocked,false);

    const raw=readFileSync(file,'utf8');
    assert.equal(raw.includes('CreatorSecret123!'),false);
    assert.match(raw,/passwordHash/);
    const second=gate.provision('window-b',{
      username:'other',
      password:'AnotherSecret123!',
      confirmPassword:'AnotherSecret123!'
    });
    assert.equal(second.ok,false);
    assert.match(second.error,/sudah diprovision/i);
  }finally{
    rmSync(dir,{recursive:true,force:true});
  }
});

test('V3.5 Creator login is rate-limited and global logout revokes every HumanALE window',()=>{
  const dir=mkdtempSync(join(tmpdir(),'humanale-owner-session-'));
  try{
    const store=createOwnerStore({filePath:join(dir,'owner.json')});
    store.provision({username:'creator',password:'CreatorSecret123!'});
    const gate=createHumanALEOwnerGate({store,maxAttempts:3,attemptWindowMs:60000});

    assert.equal(gate.login('attacker',{username:'creator',password:'wrong-1'}).ok,false);
    assert.equal(gate.login('attacker',{username:'creator',password:'wrong-2'}).ok,false);
    assert.equal(gate.login('attacker',{username:'creator',password:'wrong-3'}).ok,false);
    const limited=gate.login('attacker',{username:'creator',password:'CreatorSecret123!'});
    assert.equal(limited.ok,false);
    assert.equal(limited.rateLimited,true);

    assert.equal(gate.login('window-a',{username:'creator',password:'CreatorSecret123!'}).ok,true);
    assert.equal(gate.login('window-b',{username:'creator',password:'CreatorSecret123!'}).ok,true);
    assert.equal(gate.isUnlocked('window-a'),true);
    assert.equal(gate.isUnlocked('window-b'),true);

    gate.logout('window-a');
    assert.equal(gate.isUnlocked('window-a'),false);
    assert.equal(gate.isUnlocked('window-b'),false);
  }finally{
    rmSync(dir,{recursive:true,force:true});
  }
});

test('V3.5 credential rotation requires unlocked Creator plus current password and revokes sessions',()=>{
  const dir=mkdtempSync(join(tmpdir(),'humanale-owner-rotate-'));
  try{
    const store=createOwnerStore({filePath:join(dir,'owner.json')});
    const first=store.provision({username:'creator',password:'CreatorSecret123!'});
    const gate=createHumanALEOwnerGate({store});

    const locked=gate.changeCredentials('window-a',{
      currentPassword:'CreatorSecret123!',
      newUsername:'creator2',
      newPassword:'CreatorSecret456!'
    });
    assert.equal(locked.ok,false);

    assert.equal(gate.login('window-a',{username:'creator',password:'CreatorSecret123!'}).ok,true);
    const wrong=gate.changeCredentials('window-a',{
      currentPassword:'wrong',
      newUsername:'creator2',
      newPassword:'CreatorSecret456!'
    });
    assert.equal(wrong.ok,false);
    assert.equal(gate.isUnlocked('window-a'),true);

    const changed=gate.changeCredentials('window-a',{
      currentPassword:'CreatorSecret123!',
      newUsername:'creator2',
      newPassword:'CreatorSecret456!'
    });
    assert.equal(changed.ok,true);
    assert.equal(changed.reloginRequired,true);
    assert.equal(gate.isUnlocked('window-a'),false);
    assert.equal(store.publicProfile().ownerId,first.ownerId);
    assert.equal(store.verify({username:'creator',password:'CreatorSecret123!'}),false);
    assert.equal(store.verify({username:'creator2',password:'CreatorSecret456!'}),true);
  }finally{
    rmSync(dir,{recursive:true,force:true});
  }
});
