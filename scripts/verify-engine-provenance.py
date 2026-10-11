#!/usr/bin/env python3
import hashlib, json, subprocess, sys
from pathlib import Path
if len(sys.argv) != 4:
    raise SystemExit('Usage: verify-engine-provenance.py <upstream-git-dir> <engine-exe> <manifest-output>')
upstream,engine,out=map(Path,sys.argv[1:])
sha=subprocess.check_output(['git','-C',str(upstream),'rev-parse','HEAD'],text=True).strip()
expected='2a2c6dcbbb558c0f8145f67f28b3370984f2bf60'
if sha!=expected: raise SystemExit('Unexpected upstream commit '+sha)
diff=subprocess.check_output(['git','-C',str(upstream),'diff','--','packages/coding-agent/scripts/build-binary.ts'])
if b'cnp-engine' not in diff: raise SystemExit('Source fork patch is not present in git diff')
if not engine.is_file() or engine.stat().st_size < 1024*1024: raise SystemExit('Compiled engine missing or implausibly small')
head=engine.open('rb').read(2)
if sys.platform=='win32' and head!=b'MZ': raise SystemExit('Engine is not a Windows PE binary')
manifest={
  'product':'canoPi', 'engineName':'cnp-engine', 'upstream':'https://github.com/can1357/oh-my-pi',
  'upstreamCommit':sha,'sourcePatchSha256':hashlib.sha256(diff).hexdigest(),
  'compiledEngineSha256':hashlib.sha256(engine.read_bytes()).hexdigest(),
  'builtFromPinnedSource':True,
  'scope':'v0.2 engine output branding; full internal CLI rename not yet completed',
}
out.write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps(manifest,indent=2))
