import test from 'node:test';
import assert from 'node:assert/strict';
import {createOrchestrator} from '../nara-core/brain/orchestrator.js';
import {normalizeWorkflowPlan,NARA_WORKFLOW_LIMITS,createWorkflowEngine} from '../nara-core/brain/workflow-engine.js';

function completeVerified(nara,id,message='ok'){
 nara.startWorkflowStep(id);
 nara.completeWorkflowStep(id,message);
 return nara.verifyWorkflowStep(id,{ok:true,message});
}

test('NARA workflow graph rejects invalid skills, unknown dependencies and cycles',()=>{
 assert.throws(()=>normalizeWorkflowPlan({goal:'x',steps:[{id:'a',skill:'unknown'}]}),/Skill workflow tidak dikenal/);
 assert.throws(()=>normalizeWorkflowPlan({goal:'x',steps:[{id:'a',skill:'reasoning',dependsOn:['missing']}]}),/Dependency workflow tidak dikenal/);
 assert.throws(()=>normalizeWorkflowPlan({goal:'x',steps:[
  {id:'a',skill:'reasoning',dependsOn:['b']},
  {id:'b',skill:'planner',dependsOn:['a']}
 ]}),/Workflow dependency cycle/);
 assert.throws(()=>normalizeWorkflowPlan({goal:'x',steps:Array.from({length:NARA_WORKFLOW_LIMITS.maxSteps+1},(_,i)=>({id:'s-'+i,skill:'reasoning'}))}),/1–12 step/);
});

test('NARA observe workflow executes only auto-safe capability chain and completes deterministically',()=>{
 const nara=createOrchestrator();
 nara.start();
 let workflow=nara.createWorkflow({
  id:'observe-flow',
  goal:'Analyze, plan, and report without mutation',
  mode:'observe',
  steps:[
   {id:'reason',skill:'reasoning',label:'Analyze'},
   {id:'plan',skill:'planner',label:'Plan',dependsOn:['reason']},
   {id:'report',skill:'reporting',label:'Report',dependsOn:['plan']}
  ]
 });
 assert.equal(workflow.state,'planned');
 assert.deepEqual(workflow.permissions.missing,[]);
 assert.ok(workflow.workflow.steps.reason.permissions.includes('memory:read'));
 assert.equal(workflow.workflow.steps.reason.permissions.includes('memory:write-approved'),false);
 assert.equal(workflow.workflow.steps.reason.status,'ready');
 assert.equal(workflow.workflow.steps.plan.status,'blocked');
 assert.deepEqual(workflow.workflow.steps.plan.blockers,['step:reason']);

 workflow=nara.startWorkflow();
 assert.equal(workflow.state,'running');
 assert.equal(nara.nextWorkflowStep().id,'reason');

 workflow=completeVerified(nara,'reason','reason verified');
 assert.equal(workflow.workflow.steps.reason.status,'complete');
 assert.equal(workflow.workflow.steps.plan.status,'ready');
 assert.equal(nara.snapshot().regions.REASONER.status,'complete');

 workflow=completeVerified(nara,'plan','plan verified');
 assert.equal(workflow.workflow.steps.report.status,'ready');

 workflow=completeVerified(nara,'report','report verified');
 assert.equal(workflow.state,'completed');
 assert.equal(workflow.workflow.progress,100);
 assert.equal(workflow.workflow.counts.complete,3);
 assert.equal(nara.snapshot().regions.REPORTING.status,'complete');
 assert.equal(nara.workflowSnapshot().controlledBy,'NARA_CORE');
 assert.equal(nara.workflowSnapshot().executionBoundary,'NARA_CORE_ONLY');
 assert.equal(nara.workflowQueue().active,null);
 assert.equal(nara.workflowQueue().next,null);
 const report=nara.workflowReport();
 assert.equal(report.executionBoundary,'NARA_CORE_ONLY');
 assert.equal(report.state,'completed');
 assert.equal(report.progress,100);
 assert.equal(report.checkpoints.length,3);
 assert.deepEqual(report.checkpoints.map(item=>item.stepId),['reason','plan','report']);
});

test('observe workflow cannot receive execution approval or run mutating Program capability',()=>{
 const nara=createOrchestrator();nara.start();
 let workflow=nara.createWorkflow({
  id:'observe-program',
  goal:'Inspect program workflow',
  mode:'observe',
  steps:[{id:'code',skill:'program'}]
 });
 assert.equal(workflow.workflow.steps.code.status,'blocked');
 assert.ok(workflow.workflow.steps.code.blockers.includes('mode:observe'));
 assert.ok(workflow.permissions.missing.includes('workspace:write-approved'));
 assert.ok(workflow.permissions.missing.includes('terminal:bounded-execute'));
 assert.throws(()=>nara.grantWorkflowPermissions(['workspace:write-approved']),/observe tidak dapat menerima permission eksekusi/);
 workflow=nara.startWorkflow();
 assert.equal(workflow.state,'blocked');
 assert.equal(nara.nextWorkflowStep(),null);
});

test('execute workflow derives transitive permissions and becomes ready only after explicit grants',()=>{
 const nara=createOrchestrator();nara.start();
 let workflow=nara.createWorkflow({
  id:'execute-program',
  goal:'Controlled program execution',
  mode:'execute',
  steps:[{id:'code',skill:'program'}]
 });
 const permissions=workflow.workflow.steps.code.permissions;
 assert.ok(permissions.includes('workspace:write-approved'));
 assert.ok(permissions.includes('terminal:bounded-execute'));
 assert.ok(permissions.includes('policy:enforce'));
 assert.equal(permissions.includes('memory:write-approved'),false);
 assert.ok(workflow.permissions.granted.includes('policy:enforce'));
 assert.ok(workflow.permissions.missing.includes('workspace:write-approved'));
 assert.ok(workflow.permissions.missing.includes('terminal:bounded-execute'));
 assert.equal(workflow.workflow.steps.code.status,'blocked');

 workflow=nara.startWorkflow();
 assert.equal(workflow.state,'blocked');
 assert.equal(nara.snapshot().regions.FOLLOW_UP.status,'paused');
 assert.equal(nara.workflowQueue().next,null);
 assert.ok(nara.workflowQueue().blocked.some(item=>item.id==='code'));
 workflow=nara.grantWorkflowPermissions(['workspace:write-approved']);
 assert.equal(workflow.workflow.steps.code.status,'blocked');
 workflow=nara.grantWorkflowPermissions(['terminal:bounded-execute']);
 assert.equal(workflow.workflow.steps.code.status,'ready');
 assert.equal(workflow.state,'running');
 assert.equal(nara.workflowQueue().next,'code');
 assert.equal(nara.snapshot().regions.SAFETY.status,'ready');
 const events=workflow.history.map(item=>item.event);
 assert.ok(events.indexOf('workflow.started')<events.indexOf('workflow.blocked'));
 assert.ok(events.includes('workflow.resumed'));

 workflow=nara.startWorkflowStep('code');
 assert.equal(workflow.workflow.steps.code.status,'running');
 assert.equal(nara.snapshot().regions.PROGRAM.status,'processing');
});

test('revoking an execution permission fails an active step immediately',()=>{
 const nara=createOrchestrator();nara.start();
 nara.createWorkflow({id:'revoke-flow',goal:'Test revoke',mode:'execute',steps:[{id:'code',skill:'program'}]});
 nara.startWorkflow();
 nara.grantWorkflowPermissions(['workspace:write-approved','terminal:bounded-execute']);
 nara.startWorkflowStep('code');
 const workflow=nara.revokeWorkflowPermissions(['workspace:write-approved']);
 assert.equal(workflow.state,'failed');
 assert.equal(workflow.workflow.steps.code.status,'failed');
 assert.ok(workflow.workflow.steps.code.blockers.includes('permission-revoked:workspace:write-approved'));
 assert.equal(nara.snapshot().regions.PROGRAM.status,'error');
});

test('failed workflow step can recover once and retry at most twice',()=>{
 const nara=createOrchestrator();nara.start();
 nara.createWorkflow({id:'retry-flow',goal:'Retry bounded work',mode:'execute',steps:[{id:'code',skill:'program'}]});
 nara.startWorkflow();
 nara.grantWorkflowPermissions(['workspace:write-approved','terminal:bounded-execute']);

 nara.startWorkflowStep('code');
 let workflow=nara.failWorkflowStep('code','synthetic-failure');
 assert.equal(workflow.workflow.steps.code.attempts,1);
 assert.equal(workflow.state,'failed');

 workflow=nara.recoverWorkflowStep('code');
 assert.equal(workflow.state,'running');
 assert.equal(workflow.workflow.steps.code.status,'ready');
 assert.equal(nara.snapshot().regions.PROGRAM.status,'ready');

 nara.startWorkflowStep('code');
 workflow=nara.failWorkflowStep('code','synthetic-failure-2');
 assert.equal(workflow.workflow.steps.code.attempts,2);
 assert.throws(()=>nara.recoverWorkflowStep('code'),/Batas retry workflow tercapai/);
});

test('workflow allows only one active step at a time even when multiple steps are ready',()=>{
 const nara=createOrchestrator();nara.start();
 nara.createWorkflow({
  id:'serial-flow',goal:'Keep execution serial',mode:'observe',
  steps:[{id:'a',skill:'reasoning'},{id:'b',skill:'reporting'}]
 });
 nara.startWorkflow();
 let workflow=nara.startWorkflowStep('a');
 assert.equal(workflow.workflow.steps.a.status,'running');
 assert.equal(workflow.workflow.steps.b.status,'ready');
 assert.throws(()=>nara.startWorkflowStep('b'),/Hanya satu step workflow NARA boleh aktif/);
});


test('workflow monitor history remains bounded and report never exposes an execution adapter',()=>{
 let now=1000;
 const engine=createWorkflowEngine({clock:()=>++now});
 const skillSnapshot={skills:{reasoning:{state:'ready',missingDependencies:[]},memory:{state:'ready',missingDependencies:[]}}};
 engine.create({id:'history-flow',goal:'Bound monitor history',mode:'observe',steps:[{id:'reason',skill:'reasoning'}]},skillSnapshot);
 for(let i=0;i<50;i++)engine.grantPermissions(['state:read'],skillSnapshot);
 const snapshot=engine.snapshot();
 assert.equal(snapshot.history.length,NARA_WORKFLOW_LIMITS.maxHistory);
 assert.equal(snapshot.executionBoundary,'NARA_CORE_ONLY');
 assert.equal(Object.hasOwn(snapshot,'executor'),false);
 const report=engine.report();
 assert.equal(report.executionBoundary,'NARA_CORE_ONLY');
 assert.equal(Object.hasOwn(report,'adapter'),false);
 assert.equal(Object.hasOwn(report,'command'),false);
});
