#!/usr/bin/env python3
"""Generate or re-validate canoPi engine provenance.

Modes:
  generate: verify-engine-provenance.py <upstream-git-dir> <engine-exe> <manifest-output>
            Writes a provenance manifest for a source-built cnp-engine.exe.
  verify:   verify-engine-provenance.py --verify <manifest> <upstream-git-dir> <engine-exe>
            Recomputes every claim against the local pinned clone + engine bytes
            and fails on any mismatch (used by build-windows.ps1 before packaging).

Claims are limited to observable facts: pinned commit identity, the exact
tracked source diff applied on top of it, and the compiled engine bytes.
"""
import hashlib
import json
import subprocess
import sys
from pathlib import Path

PIN_DEFAULT = '2a2c6dcbbb558c0f8145f67f28b3370984f2bf60'
FORK_FILE = 'packages/coding-agent/scripts/build-binary.ts'
ALLOWED_UNTRACKED = {'CANOPI_SOURCE_FORK.md'}
ENGINE_MIN_BYTES = 1024 * 1024


def pinned_commit() -> str:
    pin_file = Path(__file__).resolve().parent.parent / 'upstream' / 'PINNED_COMMIT.txt'
    if pin_file.is_file():
        for line in pin_file.read_text(encoding='utf-8').splitlines():
            if line.startswith('Commit:'):
                return line.split(':', 1)[1].strip()
    return PIN_DEFAULT


def git(repo: Path, *args: str) -> bytes:
    # core.abbrev=40: diff `index old..new` lines must be byte-stable across
    # clones - shallow clones auto-abbreviate to fewer hex characters, which
    # would change provenance hashes for identical source content.
    return subprocess.check_output(['git', '-C', str(repo), '-c', 'core.abbrev=40', *args])


def collect(upstream: Path, engine: Path) -> dict:
    if not upstream.is_dir():
        raise SystemExit(f'Upstream git dir missing: {upstream}')
    sha = git(upstream, 'rev-parse', 'HEAD').decode().strip()
    expected = pinned_commit()
    if sha != expected:
        raise SystemExit(f'Unexpected upstream commit {sha}, want {expected}')
    if not engine.is_file() or engine.stat().st_size < ENGINE_MIN_BYTES:
        raise SystemExit('Compiled engine missing or implausibly small')
    if sys.platform == 'win32' and engine.open('rb').read(2) != b'MZ':
        raise SystemExit('Engine is not a Windows PE binary')

    # Exclude the fork marker file so the patch hash is identical regardless of
    # clone state (build-engine.ps1 uses `git add -N` on it before diffing).
    full_diff = git(upstream, 'diff', 'HEAD', '--', '.', ':(exclude)CANOPI_SOURCE_FORK.md')
    fork_diff = git(upstream, 'diff', 'HEAD', '--', FORK_FILE)
    if b'cnp-engine' not in fork_diff:
        raise SystemExit('Source fork patch is not present in git diff')

    status = git(upstream, 'status', '--porcelain').decode('utf-8', 'replace').splitlines()
    modified_tracked, untracked = [], []
    for line in status:
        if not line.strip():
            continue
        flag, path = line[:2], line[3:]
        if path == 'CANOPI_SOURCE_FORK.md':
            # Fork marker written by patch-omp.mjs; allowed tracked/staged/
            # intent-to-add/untracked - it is never a rogue change.
            continue
        if flag.strip() == '??':
            untracked.append(path)
        else:
            modified_tracked.append(path)
    if modified_tracked != [FORK_FILE]:
        raise SystemExit(
            'Tracked worktree changes must be exactly the canoPi fork patch file; '
            f'found: {modified_tracked}'
        )
    rogue_untracked = [p for p in untracked if p not in ALLOWED_UNTRACKED]
    if rogue_untracked:
        raise SystemExit(f'Unexpected untracked files in pinned clone: {rogue_untracked}')

    return {
        'product': 'canoPi',
        'engineName': 'cnp-engine',
        'upstream': 'https://github.com/can1357/oh-my-pi',
        'upstreamCommit': sha,
        'forkPatchFile': FORK_FILE,
        'forkPatchSha256': hashlib.sha256(fork_diff).hexdigest(),
        'sourcePatchSha256': hashlib.sha256(full_diff).hexdigest(),
        'trackedModifiedFiles': modified_tracked,
        'compiledEngineSha256': hashlib.sha256(engine.read_bytes()).hexdigest(),
        'compiledEngineBytes': engine.stat().st_size,
        'builtFromPinnedSource': True,
        'schema': 'canopi-engine-provenance/2',
        'note': 'Hashes cover the pinned commit, the tracked source diff and the compiled bytes. '
                'Recompile reproducibility is not claimed beyond these hashes.',
    }


def main(argv):
    if len(argv) == 5 and argv[1] == '--verify':
        manifest_path, upstream, engine = Path(argv[2]), Path(argv[3]), Path(argv[4])
        if not manifest_path.is_file():
            raise SystemExit(f'Manifest missing: {manifest_path}')
        claimed = json.loads(manifest_path.read_text(encoding='utf-8'))
        actual = collect(upstream, Path(engine))
        mismatches = [k for k in actual if claimed.get(k) != actual[k]]
        if mismatches:
            raise SystemExit(
                'Provenance verification FAILED for fields: ' + ', '.join(mismatches)
            )
        print(json.dumps({'verified': True, 'upstreamCommit': actual['upstreamCommit'],
                          'compiledEngineSha256': actual['compiledEngineSha256']}, indent=2))
        return 0
    if len(argv) == 4:
        upstream, engine, out = Path(argv[1]), Path(argv[2]), Path(argv[3])
        manifest = collect(upstream, engine)
        out.write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
        print(json.dumps(manifest, indent=2))
        return 0
    raise SystemExit(__doc__.strip())


if __name__ == '__main__':
    sys.exit(main(sys.argv))
