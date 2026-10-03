import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCodexJsonOutput,codexWorkspaceWriteRefusal} from '../desktop/agent-hub.mjs';
test('CLI protocol requires a completed turn and actual assistant message',()=>{
  for(const output of ['', 'not JSON', JSON.stringify({type:'turn.completed'}),
    JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'unfinished'}})]){
    assert.equal(parseCodexJsonOutput(output).failure,true);
  }
  const message=JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'Done'}});
  assert.equal(parseCodexJsonOutput(message+'\n'+JSON.stringify({type:'turn.completed'})).failure,false);
  assert.equal(parseCodexJsonOutput(message+'\n'+JSON.stringify({type:'error'})+'\n'+JSON.stringify({type:'turn.completed'})).failure,true);
});

test('Codex workspace write refusals are classified without treating ordinary text as blocked',()=>{
 assert.equal(codexWorkspaceWriteRefusal('Workspace is read-only, so I cannot write files.'),true);
 assert.equal(codexWorkspaceWriteRefusal('Writing is blocked by the sandbox.'),true);
 assert.equal(codexWorkspaceWriteRefusal('Saya tidak dapat mengedit karena sandbox hanya-baca.'),true);
 assert.equal(codexWorkspaceWriteRefusal('Perubahan selesai dan test lulus.'),false);
});
