/**
 * BoundedEventQueue - Phase 4 bounded event admission queue
 * Per-session/generation queue with FIFO ordering, never reorders.
 * Critical events never dropped; only known-safe progress events coalesce/drop.
 * Unknown events are critical by default.
 */
const MAX_CAPACITY = 500;

// Only these specific full-state progress snapshots may be coalesced/dropped
const COALESCIBLE_PROGRESS = new Set([
  'subagent_progress',
]);

// These are always critical - never dropped, never reordered
const CRITICAL_TYPES = new Set([
  'message_end',
  'message_start',
  'tool_execution_end',
  'tool_execution_start',
  'runtime_exit',
  'transport_error',
  'stderr_redacted',
  'prompt_result',
  'subagent_lifecycle',
  'extension_ui_request',
  'agent_end',
  'agent_start',
  'session_settled',
  'model_changed',
  'thinking_level_changed',
  'available_commands_update',
]);

function isCritical(type) {
  return CRITICAL_TYPES.has(type);
}

function isCoalescibleProgress(type) {
  return COALESCIBLE_PROGRESS.has(type);
}

function eventKey(frame) {
  if (!frame || typeof frame !== 'object') return '';
  const type = frame.type;
  if (type === 'subagent_progress') {
    const p = frame.payload;
    return `subagent_progress:${String(p?.progress?.id || p?.id || '')}`;
  }
  if (type === 'tool_execution_start') {
    return `tool_execution_start:${String(frame.toolCallId || frame.id || frame.tool_use_id || '')}`;
  }
  if (type === 'message_start' || type === 'message_update') {
    return `${type}:${String(frame.messageId || '')}`;
  }
  return '';
}

export class BoundedEventQueue {
  constructor(options = {}) {
    this.capacity = Math.min(options.capacity ?? MAX_CAPACITY, MAX_CAPACITY);
    this.onCondensed = options.onCondensed ?? (() => {});
    this.queue = [];  // Single FIFO queue preserving order
    this.overflowNotified = false;
    this.drainScheduled = false;
  }

  stats() {
    return {
      total: this.queue.length,
      capacity: this.capacity,
      overflow: this.overflowNotified,
    };
  }

  hasSpace() {
    return this.queue.length < this.capacity;
  }

  // Enqueue envelope {sessionKey, generation, frame}
  enqueue(envelope) {
    if (!envelope || typeof envelope !== 'object') {
      return { enqueued: false, dropped: true, coalesced: false, backpressured: false };
    }
    const frame = envelope.frame;
    if (!frame || typeof frame !== 'object') {
      return { enqueued: false, dropped: true, coalesced: false, backpressured: false };
    }

    const type = frame.type;
    const critical = isCritical(type);
    const coalescible = isCoalescibleProgress(type);

    // Coalesce only known-safe full-state progress snapshots
    if (coalescible) {
      const key = eventKey(frame);
      if (key) {
        const idx = this.queue.findIndex(e => eventKey(e.frame) === key && e.frame.type === type);
        if (idx >= 0) {
          this.queue[idx] = envelope;
          return { enqueued: true, dropped: false, coalesced: true, backpressured: false };
        }
      }
    }

    // All other events (including unknown) are critical - must enqueue
    if (this.hasSpace()) {
      this.queue.push(envelope);
      if (!this.hasSpace() && !this.overflowNotified) {
        this.overflowNotified = true;
        this.onCondensed();
      }
      return { enqueued: true, dropped: false, coalesced: false, backpressured: false };
    }

    // Full - critical events must backpressure (signal to drain synchronously)
    if (critical || !coalescible) {
      return { enqueued: false, dropped: false, coalesced: false, backpressured: true };
    }

    // Coalescible progress dropped on overflow
    if (!this.overflowNotified) {
      this.overflowNotified = true;
      this.onCondensed();
    }
    return { enqueued: false, dropped: true, coalesced: false, backpressured: false };
  }

  // FIFO dequeue - preserves exact order
  dequeue() {
    return this.queue.shift() ?? null;
  }

  // Process with handler, stops on false return
  process(handler) {
    let processed = 0;
    let envelope;
    while ((envelope = this.dequeue()) !== null) {
      const shouldContinue = handler(envelope);
      processed++;
      if (shouldContinue === false) break;
    }
    return processed;
  }

  // Synchronous drain - processes all in FIFO order
  drain(handler) {
    let count = 0;
    let envelope;
    while ((envelope = this.dequeue()) !== null) {
      handler(envelope);
      count++;
    }
    return count;
  }

  getCondensedNotice() {
    if (!this.overflowNotified) return null;
    const dropped = this.queue.length > this.capacity ? this.queue.length - this.capacity : 0;
    return `activity condensed (${dropped} progress events dropped)`;
  }

  clear() {
    this.queue = [];
    this.overflowNotified = false;
  }

  isEmpty() {
    return this.queue.length === 0;
  }
}

/**
 * Production frame admission helper - encapsulates queue logic for watchFrames integration.
 * Accepts envelope {sessionKey, generation, frame} and handler, owns the only
 * session/generation queue map in production. Testable via injected queueMap,
 * getGeneration, scheduler and capacity.
 */
export function createFrameAdmission(options = {}) {
  const { queueMap: customQueueMap, getGeneration = () => 0, onCondensed, capacity = 500 } = options;
  const queueMap = customQueueMap ?? new Map();
  const queueKey = (sessionKey, generation) => `${sessionKey}:${generation}`;

  function getOrCreate(sessionKey, generation) {
    const key = queueKey(sessionKey, generation);
    let q = queueMap.get(key);
    if (!q) {
      q = new BoundedEventQueue({ capacity, onCondensed });
      queueMap.set(key, q);
    }
    return q;
  }

  // Only numeric-generation keys of this session; a sessionKey containing ':'
  // must never match another session's queues.
  function sessionQueueKeys(sessionKey) {
    const prefix = `${sessionKey}:`;
    return [...queueMap.keys()].filter(key => key.startsWith(prefix) && /^-?\d+$/.test(key.slice(prefix.length)));
  }

  function clearSession(sessionKey) {
    for (const key of sessionQueueKeys(sessionKey)) {
      queueMap.get(key)?.clear();
      queueMap.delete(key);
    }
  }

  function clearAll() {
    for (const q of queueMap.values()) q.clear();
    queueMap.clear();
  }

  function getCondensedForSession(sessionKey) {
    let notice = null;
    for (const key of sessionQueueKeys(sessionKey)) {
      const n = queueMap.get(key)?.getCondensedNotice();
      if (n) notice = n;
    }
    return notice || 'activity condensed (progress events dropped)';
  }

  return {
    /**
     * Admit an envelope to the queue with proper drain scheduling.
     * FIFO: normal frames drain on a scheduled microtask; a full queue drains
     * synchronously and re-enqueues the critical frame; stale generations are
     * rejected at enqueue and at drain.
     * @param {Object} envelope - {sessionKey, generation, frame}
     * @param {Function} handler - Called with envelope
     * @param {Function} scheduleMicrotask - Optional custom scheduler (default queueMicrotask)
     * @returns {{enqueued: boolean, backpressured: boolean, dropped: boolean}}
     */
    admit(envelope, handler, scheduleMicrotask = queueMicrotask) {
      if (!envelope || !envelope.sessionKey || !envelope.frame) {
        return { enqueued: false, backpressured: false, dropped: true };
      }
      const sessionKey = envelope.sessionKey;
      const generation = Number.isSafeInteger(envelope.generation) ? envelope.generation : 0;

      // Generation check at enqueue time
      if (generation !== getGeneration(sessionKey)) {
        return { enqueued: false, backpressured: false, dropped: true };
      }

      const queue = getOrCreate(sessionKey, generation);
      const drainNow = () => {
        queue.drain(env => {
          if (getGeneration(env.sessionKey) === env.generation) handler(env);
        });
      };
      const scheduleDrain = () => scheduleMicrotask(() => {
        // Generation check at drain time; stale envelopes are freed, not leaked.
        if (getGeneration(sessionKey) !== generation) {
          queue.clear();
          queueMap.delete(queueKey(sessionKey, generation));
          return;
        }
        drainNow();
      });

      const result = queue.enqueue(envelope);
      if (result.enqueued) {
        scheduleDrain();
        return result;
      }
      if (result.backpressured) {
        // Critical frame with a full queue - drain synchronously, re-enqueue.
        drainNow();
        const retry = queue.enqueue(envelope);
        if (retry.enqueued) scheduleDrain();
        return { enqueued: retry.enqueued, backpressured: true, dropped: !retry.enqueued, coalesced: false };
      }
      return result;
    },
    clearSession,
    clearAll,
    getCondensedForSession,
    getQueueMap: () => queueMap,
  };
}

export default { BoundedEventQueue, createFrameAdmission };