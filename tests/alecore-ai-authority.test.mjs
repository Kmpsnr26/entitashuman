import test from 'node:test';
import assert from 'node:assert/strict';
import {
 createAuthorityPolicy,
 isKnownPermission,
 permissionDecision,
 shouldInheritDependencyPermission,
 ALECORE_AI_BRIDGE_CAPABILITIES,
 ALECORE_AI_AUTHORITY_LIMITS
} from '../ALECORE-AI/brain/authority-policy.js';
import {createOrchestrator} from '../ALECORE-AI/brain/orchestrator.js';

test('AleCore AI authority policy centralizes known permission decisions',()=>{
 for(const permission of ['sensor:read','state:read','memory:read','diagnostic:read','network:read','repo:read','report:write','policy:enforce']){
  assert.equal(isKnownPermission(permission),true);
  assert.equal(permissionDecision(permission,{mode:'observe'}).decision,'allow');
 }
 for(const permission of ['audio:output','camera:read','memory:write-approved','agent:execute-approved','terminal:bounded-execute','workspace:write-approved','repo:write-approved','cloud:write-approved']){
  assert.equal(isKnownPermission(permission),true);
  assert.equal(permissionDecision(permission,{mode:'observe'}).decision,'block');
  assert.equal(permissionDecision(permission,{mode:'execute'}).decision,'confirm');
 }
 assert.equal(permissionDecision('owner:secret',{mode:'execute'}).decision,'block');
 assert.equal(shouldInheritDependencyPermission('memory:read'),true);
 assert.equal(shouldInheritDependencyPermission('memory:write-approved'),false);
 assert.equal(shouldInheritDependencyPermission('terminal:bounded-execute'),true);
});

test('creator final-integration directive keeps every HumanALE workflow bridge locked by default',()=>{
 const authority=createAuthorityPolicy();
 const snapshot=authority.snapshot();
 assert.equal(snapshot.controlledBy,'ALECORE_AI');
 assert.equal(snapshot.creatorDirective.integrationPolicy,'FINAL_INTEGRATION_ONLY');
 assert.equal(snapshot.integrationLocked,true);
 assert.equal(snapshot.phase,'development');
 for(const capability of ALECORE_AI_BRIDGE_CAPABILITIES){
  assert.equal(snapshot.bridge[capability].decision,'block');
  assert.equal(snapshot.bridge[capability].reason,'FINAL_INTEGRATION_LOCKED');
 }
});

test('authority phase progression is ordered and final integration requires explicit creator confirmation',()=>{
 const authority=createAuthorityPolicy();
 assert.throws(()=>authority.advancePhase('final-integration',{creatorConfirmed:true}),/harus berurutan/);
 let snapshot=authority.advancePhase('validation');
 assert.equal(snapshot.phase,'validation');
 assert.equal(snapshot.integrationLocked,true);
 assert.throws(()=>authority.advancePhase('final-integration'),/konfirmasi eksplisit pencipta/);

 snapshot=authority.advancePhase('final-integration',{creatorConfirmed:true});
 assert.equal(snapshot.phase,'final-integration');
 assert.equal(snapshot.finalIntegrationApproved,true);
 assert.equal(snapshot.integrationLocked,false);
 assert.equal(snapshot.bridge['humanale:workflow-read'].decision,'allow');
 assert.equal(snapshot.bridge['humanale:workflow-control'].decision,'confirm');
 assert.equal(snapshot.bridge['humanale:execution-request'].decision,'confirm');
 assert.equal(snapshot.bridge['humanale:authority-control'].decision,'block');

 assert.throws(()=>authority.advancePhase('released'),/konfirmasi eksplisit pencipta/);
 snapshot=authority.advancePhase('released',{creatorConfirmed:true});
 assert.equal(snapshot.phase,'released');
 assert.equal(snapshot.integrationLocked,false);
});

test('AleCore AI orchestrator owns authority policy without exposing it through HumanALE',()=>{
 const nara=createOrchestrator();
 const initial=ale.authoritySnapshot();
 assert.equal(initial.phase,'development');
 assert.equal(initial.integrationLocked,true);
 ale.advanceAuthorityPhase('validation');
 assert.equal(ale.authoritySnapshot().phase,'validation');
});

test('authority transition history is bounded',()=>{
 let time=0;
 const authority=createAuthorityPolicy({clock:()=>++time});
 authority.advancePhase('validation');
 authority.advancePhase('final-integration',{creatorConfirmed:true});
 authority.advancePhase('released',{creatorConfirmed:true});
 for(let i=0;i<100;i++)authority.record('audit.event','event-'+i);
 assert.equal(authority.snapshot().history.length,ALECORE_AI_AUTHORITY_LIMITS.maxHistory);
 assert.equal(authority.snapshot().history.at(-1).detail,'event-99');
});
