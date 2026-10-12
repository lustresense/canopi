import test from 'node:test';
import assert from 'node:assert/strict';
import {projectAssistantFrame,acceptFrame} from '../src/runtime/live-projection.mjs';
const start={type:'message_start',messageId:'msg-2',message:{role:'assistant',content:[]}};
const delta=text=>({type:'message_update',messageId:'msg-2',message:{role:'assistant'},assistantMessageEvent:{type:'text_delta',delta:text}});
const end={type:'message_end',messageId:'msg-2',message:{role:'assistant',content:[{type:'text',text:'Actual final answer'}]}};
test('real RPC-style message events are folded by stable messageId',()=>{
  let list=[]; list=projectAssistantFrame(list,start);list=projectAssistantFrame(list,delta('Act'));list=projectAssistantFrame(list,delta('ual'));
  assert.equal(list.length,1);assert.equal(list[0].text,'Actual');
  list=projectAssistantFrame(list,end);assert.equal(list[0].text,'Actual final answer');
  list=projectAssistantFrame(list,end);assert.equal(list.length,1);
});
test('tool and user messages do not masquerade as assistant stream',()=>{
  assert.deepEqual(projectAssistantFrame([],{...start,message:{role:'user'}}),[]);
  assert.deepEqual(projectAssistantFrame([],{type:'tool_execution_start',messageId:'msg-2'}),[]);
});
test('a second message does not overwrite the first',()=>{
  const first=projectAssistantFrame([],end);
  const second=projectAssistantFrame(first,{...start,messageId:'msg-3'});
  assert.deepEqual(second.map(m=>m.text),['Actual final answer','']);
});
test('lost stream deltas are repaired using final canonical text',()=>{
  assert.equal(projectAssistantFrame([],end)[0].text,'Actual final answer');
});
test('state owner gates events by both session and process generation',()=>{
  const owner={sessionKey:'s1',generation:9};
  assert.equal(acceptFrame(owner,{sessionKey:'s1',generation:9,frame:start}),true);
  assert.equal(acceptFrame(owner,{sessionKey:'s2',generation:9,frame:start}),false);
  assert.equal(acceptFrame(owner,{sessionKey:'s1',generation:8,frame:start}),false);
});
test('a restarted engine cannot overwrite the previous generation answer',()=>{
  const old=projectAssistantFrame([],end,1);
  const next=projectAssistantFrame(old,{...end,message:{role:'assistant',content:[{type:'text',text:'New answer'}]}},2);
  assert.deepEqual(next.map(m=>m.text),['Actual final answer','New answer']);
});
