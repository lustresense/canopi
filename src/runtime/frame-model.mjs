/* Pure accessors for the pinned OMP RPC wire contract (protocol v2).
 *
 * Shapes come from the pinned source checkout
 * (packages/coding-agent/src/modes/rpc/rpc-types.ts, .../task/types.ts and
 * packages/tui/src/overlays/session-observer-registry.ts). Nothing here
 * guesses: subagent frames wrap their data in `payload`, and a
 * `subagent_progress` frame identifies its worker only through
 * `payload.progress.id`.
 */

const SUBAGENT_TYPES = new Set(['subagent_event', 'subagent_lifecycle', 'subagent_progress']);

export function subagentPayload(frame) {
  if (!frame || typeof frame !== 'object' || !SUBAGENT_TYPES.has(frame.type)) return null;
  const p = frame.payload;
  return p && typeof p === 'object' ? p : null;
}

/** Worker id for any subagent frame; '' when the frame carries none. */
export function subagentFrameId(frame) {
  const p = subagentPayload(frame);
  if (!p) return '';
  if (frame.type === 'subagent_progress') return String(p.progress?.id || p.id || '');
  return String(p.id || p.subagentId || '');
}

/** Inner AgentSessionEvent of a subagent_event frame, else null. */
export function subagentFrameEvent(frame) {
  const p = subagentPayload(frame);
  const ev = frame?.type === 'subagent_event' ? p?.event : null;
  return ev && typeof ev === 'object' ? ev : null;
}

/* lifecycle.status: "started" | "completed" | "failed" | "aborted"
 * snapshot/AgentProgress.status: "pending" | "running" | "completed" | "failed" | "aborted" */
const LIFECYCLE_STATE = { started: 'running', completed: 'completed', failed: 'failed', aborted: 'stopped' };
const PROGRESS_STATE = { pending: 'idle', running: 'running', completed: 'completed', failed: 'failed', aborted: 'stopped' };

export function workerStateFromStatus(status) {
  const s = String(status || '').toLowerCase();
  return LIFECYCLE_STATE[s] || PROGRESS_STATE[s] || null;
}

/** Tool-call identity shared by tool_execution_start and tool_execution_end. */
export function toolCallIdOf(frame) {
  if (!frame || typeof frame !== 'object') return '';
  const id = frame.toolCallId ?? frame.id ?? frame.tool_use_id;
  return id == null ? '' : String(id);
}
