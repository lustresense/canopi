import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fetchLoginProviders, handleLoginFrame, runProviderLogin } from '../src/runtime/provider-login.mjs';

const react = readFileSync(new URL('../src/app/CanoPi.jsx', import.meta.url), 'utf8');
const native = readFileSync(new URL('../src/runtime/native.js', import.meta.url), 'utf8');
const mainRs = readFileSync(new URL('../src-tauri/src/main.rs', import.meta.url), 'utf8');

test('fetchLoginProviders sends get_login_providers and normalizes provider entries', async () => {
  const sent = [];
  const mockSendRpc = async (cmd) => {
    sent.push(cmd);
    return {
      providers: [
        { id: 'openrouter', name: 'OpenRouter', available: true, authenticated: true },
        { id: 'github', available: false },
        { name: 'No id provider' }, // filtered out
        null, // filtered out
        { id: 'custom' } // defaults: name=id, available=true, authenticated=false
      ]
    };
  };

  const list = await fetchLoginProviders(mockSendRpc);
  assert.deepEqual(sent, [{ type: 'get_login_providers' }]);
  assert.deepEqual(list, [
    { id: 'openrouter', name: 'OpenRouter', available: true, authenticated: true },
    { id: 'github', name: 'github', available: false, authenticated: false },
    { id: 'custom', name: 'custom', available: true, authenticated: false }
  ]);
});

test('fetchLoginProviders accepts a bare array payload and rejects a missing sendRpc', async () => {
  const bare = await fetchLoginProviders(async () => [{ id: 'x', name: 'X' }]);
  assert.deepEqual(bare, [{ id: 'x', name: 'X', available: true, authenticated: false }]);
  await assert.rejects(() => fetchLoginProviders(undefined), /requires sendRpc/);
});

test('handleLoginFrame open_url consumes the frame and opens the URL', () => {
  const opened = [];
  const observed = [];
  const consumed = handleLoginFrame(
    { method: 'open_url', launchUrl: 'https://example.com/oauth/authorize?x=1' },
    { openUrl: (url) => { opened.push(url); return Promise.resolve(); }, onOpenUrl: (e) => observed.push(e) }
  );
  assert.equal(consumed, true);
  assert.deepEqual(opened, ['https://example.com/oauth/authorize?x=1']);
  assert.deepEqual(observed, [{ url: 'https://example.com/oauth/authorize?x=1' }]);
});

test('handleLoginFrame input answers the prompt with its id and default prompt', () => {
  const replies = [];
  const consumed = handleLoginFrame(
    { method: 'input', id: 'dlg-7' },
    { answerInput: (reply) => { replies.push(reply); return Promise.resolve(); } }
  );
  assert.equal(consumed, true);
  assert.deepEqual(replies, [{ id: 'dlg-7', prompt: 'Paste the sign-in URL from your browser.' }]);
});

test('handleLoginFrame ignores frames it does not own', () => {
  assert.equal(handleLoginFrame({ method: 'ask' }, {}), false);
  assert.equal(handleLoginFrame({}, {}), false);
  assert.equal(handleLoginFrame(null, {}), false);
});

test('runProviderLogin drives open_url + input frames and refreshes status and models on success', async () => {
  const log = [];
  const toasts = [];
  const frames = [
    { method: 'open_url', url: 'https://example.com/oauth' },
    { method: 'input', id: 'dlg-1', prompt: 'Paste the redirect URL.' }
  ];
  let unsubscribeCalled = false;
  let observeCallback = () => {};

  const result = await runProviderLogin({
    providerId: 'openrouter',
    sendRpc: async (cmd) => {
      log.push({ rpc: cmd });
      // frames are observed while login is in flight
      for (const f of frames) observeCallback(f);
      return { success: true };
    },
    openUrl: async (url) => { log.push({ openUrl: url }); },
    answerInput: async (reply) => { log.push({ answerInput: reply }); },
    refreshStatus: async () => { log.push({ refreshStatus: true }); },
    refreshModels: async () => { log.push({ refreshModels: true }); },
    toast: (msg) => toasts.push(msg),
    observeFrames: (cb) => { observeCallback = cb; return () => { unsubscribeCalled = true; }; },
    onFrame: (f) => log.push({ observed: f.method })
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.data, { success: true });
  assert.deepEqual(log, [
    { rpc: { type: 'login', providerId: 'openrouter' } },
    { observed: 'open_url' },
    { openUrl: 'https://example.com/oauth' },
    { observed: 'input' },
    { answerInput: { id: 'dlg-1', prompt: 'Paste the redirect URL.' } },
    { refreshStatus: true },
    { refreshModels: true }
  ]);
  assert.deepEqual(toasts, ['Signed in to openrouter.']);
  assert.equal(unsubscribeCalled, true, 'frame observation must unsubscribe after login settles');
});

test('runProviderLogin failure toasts an error and never refreshes status or models', async () => {
  const log = [];
  const toasts = [];
  const result = await runProviderLogin({
    providerId: 'openrouter',
    sendRpc: async () => {
      log.push({ rpc: true });
      throw new Error('login rejected: invalid redirect');
    },
    openUrl: async () => { log.push({ openUrl: true }); },
    refreshStatus: async () => { log.push({ refreshStatus: true }); },
    refreshModels: async () => { log.push({ refreshModels: true }); },
    toast: (msg) => toasts.push(msg)
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /Sign-in failed: login rejected: invalid redirect/);
  assert.equal(log.some(e => e.refreshStatus), false, 'refreshStatus must not run on failure');
  assert.equal(log.some(e => e.refreshModels), false, 'refreshModels must not run on failure');
  assert.equal(toasts.length, 1);
  assert.match(toasts[0], /Sign-in failed/);
});

test('runProviderLogin validates required deps and toasts each failure', async () => {
  const toasts = [];
  const toast = (m) => toasts.push(m);
  const noProvider = await runProviderLogin({ sendRpc: async () => ({}), openUrl: async () => {}, toast });
  const noRpc = await runProviderLogin({ providerId: 'x', openUrl: async () => {}, toast });
  const noOpen = await runProviderLogin({ providerId: 'x', sendRpc: async () => ({}), toast });
  for (const r of [noProvider, noRpc, noOpen]) assert.equal(r.ok, false);
  assert.match(noProvider.error, /requires providerId/);
  assert.match(noRpc.error, /requires sendRpc/);
  assert.match(noOpen.error, /requires openUrl/);
  assert.equal(toasts.length, 3);
});

test('openUrl rejection surfaces a toast instead of failing the login', async () => {
  const toasts = [];
  let observeCallback = () => {};
  const result = await runProviderLogin({
    providerId: 'openrouter',
    sendRpc: async () => {
      observeCallback({ method: 'open_url', url: 'https://example.com/oauth' });
      return { success: true };
    },
    openUrl: async () => { throw new Error('no browser'); },
    refreshStatus: async () => {},
    refreshModels: async () => {},
    toast: (m) => toasts.push(m),
    observeFrames: (cb) => { observeCallback = cb; return () => {}; }
  });
  // allow the detached openUrl rejection promise to settle
  await new Promise(r => setTimeout(r, 0));
  assert.equal(result.ok, true, 'login itself still succeeds when the browser cannot be opened');
  assert.ok(toasts.some(m => /Could not open sign-in link: no browser/.test(m)), `unexpected toasts: ${toasts}`);
});

test('native bridge exposes open_external_url and Rust allowlists login RPCs', () => {
  assert.match(native, /export async function openExternalUrl\(url\)/);
  assert.match(native, /invoke\('open_external_url', \{ url \}\)/);
  // Rust: login/get_login_providers allowlisted, long-running login timeout, open_external_url command
  assert.match(mainRs, /"get_login_providers", "login"/);
  assert.match(mainRs, /matches!\(ty, "login" \| "get_login_providers"\)/);
  assert.match(mainRs, /"login" => 600/);
  assert.match(mainRs, /open_external_url/);
});

test('CanoPi wires provider-login module into the dashboard sign-in flow', () => {
  assert.match(react, /import \{ fetchLoginProviders, runProviderLogin \} from '\.\.\/runtime\/provider-login\.mjs'/);
  assert.match(react, /const \[loginProviders, setLoginProviders\] = useState\(\[\]\)/);
  assert.match(react, /const \[loginBusy, setLoginBusy\] = useState\(null\)/);
  assert.match(react, /fetchLoginProviders\(cmd => sendRpc\(cur, cmd\)\)/);
  assert.match(react, /const connectProviderLogin = async \(providerId\)/);
  assert.match(react, /openUrl: url => openExternalUrl\(url\)/);
  assert.match(react, /providers connected via native sign-in/);
  assert.match(react, /Waiting for browser…/);
  // Connected chip reflects loginProviders authentication state
  assert.match(react, /l\.id === p\.id && l\.authenticated\)/);
});
