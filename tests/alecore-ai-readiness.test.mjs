import test from 'node:test';
import assert from 'node:assert/strict';
import {createOrchestrator} from '../alecore-ai/brain/orchestrator.js';
import {evaluateAleIntegrationReadiness,readinessCertificate,ALECORE_AI_CRITICAL_SKILLS} from '../alecore-ai/brain/integration-readiness.js';

test('healthy development core remains locked and is not yet a final readiness certificate',()=>{
 const ale=createOrchestrator();ale.start();
 const readiness=ale.integrationReadiness();
 const certificate=ale.integrationCertificate();
 assert.equal(readiness.controlledBy,'ALECORE_AI');
 assert.equal(readiness.integrationBoundary,'LOCKED_UNTIL_CREATOR_FINAL_CONFIRMATION');
 assert.equal(readiness.phase,'development');
 assert.equal(readiness.status,'development-ready');
 assert.equal(readiness.readyForCreatorConfirmation,false);
 assert.equal(certificate.passed,false);
 assert.equal(ale.authoritySnapshot().integrationLocked,true);
 for(const decision of Object.values(ale.authoritySnapshot().bridge))assert.equal(decision.decision,'block');
});

test('validation phase can become ready for creator confirmation without opening HumanALE bridge',()=>{
 const ale=createOrchestrator();ale.start();
 ale.advanceAuthorityPhase('validation');
 const readiness=ale.integrationReadiness();
 const certificate=ale.integrationCertificate();
 assert.equal(readiness.status,'ready-for-creator-confirmation');
 assert.equal(readiness.readyForCreatorConfirmation,true);
 assert.equal(readiness.finalIntegrationApproved,false);
 assert.equal(certificate.passed,true);
 assert.equal(certificate.finalIntegrationApproved,false);
 assert.equal(ale.authoritySnapshot().integrationLocked,true);
 for(const decision of Object.values(ale.authoritySnapshot().bridge))assert.equal(decision.decision,'block');
});

test('final integration still requires explicit creator confirmation after validation readiness',()=>{
 const ale=createOrchestrator();ale.start();
 ale.advanceAuthorityPhase('validation');
 assert.throws(()=>ale.advanceAuthorityPhase('final-integration'),/konfirmasi eksplisit pencipta/);
 ale.advanceAuthorityPhase('final-integration',{creatorConfirmed:true});
 const readiness=ale.integrationReadiness();
 assert.equal(readiness.status,'final-integration-approved');
 assert.equal(readiness.finalIntegrationApproved,true);
 assert.equal(ale.authoritySnapshot().bridge['humanale:workflow-read'].decision,'allow');
 assert.equal(ale.authoritySnapshot().bridge['humanale:workflow-control'].decision,'confirm');
 assert.equal(ale.authoritySnapshot().bridge['humanale:execution-request'].decision,'confirm');
 assert.equal(ale.authoritySnapshot().bridge['humanale:authority-control'].decision,'block');
});

test('readiness fails closed for active workflow, active task, error regions and unhealthy critical skills',()=>{
 const base={
  brainState:{
   lifecycle:'active',
   currentTask:{id:'real-work',label:'Real task'},
   humanale:{controlledBy:'ALECORE_AI'},
   regions:{ERROR_MONITOR:{id:'ERROR_MONITOR',status:'error'}}
  },
  skillSnapshot:{skills:Object.fromEntries(ALECORE_AI_CRITICAL_SKILLS.map(id=>[id,{id,state:'ready'}]))},
  workflowSnapshot:{state:'running'},
  authoritySnapshot:{
   phase:'validation',
   integrationLocked:true,
   creatorDirective:{integrationPolicy:'FINAL_INTEGRATION_ONLY',workflowAuthority:'ALECORE_AI'},
   bridge:{
    'humanale:workflow-read':{decision:'block'},
    'humanale:workflow-control':{decision:'block'},
    'humanale:execution-request':{decision:'block'},
    'humanale:authority-control':{decision:'block'}
   }
  }
 };
 base.skillSnapshot.skills.reasoning={id:'reasoning',state:'error'};
 const readiness=evaluateAleIntegrationReadiness(base);
 assert.equal(readiness.status,'blocked');
 assert.equal(readiness.readyForCreatorConfirmation,false);
 for(const expected of ['core:active-task','core:error-regions','workflow:not-clear','skill:reasoning:error']){
  assert.ok(readiness.blockers.includes(expected),expected);
 }
});

test('optional integration skills warn but do not override healthy critical-core readiness',()=>{
 const skills=Object.fromEntries(ALECORE_AI_CRITICAL_SKILLS.map(id=>[id,{id,state:'ready'}]));
 skills.github={id:'github',state:'offline'};
 const readiness=evaluateAleIntegrationReadiness({
  brainState:{lifecycle:'active',currentTask:null,humanale:{controlledBy:'ALECORE_AI'},regions:{}},
  skillSnapshot:{skills},
  workflowSnapshot:{state:'idle'},
  authoritySnapshot:{
   phase:'validation',integrationLocked:true,
   creatorDirective:{integrationPolicy:'FINAL_INTEGRATION_ONLY',workflowAuthority:'ALECORE_AI'},
   bridge:{
    'humanale:workflow-read':{decision:'block'},
    'humanale:workflow-control':{decision:'block'},
    'humanale:execution-request':{decision:'block'},
    'humanale:authority-control':{decision:'block'}
   }
  }
 });
 assert.equal(readiness.status,'ready-for-creator-confirmation');
 assert.ok(readiness.warnings.includes('skill:github:offline'));
 assert.equal(readiness.blockers.length,0);
});

test('prematurely opened HumanALE bridge blocks readiness even in validation',()=>{
 const skills=Object.fromEntries(ALECORE_AI_CRITICAL_SKILLS.map(id=>[id,{id,state:'ready'}]));
 const readiness=evaluateAleIntegrationReadiness({
  brainState:{lifecycle:'active',currentTask:null,humanale:{controlledBy:'ALECORE_AI'},regions:{}},
  skillSnapshot:{skills},
  workflowSnapshot:{state:'idle'},
  authoritySnapshot:{
   phase:'validation',integrationLocked:true,
   creatorDirective:{integrationPolicy:'FINAL_INTEGRATION_ONLY',workflowAuthority:'ALECORE_AI'},
   bridge:{
    'humanale:workflow-read':{decision:'allow'},
    'humanale:workflow-control':{decision:'block'}
   }
  }
 });
 assert.equal(readiness.status,'blocked');
 assert.ok(readiness.blockers.includes('authority:bridge-open-too-early'));
});

test('readiness certificate is bounded and contains no executor or bridge-control surface',()=>{
 const skills={};
 for(let i=0;i<60;i++)skills['optional-'+i]={id:'optional-'+i,state:'offline'};
 for(const id of ALECORE_AI_CRITICAL_SKILLS)skills[id]={id,state:'ready'};
 const certificate=readinessCertificate({
  brainState:{lifecycle:'active',currentTask:null,humanale:{controlledBy:'ALECORE_AI'},regions:{}},
  skillSnapshot:{skills},
  workflowSnapshot:{state:'idle'},
  authoritySnapshot:{
   phase:'validation',integrationLocked:true,
   creatorDirective:{integrationPolicy:'FINAL_INTEGRATION_ONLY',workflowAuthority:'ALECORE_AI'},
   bridge:{
    'humanale:workflow-read':{decision:'block'},
    'humanale:workflow-control':{decision:'block'},
    'humanale:execution-request':{decision:'block'},
    'humanale:authority-control':{decision:'block'}
   }
  }
 });
 assert.ok(certificate.warnings.length<=24);
 assert.equal(Object.hasOwn(certificate,'executor'),false);
 assert.equal(Object.hasOwn(certificate,'command'),false);
 assert.equal(Object.hasOwn(certificate,'unlock'),false);
});
