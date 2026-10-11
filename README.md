# canoPi Desktop v0.3, work in progress

**This ZIP contains SOURCE, not a Windows installer.** The native Rust extensions, OMP fork, and GUI have not been compiled together in this environment. Nothing in this archive is a real `canoPi Setup.exe`.

The approved `canopi-workspace.jsx` is preserved in `docs/ORIGINAL_CANOPI_WORKSPACE.jsx`, and its React layout, logo and glass CSS remain the design reference. The Tauri v2 / Rust frontend integrates the OMP `rpc-ui` protocol; a native PTY adapter and a separate WebView2 browser window per agent have been added as source code but require Windows compilation/testing.

## Building on Windows

Copy/unzip this repository on Windows x64, install the official Git, Node 22+, Python 3, Bun 1.3.14+, Rust MSVC toolchain and C++/Windows SDK prerequisites, then run `BUILD-WINDOWS.cmd` in the extracted source folder. An internet connection is required. The script builds the **pinned OMP commit from source**, checks an actual `cnp-engine` RPC handshake, compiles React and Rust, packages a Tauri NSIS installer, and produces `release/canoPi-windows-installer.zip` containing the real installer **only if every step succeeds**.

If you use GitHub, place this source at a repository root and run the workflow `.github/workflows/windows-build.yml` on a Windows runner. Artifacts are uploaded only after successful checks. Read `docs/BUILD_REPORT_V0_3.md` before treating an artifact as usable.

Data: Windows uninstaller defaults to **Keep data**; explicit Delete only traverses validated, marker-owned canoPi data folders. Existing OMP, opened project folders, credentials not imported, and other applications are never targets of canoPi cleanup.

Native browser: WebView2 opens in a dedicated window per agent and does not yet provide OMP tool-driven browser automation or embedded tabs. Native shell: portable-pty implements Windows ConPTY on supported Windows builds, with events sent from Rust to React. Neither component has been runtime-verified in this environment.

9Router: canoPi's isolated profile does not implicitly clone OMP settings. The GUI can optionally import provider model definitions; auth SQLite files are never auto-imported. Explicit login/provider setup is still required for credentials held there.

The current pinned upstream and exact layout/rpc/installer requirements are in `docs/PRD_V3_IMPLEMENTATION.md`; verifiable status is in `docs/BUILD_REPORT_V0_3.md`. No `/share`, no Electron, and no dependence on globally installed `omp` when built successfully.
