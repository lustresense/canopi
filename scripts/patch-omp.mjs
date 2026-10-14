/**
 * Minimal reproducible canoPi source fork patch, targeted to the pinned build script
 * and runtime bootstrap logic.
 * This changes the compiled artifact's identity at BUILD TIME, not by renaming
 * a downloaded OMP release, and enables providerless RPC mode bootstrap.
 * Fail closed if pinned files no longer match expected recipes.
 */
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';

export function patchFork(root) {
  const binaryTarget = join(root, 'packages/coding-agent/scripts/build-binary.ts');
  if (!existsSync(binaryTarget)) throw new Error(`Pinned upstream build source missing: ${binaryTarget}`);
  const binaryOriginal = readFileSync(binaryTarget, 'utf8');
  const binaryExpected = /const\s+outName\s*=\s*crossBuild\s*\?\s*`omp-\$\{crossBuild\.id\}`\s*:\s*["']omp["']\s*;/;
  const binaryPatched = 'const outName = crossBuild ? `cnp-engine-${crossBuild.id}` : "cnp-engine";';

  if (!binaryOriginal.includes(binaryPatched)) {
    if (!binaryExpected.test(binaryOriginal)) {
      throw new Error('Upstream build recipe changed. Audit pinned source, do not guess or rename an existing OMP EXE.');
    }
    writeFileSync(binaryTarget, binaryOriginal.replace(binaryExpected, binaryPatched));
  }

  const mainTarget = join(root, 'packages/coding-agent/src/main.ts');
  if (!existsSync(mainTarget)) throw new Error(`Pinned upstream main source missing: ${mainTarget}`);
  const mainOriginal = readFileSync(mainTarget, 'utf8');
  const mainExpected = /if\s*\(!isInteractive\s*&&\s*!session\.model\)\s*\{/;
  const mainPatched = 'if (!isInteractive && mode !== "rpc" && mode !== "rpc-ui" && !session.model) {';

  if (!mainOriginal.includes(mainPatched)) {
    if (!mainExpected.test(mainOriginal)) {
      throw new Error('Upstream startup logic changed in main.ts. Audit pinned source.');
    }
    writeFileSync(mainTarget, mainOriginal.replace(mainExpected, mainPatched));
  }
  const repoRoot = resolve(import.meta.dirname, '..');
  const transportPatch = join(repoRoot, 'patches/omp/0002-canoPi-transport-endpoint-security.patch');
  if (!existsSync(transportPatch)) throw new Error(`canoPi transport patch missing: ${transportPatch}`);
  const transportTarget = join(root, 'packages/ai/src/utils/transport-fetch.ts');
  if (!existsSync(transportTarget)) throw new Error(`Pinned upstream transport source missing: ${transportTarget}`);
  const transportSource = readFileSync(transportTarget, 'utf8');
  if (!transportSource.includes('CANOPI_STRICT_ENDPOINTS')) {
    const patchContent = readFileSync(transportPatch, 'utf8');
    const normalizedPatch = patchContent.replace(/\r\n/g, '\n');
    const tmpPatch = join(root, '.tmp-canoPi-transport.patch');
    writeFileSync(tmpPatch, normalizedPatch, 'utf8');
    try {
      execFileSync('git', ['apply', '--check', '--recount', tmpPatch], { cwd: root, stdio: 'pipe' });
      execFileSync('git', ['apply', '--recount', tmpPatch], { cwd: root, stdio: 'pipe' });
    } catch (error) {
      const detail = error.stderr?.toString() || error.message;
      throw new Error(`Cannot apply canoPi transport patch: ${detail}`);
    } finally {
      try { rmSync(tmpPatch, { force: true }); } catch {}
    }
  }

  // Include a tracked fork marker in compiled source tree for a readable history.
  writeFileSync(join(root, 'CANOPI_SOURCE_FORK.md'),
    '# canoPi source fork overlay\n\nThis checkout is compiled from pinned Oh My Pi source.\n'+
    'The build-binary.ts artifact identity is patched to `cnp-engine`; no upstream release EXE was downloaded or renamed.\n'+
    'RPC wire methods stay OMP compatible. User-visible CLI help and internal strings are not fully rebranded in v0.2.\n');

  return [binaryTarget, mainTarget];
}

if (process.argv[1] && import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href) {
  if (!process.argv[2]) throw new Error('Usage: node scripts/patch-omp.mjs <upstream-directory>');
  console.log('Patched:', patchFork(resolve(process.argv[2])));
}
