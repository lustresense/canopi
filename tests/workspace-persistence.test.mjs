import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseWorkspace, serializeWorkspace, migrateWorkspace,
  WORKSPACE_OWNER, WORKSPACE_SCHEMA, WORKSPACE_KEY, UI_DEFAULTS
} from '../src/runtime/workspace.mjs';

test('legacy v1 workspace blob migrates to the v2 schema', () => {
  const v1 = JSON.stringify({
    projects: [{ id: 'p1', name: 'Demo', path: 'C:/code/demo', extra: 'dropped' }],
    sessions: [{ id: 's1', name: 'Fix bug', project: 'p1' }]
  });
  const { projects, sessions, ui } = parseWorkspace(v1);
  assert.deepEqual(projects, [{ id: 'p1', name: 'Demo', path: 'C:/code/demo' }]);
  assert.deepEqual(sessions, [{ id: 's1', name: 'Fix bug', project: 'p1' }]);
  assert.equal(ui.theme, 'dark');
  assert.equal(ui.lastSessionId, null);
});

test('serializer copies only whitelisted fields; planted secrets never persist', () => {
  const db = {
    projects: [{ id: 'p1', name: 'Demo', path: 'C:/code/demo', apiKey: 'sk-planted' }],
    sessions: {
      s1: { id: 's1', name: 'Fix bug', project: 'p1', token: 'secret-session-field',
        todo: [{ name: 'I. Plan', tasks: [{ content: 'task', status: 'pending' }] }],
        threads: { main: [{ id: 1, role: 'user', text: 'transcript must stay in OMP' }] },
        traces: { main: [] }, agents: {}, order: [], drafts: { 's1:main': 'typed secret' } }
    }
  };
  const json = serializeWorkspace(db, { theme: 'light', apiKey: 'sk-ui-planted', lastSessionId: 's1', homeProjectId: 'p1' });
  const parsed = JSON.parse(json);
  assert.equal(parsed.owner, WORKSPACE_OWNER);
  assert.equal(parsed.schema, WORKSPACE_SCHEMA);
  assert.equal(json.includes('sk-planted') || json.includes('sk-ui-planted') || json.includes('secret-session-field') || json.includes('typed secret') || json.includes('transcript'), false,
    'no secret, draft, or task data may leave the app through UI metadata');
  assert.deepEqual(parsed.projects, [{ id: 'p1', name: 'Demo', path: 'C:/code/demo' }]);
  assert.deepEqual(parsed.sessions, [{ id: 's1', name: 'Fix bug', project: 'p1' }]);
  assert.equal(parsed.ui.theme, 'light');
  assert.equal(parsed.ui.lastSessionId, 's1');
  assert.equal(parsed.ui.homeProjectId, 'p1');
});

test('sessions without a surviving project are pruned, duplicates collapsed', () => {
  const db = {
    projects: [{ id: 'p1', name: 'Demo', path: 'C:/code/demo' }],
    sessions: {
      s1: { id: 's1', name: 'A', project: 'p1' },
      s2: { id: 's2', name: 'Orphan', project: 'gone' },
      s3: { id: 's1', name: 'Duplicate id', project: 'p1' }
    }
  };
  const parsed = parseWorkspace(serializeWorkspace(db, { lastSessionId: 's2' }));
  assert.deepEqual(parsed.sessions.map(s => s.id), ['s1']);
  assert.equal(parsed.ui.lastSessionId, null, 'selection pointing at pruned data resets');
});

test('layout metadata is clamped and enum-checked', () => {
  const raw = JSON.stringify({
    projects: [], sessions: [],
    ui: { theme: 'neon', view: 'hax', dock: { h: 99999, open: 'yes', expanded: 1, split: 'x' }, collapsed: { p1: 'truthy' } }
  });
  const { ui } = parseWorkspace(raw);
  assert.equal(ui.theme, 'dark');
  assert.equal(ui.view, 'conv');
  assert.deepEqual(ui.dock, { open: true, expanded: true, h: 2000, split: true });
  assert.deepEqual(ui.collapsed, {});
  const low = parseWorkspace(JSON.stringify({ projects: [], sessions: [], ui: { dock: { h: -5 } } })).ui;
  assert.equal(low.dock.h, 80, 'out-of-range heights clamp to the minimum dock size');
});

test('malformed or hostile blobs degrade to an empty workspace', () => {
  for (const bad of ['{', 'null', '"string"', '[]', '{"projects":{"0":1},"sessions":"x"}']) {
    const { projects, sessions } = parseWorkspace(bad);
    assert.deepEqual(projects, []);
    assert.deepEqual(sessions, []);
  }
  assert.deepEqual(parseWorkspace(null).projects, []);
});

test('serialize then parse round-trips project/session history and layout', () => {
  const db = {
    projects: [{ id: 'p1', name: 'Demo', path: 'C:/code/demo' }, { id: 'p2', name: 'Other', path: 'D:/work/other' }],
    sessions: { s1: { id: 's1', name: 'Fix bug', project: 'p1' } }
  };
  const ui = { lastSessionId: 's1', homeProjectId: 'p2', theme: 'light', view: 'board', collapsed: { p2: true }, dock: { open: false, expanded: true, h: 320, split: true } };
  const back = parseWorkspace(serializeWorkspace(db, ui));
  assert.deepEqual(back.projects, db.projects);
  assert.deepEqual(back.sessions, [{ id: 's1', name: 'Fix bug', project: 'p1' }]);
  assert.deepEqual(back.ui, ui);
  assert.deepEqual(migrateWorkspace(JSON.parse(serializeWorkspace(db, ui))).ui, ui);
});

test('workspace storage keys are namespaced per app', () => {
  assert.equal(WORKSPACE_KEY, 'canopi.workspace.v2');
});
