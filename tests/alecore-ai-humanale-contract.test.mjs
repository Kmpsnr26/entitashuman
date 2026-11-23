import test from 'node:test';
import assert from 'node:assert/strict';
import {createOrchestrator} from '../alecore-ai/brain/orchestrator.js';
import {
 ALECORE_AI_HUMANALE_PROTOCOL,
 ALECORE_AI_HUMANALE_ACTIONS,
 isHumanALEIntegrationAction,
 normalizeHumanALEIntegrationRequest,
 evaluateHumanALEIntegrationRequest,
 describeHumanALEIntegrationContract
} from '../alecore-ai/brain/humanale-integration-contract.js';

test('final integration contract exposes only bounded whitelisted HumanALE actions',()=>{
 assert.equal(ALECORE_AI_HUMANALE_PROTOCOL,'alecore-ai-humanale/1');
 assert.ok(ALECORE_AI_HUMANALE_ACTIONS.includes('workflow.snapshot'));
 assert.ok(ALECORE_AI_HUMANALE_ACTIONS.includes('workflow.step.start'));
 assert.equal(isHumanALEIntegrationAction('authority.advance'),false);
 assert.equal(isHumanALEIntegrationAction('shell.exec'),false);
 assert.equal(isHumanALEIntegrationAction('ale.dispatch'),false);
 for(const key of ['__proto__','constructor','prototype'])assert.equal(isHumanALEIntegrationAction(key),false);
});

test('integration request normalization strips arbitrary fields and bounds payload',()=>{
 const request=normalizeHumanALEIntegrationRequest({
  requestId:'request-1',
  action:'workflow.step.complete',
  payload:{
   stepId:'step-1',
   result:'x'.repeat(500),
   command:'powershell -enc secret',
   event:'owner.secret',
   token:'abc'
  },
  executor:'shell'
 });
 assert.equal(request.protocol,ALECORE_AI_HUMANALE_PROTOCOL);
 assert.equal(request.requestId,'request-1');
 assert.equal(request.action,'workflow.step.complete');
 assert.equal(request.payload.stepId,'step-1');
 assert.equal(request.payload.result.length,320);
 assert.equal(Object.hasOwn(request.payload,'command'),false);
 assert.equal(Object.hasOwn(request.payload,'event'),false);
 assert.equal(Object.hasOwn(request.payload,'token'),false);
 assert.equal(Object.hasOwn(request,'executor'),false);
});

test('malformed or unknown integration requests fail closed',()=>{
 const authority={bridge:{}};
 for(const value of [
  {requestId:'BAD ID',action:'workflow.snapshot'},
  {requestId:'r1',action:'authority.advance'},
  {requestId:'r2',action:'workflow.step.start',payload:{stepId:'../escape'}},
  {requestId:'r3',action:'workflow.permission.grant',payload:{permissions:[]}}
 ]){
  const result=evaluateHumanALEIntegrationRequest(value,authority);
  assert.equal(result.decision,'block');
  assert.equal(result.reason,'INVALID_REQUEST');
 }
});

test('development and validation keep every contract action blocked',()=>{
 const ale=createOrchestrator();ale.start();
 for(const phase of ['development','validation']){
  if(phase==='validation')ale.advanceAuthorityPhase('validation');
  const contract=ale.humanaleIntegrationContract();
  assert.equal(contract.controlledBy,'ALECORE_AI');
  assert.equal(contract.integrationPolicy,'FINAL_INTEGRATION_ONLY');
  assert.equal(contract.directMethodAccess,false);
  assert.equal(contract.arbitraryDispatch,false);
  assert.equal(contract.authorityControl,false);
  for(const action of contract.actions)assert.equal(action.decision,'block',phase+' '+action.action);

  const read=ale.evaluateHumanALEIntegrationRequest({requestId:'read-1',action:'workflow.snapshot'});
  const control=ale.evaluateHumanALEIntegrationRequest({requestId:'control-1',action:'workflow.cancel',payload:{reason:'user request'}});
  assert.equal(read.decision,'block');
  assert.equal(control.decision,'block');
 }
});

test('creator-approved final integration allows reads but keeps control and execution per-action confirmation',()=>{
 const ale=createOrchestrator();ale.start();
 ale.advanceAuthorityPhase('validation');
 ale.advanceAuthorityPhase('final-integration',{creatorConfirmed:true});

 const read=ale.evaluateHumanALEIntegrationRequest({requestId:'read-1',action:'workflow.snapshot'});
 assert.equal(read.decision,'allow');
 assert.equal(read.capability,'humanale:workflow-read');

 const control=ale.evaluateHumanALEIntegrationRequest({
  requestId:'control-1',action:'workflow.cancel',payload:{reason:'creator request'}
 });
 assert.equal(control.decision,'confirm');
 assert.equal(control.capability,'humanale:workflow-control');

 const execution=ale.evaluateHumanALEIntegrationRequest({
  requestId:'exec-1',action:'workflow.step.start',payload:{stepId:'step-1'}
 });
 assert.equal(execution.decision,'confirm');
 assert.equal(execution.capability,'humanale:execution-request');

 assert.equal(isHumanALEIntegrationAction('authority.advance'),false);
 assert.equal(ale.authoritySnapshot().bridge['humanale:authority-control'].decision,'block');
});

test('contract description carries no executable adapter, shell command, token or direct method map',()=>{
 const contract=describeHumanALEIntegrationContract({
  bridge:{
   'humanale:workflow-read':{decision:'allow'},
   'humanale:workflow-control':{decision:'confirm'},
   'humanale:execution-request':{decision:'confirm'}
  }
 });
 assert.ok(contract.actions.length>0);
 for(const key of ['executor','adapter','command','token','secret','methods','dispatch'])assert.equal(Object.hasOwn(contract,key),false);
 for(const action of contract.actions){
  for(const key of ['executor','adapter','command','token','secret','method'])assert.equal(Object.hasOwn(action,key),false);
 }
});
