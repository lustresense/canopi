import test from 'node:test';
import assert from 'node:assert/strict';
import { retainRows, mergeTranscriptSnapshot } from '../src/runtime/tool-activity.mjs';

const row = (id, status) => ({ id, status });

test('retainRows returns exactly cap rows, never cap+1', () => {
  const rows = Array.from({ length: 10 }, (_, i) => row(`r${i}`, 'ok'));
  const kept = retainRows(rows, 5);
  assert.equal(kept.length, 5);
  assert.deepEqual(kept.map(r => r.id), ['r5', 'r6', 'r7', 'r8', 'r9']);
});

test('retainRows evicts completed rows before running work', () => {
  const rows = [row('run1', 'running'), ...Array.from({ length: 10 }, (_, i) => row(`c${i}`, 'ok'))];
  const kept = retainRows(rows, 5);
  assert.equal(kept.length, 5);
  assert.ok(kept.some(r => r.id === 'run1'), 'running row survives eviction');
});

test('retainRows bounds an all-running overflow to cap, newest rows win', () => {
  const rows = Array.from({ length: 7 }, (_, i) => row(`run${i}`, 'running'));
  const kept = retainRows(rows, 5);
  assert.equal(kept.length, 5);
  assert.deepEqual(kept.map(r => r.id), ['run2', 'run3', 'run4', 'run5', 'run6']);
});

test('retainRows preserves all running rows before newest completed rows', () => {
  const rows = [
    row('old-complete', 'ok'),
    row('running-1', 'running'),
    row('new-complete-1', 'ok'),
    row('running-2', 'running'),
    row('new-complete-2', 'error'),
    row('new-complete-3', 'ok'),
  ];
  const kept = retainRows(rows, 4);
  assert.deepEqual(kept.map(r => r.id), ['running-1', 'running-2', 'new-complete-2', 'new-complete-3']);
});

test('retainRows returns no rows when cap is zero', () => {
  assert.deepEqual(retainRows([row('running', 'running')], 0), []);
});

test('retainRows leaves lists within cap untouched', () => {
  const rows = [row('a', 'ok'), row('b', 'running')];
  assert.equal(retainRows(rows, 5), rows);
});

test('mergeTranscriptSnapshot preserves old assistant frames missing from the snapshot', () => {
  const oldLocal = { id: 'omp-0-msg-9', role: 'asst', text: 'local only', timestamp: 't9', generation: 0 };
  const snapshot = [{ id: 'worker-native-w1-0', role: 'asst', text: 'from engine', timestamp: 't1' }];
  const merged = mergeTranscriptSnapshot([oldLocal], snapshot);
  assert.deepEqual(merged.map(r => r.id), ['worker-native-w1-0', 'omp-0-msg-9']);
});

test('mergeTranscriptSnapshot yields one row per canonical timestamp, snapshot wins', () => {
  const local = { id: 'omp-1-msg-2', role: 'asst', text: 'streamed', timestamp: 't2', generation: 1 };
  const snapshot = [{ id: 'worker-native-w1-0', role: 'asst', text: 'final', timestamp: 't2' }];
  const merged = mergeTranscriptSnapshot([local], snapshot);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].text, 'final');
});

test('mergeTranscriptSnapshot keeps in-flight rows without a timestamp', () => {
  const inFlight = { id: 'omp-1-msg-3', role: 'asst', text: 'streaming', generation: 1 };
  const snapshot = [{ id: 'worker-native-w1-0', role: 'user', text: 'question', timestamp: 't1' }];
  const merged = mergeTranscriptSnapshot([inFlight], snapshot);
  assert.deepEqual(merged.map(r => r.id), ['worker-native-w1-0', 'omp-1-msg-3']);
});

test('mergeTranscriptSnapshot is idempotent across repeated reconnect refreshes', () => {
  const snapshot = [{ id: 'worker-native-w1-0', role: 'user', text: 'question', timestamp: 't1' }];
  const once = mergeTranscriptSnapshot([], snapshot);
  const twice = mergeTranscriptSnapshot(once, snapshot);
  assert.deepEqual(twice, once);
});

test('mergeTranscriptSnapshot tolerates empty inputs', () => {
  assert.deepEqual(mergeTranscriptSnapshot(undefined, undefined), []);
});
