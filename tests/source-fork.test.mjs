import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { patchFork } from '../scripts/patch-omp.mjs';
test('canopi fork modifies the source build recipe, not a downloaded EXE',()=>{
  const root=mkdtempSync(path.join(tmpdir(),'cnp-fork-'));
  try {
    const file=path.join(root,'packages/coding-agent/scripts/build-binary.ts');
    mkdirSync(path.dirname(file),{recursive:true});
    writeFileSync(file,'const outName = crossBuild ? `omp-${crossBuild.id}` : "omp";');
    patchFork(root);
    assert.match(readFileSync(file,'utf8'),/cnp-engine-\$\{crossBuild.id\}/);
    assert.throws(()=>patchFork(root),/changed/);
    assert.match(readFileSync(path.join(root,'CANOPI_SOURCE_FORK.md'),'utf8'),/source fork/);
  } finally { rmSync(root,{recursive:true,force:true}); }
});
