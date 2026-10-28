import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert';

test('CanoPi.jsx: refreshLoginProviders declared before useEffect (TDZ prevention)', () => {
  const code = readFileSync('src/app/CanoPi.jsx', 'utf8');
  const declPos = code.indexOf('const refreshLoginProviders = useCallback(');
  const effectPos = code.indexOf('void refreshLoginProviders();');
  assert(declPos !== -1, 'refreshLoginProviders declaration must exist');
  assert(effectPos !== -1, 'refreshLoginProviders call in useEffect must exist');
  assert(declPos < effectPos, 'refreshLoginProviders must be declared BEFORE useEffect to prevent TDZ ReferenceError');
});

test('CanoPi.jsx: onSave requires API key directly without OAuth bypass', () => {
  const code = readFileSync('src/app/CanoPi.jsx', 'utf8');
  assert(
    code.includes("const key = keyInput.trim();") && code.includes("if (!key) { A.toast('Enter an API key.'); return; }"),
    'onSave must validate key directly without empty key saveApiKey invocation'
  );
  assert(
    !code.includes('if (!key && !hasOAuthSession)'),
    'hasOAuthSession must not bypass empty key check in onSave'
  );
});
