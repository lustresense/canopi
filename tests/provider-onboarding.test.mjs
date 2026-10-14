import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { serializeWorkspace, parseWorkspace, WORKSPACE_KEY } from '../src/runtime/workspace.mjs';
import {
  ensureSessionModel,
  executeSessionStart
} from '../src/runtime/session-bootstrap.mjs';

const react = readFileSync(new URL('../src/app/CanoPi.jsx', import.meta.url), 'utf8');
const native = readFileSync(new URL('../src/runtime/native.js', import.meta.url), 'utf8');
const mainRs = readFileSync(new URL('../src-tauri/src/main.rs', import.meta.url), 'utf8');

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
  assert.match(react, /value="google"/);
  assert.match(react, /value="openrouter"/);
  assert.match(react, /value="groq"/);
  assert.match(react, /value="xai"/);
  assert.match(react, /value="deepseek"/);
  assert.match(react, /value="custom"/);
  // 9Router, Mistral, Together should NOT be in the list
  assert.doesNotMatch(react, /value="9router"/);
  assert.doesNotMatch(react, /value="mistral"/);
  assert.doesNotMatch(react, /value="together"/);
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

test('bundled provider choices and transport selector follow canonical OMP rules', () => {
  // Real bundled provider choices offered in UI (strict list: Anthropic, OpenAI, Google Gemini, OpenRouter, Groq, xAI, DeepSeek, Custom)
  assert.match(react, /value="anthropic"/);
  assert.match(react, /value="openai"/);
  assert.match(react, /value="google"/);
  assert.match(react, /value="openrouter"/);
  assert.match(react, /value="groq"/);
  assert.match(react, /value="xai"/);
  assert.match(react, /value="deepseek"/);
  assert.match(react, /value="custom"/);
  // 9Router, Mistral, Together should NOT be in the list
  assert.doesNotMatch(react, /value="9router"/);
  assert.doesNotMatch(react, /value="mistral"/);
  assert.doesNotMatch(react, /value="together"/);

  // Custom transport API selector offers valid OMP values
  assert.match(react, /value="openai-completions"/);
  assert.match(react, /value="openai-responses"/);
  assert.match(react, /value="anthropic-messages"/);
  assert.match(react, /value="google-generative-ai"/);

  // No openai-chat generated anywhere in UI, native bridge, or Rust backend
  assert.doesNotMatch(react, /openai-chat/);
  assert.doesNotMatch(native, /openai-chat/);
  assert.doesNotMatch(mainRs, /"api":\s*"openai-chat"/);
  assert.match(mainRs, /Invalid api 'openai-chat'/);
});

test('deterministic model selection strictly precedes user prompt dispatch', async () => {
  const callLog = [];
  let activeSessionModel = null;
  const catalog = [
    { provider: 'custom', id: 'model-primary', name: 'Primary Model' },
    { provider: 'custom', id: 'model-secondary', name: 'Secondary Model' }
  ];

  const mockSendRpc = async (cmd) => {
    callLog.push({ type: 'rpc', command: cmd.type, payload: cmd });
    if (cmd.type === 'set_model') {
      activeSessionModel = { provider: cmd.provider, modelId: cmd.modelId };
      return { success: true };
    }
    return { success: true };
  };

  const result = await executeSessionStart({
    sessionId: 'session-order-test',
    text: 'Implement feature X',
    startRuntime: async (id) => {
      callLog.push({ type: 'runtime_start', sessionId: id });
    },
    bootSession: async (id) => {
      callLog.push({ type: 'boot_begin', sessionId: id });
      const res = await ensureSessionModel({
        sendRpc: mockSendRpc,
        currentModel: activeSessionModel,
        refreshModels: async () => {
          callLog.push({ type: 'get_models' });
          return catalog;
        },
        refreshState: async () => {
          callLog.push({ type: 'refresh_state' });
        },
        refreshThinkingLevels: async () => {
          callLog.push({ type: 'refresh_thinking_levels' });
        },
        setModel: (m) => {
          activeSessionModel = m;
        }
      });
      callLog.push({ type: 'boot_end', sessionId: id });
      return res.ok ? res.models : [];
    },
    getActiveModel: () => activeSessionModel,
    pushUserMessage: (id, text) => {
      callLog.push({ type: 'push_msg', sessionId: id, text });
    },
    sendPrompt: async (id, text) => {
      callLog.push({ type: 'send_prompt', sessionId: id, text });
    }
  });

  assert.equal(result.status, 'prompt_sent');
  assert.deepEqual(result.model, { provider: 'custom', modelId: 'model-primary' });

  // Verify order of operations: selection must precede prompt
  const setModelIdx = callLog.findIndex(c => c.type === 'rpc' && c.command === 'set_model');
  const sendPromptIdx = callLog.findIndex(c => c.type === 'send_prompt');
  const refreshStateIdx = callLog.findIndex(c => c.type === 'refresh_state');
  const refreshThinkingIdx = callLog.findIndex(c => c.type === 'refresh_thinking_levels');

  assert.ok(setModelIdx !== -1, 'set_model must be invoked during session boot');
  assert.ok(sendPromptIdx !== -1, 'send_prompt must be invoked after successful boot');
  assert.ok(setModelIdx < sendPromptIdx, 'set_model must strictly precede send_prompt');
  const promptsBeforeSetModel = callLog.slice(0, setModelIdx).filter(c => c.type === 'send_prompt');
  assert.equal(promptsBeforeSetModel.length, 0, 'no prompt before set_model');
  // State and thinking levels must sync after selection and before prompt
  assert.ok(refreshStateIdx > setModelIdx, 'refresh_state must follow set_model');
  assert.ok(refreshThinkingIdx > setModelIdx, 'refresh_thinking_levels must follow set_model');
  assert.ok(refreshThinkingIdx < sendPromptIdx, 'refresh_thinking_levels must precede send_prompt');
});

test('model discovery or selection failure strictly prevents user prompt dispatch', async () => {
  // Case 1: Empty catalog prevents prompt
  {
    const callLog = [];
    let setupInvoked = false;

    const result = await executeSessionStart({
      sessionId: 'session-empty-catalog',
      text: 'Prompt on empty catalog',
      startRuntime: async (id) => {
        callLog.push({ type: 'runtime_start', sessionId: id });
      },
      bootSession: async () => {
        const res = await ensureSessionModel({
          sendRpc: async () => {},
          currentModel: null,
          refreshModels: async () => []
        });
        return res.ok ? res.models : [];
      },
      getActiveModel: () => null,
      pushUserMessage: () => {
        callLog.push({ type: 'push_msg' });
      },
      sendPrompt: async () => {
        callLog.push({ type: 'send_prompt' });
      },
      onSetupRequired: () => {
        setupInvoked = true;
      }
    });

    assert.equal(result.status, 'model_setup_required');
    assert.equal(setupInvoked, true, 'onSetupRequired must be signaled');
    assert.equal(callLog.some(c => c.type === 'send_prompt'), false, 'User prompt must never dispatch on empty catalog');
    assert.equal(callLog.some(c => c.type === 'push_msg'), false, 'User message must never push on empty catalog');
  }

  // Case 2: set_model RPC rejection prevents prompt
  {
    const callLog = [];
    let capturedError = null;
    let activeSessionModel = null;

    const result = await executeSessionStart({
      sessionId: 'session-rpc-fail',
      text: 'Prompt on RPC error',
      startRuntime: async (id) => {
        callLog.push({ type: 'runtime_start', sessionId: id });
      },
      bootSession: async () => {
        const res = await ensureSessionModel({
          sendRpc: async (cmd) => {
            if (cmd.type === 'set_model') {
              throw new Error('OMP backend rejected set_model');
            }
          },
          currentModel: null,
          refreshModels: async () => [
            { provider: 'custom', id: 'fail-model', name: 'Fail Model' }
          ],
          setModel: (m) => {
            activeSessionModel = m;
          }
        });
        return res.ok ? res.models : [];
      },
      getActiveModel: () => activeSessionModel,
      pushUserMessage: () => {
        callLog.push({ type: 'push_msg' });
      },
      sendPrompt: async () => {
        callLog.push({ type: 'send_prompt' });
      },
      onError: (err) => {
        capturedError = err;
      }
    });

    assert.equal(result.status, 'error');
    assert.ok(capturedError instanceof Error);
    assert.match(capturedError.message, /OMP backend rejected set_model/);
    assert.equal(callLog.some(c => c.type === 'send_prompt'), false, 'User prompt must never dispatch on set_model failure');
    assert.equal(callLog.some(c => c.type === 'push_msg'), false, 'User message must never push on set_model failure');
  }

  // Case 3: Runtime start failure strictly prevents user prompt dispatch
  {
    const callLog = [];
    let capturedError = null;

    const result = await executeSessionStart({
      sessionId: 'session-runtime-fail',
      text: 'Prompt on runtime failure',
      startRuntime: async () => {
        callLog.push({ type: 'runtime_start_fail' });
        throw new Error('Failed to spawn runtime');
      },
      bootSession: async () => {
        callLog.push({ type: 'boot' });
        return [];
      },
      getActiveModel: () => null,
      pushUserMessage: () => {
        callLog.push({ type: 'push_msg' });
      },
      sendPrompt: async () => {
        callLog.push({ type: 'send_prompt' });
      },
      onError: (err) => {
        capturedError = err;
      }
    });

    assert.equal(result.status, 'error');
    assert.ok(capturedError instanceof Error);
    assert.match(capturedError.message, /Failed to spawn runtime/);
    assert.equal(callLog.some(c => c.type === 'boot'), false, 'bootSession must not execute after startRuntime error');
    assert.equal(callLog.some(c => c.type === 'send_prompt'), false, 'no prompt after error');
    assert.equal(callLog.some(c => c.type === 'push_msg'), false, 'no user message pushed after error');
  }
});

/* Regression helpers mirroring state machine logic in CanoPi.jsx */
function isValidDialogFrame(frame) {
  if (!frame || typeof frame !== 'object') return false;
  const id = frame.id;
  if (typeof id !== 'string' && typeof id !== 'number') return false;
  const s = String(id).trim();
  return s.length > 0 && s.length <= 128;
}

function clearDialogForSession(currentDialog, sessionKey) {
  if (!currentDialog) return null;
  if (!sessionKey || currentDialog.sessionKey === sessionKey) return null;
  return currentDialog;
}

function isWorkspaceInert({ drawer, palette, confirmS, runtimeDialog }) {
  const hasActiveDialog = Boolean(runtimeDialog && isValidDialogFrame(runtimeDialog.frame));
  return Boolean(drawer || palette || confirmS || hasActiveDialog);
}

test('runtime dialog frame validation rejects malformed frames without valid id', () => {
  assert.equal(isValidDialogFrame({ id: 'd-1' }), true);
  assert.equal(isValidDialogFrame({ id: 101 }), true);
  assert.equal(isValidDialogFrame({ id: '  ' }), false);
  assert.equal(isValidDialogFrame({ id: '' }), false);
  assert.equal(isValidDialogFrame({ id: null }), false);
  assert.equal(isValidDialogFrame({ id: undefined }), false);
  assert.equal(isValidDialogFrame({}), false);
  assert.equal(isValidDialogFrame(null), false);
  assert.equal(isValidDialogFrame(undefined), false);
  assert.equal(isValidDialogFrame({ id: 'a'.repeat(129) }), false);
});

test('clearDialogForSession clears dialog for matching session and ignores other sessions', () => {
  const dialogS1 = { sessionKey: 's1', frame: { id: 'd-1' } };
  assert.equal(clearDialogForSession(dialogS1, 's1'), null);
  assert.deepEqual(clearDialogForSession(dialogS1, 's2'), dialogS1);
  assert.equal(clearDialogForSession(dialogS1, null), null);
  assert.equal(clearDialogForSession(null, 's1'), null);
});

test('isWorkspaceInert scopes inert to workspace and never blocks reconnect on disconnect', () => {
  assert.equal(isWorkspaceInert({}), false);
  assert.equal(isWorkspaceInert({ drawer: 'settings' }), true);
  assert.equal(isWorkspaceInert({ palette: true }), true);
  assert.equal(isWorkspaceInert({ confirmS: {} }), true);
  assert.equal(isWorkspaceInert({ runtimeDialog: { frame: { id: 'd-1' } } }), true);
  assert.equal(isWorkspaceInert({ runtimeDialog: { frame: { id: '' } } }), false, 'malformed dialog must not block workspace');
  assert.equal(isWorkspaceInert({ runtimeDialog: { frame: {} } }), false, 'missing id must not block workspace');

  // State flow: dialog active on session s1 -> session disconnects -> dialog cleared -> inert removed
  let dialog = { sessionKey: 's1', frame: { id: 'd-1' } };
  assert.equal(isWorkspaceInert({ runtimeDialog: dialog }), true);
  dialog = clearDialogForSession(dialog, 's1');
  assert.equal(isWorkspaceInert({ runtimeDialog: dialog }), false, 'reconnect must remain actionable after disconnect');
});

test('reconnect button is outside workspace inert container in CanoPi JSX structure', () => {
  // Scopes inert to workRef (workspace), NOT appRef (which contains topbar and banners)
  assert.match(react, /workRef\.current\.inert\s*=\s*layerOpen/);
  assert.match(react, /appRef\.current\.inert\s*=\s*false/);

  // Reconnect button in system banner is outside workspace <main className="work">
  const bannerIndex = react.indexOf('onClick={reconnect}');
  const mainWorkIndex = react.indexOf('<main className="work"');
  assert.ok(bannerIndex !== -1, 'reconnect button must exist');
  assert.ok(mainWorkIndex !== -1, 'main work element must exist');
  assert.ok(bannerIndex < mainWorkIndex, 'system banner with reconnect must be outside workspace main element');

  // Disconnect, reconnect, error, goHome, and openSession trigger session dialog cleanup
  assert.match(react, /clearDialogForSession\(curr,\s*sidx\)/);
  assert.match(react, /clearDialogForSession\(curr,\s*cur\)/);
  assert.match(react, /isValidDialogFrame/);
});

