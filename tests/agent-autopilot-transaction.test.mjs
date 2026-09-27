import test from 'node:test';
import assert from 'node:assert/strict';
import {
 AI_AUTOPILOT_STATES,
 AI_AUTOPILOT_REASONS,
 createAIAutopilotTransaction
} from '../desktop/agent-autopilot-transaction.mjs';

function broker(overrides={}){
 const calls=[];
 const api={
  calls,
  async detect(){calls.push('detect');return {ok:true,code:'ISSUE',summary:'issue found',issueId:'issue-1'};},
  async reproduce(){calls.push('reproduce');return {ok:true,code:'REPRODUCED',summary:'reproduced'};},
  async patch(){calls.push('patch');return {ok:true,code:'PATCHED',summary:'patch ready'};},
  async inspect(){calls.push('inspect');return {ok:true,code:'SAFE_DIFF',summary:'diff safe'};},
  async test(){calls.push('test');return {ok:true,code:'TEST_PASS',summary:'tests pass'};},
  async verify(){calls.push('verify');return {ok:true,code:'VERIFY_PASS',summary:'verified'};},
  async rollback(){calls.push('rollback');return {ok:true,code:'ROLLBACK_OK',summary:'rolled back'};}
 };
 return Object.assign(api,overrides);
}

test('one-shot autopilot follows strict detect→reproduce→patch→inspect→test→verify order',async()=>{
 let now=1000;
 const b=broker();
 const auto=createAIAutopilotTransaction({
  broker:b,
  now:()=>++now,
  idFactory:()=> 'auto-order-1'
 });
 const result=await auto.runOnce();
 assert.equal(result.status,AI_AUTOPILOT_STATES.PASSED);
 assert.equal(result.reason,null);
 assert.deepEqual(b.calls,['detect','reproduce','patch','inspect','test','verify']);
 assert.equal(result.attempts,1);
 assert.equal(result.authority.gitPush,false);
 assert.equal(result.authority.gitMerge,false);
 assert.equal(result.authority.releasePublish,false);
 assert.equal(result.authority.creatorApproval,false);
 assert.equal(result.authority.draftPr,false);
});

test('no issue exits without patching',async()=>{
 const b=broker({
  async detect(){b.calls.push('detect');return {ok:false,code:'NO_ISSUE',summary:'nothing to repair'};}
 });
 const auto=createAIAutopilotTransaction({broker:b,idFactory:()=> 'auto-no-issue'});
 const result=await auto.runOnce();
 assert.equal(result.status,AI_AUTOPILOT_STATES.IDLE);
 assert.equal(result.reason,AI_AUTOPILOT_REASONS.NO_ISSUE);
 assert.deepEqual(b.calls,['detect']);
});

test('inspection failure forces rollback before retry',async()=>{
 let attempt=0;
 const b=broker({
  async inspect(){
   b.calls.push('inspect');
   attempt++;
   return attempt===1
    ?{ok:false,code:'PROTECTED_PATH_CHANGE',summary:'protected'}
    :{ok:true,code:'SAFE_DIFF',summary:'safe'};
  }
 });
 const auto=createAIAutopilotTransaction({
  broker:b,
  limits:{maxAttempts:2}
 });
 const result=await auto.runOnce({requestId:'auto-inspect-retry'});
 assert.equal(result.status,AI_AUTOPILOT_STATES.PASSED);
 assert.deepEqual(b.calls,[
  'detect',
  'reproduce','patch','inspect','rollback',
  'reproduce','patch','inspect','test','verify'
 ]);
 assert.equal(result.attempts,2);
});

test('test failure forces rollback and stops when retry budget exhausted',async()=>{
 const b=broker({
  async test(){b.calls.push('test');return {ok:false,code:'TEST_FAILED',summary:'bad test'};}
 });
 const auto=createAIAutopilotTransaction({
  broker:b,
  limits:{maxAttempts:2}
 });
 const result=await auto.runOnce({requestId:'auto-test-fail'});
 assert.equal(result.status,AI_AUTOPILOT_STATES.ROLLED_BACK);
 assert.equal(result.reason,AI_AUTOPILOT_REASONS.TEST_FAILED);
 assert.equal(result.attempts,2);
 assert.equal(b.calls.filter(x=>x==='rollback').length,2);
 assert.equal(b.calls.includes('verify'),false);
});

test('verification failure rolls back',async()=>{
 const b=broker({
  async verify(){b.calls.push('verify');return {ok:false,code:'VERIFY_FAILED',summary:'not verified'};}
 });
 const auto=createAIAutopilotTransaction({
  broker:b,
  limits:{maxAttempts:1}
 });
 const result=await auto.runOnce({requestId:'auto-verify-fail'});
 assert.equal(result.status,AI_AUTOPILOT_STATES.ROLLED_BACK);
 assert.equal(result.reason,AI_AUTOPILOT_REASONS.VERIFICATION_FAILED);
 assert.deepEqual(b.calls,['detect','reproduce','patch','inspect','test','verify','rollback']);
});

test('rollback failure terminates fail-closed and never retries',async()=>{
 const b=broker({
  async inspect(){b.calls.push('inspect');return {ok:false,code:'BLOCKED',summary:'blocked'};},
  async rollback(){b.calls.push('rollback');return {ok:false,code:'ROLLBACK_FAILED',summary:'manual recovery'};}
 });
 const auto=createAIAutopilotTransaction({
  broker:b,
  limits:{maxAttempts:2}
 });
 const result=await auto.runOnce({requestId:'auto-rollback-fail'});
 assert.equal(result.status,AI_AUTOPILOT_STATES.FAILED);
 assert.equal(result.reason,AI_AUTOPILOT_REASONS.ROLLBACK_FAILED);
 assert.equal(result.attempts,1);
 assert.deepEqual(b.calls,['detect','reproduce','patch','inspect','rollback']);
});

test('reproduction failure never calls rollback because no patch exists',async()=>{
 const b=broker({
  async reproduce(){b.calls.push('reproduce');return {ok:false,code:'NO_REPRO',summary:'cannot reproduce'};}
 });
 const auto=createAIAutopilotTransaction({
  broker:b,
  limits:{maxAttempts:2}
 });
 const result=await auto.runOnce({requestId:'auto-no-repro'});
 assert.equal(result.status,AI_AUTOPILOT_STATES.FAILED);
 assert.equal(result.reason,AI_AUTOPILOT_REASONS.REPRODUCTION_FAILED);
 assert.equal(b.calls.includes('patch'),false);
 assert.equal(b.calls.includes('rollback'),false);
});

test('invalid broker fails closed during construction',()=>{
 assert.throws(
  ()=>createAIAutopilotTransaction({broker:{detect(){}}}),
  /must expose reproduce/
 );
});

test('concurrent runOnce calls are rejected',async()=>{
 let release;
 const gate=new Promise(resolve=>{release=resolve;});
 const b=broker({
  async detect(){
   b.calls.push('detect');
   await gate;
   return {ok:true,code:'ISSUE'};
  }
 });
 const auto=createAIAutopilotTransaction({broker:b});
 const first=auto.runOnce({requestId:'auto-busy-1'});
 await new Promise(resolve=>setTimeout(resolve,0));
 await assert.rejects(
  ()=>auto.runOnce({requestId:'auto-busy-2'}),
  error=>error?.code==='AI_AUTOPILOT_BUSY'
 );
 release();
 await first;
});

test('v1 exposes no realtime scheduler or git publication authority',()=>{
 const auto=createAIAutopilotTransaction({broker:broker()});
 assert.equal(typeof auto.startRealtime,'undefined');
 assert.equal(typeof auto.watch,'undefined');
 assert.equal(typeof auto.createDraftPR,'undefined');
 assert.equal(typeof auto.push,'undefined');
 assert.equal(typeof auto.merge,'undefined');
 assert.equal(typeof auto.publish,'undefined');
});
