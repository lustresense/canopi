import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("JSX source contains required React entrypoints", () => {
  const src = readFileSync(new URL("../src/app/CanoPi.jsx", import.meta.url), "utf8");
  assert.match(src, /export default function CanoPi\(/);
  assert.match(src, /import React/);
  assert.match(src, /function NativeDialog\(/);
  assert.match(src, /watchFrames\(/);
});

test("native providers have matching setup options", () => {
  const rust = readFileSync(new URL("../src-tauri/src/main.rs", import.meta.url), "utf8");
  const ui = readFileSync(new URL("../src/app/CanoPi.jsx", import.meta.url), "utf8");
  const block = rust.split("const BUILTIN_PROVIDERS: &[&str] = &[")[1].split("];", 1)[0];
  const providers = [...block.matchAll(/"([a-z0-9_-]+)"/g)].map(match => match[1]);
  for (const provider of providers) assert.ok(ui.includes(`<option value="${provider}">`), `missing ${provider}`);
});
test("dashboard exposes actual provider and model state, marks request telemetry unavailable", () => {
  const src = readFileSync(new URL("../src/app/CanoPi.jsx", import.meta.url), "utf8");
  assert.match(src, /function Dashboard\(/);
  assert.match(src, /aria-label="Dashboard"/);
  assert.match(src, /Request telemetry unavailable/);
  assert.match(src, /providerConfig/);
  assert.match(src, /availableModels/);
});
