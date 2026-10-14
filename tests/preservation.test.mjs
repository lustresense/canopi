import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
const port=readFileSync(new URL('../src/app/CanoPi.jsx',import.meta.url),'utf8');
test('core JSX component layout preserved',()=>{
  for(const name of ['Topbar','Rail','ProjectNode','SessionNode','AgentRow','Home','Conversation','Transcript','Composer','Inspector','InspChat','Board','Dock','DockPane','DrawerLayer','PaletteLayer']){
    assert.match(port,new RegExp(`function ${name}\\(`),name);
  }
  assert.match(port,/<Topbar\s*\/>/);
  assert.match(port,/<Rail\s*\/>/);
  assert.match(port,/<main className="work"/);
  assert.match(port,/<TaskStrip\s*\/>/);
  assert.match(port,/<Composer\s*\/>/);
  assert.match(port,/<Dock\s*\/>/);
  assert.match(port,/function Logo\(/);
  assert.match(port,/Crimson Text/);
  assert.match(port,/Plus Jakarta Sans/);
});
test('production does not seed preview tasks or simulate model answers',()=>{
  assert.doesNotMatch(port,/function seed\(/);
  assert.doesNotMatch(port,/function PreviewLayer\(/);
  assert.doesNotMatch(port,/function pageFor\(/);
  assert.doesNotMatch(port,/function PageView\(/);
  assert.match(port,/sendRpc\(sidx,\{type:'prompt',message:text/);
  assert.match(port,/normalizeTodos\(state\)/);
});
