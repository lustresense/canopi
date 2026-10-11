# Known remaining gaps against PRD v3

Release-blocking and unverified:

1. **Windows native compile**: `cargo`/`rustc` 1.99 are installed, but this machine has **no Visual Studio/MSVC `link.exe`** (rustup default switched to `stable-x86_64-pc-windows-gnu`); whether the Tauri/wry stack links under the GNU toolchain is unproven - the first `cargo test`/NSIS build attempt reports it honestly. CI/VM with official MSVC Build Tools stays the fallback. `cargo fetch --locked` passes with the committed `src-tauri/Cargo.lock`.
2. **Frontend dependency build**: `npm ci` from the committed `package-lock.json` and `npm run build` (Vite) now PASS on this machine; `npm test` results are tracked in `release/RELEASE_TEST_REPORT.md` per build, not claimed here.
3. **Engine build**: pinned OMP checkout + fork patch verified locally; a source-built `cnp-engine.exe` plus `ENGINE-PROVENANCE.json` is still required and has not yet been produced on this machine (MSVC `link.exe` missing for `build:native`). `build-windows.ps1` refuses to package without a verified engine (in-pipeline source build, or `-EngineExe` + provenance revalidated against the pinned clone). A renamed upstream release EXE is never accepted. `tauri-build` requires all bundle resources (engine included) to exist for any `cargo` invocation, so cargo steps are gated behind engine staging.
4. **Installer and uninstall**: NSIS hooks neutralize Tauri's stock blind `Delete app data` path and route deletion only through marker-validated `uninstall-data.ps1`; disposable-profile checks (owned delete, junction refusal, OMP/9Router/external preservation, receipt honesty) pass locally. Real install/registry/Start Menu verification, interactive Delete/Cancel and the full WU01-WU12 matrix still require a clean Windows VM run; evidence is collected under `release/evidence/`.
5. **9Router/provider onboarding**: missing; do not silently import existing profile, especially secrets. Configure in canoPi profile via native tested setup.
6. **Native browser surface**: agent-isolated WebView2 windows are now implemented natively (no external Chrome, no Electron); OMP tool-driven automation parity and runtime isolation proof still require VM evidence. Unsupported controls must stay honest.
7. **Terminal**: ConPTY sessions implemented natively via portable-pty with real exit-code reporting; Windows runtime verification and regression evidence still required.
8. **Extension parity**: approval UX and some dynamic widgets require native RPC-UI capability audit and implementation. Unsupported controls must be honest.
9. **Mac/Linux**: no native packaging, CLI/binary names/GUI integration or full uninstall retention design; not shipped. Windows EXE works only on Windows.
10. **Full rebrand**: `cnp-engine` is a source-built executable artifact name; full internal CLI namespace `cnp`, other OMP strings/config namespaces not yet comprehensively forked. Preserve protocol compatibility.
11. **Security and data**: native startup isolated app roots are marked, but richer credential storage, importer, own migration and robust single-user/multi-user OS cleanup must be verified before distributing.
12. **Complete UX**: significant feature parity and screenshot/keyboard/accessibility E2E tests remain. Source-level component/style equivalence alone is not screenshot fidelity.

Implementation order remains governed by `PRD.md` (v3). Treat source milestone v0.2 as partial technical progress, not completed requirements.
