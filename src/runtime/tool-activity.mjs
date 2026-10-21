const MAX_DETAIL = 32768;
const MAX_TRACES = 1000;
const MAX_MESSAGES = 2000;

const VERBS = {
  read: 'Reading',
  grep: 'Searching',
  glob: 'Finding',
  edit: 'Editing',
  write: 'Creating',
  bash: 'Running',
  eval: 'Running',
  lsp: 'Checking',
  todo: 'Updating tasks',
  task: 'Delegating',
  wait: 'Waiting',
  browser: 'Browsing',
  web_search: 'Searching',
  computer: 'Controlling',
};

const safeText = value => String(value ?? '').replace(/\s+/g, ' ').slice(0, 180);
const detail = value => (typeof value === 'string' ? value : JSON.stringify(value ?? null, null, 2)).slice(0, MAX_DETAIL);

/** Raw arguments/results are disclosure-only; never used as the default label. */
export function projectToolActivity(frame, owner = 'main', generation = 0) {
  const callId = frame?.toolCallId || frame?.tool_call_id;
  if (!callId || !['tool_execution_start', 'tool_execution_end'].includes(frame?.type)) return null;
  const tool = String(frame.toolName || frame.name || 'tool');
  const args = frame.args && typeof frame.args === 'object' ? frame.args : {};
  const ended = frame.type === 'tool_execution_end';
  const denied = frame.denied === true;
  const isError = frame.isError === true;
  const status = ended ? (denied ? 'denied' : isError ? 'error' : 'ok') : 'running';

  // Semantic target per tool; NO fallback to first string arg (may contain secrets)
  let target = '';
  if (args.path) target = args.path;
  else if (args.query) target = args.query;
  else if (args.pattern) target = args.pattern;
  else if (args.i) target = args.i;
  else if (args.title) target = args.title;
  else if (args.url) target = args.url;
  else if (tool === 'bash' && args.command) target = args.command;
  else if (tool === 'grep' && args.pattern) target = args.pattern;
  else if (tool === 'glob' && args.pattern) target = args.pattern;
  else if (tool === 'read' && args.path) target = args.path;
  else if (tool === 'edit' && args.path) target = args.path;
  else if (tool === 'write' && args.path) target = args.path;
  else if (tool === 'task' && args.description) target = args.description;
  else if (tool === 'web_search' && args.query) target = args.query;
  else if (tool === 'browser' && args.url) target = args.url;
  else if (tool === 'computer' && args.action) target = args.action;
  // Unknown tools: NO fallback to first string (may expose API keys)
  // target remains empty string - UI will show tool name only

  const action = VERBS[tool] || `Running ${tool}`;

  // Actual result/error on end; raw args/result kept only for detail (expansion/copy)
  let out = undefined;
  if (ended) {
    if (denied) out = 'Tool call denied by policy';
    else if (isError) out = detail(frame.error ?? frame.result ?? frame.output ?? 'Error');
    else out = detail(frame.result ?? frame.output ?? '');
  }

  return {
    id: `tool-${generation}-${owner}-${callId}`,
    toolCallId: callId,
    owner,
    tool,
    action,
    target: safeText(target),
    arg: frame.args === undefined ? undefined : detail(frame.args),
    out,
    status,
    t: new Date().toTimeString().slice(0, 8),
    ended,
    generation,
  };
}

/**
 * Upsert activity row with out-of-order/duplicate correctness:
 * - Same callId maps to same row (correlated start/end)
 * - Late duplicate start cannot undo a terminal result
 * - Duplicate end preserves first terminal result
 * - Duplicate start while running is ignored
 * - Preserves running status until terminal frame arrives
 */
export function upsertActivity(rows, entry) {
  if (!entry) return rows;
  const index = rows.findIndex(row => row.id === entry.id);
  if (index < 0) return [...rows, entry];
  const previous = rows[index];

  // Late duplicate start cannot undo a terminal result.
  if (previous.ended && !entry.ended) return rows;

  // Duplicate end - keep first terminal result
  if (previous.ended && entry.ended) return rows;

  // Duplicate start while running - ignore
  if (!previous.ended && !entry.ended) return rows;

  // Normal transition: running -> ended
  const next = { ...previous, ...entry, t: previous.t };
  for (const key of ['arg', 'target', 'out']) {
    if (entry[key] === undefined || (key === 'target' && !entry[key])) next[key] = previous[key];
  }
  if (entry.tool === 'tool') { next.tool = previous.tool; next.action = previous.action; }
  const copy = [...rows]; copy[index] = next; return copy;
}

/**
 * Retain rows with strict bounds:
 * - Returns exactly cap rows, never cap+1 (no marker row in the list)
 * - Completed rows evict first; running work stays visible
 * - If running rows alone exceed cap, the newest cap rows win (explicit bound)
 * - Caller sets separate activityEvicted flag for UI visibility
 */
export function retainRows(rows, cap) {
  if (rows.length <= cap) return rows;
  if (cap <= 0) return [];
  const runningCount = rows.reduce((count, row) => count + (row.status === 'running' ? 1 : 0), 0);
  if (runningCount > cap) return rows.slice(-cap);
  let completedToRemove = rows.length - cap;
  return rows.filter(row => {
    if (row.status === 'running') return true;
    if (completedToRemove > 0) {
      completedToRemove--;
      return false;
    }
    return true;
  });
}

/**
 * Reconnect reconciliation:
 * - Snapshot rows are canonical for the fetched transcript
 * - Local rows the snapshot does not represent (old assistant frames, rows
 *   still streaming) are preserved after the snapshot instead of dropped
 * - Identity is canonical role:timestamp, so one canonical timestamp yields
 *   exactly one row (first wins, snapshot ordered first)
 */
export function mergeTranscriptSnapshot(current, snapshot) {
  const identity = row => {
    // Prefer original message timestamp for canonical identity
    const ts = row.timestamp ?? row.originalTimestamp;
    if (ts && row.role) return `${row.role}:${ts}`;
    // Fallback for in-flight rows without timestamp: generation-scoped id
    if (row.generation !== undefined && row.id) return `${row.generation}:${row.id}`;
    return row.id;
  };

  const seen = new Set();
  const merged = [];
  for (const row of [...(snapshot || []), ...(current || [])]) {
    if (!row) continue;
    const key = identity(row);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(row);
  }
  return merged;
}

// Bounded UI bookkeeping sets to prevent unbounded growth
export const UI_BOOKKEEPING_CAP = 5000;

/**
 * Trim a Set to cap by removing oldest entries (FIFO)
 */
export function trimSet(set, cap = UI_BOOKKEEPING_CAP) {
  if (set.size <= cap) return set;
  const entries = [...set.entries()];
  const toRemove = entries.slice(0, set.size - cap);
  for (const [key] of toRemove) set.delete(key);
  return set;
}

/**
 * Trim a Map to cap by removing oldest entries (FIFO)
 */
export function trimMap(map, cap = UI_BOOKKEEPING_CAP) {
  if (map.size <= cap) return map;
  const entries = [...map.entries()];
  const toRemove = entries.slice(0, map.size - cap);
  for (const [key] of toRemove) map.delete(key);
  return map;
}