import { textFromMessage } from './projection.mjs';

/** One OMP assistant message retains its RPC messageId through start/update/end.
 * Never mix a worker's or another session's frames into this transcript.
 * `message_end` has the canonical full message, repairing missed deltas.
 */
export function projectAssistantFrame(messages, frame) {
  if (!['message_start', 'message_update', 'message_end'].includes(frame?.type)) return messages;
  if (typeof frame.messageId !== 'string' || !frame.messageId.trim()) return messages;
  if (frame.message?.role !== 'assistant') return messages;
  const id = 'omp-' + frame.messageId;
  const idx = messages.findIndex(m => m.id === id);
  const current = idx >= 0 ? messages[idx] : { id, role:'asst', text:'', native:true };
  let text = current.text;
  if (frame.type === 'message_update') {
    // "full" projection carries the accumulated message; "delta" projection
    // carries only the increment. Prefer canonical content when present.
    const full = textFromMessage(frame.message);
    if (full) text = full;
    else if (frame.assistantMessageEvent?.type === 'text_delta') {
      text += String(frame.assistantMessageEvent.delta ?? '');
    }
  }
  if (frame.type === 'message_end') text = textFromMessage(frame.message);
  if (idx >= 0 && current.text === text) return messages;
  const updated = { ...current, text };
  if (idx < 0) return [...messages, updated];
  const copy = [...messages]; copy[idx] = updated; return copy;
}

/** Key must be attached by the Rust process owner, not inferred from TUI file. */
export function acceptFrame(owner, envelope) {
  if (!owner || !envelope || !envelope.frame) return false;
  return owner.sessionKey === envelope.sessionKey &&
    Number.isSafeInteger(owner.generation) && owner.generation === envelope.generation;
}
