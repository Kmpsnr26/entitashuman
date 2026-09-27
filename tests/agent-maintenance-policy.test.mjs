import {
 AI_MAINTENANCE_AUTOPILOT_MAX_ATTEMPTS,
 autopilotSnapshot,
 createAutopilotAttemptPrompt,
 isNonRetryableMaintenanceError,
 normalizeAutopilotAttempts
} from '../desktop/maintenance-autopilot.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {
 AI_MAINTENANCE_ALLOWED_CAPABILITIES,
 AI_MAINTENANCE_DENIED_CAPABILITIES,
 assertMaintenanceTaskAllowed,
 buildMaintenanceWorkPrompt,
 evaluateMaintenanceTask,
 maintenancePolicySnapshot,
 isProtectedMaintenancePath
} from '../desktop/agent-maintenance-policy.mjs';

test('AI maintenance policy is repair-only and denies all owner/release authority',()=>{
 const snapshot=maintenancePolicySnapshot();
 assert.equal(snapshot.mode,'REPAIR_ONLY');
 assert.equal(snapshot.ownerAuthority,false);
 assert.equal(snapshot.selfPrivilegeEscalation,false);
 assert.equal(snapshot.autoApproval,false);
 assert.equal(snapshot.releaseAuthority,false);

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
 assert.match(prompt,/Jangan mengedit area dilindungi/);
});

test('Agent Hub enforces maintenance policy before work execution and requires a clean Git worktree',async()=>{
 const hub=await readFile(new URL('../desktop/agent-hub.mjs',import.meta.url),'utf8');
 assert.match(hub,/agent-maintenance-policy\.mjs/);
 assert.match(hub,/assertMaintenanceTaskAllowed\(prompt,\{mode\}\)/);
 assert.match(hub,/git',\['status','--porcelain'\]/);
 assert.match(hub,/AI maintenance hanya boleh dimulai dari Git worktree bersih/);
 assert.match(hub,/buildMaintenanceWorkPrompt\(prompt\)/);
 assert.match(hub,/maintenancePolicy:maintenancePolicySnapshot\(\)/);
 assert.match(hub,/--sandbox','workspace-write/);
 assert.match(hub,/--available-tools=view,grep,glob,edit,create,apply_patch/);
 assert.doesNotMatch(hub,/--dangerously-skip-permissions|bypassPermissions/);
});


test('protected maintenance paths cover owner authority, secrets, self-policy and release control',()=>{
 for(const path of [
  '.git/config',
  '.env',
  '.env.production',
  'nara-cloud/.env',
  'nara-cloud/src/db/migrate.ts',
  'nara-cloud/src/apps/authServer.ts',
  'nara-cloud/src/services/owner.service.ts',
  'nara-cloud/src/scripts/createOwner.ts',
  'nara-cloud/src/security/password.ts',
  'nara-cloud/src/sessions/session.ts',
  'nara-core/permissions/approval-manager.js',
  '.github/workflows/verify.yml',
  '.github/workflows/cloud-auto-repair.yml',
  'package.json',
  'package-lock.json',
  'electron-builder.yml',
  'docs/humanale-final-readiness-certificate.json',
  'desktop/agent-hub.mjs',
  'desktop/agent-maintenance-policy.mjs'
 ]){
  assert.equal(isProtectedMaintenancePath(path),true,path);
 }
 for(const path of [
  'public/avatar.js',
  'public/app.js',
  'desktop/audio-reactor.mjs',
  'tests/avatar.test.mjs',
  'nara-core/brain/brain-state.js'
 ]){
  assert.equal(isProtectedMaintenancePath(path),false,path);
 }
});

test('Agent Hub audits changed paths and rolls back failed or protected maintenance runs',async()=>{
 const hub=await readFile(new URL('../desktop/agent-hub.mjs',import.meta.url),'utf8');
 assert.match(hub,/async function maintenanceChangedPaths\(cwd\)/);
 assert.match(hub,/\['diff','--name-only','HEAD','--'\]/);
 assert.match(hub,/\['ls-files','--others','--exclude-standard'\]/);
 assert.match(hub,/changedPaths\.filter\(isProtectedMaintenancePath\)/);
 assert.match(hub,/AI_MAINTENANCE_PROTECTED_PATH/);
 assert.match(hub,/async function rollbackMaintenanceWorktree\(cwd\)/);
 assert.match(hub,/\['reset','--hard','HEAD'\]/);
 assert.match(hub,/\['clean','-fd'\]/);
 assert.match(hub,/AI_MAINTENANCE_ROLLBACK_FAILED/);
 assert.match(hub,/rollback:false/);
});


test('bounded maintenance autopilot has a hard two-attempt ceiling and no daemon mode',()=>{
 assert.equal(AI_MAINTENANCE_AUTOPILOT_MAX_ATTEMPTS,2);
 assert.equal(normalizeAutopilotAttempts(undefined),2);
 assert.equal(normalizeAutopilotAttempts(99),2);
 assert.equal(normalizeAutopilotAttempts(0),1);
 assert.equal(normalizeAutopilotAttempts(1),1);

 const snapshot=autopilotSnapshot();
 assert.equal(snapshot.mode,'BOUNDED_REPAIR');
 assert.equal(snapshot.backgroundDaemon,false);
 assert.equal(snapshot.ownerAuthority,false);
 assert.equal(snapshot.releaseAuthority,false);
 assert.equal(snapshot.verifyCommand,'npm run verify');

 assert.equal(isNonRetryableMaintenanceError({code:'AI_MAINTENANCE_BOUNDARY_BLOCKED'}),true);
 assert.equal(isNonRetryableMaintenanceError({code:'AI_MAINTENANCE_PROTECTED_PATH'}),true);
 assert.equal(isNonRetryableMaintenanceError({code:'AI_MAINTENANCE_ROLLBACK_FAILED'}),true);
 assert.equal(isNonRetryableMaintenanceError({code:'WORK_FAILED'}),false);

 assert.equal(createAutopilotAttemptPrompt('perbaiki bug',{attempt:1}),'perbaiki bug');
 const retry=createAutopilotAttemptPrompt('perbaiki bug',{attempt:2});
 assert.match(retry,/AUTOPILOT RETRY/);
 assert.match(retry,/rollback ke HEAD/);
 assert.match(retry,/Jangan memperluas scope/);
});

test('Agent Hub bounded autopilot forces orchestrator, deterministic verify and rollback',async()=>{
 const hub=await readFile(new URL('../desktop/agent-hub.mjs',import.meta.url),'utf8');
 assert.match(hub,/async runAutopilot\(value=\{\}\)/);
 assert.match(hub,/normalizeAutopilotAttempts\(value\?\.maxAttempts\)/);
 assert.match(hub,/id:'humanale-orchestrator'/);
 assert.match(hub,/mode:'work'/);
 assert.match(hub,/\['run','verify'\]/);
 assert.match(hub,/AI_MAINTENANCE_AUTOPILOT_VERIFY_TIMEOUT_MS/);
 assert.match(hub,/rollbackMaintenanceWorktree\(cwd\)/);
 assert.match(hub,/isNonRetryableMaintenanceError\(error\)/);
 assert.match(hub,/AI_MAINTENANCE_VERIFY_FAILED/);
 assert.match(hub,/this\.autopilotPending=true/);
 assert.match(hub,/this\.autopilotPending=false/);
 assert.doesNotMatch(hub,/while\s*\(\s*true\s*\)|setInterval\s*\(/);
});
