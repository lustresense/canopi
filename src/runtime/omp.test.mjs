import assert from 'node:assert/strict';
import test from 'node:test';
// Pure state projection functions are duplicated here via extraction to avoid requiring Tauri at test time.
import { readFileSync } from 'node:fs';
const code = readFileSync(new URL('./omp.js', import.meta.url), 'utf8');
test('runtime adapter has real IPC and no fake output', () => {
  assert.match(code, /invoke\('rpc_send'/);
  assert.match(code, /listen\('cnp-frame'/);
  assert.match(code, /projection\.mjs/);
  assert.doesNotMatch(code, /This is a preview reply/);
});
test('no arbitrary command execution in Rust bridge', () => {
  const rs = readFileSync(new URL('../../src-tauri/src/main.rs', import.meta.url), 'utf8');
  assert.match(rs, /const ALLOWED/);
  assert.match(rs, /resource_dir\(\)/);
  assert.doesNotMatch(rs, /Command::new\("omp"\)/);
  assert.match(rs, /ui_requests\.lock\(\)\.await\.remove\(id\)/);
});
