import test from 'node:test';
import assert from 'node:assert/strict';
import { createFrameAdmission } from '../src/runtime/event-queue.mjs';

/* Deterministic scheduler: admission drains on scheduled microtasks; tests
 * collect them and flush explicitly to observe the real watch-path timing. */
function makeScheduler() {
  const pending = [];
  return { schedule: fn => pending.push(fn), flush: () => { while (pending.length) pending.shift()(); } };
}

const env = (sessionKey, generation, type, id) => ({
  sessionKey, generation, frame: { type, messageId: id },
});

test('watch path drains normal frames in FIFO order on the scheduled microtask', () => {
  const gen = { s1: 0 };
  const { schedule, flush } = makeScheduler();
  const admission = createFrameAdmission({ getGeneration: k => gen[k] });
  const seen = [];
  const handler = e => seen.push(e.frame.messageId);
  for (const id of ['a', 'b', 'c']) {
    const r = admission.admit(env('s1', 0, 'message_update', id), handler, schedule);
    assert.equal(r.enqueued, true);
    assert.equal(r.dropped, false);
  }
  assert.deepEqual(seen, []); // admitted but not yet drained
  flush();
  assert.deepEqual(seen, ['a', 'b', 'c']);
});

test('critical frame on a full queue drains synchronously and re-enqueues (FIFO preserved)', () => {
  const { schedule, flush } = makeScheduler();
  const admission = createFrameAdmission({ getGeneration: () => 0, capacity: 2 });
  const seen = [];
  const handler = e => seen.push(e.frame.messageId);
  assert.equal(admission.admit(env('s1', 0, 'message_end', 'a'), handler, schedule).enqueued, true);
  assert.equal(admission.admit(env('s1', 0, 'message_end', 'b'), handler, schedule).enqueued, true);
  const r = admission.admit(env('s1', 0, 'message_end', 'c'), handler, schedule);
  assert.equal(r.backpressured, true);
  assert.equal(r.enqueued, true); // re-enqueued after the synchronous drain
  assert.deepEqual(seen, ['a', 'b']); // synchronous drain of the full queue
  flush();
  assert.deepEqual(seen, ['a', 'b', 'c']); // re-enqueued frame delivered next
});

test('stale generation is rejected at enqueue time', () => {
  const { schedule, flush } = makeScheduler();
  const admission = createFrameAdmission({ getGeneration: k => (k === 's1' ? 1 : 0) });
  const seen = [];
  const r = admission.admit(env('s1', 0, 'message_end', 'stale'), e => seen.push(e.frame.messageId), schedule);
  assert.equal(r.enqueued, false);
  assert.equal(r.dropped, true);
  assert.equal(r.backpressured, false);
  flush();
  assert.deepEqual(seen, []);
});

test('generation change before drain rejects queued frames and frees the queue', () => {
  const gen = { s1: 0 };
  const { schedule, flush } = makeScheduler();
  const admission = createFrameAdmission({ getGeneration: k => gen[k] });
  const seen = [];
  admission.admit(env('s1', 0, 'message_end', 'a'), e => seen.push(e.frame.messageId), schedule);
  gen.s1 = 1; // engine restarted between enqueue and drain
  flush();
  assert.deepEqual(seen, []);
  assert.equal(admission.getQueueMap().has('s1:0'), false); // no leak
});

test('clearSession clears the active admission queue for every session generation', () => {
  const gen = { s1: 0, s2: 0 };
  const { schedule, flush } = makeScheduler();
  const admission = createFrameAdmission({ getGeneration: k => gen[k] });
  const seen = [];
  const handler = e => seen.push(e.frame.messageId);
  admission.admit(env('s1', 0, 'message_end', 'g0'), handler, schedule);
  gen.s1 = 1; // generation bump leaves the old generation queue parked
  admission.admit(env('s1', 1, 'message_end', 'g1'), handler, schedule);
  admission.admit(env('s2', 0, 'message_end', 'other'), handler, schedule);
  admission.clearSession('s1');
  assert.deepEqual([...admission.getQueueMap().keys()], ['s2:0']);
  flush(); // pending drains of cleared queues replay nothing for s1
  assert.deepEqual(seen, ['other']);
});

test('condensed notice is read from the active admission map', () => {
  const { schedule } = makeScheduler();
  const condensed = [];
  const admission = createFrameAdmission({ getGeneration: () => 0, capacity: 1, onCondensed: () => condensed.push(1) });
  admission.admit(env('s1', 0, 'message_end', 'a'), () => {}, schedule);
  const r = admission.admit(env('s1', 0, 'message_end', 'b'), () => {}, schedule);
  assert.equal(r.backpressured, true);
  assert.equal(condensed.length, 1); // overflow signaled once from the live queue
  assert.match(admission.getCondensedForSession('s1'), /activity condensed/);
});
