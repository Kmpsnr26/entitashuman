import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {
 AI_MAINTENANCE_AUTOPILOT_MAX_ATTEMPTS,
 autopilotSnapshot,
 createAutopilotAttemptPrompt,
 isNonRetryableMaintenanceError,
 normalizeAutopilotAttempts
} from '../desktop/maintenance-autopilot.mjs';

test('bounded autopilot has a hard two-attempt ceiling and no background/release authority',()=>{
 assert.equal(AI_MAINTENANCE_AUTOPILOT_MAX_ATTEMPTS,2);
 assert.equal(normalizeAutopilotAttempts(undefined),2);
 assert.equal(normalizeAutopilotAttempts(99),2);
 assert.equal(normalizeAutopilotAttempts(0),1);
 const snapshot=autopilotSnapshot();
 assert.equal(snapshot.mode,'BOUNDED_REPAIR');
 assert.equal(snapshot.backgroundDaemon,false);
 assert.equal(snapshot.ownerAuthority,false);
 assert.equal(snapshot.releaseAuthority,false);
 assert.equal(snapshot.directMainWrite,false);
 assert.equal(snapshot.verifyCommand,'npm run verify');
});

test('authority, repository identity and transaction violations are non-retryable',()=>{
 for(const code of [
  'AI_MAINTENANCE_BOUNDARY_BLOCKED',
  'AI_MAINTENANCE_CHANGESET_BLOCKED',
  'AI_MAINTENANCE_MANUAL_RECOVERY_REQUIRED',
  'AI_MAINTENANCE_REPO_LOCKED',
  'AI_MAINTENANCE_PROTECTED_BRANCH',
  'AI_MAINTENANCE_SECRET_FILE_PRESENT',
  'AI_MAINTENANCE_DIRTY_WORKTREE',
  'AI_MAINTENANCE_ROLLBACK_INCOMPLETE'
 ]){
  assert.equal(isNonRetryableMaintenanceError({code}),true,code);
 }
 assert.equal(isNonRetryableMaintenanceError({code:'WORK_FAILED'}),false);
});

test('retry prompt stays bounded and records transaction rollback',()=>{
 assert.equal(createAutopilotAttemptPrompt('perbaiki bug',{attempt:1}),'perbaiki bug');
 const retry=createAutopilotAttemptPrompt('perbaiki bug',{attempt:2});
 assert.match(retry,/AUTOPILOT RETRY/);
 assert.match(retry,/maintenance transaction/);
 assert.match(retry,/Jangan memperluas scope/);
});

test('Agent Hub keeps one transaction through worker and deterministic verify',async()=>{
 const hub=await readFile(new URL('../desktop/agent-hub.mjs',import.meta.url),'utf8');
 assert.match(hub,/async runAutopilot\(value=\{\}\)/);
 assert.match(hub,/beginMaintenanceTransaction\(cwd\)/);
 assert.match(hub,/internal:true,transaction/);
 assert.match(hub,/id:'humanale-orchestrator'/);
 assert.match(hub,/\['run','verify'\]/);
 assert.match(hub,/env:verifyEnv/);
 assert.match(hub,/transaction\.inspect\(\)/);
 assert.match(hub,/transaction\.rollback\('VERIFY_FAILED'\)/);
 assert.match(hub,/AI_MAINTENANCE_VERIFY_FAILED/);
 assert.match(hub,/this\.autopilotPending=true/);
 assert.match(hub,/this\.autopilotPending=false/);
 assert.doesNotMatch(hub,/while\s*\(\s*true\s*\)|setInterval\s*\(/);
});
