import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCodexJsonOutput} from '../desktop/agent-hub.mjs';
test('CLI protocol requires a completed turn and actual assistant message',()=>{
  for(const output of ['', 'not JSON', JSON.stringify({type:'turn.completed'}),
    JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'unfinished'}})]){
    assert.equal(parseCodexJsonOutput(output).failure,true);
  }
  const message=JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'Done'}});
  assert.equal(parseCodexJsonOutput(message+'\n'+JSON.stringify({type:'turn.completed'})).failure,false);
  assert.equal(parseCodexJsonOutput(message+'\n'+JSON.stringify({type:'error'})+'\n'+JSON.stringify({type:'turn.completed'})).failure,true);
});
