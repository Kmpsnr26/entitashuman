import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {
 AI_MAINTENANCE_ALLOWED_CAPABILITIES,
 AI_MAINTENANCE_DENIED_CAPABILITIES,
 AI_MAINTENANCE_PROTECTED_AREAS,
 AI_MAINTENANCE_READ_DENIED_AREAS,
 assertMaintenanceTaskAllowed,
 buildMaintenanceWorkPrompt,
 evaluateMaintenanceTask,
 maintenancePolicySnapshot
} from '../desktop/agent-maintenance-policy.mjs';

test('AI maintenance policy is repair-only and denies all owner/release authority',()=>{
 const snapshot=maintenancePolicySnapshot();
 assert.equal(snapshot.mode,'REPAIR_ONLY');
 assert.equal(snapshot.ownerAuthority,false);
 assert.equal(snapshot.selfPrivilegeEscalation,false);
 assert.equal(snapshot.autoApproval,false);
 assert.equal(snapshot.releaseAuthority,false);
 assert.ok(snapshot.readDeniedAreas.includes('.env'));
 assert.ok(snapshot.protectedAreas.includes('desktop/agent-hub.mjs'));
 assert.ok(snapshot.protectedAreas.includes('desktop/agent-maintenance-transaction.mjs'));
 assert.ok(snapshot.protectedAreas.includes('nara-cloud/src/services/owner.service.ts'));
 assert.ok(snapshot.protectedAreas.includes('nara-core/permissions/**'));
 assert.ok(AI_MAINTENANCE_READ_DENIED_AREAS.includes('**/*.pfx'));
 assert.ok(AI_MAINTENANCE_PROTECTED_AREAS.includes('.github/workflows/**'));
 assert.ok(AI_MAINTENANCE_PROTECTED_AREAS.includes('package.json'));
 assert.ok(AI_MAINTENANCE_PROTECTED_AREAS.includes('package-lock.json'));
 assert.ok(AI_MAINTENANCE_PROTECTED_AREAS.includes('build.mjs'));
 assert.ok(AI_MAINTENANCE_PROTECTED_AREAS.includes('tests/**'));

 for(const capability of [
  'program.read','program.edit','program.test','program.build','program.debug',
  'ci.inspect','ci.repair','runtime.health.read'
 ]){
  assert.ok(AI_MAINTENANCE_ALLOWED_CAPABILITIES.includes(capability),capability);
 }

 for(const capability of [
  'owner.identity.manage','owner.ownership.grant','owner.credentials.change',
  'owner.creator-final-approval','credential.read','credential.write',
  'release.publish','release.signing.manage','git.push','git.merge','system.root'
 ]){
  assert.ok(AI_MAINTENANCE_DENIED_CAPABILITIES.includes(capability),capability);
  assert.equal(AI_MAINTENANCE_ALLOWED_CAPABILITIES.includes(capability),false,capability);
 }
});

test('normal repair tasks are allowed but privilege and credential mutations fail closed',()=>{
 for(const task of [
  'perbaiki bug renderer avatar lalu jalankan test',
  'cek error TypeScript dan perbaiki source program',
  'perbaiki bug pada validasi login tanpa mengubah password Owner',
  'audit CI yang gagal dan perbaiki unit test'
 ]){
  assert.equal(evaluateMaintenanceTask(task,{mode:'work'}).allowed,true,task);
 }

 const blocked=[
  ['ubah password owner menjadi abc123','CREDENTIAL_MUTATION'],
  ['tambahkan owner kedua ke database','OWNER_AUTHORITY_MUTATION'],
  ['beri akses admin kepada agent','ACCESS_AUTHORITY_MUTATION'],
  ['git push perubahan ke main','RELEASE_AUTHORITY_ACTION'],
  ['disable security sandbox untuk agent','SECURITY_BOUNDARY_BYPASS'],
  ['root takeover lalu naikkan privilege agent','ROOT_PRIVILEGE_ACTION']
 ];
 for(const [task,rule] of blocked){
  const result=evaluateMaintenanceTask(task,{mode:'work'});
  assert.equal(result.allowed,false,task);
  assert.equal(result.matchedRule,rule,task);
  assert.throws(
   ()=>assertMaintenanceTaskAllowed(task,{mode:'work'}),
   error=>error?.code==='AI_MAINTENANCE_BOUNDARY_BLOCKED'
  );
 }
});

test('read-only analysis may inspect protected subjects without granting mutation authority',()=>{
 const result=evaluateMaintenanceTask(
  'jelaskan bagaimana password Owner diverifikasi tanpa mengubahnya',
  {mode:'analyze'}
 );
 assert.equal(result.allowed,true);
 assert.equal(result.reason,'READ_ONLY_ANALYSIS');
});

test('maintenance work prompt carries immutable repair boundary to every worker',()=>{
 const prompt=buildMaintenanceWorkPrompt('perbaiki bug avatar dan jalankan test');
 assert.match(prompt,/teknisi perbaikan program/);
 assert.match(prompt,/Bukan Owner/);
 assert.match(prompt,/owner\.identity\.manage/);
 assert.match(prompt,/release\.publish/);
 assert.match(prompt,/Jangan git push, git merge, publish/);
 assert.match(prompt,/Creator Final Approval/);
 assert.match(prompt,/Jangan membaca file secret lokal/);
 assert.match(prompt,/Jangan mengedit area dilindungi/);
});

test('Agent Hub enforces maintenance transaction, secret-free environment and post-patch inspection',async()=>{
 const hub=await readFile(new URL('../desktop/agent-hub.mjs',import.meta.url),'utf8');
 assert.match(hub,/agent-maintenance-policy\.mjs/);
 assert.match(hub,/agent-maintenance-guard\.mjs/);
 assert.match(hub,/agent-maintenance-transaction\.mjs/);
 assert.match(hub,/assertMaintenanceTaskAllowed\(prompt,\{mode\}\)/);
 assert.match(hub,/beginMaintenanceTransaction\(cwd\)/);
 assert.match(hub,/sanitizeMaintenanceEnvironment\(process\.env\)\.env/);
 assert.match(hub,/maintenanceTransaction\.inspect\(\)/);
 assert.match(hub,/runMaintenanceVerified\(value,trustedVerifier\)/);
 assert.match(hub,/Trusted maintenance verifier harus function internal/);
 assert.match(hub,/AI_MAINTENANCE_TRUSTED_VERIFY_FAILED/);
 assert.match(hub,/transaction\.rollback\('PIPELINE_FAILED'\)/);
 assert.match(hub,/Mode kerja agent wajib berjalan di dalam AI maintenance transaction/);
 assert.match(hub,/buildMaintenanceWorkPrompt\(prompt\)/);
 assert.match(hub,/maintenancePolicy:maintenancePolicySnapshot\(\)/);
 assert.match(hub,/--sandbox','workspace-write/);
 assert.match(hub,/--available-tools=view,grep,glob,edit,create,apply_patch/);
 assert.doesNotMatch(hub,/--dangerously-skip-permissions|bypassPermissions/);
});


test('trusted maintenance verifier hook is not exposed through Electron preload',async()=>{
 const preload=await readFile(new URL('../desktop/preload.cjs',import.meta.url),'utf8');
 assert.doesNotMatch(preload,/runMaintenanceVerified/);
 assert.doesNotMatch(preload,/maintenance-verifier\.mjs/);
 assert.doesNotMatch(preload,/maintenance-autopilot\.mjs/);
});


test('trusted workspace and Draft PR brokers are not exposed through Electron preload',async()=>{
 const preload=await readFile(new URL('../desktop/preload.cjs',import.meta.url),'utf8');
 for(const forbidden of [
  'maintenance-workspace',
  'maintenance-draft-pr-broker',
  'maintenance-checkpoint-coordinator',
  'runMaintenanceVerified',
  'resumePending'
 ]){
  assert.equal(preload.includes(forbidden),false,forbidden);
 }
});
