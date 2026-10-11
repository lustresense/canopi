import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
test('JSX source contains all required React entrypoints',()=>{
  const src=readFileSync(new URL('../src/app/CanoPi.jsx',import.meta.url),'utf8');
  assert.match(src,/export default function CanoPi\(/);
  assert.match(src,/import React/);
  assert.match(src,/function NativeDialog\(/);
  assert.match(src,/watchFrames\(/);
});
