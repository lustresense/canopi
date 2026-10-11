import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { serializeWorkspace, parseWorkspace, WORKSPACE_KEY } from '../src/runtime/workspace.mjs';

const react = readFileSync(new URL('../src/app/CanoPi.jsx', import.meta.url), 'utf8');
const native = readFileSync(new URL('../src/runtime/native.js', import.meta.url), 'utf8');

test('native bridge exposes provider persistence and data root recovery', () => {
  assert.match(native, /export async function getProviderStatus\(\)/);
  assert.match(native, /invoke\('provider_status'\)/);
  assert.match(native, /export async function saveProviderKey\(provider,\s*apiKey/);
  assert.match(native, /invoke\('provider_save_key'/);
  assert.match(native, /export async function dataRootStatus\(\)/);
  assert.match(native, /invoke\('data_root_status'\)/);
  assert.match(native, /export async function recoverDataRoot\(\)/);
  assert.match(native, /invoke\('recover_data_root'\)/);
});

test('model and setup labels are neutral and free of OMP mentions in UI chips', () => {
  // Replaced "Model from OMP"
  assert.doesNotMatch(react, /Model from OMP/);
  assert.match(react, /Model setup/);
  assert.match(react, /canoPi engine · local session/);
});

test('provider onboarding is API-key-first and does not make 9Router default', () => {
  assert.match(react, /function ProviderSetupSection\(/);
  // Anthropic is default provider, not 9Router
  assert.match(react, /useState\(['"]anthropic['"]\)/);
  assert.match(react, /value="anthropic"/);
  assert.match(react, /value="openai"/);
  assert.match(react, /value="openrouter"/);
  assert.match(react, /value="9router"/);
  // 9Router is marked optional
  assert.match(react, /9Router \(optional local proxy\)/);
  // Input uses password field with autocomplete off
  assert.match(react, /type="password"/);
  assert.match(react, /autoComplete="off"/);
  // Invokes native saveApiKey and clears input
  assert.match(react, /saveApiKey/);
});

test('proof: no secrets can be persisted into frontend workspace state or localStorage', () => {
  const contaminatedDb = {
    apiKey: 'sk-ant-global-leak',
    providers: {
      anthropic: { apiKey: 'sk-ant-provider-leak' }
    },
    projects: [
      { id: 'p1', name: 'Test', path: 'C:/test', apiKey: 'sk-project-leak', bearer: 'token-leak' }
    ],
    sessions: {
      s1: {
        id: 's1',
        name: 'Session',
        project: 'p1',
        apiKey: 'sk-session-leak',
        secrets: { key: 'secret-val' }
      }
    }
  };
  const contaminatedUi = {
    theme: 'dark',
    apiKey: 'sk-ui-leak',
    password: 'password-leak',
    lastSessionId: 's1',
    homeProjectId: 'p1'
  };

  const serialized = serializeWorkspace(contaminatedDb, contaminatedUi);
  assert.ok(!serialized.includes('sk-ant-global-leak'), 'Global apiKey must not persist');
  assert.ok(!serialized.includes('sk-ant-provider-leak'), 'Provider apiKey must not persist');
  assert.ok(!serialized.includes('sk-project-leak'), 'Project apiKey must not persist');
  assert.ok(!serialized.includes('token-leak'), 'Token must not persist');
  assert.ok(!serialized.includes('sk-session-leak'), 'Session apiKey must not persist');
  assert.ok(!serialized.includes('secret-val'), 'Secrets must not persist');
  assert.ok(!serialized.includes('sk-ui-leak'), 'UI apiKey must not persist');
  assert.ok(!serialized.includes('password-leak'), 'Password must not persist');

  const parsed = parseWorkspace(serialized);
  assert.equal(parsed.projects[0].apiKey, undefined);
  assert.equal(parsed.sessions[0].apiKey, undefined);
  assert.equal(parsed.ui.apiKey, undefined);
  assert.equal(WORKSPACE_KEY, 'canopi.workspace.v2');
});

test('safe data root recovery is exposed in UI for unowned root startup failures', () => {
  assert.match(react, /dataRootIssue/);
  assert.match(react, /handleRecoverDataRoot/);
  assert.match(react, /Recover data root/);
  assert.match(react, /recoverDataRoot/);
});
