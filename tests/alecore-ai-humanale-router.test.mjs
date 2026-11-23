import test from 'node:test';
import assert from 'node:assert/strict';
import {createOrchestrator} from '../alecore-ai/brain/orchestrator.js';
import {ALECORE_AI_HUMANALE_DRY_RUN_ROUTES,previewHumanALEIntegrationRoute,describeHumanALEIntegrationDryRun} from '../alecore-ai/brain/humanale-integration-router.js';

test('dry-run router defines one non-executing route for every integration action',()=>{
 const actions=Object.keys(ALECORE_AI_HUMANALE_DRY_RUN_ROUTES);
 assert.ok(actions.length>=10);
 for(const [action,route] of Object.entries(ALECORE_AI_HUMANALE_DRY_RUN_ROUTES)){
  assert.ok(route.domain);
  assert.ok(route.operation);
  assert.equal(typeof route.mutating,'boolean');
  assert.doesNotMatch(action,/authority|shell|dispatch/);
 }
});

test('pre-final route preview remains blocked and never executes',()=>{
 const ale=createOrchestrator();ale.start();
 const result=ale.previewHumanALEIntegrationRoute({requestId:'read-1',action:'workflow.snapshot'});
 assert.equal(result.decision,'block');
 assert.equal(result.executed,false);
 assert.equal(result.dryRun,true);
 assert.equal(result.route,null);
});

test('creator-approved final read preview resolves route but still does not execute',()=>{
 const ale=createOrchestrator();ale.start();
 ale.advanceAuthorityPhase('validation');
 ale.advanceAuthorityPhase('final-integration',{creatorConfirmed:true});
 const result=ale.previewHumanALEIntegrationRoute({requestId:'read-1',action:'workflow.snapshot'});
 assert.equal(result.decision,'allow');
 assert.equal(result.executed,false);
 assert.equal(result.dryRun,true);
 assert.equal(result.route.domain,'workflow');
 assert.equal(result.route.operation,'snapshot');
 assert.equal(result.route.mutating,false);
});

test('mutating final routes remain confirm-required and non-executing',()=>{
 const ale=createOrchestrator();ale.start();
 ale.advanceAuthorityPhase('validation');
 ale.advanceAuthorityPhase('final-integration',{creatorConfirmed:true});
 const requests=[
  {requestId:'c1',action:'workflow.cancel',payload:{reason:'test'}},
  {requestId:'e1',action:'workflow.step.start',payload:{stepId:'step-1'}},
  {requestId:'p1',action:'workflow.permission.grant',payload:{permissions:['workspace:write-approved']}}
 ];
 for(const request of requests){
  const result=ale.previewHumanALEIntegrationRoute(request);
  assert.equal(result.decision,'confirm');
  assert.equal(result.requiresConfirmation,true);
  assert.equal(result.executed,false);
  assert.equal(result.route.mutating,true);
 }
});

test('invalid requests stay blocked before route lookup',()=>{
 const ale=createOrchestrator();ale.start();
 const invalid=[
  {requestId:'bad id',action:'workflow.snapshot'},
  {requestId:'x1',action:'shell.exec'},
  {requestId:'x2',action:'workflow.step.start',payload:{stepId:'../escape'}}
 ];
 for(const request of invalid){
  const result=ale.previewHumanALEIntegrationRoute(request);
  assert.equal(result.decision,'block');
  assert.equal(result.executed,false);
  assert.equal(result.route,null);
 }
});

test('dry-run description exposes routing metadata only and no execution surface',()=>{
 const ale=createOrchestrator();ale.start();
 const dry=ale.humanaleIntegrationDryRun();
 assert.equal(dry.mode,'DRY_RUN_ONLY');
 assert.equal(dry.executed,false);
 assert.equal(dry.mutationSurface,false);
 assert.equal(dry.externalAdapter,false);
 assert.equal(dry.ipcExposed,false);
 for(const key of ['executor','adapter','callback','mutator','command','token','secret','dispatch'])assert.equal(Object.hasOwn(dry,key),false);
 for(const route of dry.routes){
  for(const key of ['executor','adapter','callback','command','token','secret','method'])assert.equal(Object.hasOwn(route,key),false);
 }
});

test('dry-run helper never needs a runtime callback to produce a preview',()=>{
 const authority={
  bridge:{
   'humanale:workflow-read':{decision:'allow',reason:'TEST'},
   'humanale:workflow-control':{decision:'confirm',reason:'TEST'},
   'humanale:execution-request':{decision:'confirm',reason:'TEST'}
  }
 };
 const result=previewHumanALEIntegrationRoute({requestId:'r1',action:'readiness.certificate'},authority);
 assert.equal(result.decision,'allow');
 assert.equal(result.route.domain,'readiness');
 assert.equal(result.executed,false);
});
