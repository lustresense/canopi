import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const native = readFileSync(new URL('../src-tauri/src/native.rs',import.meta.url),'utf8');
const react = readFileSync(new URL('../src/app/CanoPi.jsx',import.meta.url),'utf8');
const bridge = readFileSync(new URL('../src/runtime/native.js',import.meta.url),'utf8');

test('Rust PTY is backed by portable-pty and a real operating-system shell',()=>{
  assert.match(native,/native_pty_system\(\)/);
  assert.match(native,/\.openpty\(/);
  assert.match(native,/spawn_command\(cmd\)/);
  assert.match(native,/"powershell\.exe"/);
  assert.match(native,/pty_write/);
  assert.match(native,/pty_resize/);
});
test('browser surface has per-agent data directory and no main-window IPC capability',()=>{
  assert.match(native,/browser-profiles/);
  assert.match(native,/\.data_directory\(browser_dir\)/);
  assert.match(native,/WebviewUrl::External\(url\)/);
  assert.match(native,/Only HTTPS or loopback HTTP allowed/);
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
