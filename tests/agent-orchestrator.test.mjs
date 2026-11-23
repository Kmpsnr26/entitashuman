import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {classifyTaskDifficulty,reviewVerdict,selectStructuredRoles,requireIndependentWorkReview,agentTimeoutMs} from '../desktop/agent-hub.mjs';

test('structured HumanALE orchestrator classifies difficult work and review verdicts',()=>{
 assert.equal(classifyTaskDifficulty('halo'),'low');
 assert.equal(classifyTaskDifficulty('review runtime lalu perbaiki bug, jalankan test, audit security dan build Electron release'),'high');
 assert.equal(reviewVerdict('Semua sesuai.\nVERDICT: PASS'),'pass');
 assert.equal(reviewVerdict('Masih ada regression.\nVERDICT: NEEDS_FIX'),'needs_fix');
 assert.equal(reviewVerdict('belum ada keputusan'),'unknown');
 const two=selectStructuredRoles(['codex','github-copilot']);
 assert.deepEqual(two,{planner:'codex',worker:'github-copilot',reviewer:'codex',degraded:false,executors:['codex','github-copilot']});
 const alternate=selectStructuredRoles(['github-copilot','cursor']);
 assert.equal(alternate.worker,'cursor');
 assert.equal(alternate.reviewer,'github-copilot');
 assert.equal(alternate.degraded,false);
 const explicit=selectStructuredRoles(['codex','github-copilot','cursor'],'cursor');
 assert.equal(explicit.worker,'cursor');
 assert.notEqual(explicit.reviewer,'cursor');
 assert.equal(selectStructuredRoles(['github-copilot'],'cursor'),null);
 const single=selectStructuredRoles(['codex']);
 assert.equal(single.degraded,true);
 assert.equal(single.worker,single.reviewer);
 assert.equal(selectStructuredRoles([]),null);
});

test('directly selected work executors cannot bypass the final independent Reviewer',()=>{
 const accepted={id:'codex',mode:'work',verification:{status:'passed'},stages:[
  {role:'planner',text:'Plan ready'},
  {role:'worker',text:'Changed one file'},
  {role:'reviewer',text:'Final checks complete. VERDICT: PASS'}
 ]};
 assert.equal(requireIndependentWorkReview(accepted),accepted);
 assert.throws(
  ()=>requireIndependentWorkReview({
   id:'codex',mode:'work',verification:{status:'passed'},
   maintenance:{changedFiles:1},text:'Worker completed'
  }),
  error=>error.code==='AGENT_WORK_REVIEW_REQUIRED'
 );
 assert.throws(
  ()=>requireIndependentWorkReview({
   verification:{status:'passed'},
   stages:[
    {role:'reviewer',text:'VERDICT: PASS'},
    {role:'reviewer',text:'VERDICT: NEEDS_FIX'}
   ]
  }),
  error=>error.code==='AGENT_WORK_REVIEW_REQUIRED'
 );
});

test('structured HumanALE orchestrator keeps planning, work and review bounded',async()=>{
 const [hub,app,html]=await Promise.all([
  readFile(new URL('../desktop/agent-hub.mjs',import.meta.url),'utf8'),
  readFile(new URL('../public/app.js',import.meta.url),'utf8'),
  readFile(new URL('../public/index.html',import.meta.url),'utf8')
 ]);
 assert.match(hub,/id:'humanale-orchestrator'/);
 assert.match(hub,/async runStructured\(prompt,mode,preferredWorker/);
 assert.match(hub,/Planner HumanALE/);
 assert.match(hub,/Worker HumanALE/);
 assert.match(hub,/Reviewer HumanALE/);
 assert.match(hub,/Final Reviewer HumanALE/);
 assert.match(hub,/let verdict=reviewVerdict\(review\.text\)/);
 assert.match(hub,/verdict==='unknown'/);
 assert.match(hub,/tidak memberikan VERDICT valid setelah retry/);
 assert.match(hub,/Final Reviewer HumanALE belum memberikan VERDICT: PASS/);
 assert.match(hub,/runDirect\(planner,planPrompt,'analyze'\)/);
 assert.match(hub,/runDirect\(worker,workPrompt,mode\)/);
 assert.match(hub,/runDirect\(reviewer,reviewPrompt,'analyze'\)/);
 assert.match(hub,/selectStructuredRoles\(available,preferredWorker\)/);
 assert.match(hub,/DEGRADED SINGLE-EXECUTOR/);
 assert.match(hub,/INDEPENDENT REVIEW/);
 assert.match(hub,/runProcess\(executable,\['--version'\]/);
 assert.match(hub,/buildMaintenanceWorkPrompt\(prompt\)/);
 const policy=await readFile(new URL('../desktop/agent-maintenance-policy.mjs',import.meta.url),'utf8');
 assert.match(policy,/Jangan git push, git merge, publish/);
 assert.match(hub,/validateMemoryContext\(value\?\.memoryContext/);
 assert.match(hub,/memoryContextBlock\(memoryContext\)/);
 assert.match(hub,/id==='humanale-orchestrator'/);
 assert.match(hub,/await this\.runStructured\(prompt,mode\)/);
 assert.match(hub,/if\(mode==='work'\)requireIndependentWorkReview\(result\)/);
 assert.match(hub,/requireIndependentWorkReview\(await this\.runStructured\(task,'work'\)\)/);
 assert.match(app,/\['humanale-orchestrator','github-copilot','codex','cursor','claude'\]\.includes\(id\)/);
 assert.match(html,/Planner → Worker → Reviewer/);
});


test('AI maintenance work mode blocks direct memory context handoff to Worker',async()=>{
 const hub=await readFile(new URL('../desktop/agent-hub.mjs',import.meta.url),'utf8');
 assert.match(hub,/AI_MAINTENANCE_WORK_MEMORY_BLOCKED/);
 assert.match(hub,/Mode kerja AI maintenance tidak menerima memory context langsung/);
 assert.match(hub,/mode==='work'&&value\?\.memoryContext!=null/);
});


test('Agent Hub trusted maintenance entrypoint requires external active transaction and never owns its lifecycle',async()=>{
 const hub=await readFile(new URL('../desktop/agent-hub.mjs',import.meta.url),'utf8');
 assert.match(hub,/async runTrustedMaintenanceWork\(prompt,\{transaction,signal=null\}=\{\}\)/);
 assert.match(hub,/AI_MAINTENANCE_TRUSTED_TRANSACTION_REQUIRED/);
 assert.match(hub,/AI_MAINTENANCE_TRANSACTION_ROOT_MISMATCH/);
 assert.match(hub,/transaction\.inspect\(\{rollbackOnViolation:false\}\)/);
 assert.match(hub,/this\.maintenanceTransaction=transaction/);
 assert.doesNotMatch(
  hub.match(/async runTrustedMaintenanceWork[\s\S]*?\n \}\n\n async run\(/)?.[0]||'',
  /beginMaintenanceTransaction\(|transaction\.release\(/
 );
});


test('structured executor stage timeouts stay inside NARA sequential pipeline budget',()=>{
 assert.equal(agentTimeoutMs('analyze',{}),120000);
 assert.equal(agentTimeoutMs('work',{}),600000);
 assert.equal(agentTimeoutMs('analyze',{HUMANALE_AGENT_TIMEOUT_MS:'900000'}),300000);
 assert.equal(agentTimeoutMs('work',{HUMANALE_AGENT_TIMEOUT_MS:'900000'}),600000);
 assert.equal(agentTimeoutMs('analyze',{DUDIDAM_AGENT_TIMEOUT_MS:'450000'}),300000);
 assert.equal(agentTimeoutMs('work',{DUDIDAM_AGENT_TIMEOUT_MS:'450000'}),450000);
});
