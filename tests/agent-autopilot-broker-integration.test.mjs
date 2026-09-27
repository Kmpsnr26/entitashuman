import test from 'node:test';
import assert from 'node:assert/strict';
import {createAIAutopilotTransaction} from '../desktop/agent-autopilot-transaction.mjs';
import {createTrustedMaintenanceBroker} from '../desktop/agent-trusted-maintenance-broker.mjs';

function makeTx(id,events){
 return {
  id,
  cwd:'/repo',
  isolatedHome:'/isolated/'+id,
  released:false,
  async inspect(){
   events.push(id+':inspect');
   return {allowed:true,violations:[],paths:['src/fix.js'],totalBytes:64};
  },
  async rollback(reason){
   events.push(id+':rollback:'+reason);
   return {rolledBack:true};
  },
  async release(){
   events.push(id+':release');
   this.released=true;
  }
 };
}

test('autopilot + trusted broker rollback failed first attempt then use a fresh transaction for retry',async()=>{
 const events=[];
 let txSequence=0;
 let testRuns=0;
 const broker=createTrustedMaintenanceBroker({
  projectRoot:'/repo',
  agentHub:{
   async runTrustedMaintenanceWork(_prompt,{transaction}){
    events.push(transaction.id+':worker');
    return {maintenance:{changedFiles:1,totalBytes:64}};
   }
  },
  detector:async()=>({ok:true,code:'BUG_FOUND',summary:'bug'}),
  reproducer:async()=>({ok:true,code:'REPRODUCED',summary:'reproduced'}),
  transactionFactory:async()=>makeTx('tx-'+(++txSequence),events),
  commandRunner:async ({args})=>{
   if(args.length===1&&args[0]==='test'){
    testRuns++;
    events.push('test-'+testRuns);
    return testRuns===1
     ?{ok:false,code:'TEST_FAILED',summary:'first attempt fails'}
     :{ok:true,code:'TEST_PASS',summary:'second attempt passes'};
   }
   events.push('build');
   return {ok:true,code:'BUILD_PASS',summary:'build passes'};
  }
 });
 const auto=createAIAutopilotTransaction({
  broker,
  limits:{maxAttempts:2},
  idFactory:()=> 'auto-integrated-retry'
 });
 const result=await auto.runOnce();
 assert.equal(result.status,'PASSED');
 assert.equal(result.attempts,2);
 assert.equal(txSequence,2);
 assert.ok(events.includes('tx-1:rollback:TEST_FAILED'));
 assert.ok(events.includes('tx-1:release'));
 assert.ok(events.includes('tx-2:release'));
 assert.equal(broker.snapshot().activeSessions,0);
 assert.equal(result.authority.gitPush,false);
 assert.equal(result.authority.draftPr,false);
});

test('autopilot + trusted broker blocks unsafe inspection and rolls transaction back',async()=>{
 const events=[];
 const tx=makeTx('tx-block',events);
 let inspections=0;
 tx.inspect=async()=>{
  inspections++;
  events.push('tx-block:inspect');
  if(inspections>=2){
   return {
    allowed:false,
    violations:['PROTECTED_PATH_CHANGE'],
    paths:['desktop/agent-maintenance-policy.mjs'],
    totalBytes:1
   };
  }
  return {allowed:true,violations:[],paths:['src/fix.js'],totalBytes:1};
 };
 const broker=createTrustedMaintenanceBroker({
  projectRoot:'/repo',
  agentHub:{
   async runTrustedMaintenanceWork(){
    return {maintenance:{changedFiles:1,totalBytes:1}};
   }
  },
  detector:async()=>({ok:true,code:'BUG_FOUND',summary:'bug'}),
  reproducer:async()=>({ok:true,code:'REPRODUCED',summary:'reproduced'}),
  transactionFactory:async()=>tx,
  commandRunner:async()=>({ok:true,code:'PASS',summary:'pass'})
 });
 const auto=createAIAutopilotTransaction({
  broker,
  limits:{maxAttempts:1},
  idFactory:()=> 'auto-integrated-block'
 });
 const result=await auto.runOnce();
 assert.equal(result.status,'ROLLED_BACK');
 assert.equal(result.reason,'INSPECTION_BLOCKED');
 assert.ok(events.includes('tx-block:rollback:INSPECTION_BLOCKED'));
 assert.equal(broker.snapshot().activeSessions,0);
});

test('integrated success never invokes rollback and still never publishes',async()=>{
 const events=[];
 const tx=makeTx('tx-pass',events);
 const broker=createTrustedMaintenanceBroker({
  projectRoot:'/repo',
  agentHub:{
   async runTrustedMaintenanceWork(){
    events.push('worker');
    return {maintenance:{changedFiles:1,totalBytes:64}};
   }
  },
  detector:async()=>({ok:true,code:'BUG_FOUND',summary:'bug'}),
  reproducer:async()=>({ok:true,code:'REPRODUCED',summary:'reproduced'}),
  transactionFactory:async()=>tx,
  commandRunner:async ({args})=>{
   events.push(args.join(' '));
   return {ok:true,code:'PASS',summary:'pass'};
  }
 });
 const auto=createAIAutopilotTransaction({
  broker,
  limits:{maxAttempts:1},
  idFactory:()=> 'auto-integrated-pass'
 });
 const result=await auto.runOnce();
 assert.equal(result.status,'PASSED');
 assert.equal(events.some(item=>item.includes(':rollback:')),false);
 assert.ok(events.includes('test'));
 assert.ok(events.includes('run build'));
 assert.equal(tx.released,true);
 assert.equal(typeof broker.push,'undefined');
 assert.equal(typeof broker.merge,'undefined');
 assert.equal(typeof broker.publish,'undefined');
 assert.equal(typeof broker.createDraftPR,'undefined');
});
