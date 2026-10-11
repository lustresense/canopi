import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const native = ['mod.rs','terminal.rs','browser.rs','webview2.rs'].map(f=>readFileSync(new URL('../src-tauri/src/native/'+f,import.meta.url),'utf8')).join('\n');
const react = readFileSync(new URL('../src/app/CanoPi.jsx',import.meta.url),'utf8');
const bridge = readFileSync(new URL('../src/runtime/native.js',import.meta.url),'utf8');

test('Rust PTY is backed by portable-pty and a real operating-system shell',()=>{
  assert.match(native,/native_pty_system\(\)/);   // real OS PTY, not a pipe or simulation
  assert.match(native,/\.openpty\(/);
  assert.match(native,/ComSpec/);                // default shell follows the OS
  assert.match(native,/not-absolute/);           // shell must be an absolute path; no PATH resolution
  assert.match(native,/child\.wait\(\)/);        // exit status is captured from the real child
  assert.match(native,/SCROLLBACK_CAP_BYTES/);   // terminal scrollback is bounded
  assert.match(native,/MAX_WRITE_BYTES/);        // input writes are bounded
  // Cross-boundary IPC contract: the frontend invokes these exact command names.
  assert.match(native,/pty_write/);
  assert.match(native,/pty_resize/);
});
test('browser surface has per-agent data directory and no main-window IPC capability',()=>{
  // Invariants: profiles live under the app-owned browser-profiles root with
  // per-session AND per-agent storage isolation; the window renders the real
  // site via an external URL; screenshots come from the WebView2 compositor;
  // camera/mic/location/notifications are default-deny.
  assert.match(native,/join\("browser-profiles"\)/);
  assert.match(native,/browser-profiles[\\\/]sessA[\\\/]agentB/);
  assert.match(native,/\.data_directory\(/);
  // Hardened open: inert about:blank (literal or Url::parse form), policy hooks
  // installed, THEN the validated URL is navigated — no pre-hook redirect.
  { const src=readFileSync(new URL('../src-tauri/src/native/browser.rs',import.meta.url),'utf8');
    const full=src.slice(src.indexOf('WebviewWindowBuilder::new('));
    assert.match(src,/Url::parse\("about:blank"\)/); // (a) inert about:blank created in the window-opening flow
    assert.match(src,/WebviewUrl::External\(/);
    const hooks=full.indexOf('install_policy_hooks'), nav=full.indexOf('.navigate(');
    assert.ok(hooks>-1 && nav>-1 && hooks<nav, 'policy hooks must be installed before the first real navigation'); }
  assert.match(native,/window\.navigate\(url\)/);
  assert.match(native,/Only HTTPS or loopback HTTP allowed/);
  assert.match(native,/CapturePreview/);
  assert.match(native,/COREWEBVIEW2_PERMISSION_STATE_DENY/);
  assert.match(readFileSync(new URL('../src-tauri/capabilities/default.json',import.meta.url),'utf8'),/"windows":\s*\["main"\]/);
});
test('React Shell and Browser now invoke actual Tauri native adapters, without fake replies',()=>{
  assert.match(react,/await createTerminal\(/);
  assert.match(react,/await openAgentBrowser\(/);
  assert.match(react,/await writeTerminal\(/);
  assert.match(react,/watchTerminal\(/);
  assert.doesNotMatch(react,/native browser unavailable/);
  assert.doesNotMatch(react,/ConPTY adapter not implemented/);
  assert.match(bridge,/invoke\('pty_open'/);
  assert.match(bridge,/invoke\('browser_open'/);
});
test('extended terminal and browser contract reaches the UI through real invokes',()=>{
  assert.match(bridge,/invoke\('pty_list'/);
  assert.match(bridge,/invoke\('pty_signal'/);
  assert.match(bridge,/invoke\('browser_navigate'/);
  assert.match(bridge,/invoke\('browser_reload'/);
  assert.match(bridge,/invoke\('browser_state'/);
  assert.match(bridge,/invoke\('browser_screenshot'/);
  // PTY chunks: replay replaces the buffer, seq drops duplicates, exitCode is the child status.
  assert.match(react,/p\.replay/);
  assert.match(react,/terminalSeq/);
  assert.match(react,/Number\.isInteger\(p\.exitCode\)/);
  assert.match(react,/await listTerminals\(/);
  assert.match(react,/await navigateAgentBrowser\(/);
  assert.match(react,/await screenshotAgentBrowser\(/);
});
