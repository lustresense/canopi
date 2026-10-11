# BUILD_AND_E2E_REPORT.md — canoPi Windows v1.0 Release Pipeline

Date: 2026-10-11 (UTC)  
Host: Windows 10 Pro build 26200.9457 x64  
Repo commit: `8b6adb0e50fb168f9a8c673641979004f1d7237e`  
Pinned upstream OMP: `2a2c6dcbbb558c0f8145f67f28b3370984f2bf60` (v18.6.1)  
Product identity: `canoPi` 1.0.0, identifier `app.canopi.desktop`, publisher `canoPi Project`  
Build result: **SUCCESS** (all 27 pipeline steps completed)

---

## 1. Pipeline Execution Summary

Executed command:
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-windows.ps1 -EngineExe "upstream/oh-my-pi/packages/coding-agent/dist/cnp-engine.exe"
```

### Step Outcomes (27/27 PASSED)
1. Audit version identity across manifests — PASSED (0)
2. Require dependency lockfiles and a coherent git worktree — PASSED (0)
3. Capture build environment — PASSED (0)
4. Check out exact pinned OMP commit — PASSED (0)
5. Reset dedicated upstream source-build checkout — PASSED (0)
6. Apply canoPi fork source patch — PASSED (0)
7. Verify patched fork diff — PASSED (0)
8. Verify supplied engine provenance against pinned clone — PASSED (0)
9. Engine is a real Windows PE of plausible size — PASSED (0)
10. Check engine version (`omp/18.6.1`) — PASSED (0)
11. Live engine RPC v2 handshake smoke (no provider secrets needed) — PASSED (0)
12. Place engine at bundled resource path (`src-tauri/resources/engine/cnp-engine.exe`) — PASSED (0)
13. Install desktop dependencies from lockfile (`npm ci`) — PASSED (0)
14. Node runtime and source tests (53/53 passed) — PASSED (0)
15. React frontend production build (`vite build`) — PASSED (0)
16. Cargo lockfile in sync (`cargo fetch --locked`) — PASSED (0)
17. Compile and test Rust (`cargo test`, 27/27 passed) — PASSED (0)
18. Package NSIS Windows installer (Tauri `tauri build --bundles nsis`) — PASSED (0)
19. Installer is a real Windows PE of plausible size — PASSED (0)
20. Uninstall data cleanup tests on disposable profiles (`test-uninstall-data.ps1`) — PASSED (0)
21. Silent install/uninstall lifecycle verification (`test-uninstall-windows.ps1`) — PASSED (0)
22. Publish installer and provenance to `release/` — PASSED (0)
23. Create source ZIP (git-tracked files + lockfiles, no binaries) — PASSED (0)
24. Create `BUILD-MANIFEST.json` — PASSED (0)
25. Create installer ZIP (`canoPi-windows-installer.zip`) — PASSED (0)
26. Create `SHA256SUMS.txt` covering release artifacts — PASSED (0)
27. Generate `RELEASE_TEST_REPORT.md` from observed evidence — PASSED (0)

---

## 2. Packaging / Release-Script Issues Repaired

During this run, four root causes were identified and fixed in packaging/configuration paths:

1. **Main binary name mismatch**:
   - *Symptom*: NSIS package bundled `canopi-desktop.exe` (from Cargo package name), failing installed-runtime verification expecting `canoPi.exe`.
   - *Fix*: Added `"mainBinaryName": "canoPi"` to `src-tauri/tauri.conf.json`, locked with assertion in `tests/package-contract.test.mjs`.

2. **Silent uninstall Delete-mode auto-trigger**:
   - *Symptom*: NSIS `MessageBox` in silent (`/S`) mode returns `IDYES` by default, triggering data cleanup instead of default Keep.
   - *Fix*: Restored `IfSilent canopi_pre_done` guard immediately before `MessageBox` in `src-tauri/windows/hooks.nsh`, locked in `tests/package-contract.test.mjs`.

3. **PowerShell empty parameter handling**:
   - *Symptom*: `scripts/test-uninstall-windows.ps1` invoked child `verify-installed-runtime.ps1` with `-ExpectedVersion $ExpectedVersion` where variable was empty string `''`; PS CLI treated it as a bare switch lacking value, throwing `Missing an argument for parameter 'ExpectedVersion'`.
   - *Fix*: Spliced `-ExpectedVersion` only when non-empty.

4. **PowerShell 5.1 JSON parsing with empty key**:
   - *Symptom*: In step "Create BUILD-MANIFEST.json", `ConvertFrom-Json` on `package-lock.json` failed with `Cannot process argument because the value of argument "name" is not valid` because npm lockfile v3 contains an empty-string root package key `""` which PS 5.1 rejects as a PSCustomObject property name.
   - *Fix*: Replaced `ConvertFrom-Json` call in `scripts/build-windows.ps1` with direct .NET regex matching for `@tauri-apps/cli` version.

---

## 3. Verified Release Artifacts and Hashes

All release artifacts reside in `release/`:

| Artifact | File Size (bytes) | SHA256 Hash |
|---|---|---|
| `canopi-windows-x64-setup-1.0.0.exe` | 114,088,880 | `F64E6687FC2F4446EABD75C3AE80BC9D70840C69CB6B9F5727CBAA6359411777` |
| `canopi-source-1.0.0.zip` | 359,135 | `2A38EB2F745E3BE65369CA4E4CE6AEE0D8619E6A96D941F1013BC6B72190C653` |
| `canoPi-windows-installer.zip` | 114,105,556 | `7624FA679DD87B079F236A1BB6C241093800330F6E0275A5093B22B2E3839195` |
| `ENGINE-PROVENANCE.json` | 883 | `785353767590BB4E828344BB545F1681941DDDCC084FFF36261E996005A5ADAE` |
| `BUILD-MANIFEST.json` | 3,248 | `07E13FAADAD51BB465DC946B333E36C39F228BC59EEF340A53A0E28C9833DD1F` |
| `SHA256SUMS.txt` | 469 | *(covers the 5 primary artifacts above; byte-for-byte verified)* |
| `RELEASE_TEST_REPORT.md` | 10,089 | *(evidence report generated last)* |

Installer binary format: verified Windows PE (`MZ` header present, length > 100 MiB).

---

## 4. Install & Lifecycle Verification Evidence

Scripted on this machine via `scripts/test-uninstall-windows.ps1` (silent modes, no fake test assertions):

- Silent installation (`/S`): exits 0.
- Installed runtime contract (`verify-installed-runtime.ps1`):
  - Installed Apps registration in `HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\canoPi`: PASS
  - Version `1.0.0`, publisher `canoPi Project`: PASS
  - `DisplayIcon` points at `C:\Users\deano\AppData\Local\canoPi\canoPi.exe`: PASS
  - `UninstallString` points at `uninstall.exe`: PASS
  - App executable `canoPi.exe` present and PE: PASS
  - Bundled engine at `engine\cnp-engine.exe`: PASS (PE, SHA256 matches build provenance `3c4866b6362cf7886fa9a44494ec9d054885c5d3b5e85e6c34b6bfdf24ae3f6c`)
  - Licenses bundled (`LICENSE-OMP.txt`, `THIRD-PARTY-NOTICES-OMP.txt`): PASS
  - No developer binaries (`node`, `bun`, `npm`, `cargo`, `rustc`, `omp`) shipped in install dir: PASS
  - PATH not mutated (no cnp/omp user PATH entry): PASS
  - Start Menu shortcut present: PASS
  - WebView2 runtime registered (version `154.0.4258.62`): PASS
- Disposable owned data fixtures created across 3 roots (`LOCALAPPDATA\app.canopi.desktop`, `APPDATA\app.canopi.desktop`, `USERPROFILE\.canopi`): PASS
- Silent uninstallation (`/S`): exits 0.
- App files removed (`canoPi.exe`, `uninstall.exe`, no leftovers): PASS
- Installed Apps and Start Menu shortcuts removed: PASS
- **WU01/WU08 silent Keep default**: all 3 data roots byte-identical, no deletion receipt created: PASS
- Test fixtures cleaned up, pre-existing data untouched: PASS

---

## 5. P0 Acceptance Limitations & Non-Claims

Honest scope per PRD / test matrix:
1. **Unsigned**: Installer is unsigned. SmartScreen warnings expected; no Authenticode signature or reputation claimed.
2. **Interactive GUI / VM tests NOT RUN**:
   - Interactive NSIS GUI Keep/Delete dialog (WU01 interactive, WU02 interactive Delete, WU03 Cancel) requires VM/human manual verification.
   - Static disposable-profile tests in `test-uninstall-data.ps1` verified ownership-marker checking and junction refusal; full OS-level multi-user / upgrade VM matrix rows (WU01-WU12, A-003, A-019-A-023) are recorded as `NOT RUN` pending dedicated clean-VM runs.
3. **No fake provider turn**: Engine RPC v2 handshake smoke validated protocol exchange (`ready`, `protocol v2`, `open_session`, `get_state`). No simulated model generation or fake provider credentials were used.
4. **No interactive browser / GUI session claimed**: Native WebView2 backend and PTY reaper passed automated unit/integration tests; live GUI interaction on host desktop was not executed.
