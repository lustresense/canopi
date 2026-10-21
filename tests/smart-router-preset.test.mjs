import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const mainRs = readFileSync(join(root, "src-tauri/src/main.rs"), "utf8");
const canoPiJsx = readFileSync(join(root, "src/app/CanoPi.jsx"), "utf8");
const endpointRs = readFileSync(join(root, "src-tauri/src/provider_endpoint.rs"), "utf8");

test("canopi-router is listed in BUILTIN_PROVIDERS", () => {
  const block = mainRs.match(/const BUILTIN_PROVIDERS[\s\S]*?\];/);
  assert.ok(block, "BUILTIN_PROVIDERS block not found in main.rs");
  assert.match(block[0], /"canopi-router"/);
});

test("Smart Router setup option exists alongside native providers", () => {
  assert.ok(
    canoPiJsx.includes('<option value="canopi-router">Smart Router</option>'),
    "Smart Router option missing from CanoPi.jsx"
  );
});

test("local router server uses a loopback endpoint", () => {
  const src = mainRs + endpointRs + canoPiJsx;
  const m = src.match(/https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/);
  assert.ok(m, "no loopback http endpoint found in main.rs/provider_endpoint.rs/CanoPi.jsx");
});
