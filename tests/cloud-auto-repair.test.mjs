import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {
 fallbackBranchFor,
 fallbackMarkerFor,
 isFallbackPullRequest,
 issueRecovered,
 managedCiSource,
 routeFallbackCandidates,
 selectLatestFailedRuns
} from './helpers/cloud-auto-repair-logic.mjs';

const workflow=await readFile(
 new URL('../.github/workflows/cloud-auto-repair.yml',import.meta.url),
 'utf8'
);

function extractBlocks(name){
 const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 const pattern=new RegExp(
  `// cloud-auto-repair-test:start ${escaped}\\r?\\n([\\s\\S]*?)`+
  `// cloud-auto-repair-test:end ${escaped}`,
  'g'
 );
 return [...workflow.matchAll(pattern)].map((match)=>match[1].trim());
}

function normalizeSource(source){
 const lines=source.trim().split(/\r?\n/);
 const indents=lines.slice(1)
  .filter((line)=>line.trim())
  .map((line)=>line.match(/^\s*/)[0].length);
 const indent=indents.length?Math.min(...indents):0;
 return [lines[0],...lines.slice(1).map((line)=>line.slice(indent))].join('\n');
}

function run(overrides={}){
 return {
  id:1,
  workflow_id:100,
  name:'Verify and package',
  head_branch:'main',
  conclusion:'failure',
  updated_at:'2026-09-27T10:00:00.000Z',
  ...overrides
 };
}

const failureConclusions=new Set([
 'failure',
 'timed_out',
 'startup_failure',
 'action_required'
]);
const cutoff=Date.parse('2026-09-27T09:00:00.000Z');

test('scheduled scan ignores an older failure after a later success',()=>{
 const blocks=extractBlocks('select-latest-failed-runs');
 assert.equal(blocks.length,1);
 assert.equal(normalizeSource(blocks[0]),normalizeSource(selectLatestFailedRuns.toString()));
 const failure=run({id:10,updated_at:'2026-09-27T10:00:00.000Z'});
 const success=run({id:11,conclusion:'success',updated_at:'2026-09-27T10:05:00.000Z'});

 for(const runs of [[failure,success],[success,failure]]){
  assert.deepEqual(selectLatestFailedRuns(runs,{
   cutoff,
   defaultBranch:'main',
   failureConclusions
  }),[]);
 }
});

test('scheduled scan selects a newer failure after an earlier success',()=>{
 const success=run({id:20,conclusion:'success',updated_at:'2026-09-27T10:00:00.000Z'});
 const failure=run({id:21,updated_at:'2026-09-27T10:05:00.000Z'});

 assert.deepEqual(selectLatestFailedRuns([failure,success],{
  cutoff,
  defaultBranch:'main',
  failureConclusions
 }),[failure]);
});

test('scheduled scan resolves equal completion timestamps by run id',()=>{
 const older=run({id:50,workflow_id:9,updated_at:'2026-09-27T10:05:00.000Z'});
 const newer=run({id:51,workflow_id:9,updated_at:'2026-09-27T10:05:00.000Z'});

 assert.deepEqual(selectLatestFailedRuns([newer,older],{
  cutoff,
  defaultBranch:'main',
  failureConclusions
 }),[newer]);
});

test('scheduled scan normalizes a missing branch before suppressing a stale failure',()=>{
 const failure=run({id:30,head_branch:null,updated_at:'2026-09-27T10:00:00.000Z'});
 const success=run({id:31,head_branch:'main',conclusion:'success',updated_at:'2026-09-27T10:05:00.000Z'});

 assert.deepEqual(selectLatestFailedRuns([failure,success],{
  cutoff,
  defaultBranch:'main',
  failureConclusions
 }),[]);
});

test('scheduled scan excludes self, automation, stale and invalid runs before taking three newest failures',()=>{
 const failures=[
  run({id:41,workflow_id:1,updated_at:'2026-09-27T10:01:00.000Z'}),
  run({id:42,workflow_id:2,updated_at:'2026-09-27T10:02:00.000Z'}),
  run({id:43,workflow_id:3,updated_at:'2026-09-27T10:03:00.000Z'}),
  run({id:44,workflow_id:4,updated_at:'2026-09-27T10:04:00.000Z'}),
  run({id:45,workflow_id:5,name:'Cloud Auto Repair',updated_at:'2026-09-27T10:05:00.000Z'}),
  run({id:46,workflow_id:6,head_branch:'automation/issue-1',updated_at:'2026-09-27T10:06:00.000Z'}),
  run({id:47,workflow_id:7,updated_at:'2026-09-27T08:59:59.000Z'}),
  run({id:48,workflow_id:8,updated_at:'not-a-date'})
 ];

 assert.deepEqual(selectLatestFailedRuns(failures,{
  cutoff,
  defaultBranch:'main',
  failureConclusions
 }).map(({id})=>id),[44,43,42]);
});

test('both cleanup paths share canonical and legacy fallback identity rules',()=>{
 const blocks=extractBlocks('fallback-identity');
 assert.equal(blocks.length,2);
 assert.equal(blocks[0],blocks[1]);
 const helperSource=[fallbackBranchFor,fallbackMarkerFor,isFallbackPullRequest]
  .map((helper)=>helper.toString())
  .join('\n\n');
 assert.equal(normalizeSource(blocks[0]),normalizeSource(helperSource));

 const canonical={
   draft:true,
   head:{ref:'automation/issue-42'},
   body:'<!-- cloud-fallback-request: issue-42 -->'
 };
 const legacy={
   draft:true,
   head:{ref:'automation/issue-42'},
   body:'## Cloud fallback\n\nTracks #42.'
 };

 assert.equal(fallbackBranchFor(42),'automation/issue-42');
 assert.equal(fallbackMarkerFor(42),'<!-- cloud-fallback-request: issue-42 -->');
 assert.equal(isFallbackPullRequest(canonical,42),true);
 assert.equal(isFallbackPullRequest(legacy,42),true);
 assert.equal(isFallbackPullRequest({...legacy,draft:false},42),false);
 assert.equal(isFallbackPullRequest({...legacy,head:{ref:'automation/issue-420'}},42),false);
 assert.equal(isFallbackPullRequest({...legacy,body:'Tracks #420.'},42),false);
 assert.equal(isFallbackPullRequest({...canonical,body:'<!-- cloud-fallback-request: issue-420 -->'},42),false);
});

test('resolved or closed issues cannot be requeued by labeled events',()=>{
 const blocks=extractBlocks('issue-recovery-state');
 assert.equal(blocks.length,2);
 assert.equal(blocks[0],blocks[1]);
 assert.equal(normalizeSource(blocks[0]),normalizeSource(issueRecovered.toString()));

 assert.equal(issueRecovered({state:'open',labels:['ci-failure']}),false);
 assert.equal(issueRecovered({state:'closed',labels:['ci-failure']}),true);
 assert.equal(issueRecovered({
  state:'open',
  labels:[{name:'automation:resolved'}]
 }),true);
 assert.match(
  workflow,
  /async function queueExistingIssue\(issue\) \{\s*if \(issueRecovered\(issue\)\) return;/
 );
});

test('new fallback PR bodies include the canonical marker',()=>{
 assert.match(
  workflow,
  /pulls\.create\(\{[\s\S]*?body:\s*\[[\s\S]*?fallbackMarkerFor\(issue\.number\)/
 );
});

test('Actions PR creation disabled leaves candidates queued and skips fallback job',()=>{
 const blocks=extractBlocks('fallback-permission-routing');
 assert.equal(blocks.length,1);
 assert.equal(normalizeSource(blocks[0]),normalizeSource(routeFallbackCandidates.toString()));
 const candidates=[{issue_number:182,branch:'main'}];

 assert.deepEqual(routeFallbackCandidates(candidates,false),{
  fallback:[],queued:candidates
 });
 assert.deepEqual(routeFallbackCandidates(candidates,true),{
  fallback:candidates,queued:[]
 });
 assert.match(workflow,/can_approve_pull_request_reviews === true/);
 assert.match(workflow,/core\.setOutput\('queued_issues', JSON\.stringify\(route\.queued\)\)/);
 assert.match(workflow,/if: needs\.triage\.outputs\.fallback_issues != '\[\]'/);
});

test('stale CI retirement identifies only managed non-default source branches',()=>{
 const blocks=extractBlocks('managed-ci-source');
 assert.equal(blocks.length,1);
 assert.equal(normalizeSource(blocks[0]),normalizeSource(managedCiSource.toString()));
 const issue={
  labels:['automation:managed','ci-failure'],
  body:'<!-- cloud-automation-key: workflow:367664414:codex/old-branch -->\n'+
   '- Commit: `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`\n'+
   '- Run: https://github.com/Kmpsnr26/entitashuman/actions/runs/12345'
 };

 assert.deepEqual(managedCiSource(issue,'main'),{
  workflowId:367664414,
  branch:'codex/old-branch',
  headSha:'a'.repeat(40),
  runId:12345
 });
 assert.equal(managedCiSource({...issue,body:issue.body.replace('codex/old-branch','main')},'main'),null);
 assert.equal(managedCiSource({...issue,labels:['ci-failure']},'main'),null);
 assert.equal(managedCiSource({...issue,body:'unrelated issue'},'main'),null);
 assert.equal(managedCiSource({...issue,body:issue.body.replace('old-branch','bad branch')},'main'),null);
 assert.equal(managedCiSource({...issue,body:issue.body.replace('a'.repeat(40),'unknown')},'main'),null);
 assert.match(workflow,/if \(error\.status !== 404\) throw error;/);
 assert.match(workflow,/run\.head_sha !== source\.headSha/);
 assert.match(workflow,/state_reason: 'not_planned'/);
});
