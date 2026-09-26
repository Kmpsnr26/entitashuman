import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {classifyTaskDifficulty,reviewVerdict,selectStructuredRoles} from '../desktop/agent-hub.mjs';

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
 const single=selectStructuredRoles(['codex']);
 assert.equal(single.degraded,true);
 assert.equal(single.worker,single.reviewer);
 assert.equal(selectStructuredRoles([]),null);
});

test('structured HumanALE orchestrator keeps planning, work and review bounded',async()=>{
 const [hub,app,html]=await Promise.all([
  readFile(new URL('../desktop/agent-hub.mjs',import.meta.url),'utf8'),
  readFile(new URL('../public/app.js',import.meta.url),'utf8'),
  readFile(new URL('../public/index.html',import.meta.url),'utf8')
 ]);
 assert.match(hub,/id:'humanale-orchestrator'/);
 assert.match(hub,/async runStructured\(prompt,mode\)/);
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
 assert.match(hub,/selectStructuredRoles\(available\)/);
 assert.match(hub,/DEGRADED SINGLE-EXECUTOR/);
 assert.match(hub,/INDEPENDENT REVIEW/);
 assert.match(hub,/runProcess\(executable,\['--version'\]/);
 assert.match(hub,/Jangan git push, git merge, publish/);
 assert.match(hub,/validateMemoryContext\(value\?\.memoryContext/);
 assert.match(hub,/memoryContextBlock\(memoryContext\)/);
 assert.match(hub,/if\(id==='humanale-orchestrator'\)return await this\.runStructured/);
 assert.match(app,/\['humanale-orchestrator','github-copilot','codex','cursor','claude'\]\.includes\(id\)/);
 assert.match(html,/Planner → Worker → Reviewer/);
});
