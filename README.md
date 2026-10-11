# canoPi Desktop v1.0 for Windows

**This repository contains SOURCE, not a prebuilt installer.** Compiled artifacts exist only under `release/` after a successful `BUILD-WINDOWS.cmd` run; a source ZIP never contains engine or installer binaries.

The approved `canopi-workspace.jsx` is preserved in `docs/ORIGINAL_CANOPI_WORKSPACE.jsx`, and its React layout, logo and glass CSS remain the design reference. The Tauri v2 / Rust frontend integrates the OMP `rpc-ui` protocol; a native PTY adapter and a separate WebView2 browser window per agent have been added as source code but require Windows compilation/testing.

## Building on Windows

Copy/unzip this repository on Windows x64, install the official Git, Node 22+, Python 3, Bun 1.3.14+, Rust MSVC toolchain and C++/Windows SDK prerequisites, then run `BUILD-WINDOWS.cmd` in the extracted source folder. An internet connection is required. The script audits version/lockfile identity, builds (or revalidates via `-EngineExe` + `ENGINE-PROVENANCE.json`) the **pinned OMP commit from source**, checks an actual `cnp-engine` RPC handshake, runs tests, compiles React and Rust, packages a Tauri NSIS installer, verifies silent install/uninstall with default Keep data, and only then publishes `release/`: `canopi-windows-x64-setup-<version>.exe`, `canopi-source-<version>.zip`, `ENGINE-PROVENANCE.json`, `BUILD-MANIFEST.json`, `SHA256SUMS.txt`, `RELEASE_TEST_REPORT.md`, `canoPi-windows-installer.zip`. Per-step logs: `release/_logs/`. Any failed step aborts before publication, so no release file from a failed run is trustworthy.

If you use GitHub, place this source at a repository root and run the workflow `.github/workflows/windows-build.yml` on a Windows runner. Artifacts are uploaded only after successful checks. Read `docs/BUILD_REPORT_V0_3.md` before treating an artifact as usable.

Data: Windows uninstaller defaults to **Keep data** — the stock Tauri "Delete app data" checkbox is neutralized and deletion runs only through `src-tauri/windows/uninstall-data.ps1`, which requires the `.canopi-owner` marker, refuses junctions/reparse points, and writes a receipt to `%LOCALAPPDATA%\canoPi-uninstall-receipt.json` on failure. Explicit Delete only traverses validated, marker-owned canoPi data folders. Existing OMP (`~/.omp`), 9Router settings, opened project folders, and other applications are never targets of canoPi cleanup.

Native browser: WebView2 opens in a dedicated window per agent and does not yet provide OMP tool-driven browser automation or embedded tabs. Native shell: portable-pty implements Windows ConPTY on supported Windows builds, with events sent from Rust to React. Neither component has been runtime-verified in this environment.

9Router: canoPi's isolated profile does not implicitly clone OMP settings. The GUI can optionally import provider model definitions; auth SQLite files are never auto-imported. Explicit login/provider setup is still required for credentials held there.

The current pinned upstream and exact layout/rpc/installer requirements are in `docs/PRD_V3_IMPLEMENTATION.md`; verifiable status is in `docs/BUILD_REPORT_V0_3.md`. No `/share`, no Electron, and no dependence on globally installed `omp` when built successfully.
