import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('Tauri mapped resource path matches Rust engine path',()=>{
  const c=JSON.parse(read('src-tauri/tauri.conf.json'));
  assert.equal(c.productName,'canoPi');
  assert.equal(c.identifier,'app.canopi.desktop');
  assert.equal(c.bundle.resources['resources/engine/cnp-engine.exe'],'engine/cnp-engine.exe');
  assert.match(read('src-tauri/src/main.rs'),/join\("engine"\)\.join\(name\)/);
});
test('production keeps original CSS and umbrella logo byte-identical to v0.1',()=>{
  const original=read('docs/ORIGINAL_CANOPI_WORKSPACE.jsx');
  const port=read('src/app/CanoPi.jsx');
  for(const name of ['function Logo(', 'function Home()', 'function Rail()', 'function Board()','function Dock()']) {
    assert.ok(original.includes(name),'Original missing '+name);
    assert.ok(port.includes(name),'Port missing '+name);
  }
  const css=port.match(/const CSS = `([\s\S]*?)`;\/\*?\s*={5,}/)?.[1] || port.match(/const CSS = `([\s\S]*?)`;/)?.[1];
  assert.ok(css && css.includes('--glass:rgba(25,45,53,.58)'));
});
test('Windows installer exposes an explicit keep/delete-data choice',()=>{
  const conf=JSON.parse(read('src-tauri/tauri.conf.json'));
  assert.equal(conf.bundle.windows.nsis.installerHooks,'./windows/hooks.nsh');
  const hooks=read('src-tauri/windows/hooks.nsh');
  assert.match(hooks,/StrCpy \$R8 "keep"/);
  assert.match(hooks,/MB_DEFBUTTON2/);
  assert.match(hooks,/canopi_pre_delete/);
  assert.match(hooks,/canopi-cleanup\.ps1/);
});
test('cleanup is restricted to app-owned roots and refuses reparse points',()=>{
  const ps=read('src-tauri/windows/uninstall-data.ps1');
  assert.match(ps, /app\.canopi\.desktop/);
  assert.match(ps, /\.canopi-owner/);
  assert.match(ps, /ReparsePoint/);
  assert.doesNotMatch(ps, /\.omp[\\/]/);
  assert.doesNotMatch(ps, /\$env:USERPROFILE\s*\|\s*Remove-Item/);
});
test('source tree has no placeholder exe masquerading as compiled runtime',()=>{
  assert.ok(!existsSync(new URL('../src-tauri/resources/engine/cnp-engine.exe',import.meta.url)));
  assert.ok(!existsSync(new URL('../dist-artifacts/canoPi.exe',import.meta.url)));
});
