/**
 * Minimal reproducible canoPi source fork patch, targeted to the pinned build script.
 * This changes the compiled artifact's identity at BUILD TIME, not by renaming
 * a downloaded OMP release. It does NOT claim full CLI/string rebranding.
 * Fail if the pinned file no longer has the expected recipe.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

export function patchFork(root) {
  const target = join(root, 'packages/coding-agent/scripts/build-binary.ts');
  if (!existsSync(target)) throw new Error(`Pinned upstream build source missing: ${target}`);
  const original = readFileSync(target, 'utf8');
  const expected = /const\s+outName\s*=\s*crossBuild\s*\?\s*`omp-\$\{crossBuild\.id\}`\s*:\s*["']omp["']\s*;/;
  const patched = original.replace(expected, 'const outName = crossBuild ? `cnp-engine-${crossBuild.id}` : "cnp-engine";');
  if (patched === original) throw new Error('Upstream build recipe changed. Audit pinned source, do not guess or rename an existing OMP EXE.');
  writeFileSync(target, patched);
  // Include a tracked fork marker in compiled source tree for a readable history.
  writeFileSync(join(root, 'CANOPI_SOURCE_FORK.md'),
    '# canoPi source fork overlay\n\nThis checkout is compiled from pinned Oh My Pi source.\n'+
    'The build-binary.ts artifact identity is patched to `cnp-engine`; no upstream release EXE was downloaded or renamed.\n'+
    'RPC wire methods stay OMP compatible. User-visible CLI help and internal strings are not fully rebranded in v0.2.\n');
  return target;
}
if (process.argv[1] && import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href) {
  if (!process.argv[2]) throw new Error('Usage: node scripts/patch-omp.mjs <upstream-directory>');
  console.log('Patched:', patchFork(resolve(process.argv[2])));
}
