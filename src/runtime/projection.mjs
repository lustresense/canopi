export function textFromMessage(msg) {
  if (!msg) return '';
  if (typeof msg.text === 'string') return msg.text;
  if (Array.isArray(msg.content)) return msg.content.filter(x => x?.type === 'text').map(x => x.text || '').join('');
  return '';
}
const TODO_STATUSES = new Set(['pending', 'in_progress', 'blocked', 'completed', 'abandoned']);
export function normalizeTodos(state) {
  const phases = state?.todoPhases;
  if (phases == null) return []; // A session may not have a TODO yet.
  if (!Array.isArray(phases)) throw new Error('Invalid OMP todoPhases shape');
  return phases.map((p, pi) => {
    if (!p || typeof p.name !== 'string' || !Array.isArray(p.tasks)) throw new Error(`Invalid OMP TODO phase ${pi}`);
    return { name: p.name, tasks: p.tasks.map((t, ti) => {
      if (!t || typeof t.content !== 'string' || !TODO_STATUSES.has(t.status)) {
        throw new Error(`Unknown OMP TODO status in ${pi}/${ti}; keeping previous board`);
      }
      return { content: t.content, status: t.status, ...(t.blocker ? { blocker: String(t.blocker) } : {}) };
    }) };
  });
}
export function normalizeWorkers(data) {
  const list = Array.isArray(data) ? data : (data?.subagents || data?.agents || []);
  return Array.isArray(list) ? list.map((a, i) => ({
    id: String(a.subagentId || a.id || a.agentId || `worker-${i}`),
    name: String(a.name || a.agentName || a.taskName || a.label || `Worker ${i + 1}`),
    parent: String(a.parentSubagentId || a.parentId || 'main'),
    state: /done|complete|success/.test(String(a.status || a.state || '').toLowerCase()) ? 'completed' :
      /fail|error/.test(String(a.status || a.state || '').toLowerCase()) ? 'failed' :
      /wait|idle/.test(String(a.status || a.state || '').toLowerCase()) ? 'waiting' : 'running',
    activity: String(a.task || a.description || a.status || a.state || 'Working')
  })) : [];
}
