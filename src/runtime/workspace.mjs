/* canoPi-owned UI metadata persistence.
 *
 * Storage carries ONLY canoPi UI metadata: project list, session list (id,
 * name, owning project), and last layout/selection. OMP transcripts, TODO
 * phases, workers and traces stay inside the engine's durable session files —
 * this module never becomes a second task database. It also never stores
 * model credentials, API keys, drafts or provider settings: the serializer
 * copies a fixed whitelist of fields and drops everything else, so a tampered
 * localStorage blob cannot smuggle secrets back into state.
 */
export const WORKSPACE_OWNER = 'app.canopi.desktop';
export const WORKSPACE_SCHEMA = 2;
export const WORKSPACE_KEY = 'canopi.workspace.v2';
/* Migrated from once; removed after the first successful v2 write. */
export const WORKSPACE_KEY_V1 = 'canopi.workspace.v1';

const cap = (v, n) => String(v ?? '').slice(0, n);
const idOk = v => typeof v === 'string' && v.length > 0 && v.length <= 64 && /^[A-Za-z0-9._-]+$/.test(v);
const bool = v => !!v;
const clampInt = (v, lo, hi, dflt) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt;
};

export const UI_DEFAULTS = Object.freeze({
  lastSessionId: null,
  homeProjectId: '',
  theme: 'dark',
  view: 'conv',
  collapsed: {},
  dock: Object.freeze({ open: true, expanded: false, h: 216, split: false })
});

function sanitizeProject(p) {
  if (!p || typeof p !== 'object' || !idOk(p.id) || typeof p.path !== 'string' || !p.path) return null;
  return { id: p.id, name: cap(p.name, 120) || p.id, path: cap(p.path, 2048) };
}

function sanitizeSession(s, projectIds) {
  if (!s || typeof s !== 'object' || !idOk(s.id) || !projectIds.has(s.project)) return null;
  return { id: s.id, name: cap(s.name, 120) || s.id, project: s.project };
}

function sanitizeUi(ui, projectIds, sessionIds) {
  const u = ui && typeof ui === 'object' ? ui : {};
  const dockIn = u.dock && typeof u.dock === 'object' ? u.dock : {};
  const collapsedIn = u.collapsed && typeof u.collapsed === 'object' ? u.collapsed : {};
  const collapsed = {};
  for (const key of Object.keys(collapsedIn).slice(0, 200)) {
    if (projectIds.has(key)) collapsed[key] = bool(collapsedIn[key]);
  }
  return {
    lastSessionId: sessionIds.has(u.lastSessionId) ? u.lastSessionId : null,
    homeProjectId: projectIds.has(u.homeProjectId) ? u.homeProjectId : '',
    theme: u.theme === 'light' ? 'light' : 'dark',
    view: u.view === 'board' ? 'board' : 'conv',
    collapsed,
    dock: {
      open: dockIn.open === false ? false : true,
      expanded: bool(dockIn.expanded),
      h: clampInt(dockIn.h, 80, 2000, UI_DEFAULTS.dock.h),
      split: bool(dockIn.split)
    }
  };
}

/** Normalize any parsed stored blob (v1 or v2) into { projects, sessions, ui }. */
export function migrateWorkspace(raw) {
  const inProjects = Array.isArray(raw?.projects) ? raw.projects : [];
  const inSessions = Array.isArray(raw?.sessions) ? raw.sessions : [];
  const projects = inProjects.map(sanitizeProject).filter(Boolean);
  const projectIds = new Set(projects.map(p => p.id));
  const seen = new Set();
  const sessions = [];
  for (const s of inSessions) {
    const clean = sanitizeSession(s, projectIds);
    if (clean && !seen.has(clean.id)) { seen.add(clean.id); sessions.push(clean); }
  }
  return { projects, sessions, ui: sanitizeUi(raw?.ui, projectIds, seen) };
}

/** Parse persisted text. Malformed or hostile data degrades to an empty workspace. */
export function parseWorkspace(text) {
  if (typeof text !== 'string' || !text) return migrateWorkspace(null);
  try { return migrateWorkspace(JSON.parse(text)); } catch { return migrateWorkspace(null); }
}

/** Serialize the whitelisted metadata. Unknown fields (e.g. planted secrets) are dropped. */
export function serializeWorkspace(db, ui) {
  const projects = (db?.projects || []).map(sanitizeProject).filter(Boolean);
  const projectIds = new Set(projects.map(p => p.id));
  const sessions = [];
  const seen = new Set();
  for (const s of Object.values(db?.sessions || {})) {
    const clean = sanitizeSession(s, projectIds);
    if (clean && !seen.has(clean.id)) { seen.add(clean.id); sessions.push(clean); }
  }
  return JSON.stringify({ owner: WORKSPACE_OWNER, schema: WORKSPACE_SCHEMA, projects, sessions, ui: sanitizeUi(ui, projectIds, seen) });
}
