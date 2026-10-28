import test from 'node:test';
import assert from 'node:assert/strict';
import { subagentFrameId, subagentFrameEvent, workerStateFromStatus, toolCallIdOf } from '../src/runtime/frame-model.mjs';
import { normalizeWorkers } from '../src/runtime/projection.mjs';
import { projectAssistantFrame, acceptFrame } from '../src/runtime/live-projection.mjs';

/* Fixtures mirror the pinned upstream wire contract:
 * packages/coding-agent/src/modes/rpc/rpc-types.ts (RpcSubagentSnapshot,
 * RpcSubagent*Frame), .../task/types.ts (SubagentEventPayload) and
 * packages/tui/src/overlays/session-observer-registry.ts (payloads). */

const lifecycleFrame = {
  type: 'subagent_lifecycle',
  payload: { id: 'sg-7', agent: 'task', agentSource: 'builtin', description: 'Review the auth patch', status: 'started', parentToolCallId: 'call-1', index: 0 }
};
const progressFrame = {
  type: 'subagent_progress',
  payload: { index: 0, agent: 'task', agentSource: 'builtin', task: 'Review the auth patch', parentToolCallId: 'call-1',
    progress: { id: 'sg-7', index: 0, agent: 'task', status: 'running', task: 'Review the auth patch', currentTool: 'read', recentTools: [], recentOutput: [], toolCount: 1, requests: 1, tokens: 120 } }
};
const eventFrame = {
  type: 'subagent_event',
  payload: { id: 'sg-7', event: { type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'Review done' }] } } }
};

test('subagent frames identify workers through payload, per upstream shapes', () => {
  assert.equal(subagentFrameId(lifecycleFrame), 'sg-7');
  assert.equal(subagentFrameId(progressFrame), 'sg-7', 'progress frames only carry the id inside progress');
  assert.equal(subagentFrameId(eventFrame), 'sg-7');
  assert.equal(subagentFrameId({ type: 'message_start', messageId: 'm1' }), '');
  assert.equal(subagentFrameId(null), '');
});

test('only subagent_event frames unwrap to an inner session event', () => {
  assert.equal(subagentFrameEvent(eventFrame).type, 'message_end');
  assert.equal(subagentFrameEvent(lifecycleFrame), null);
  assert.equal(subagentFrameEvent(progressFrame), null);
});

test('agent progress statuses map onto UI states without relabeling failures', () => {
  assert.equal(workerStateFromStatus('pending'), 'idle');
  assert.equal(workerStateFromStatus('running'), 'running');
  assert.equal(workerStateFromStatus('completed'), 'completed');
  assert.equal(workerStateFromStatus('failed'), 'failed');
  assert.equal(workerStateFromStatus('aborted'), 'stopped');
  assert.equal(workerStateFromStatus('started'), 'running');
  assert.equal(workerStateFromStatus('nonsense'), null);
});

test('tool call identity is shared by tool start/end frames', () => {
  assert.equal(toolCallIdOf({ type: 'tool_execution_start', toolCallId: 'call-9' }), 'call-9');
  assert.equal(toolCallIdOf({ type: 'tool_execution_end', id: 'call-9' }), 'call-9');
  assert.equal(toolCallIdOf({ type: 'agent_start' }), '');
});

test('normalizeWorkers consumes a real get_subagents snapshot', () => {
  const data = { subagents: [
    { id: 'sg-7', index: 0, agent: 'task', agentSource: 'builtin', description: 'Review the auth patch', status: 'running', task: 'Review the auth patch', lastUpdate: 1,
      progress: { id: 'sg-7', status: 'running', currentTool: 'grep', recentTools: [], recentOutput: [], toolCount: 3, requests: 2, tokens: 900 } },
    { id: 'sg-8', index: 1, agent: 'task', description: 'Ship the docs', status: 'aborted', lastUpdate: 2 }
  ] };
  const [a, b] = normalizeWorkers(data);
  assert.equal(a.id, 'sg-7');
  assert.equal(a.name, 'Review the auth patch');
  assert.equal(a.state, 'running');
  assert.equal(a.parent, 'main');
  assert.equal(a.activity, 'Review the auth patch');
  assert.equal(b.id, 'sg-8');
  assert.equal(b.state, 'stopped', 'aborted is terminal, never shown as running');
});

test('a full message_update repairs a stream that lost deltas', () => {
  const start = { type: 'message_start', messageId: 'm1', message: { role: 'assistant', content: [] } };
  const fullUpdate = { type: 'message_update', messageId: 'm1', message: { role: 'assistant', content: [{ type: 'text', text: 'accumulated so far' }] }, assistantMessageEvent: { type: 'text_delta', delta: 'far' } };
  let list = projectAssistantFrame([], start);
  list = projectAssistantFrame(list, fullUpdate);
  assert.equal(list[0].text, 'accumulated so far');
});

test('generation and session gate still apply to recorded envelopes', () => {
  const owner = { sessionKey: 's1', generation: 4 };
  assert.equal(acceptFrame(owner, { sessionKey: 's1', generation: 4, frame: eventFrame }), true);
  assert.equal(acceptFrame(owner, { sessionKey: 's1', generation: 3, frame: eventFrame }), false);
});
