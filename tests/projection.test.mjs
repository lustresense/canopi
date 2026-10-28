import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeTodos,normalizeWorkers,textFromMessage} from '../src/runtime/projection.mjs';
test('TODO status and phase mapping comes from get_state only',()=>{
  const input={todoPhases:[{name:'IV. Verify',tasks:[{content:'Run visual check',status:'in_progress'},{content:'Deploy',status:'blocked',blocker:'Needs approval'}]}]};
  assert.deepEqual(normalizeTodos(input),input.todoPhases);
  assert.deepEqual(normalizeTodos({}),[]);
});
test('unknown status is rejected, never relabeled as pending',()=>{
  assert.throws(()=>normalizeTodos({todoPhases:[{name:'Phase',tasks:[{content:'x',status:'unknown'}]}]}),/Unknown OMP TODO status/);
});
test('worker registry maps parent and completion',()=>{
  const workers=normalizeWorkers({subagents:[{subagentId:'a7',name:'Reviewer',parentSubagentId:'a3',status:'completed'}]});
  assert.equal(workers[0].id,'a7');assert.equal(workers[0].parent,'a3');assert.equal(workers[0].state,'completed');
});
test('assistant message blocks projected to text',()=>{
  assert.equal(textFromMessage({role:'assistant',content:[{type:'thinking',text:'hidden'},{type:'text',text:'Hello'},{type:'text',text:' world'}]}),'Hello world');
});
