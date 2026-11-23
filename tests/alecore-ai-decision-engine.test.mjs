import test from 'node:test';
import assert from 'node:assert/strict';
import {createEventBus} from '../alecore-ai/brain/event-bus.js';
import {
  DECISION_OUTCOMES,
  DECISION_REASON_CODES,
  createDecisionPolicy,
  createDecisionEngine
} from '../alecore-ai/decision/index.js';

function readyContext(extra={}){
  return {
    capabilities:{
      reason:'ready',
      plan:'ready',
      'memory.read':'ready',
      'memory.write':'ready',
      sync:'ready',
      'github.read':'ready',
      'github.write':'ready',
      'system.shell':'ready'
    },
    deniedCapabilities:[],
    dependencies:{github:'connected'},
    gates:{
      'humanale.final_ready':false,
      'integration.contract_validated':true
    },
    approvals:{owner:false},
    ...extra
  };
}

test('Decision Engine allows a low-risk ready capability',()=>{
  const engine=createDecisionEngine({
    idFactory:()=> 'generated-1',
    now:()=>1000
  });
  const result=engine.decide({
    id:'reason-1',
    action:'reason',
    actor:'system',
    label:'Analyze current state'
  },readyContext());

  assert.equal(result.outcome,DECISION_OUTCOMES.ALLOW);
  assert.deepEqual(result.reasonCodes,[DECISION_REASON_CODES.POLICY_ALLOW]);
  assert.equal(result.capability,'reason');
  assert.equal(result.risk,'low');
  assert.equal(result.summary.includes('checks passed'),true);
});

test('Decision Engine blocks unknown actions and malformed requests fail closed',()=>{
  const engine=createDecisionEngine({idFactory:()=> 'fallback-1',now:()=>2000});

  const unknown=engine.decide({id:'unknown-1',action:'root.takeover'},readyContext());
  assert.equal(unknown.outcome,DECISION_OUTCOMES.BLOCK);
  assert.deepEqual(unknown.reasonCodes,[DECISION_REASON_CODES.UNKNOWN_ACTION]);

  const invalid=engine.decide({id:'invalid-1',action:'bad action with spaces'},readyContext());
  assert.equal(invalid.outcome,DECISION_OUTCOMES.BLOCK);
  assert.deepEqual(invalid.reasonCodes,[DECISION_REASON_CODES.INVALID_REQUEST]);
  assert.match(invalid.validationError,/action is invalid/i);
});

test('Decision Engine defers when a capability or dependency is not ready',()=>{
  const engine=createDecisionEngine({now:()=>3000});

  const capability=engine.decide({
    id:'cap-1',
    action:'external.read',
    capability:'github.read'
  },readyContext({capabilities:{'github.read':false}}));
  assert.equal(capability.outcome,DECISION_OUTCOMES.DEFER);
  assert.deepEqual(capability.reasonCodes,[DECISION_REASON_CODES.CAPABILITY_NOT_READY]);

  const dependency=engine.decide({
    id:'dep-1',
    action:'external.read',
    capability:'github.read',
    requiredDependencies:['github']
  },readyContext({dependencies:{github:'disconnected'}}));
  assert.equal(dependency.outcome,DECISION_OUTCOMES.DEFER);
  assert.deepEqual(dependency.missingDependencies,['github']);
});

test('high-risk external write requires owner approval after capability checks',()=>{
  const engine=createDecisionEngine({now:()=>4000});
  const request={
    id:'write-1',
    action:'external.write',
    capability:'github.write',
    requiredDependencies:['github']
  };

  const pending=engine.decide(request,readyContext());
  assert.equal(pending.outcome,DECISION_OUTCOMES.REQUIRE_APPROVAL);
  assert.deepEqual(pending.missingApprovals,['owner']);

  const approved=engine.decide(
    {...request,id:'write-2'},
    readyContext({approvals:{owner:true}})
  );
  assert.equal(approved.outcome,DECISION_OUTCOMES.ALLOW);
});

test('safety stop and explicit capability denial override approval',()=>{
  const engine=createDecisionEngine({now:()=>5000});
  const request={
    id:'shell-1',
    action:'system.execute',
    capability:'system.shell'
  };

  const stopped=engine.decide(
    request,
    readyContext({safetyStop:true,approvals:{owner:true}})
  );
  assert.equal(stopped.outcome,DECISION_OUTCOMES.BLOCK);
  assert.deepEqual(stopped.reasonCodes,[DECISION_REASON_CODES.SAFETY_STOP]);

  const denied=engine.decide(
    {...request,id:'shell-2'},
    readyContext({deniedCapabilities:['system.shell'],approvals:{owner:true}})
  );
  assert.equal(denied.outcome,DECISION_OUTCOMES.BLOCK);
  assert.deepEqual(denied.reasonCodes,[DECISION_REASON_CODES.CAPABILITY_DENIED]);
});

test('HumanALE integration stays deferred until final-ready lifecycle gate',()=>{
  const engine=createDecisionEngine({now:()=>6000});

  const deferred=engine.decide({
    id:'integration-1',
    action:'integration.handshake'
  },readyContext());
  assert.equal(deferred.outcome,DECISION_OUTCOMES.DEFER);
  assert.deepEqual(deferred.reasonCodes,[DECISION_REASON_CODES.GATE_NOT_READY]);
  assert.deepEqual(deferred.missingGates,['humanale.final_ready']);

  const allowed=engine.decide({
    id:'integration-2',
    action:'integration.handshake'
  },readyContext({
    gates:{
      'humanale.final_ready':true,
      'integration.contract_validated':true
    }
  }));
  assert.equal(allowed.outcome,DECISION_OUTCOMES.ALLOW);
});

test('custom policy can disable actions without modifying default policy',()=>{
  const policy=createDecisionPolicy({
    actions:{
      'memory.write':{enabled:false}
    }
  });
  const engine=createDecisionEngine({policy,now:()=>7000});
  const result=engine.decide({
    id:'memory-disabled',
    action:'memory.write'
  },readyContext());
  assert.equal(result.outcome,DECISION_OUTCOMES.BLOCK);
  assert.deepEqual(result.reasonCodes,[DECISION_REASON_CODES.ACTION_DISABLED]);
});

test('Decision Engine deduplicates IDs and bounds retained history',()=>{
  let time=8000;
  const engine=createDecisionEngine({
    now:()=>++time,
    historyLimit:2
  });

  const first=engine.decide({id:'d-1',action:'observe'},readyContext());
  const duplicate=engine.decide({id:'d-1',action:'observe'},readyContext({safetyStop:true}));
  assert.equal(duplicate.duplicate,true);
  assert.equal(duplicate.outcome,first.outcome);

  engine.decide({id:'d-2',action:'observe'},readyContext());
  engine.decide({id:'d-3',action:'observe'},readyContext());

  assert.equal(engine.snapshot().historySize,2);
  assert.equal(engine.get('d-1'),null);
  assert.equal(engine.snapshot().counters.duplicates,1);
});

test('Decision Engine event output contains audit metadata but no request label or private reasoning text',()=>{
  const bus=createEventBus();
  const events=[];
  bus.onAny(event=>events.push(event));
  const engine=createDecisionEngine({bus,now:()=>9000});

  engine.decide({
    id:'event-1',
    action:'reason',
    label:'Sensitive internal label that must not be emitted'
  },readyContext());

  const decisionEvents=events.filter(item=>item.event.startsWith('decision.'));
  assert.equal(decisionEvents.length,2);
  assert.deepEqual(
    decisionEvents.map(item=>item.event),
    ['decision.completed','decision.allowed']
  );
  const serialized=JSON.stringify(decisionEvents);
  assert.equal(serialized.includes('Sensitive internal label'),false);
  assert.equal(serialized.includes('chain-of-thought'),false);
  assert.match(serialized,/POLICY_ALLOW/);
});
