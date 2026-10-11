# canoPi Desktop v0.2 — Build and implementation evidence

Date: 2026-10-11 (Asia/Jakarta)
Status: **SOURCE MILESTONE COMPLETED. WINDOWS EXECUTABLE NOT BUILT. NOT PRODUCTION-READY.**

## Verified input and UI preservation

- `canopi-workspace.jsx` user's exact original, SHA256 `6464d6c3a626dc669672b644a2fa3e03f64a1dd795dd40d2a894bc1cc1b30113`. `docs/ORIGINAL_CANOPI_WORKSPACE.jsx` matches its bytes exactly.
- Production `src/app/CanoPi.jsx` retains the original component structure, umbrella Logo JSX and **CSS design rules exactly**, with one explicitly intentional modification: CDN font `@import` removed and equivalent font families loaded locally via `@fontsource`.
- Home, project/session tree, greeting easter egg, glass cyan tokens, messaging serif/sans fonts, inspector, task board, dock retain positioning. Source-level preservation checked. **No screenshot comparison run**.

## Actual implementation and tests

| Capability | State | Evidence / limitation |
|---|---|---|
| Source preservation | Implemented, JS tested | SHA and logo/structure checks |
| React native integration | Source wired, build blocked | Native folder picker and events; Vite unavailable locally |
| Rust RPC startup, session routing | Source written, native compile blocked | `ready` then protocol-v2 negotiation, session directory and state; Rust not installed |
| Strict RPC v2 chunk framing | JS fixtures tested | Rust decoder source also included; Rust compile pending |
| Streaming assistant text | Source wired, unverified | Frame projector and canonical message reconciliation |
| Native TODO to read-only Kanban | Pure unit tested, runtime unverified | Reject invalid status rather than fabricate a replacement |
| Subagent registry and transcript | Source wired, unverified | Snapshot via `get_subagents`, transcript via `get_subagent_messages` |
| Fork source build | Script unit tested, real build blocked | Pinned OMP source commit and tracked `build-binary.ts` patch |
| `cnp-engine.exe` included in installer | CI step written, not run | No executable bundled locally |
| Standalone Windows NSIS installer | Config and CI written, not run | No PE produced |
| Uninstall Keep/Delete data | Hook/script written, Windows test not run | Keep default, owned-root markers, symlink/reparse rejection |
| 9Router auto-import and model sign-in | NOT implemented | Provider setup must be handled separately |
| WebView2 browser per agent | NOT implemented | No fake GUI browser substituting for native browser |
| ConPTY shell | NOT implemented | No simulated native shell |
| macOS/Linux native bundles | NOT implemented | Requires host-specific build and uninstall/data policy |
| OMP-to-canoPi migration | Deferred | v1.1/v2 opt-in import, no implicit overwrite |
| Optional `cnp` CLI command | NOT implemented | Source engine artifact renamed, internal OMP flags retained |
| /share | Intentionally excluded | UI path blocks command, no share feature |

## Tests actually run in this sandbox

- Node.js `node --test src/runtime/*.test.mjs tests/*.test.mjs`: **35/35 passed**, including protocol framing, TODO projection, source preservation, source fork patch fixture, installer packaging contract tests.
- TypeScript `transpileModule` syntax diagnostics on production JSX: **passed**, not equivalent to a full bundle or runtime test.
- Python scripts `py_compile`: run locally if available, not a real OMP process.
- YAML and Tauri JSON structural parse: run locally, not equivalent to a Windows packaging verification.
- Rust `cargo test`: **NOT RUN**, cargo/rustc absent.
- Vite production build: **NOT RUN**, npm modules and npm registry access absent.
- Native `cnp-engine.exe` build, OMP RPC smoke, provider turn: **NOT RUN**, GitHub clone DNS failure, Bun absent.
- NSIS installer & uninstall hooks, Windows registry entry, Start menu, 9Router onboarding: **NOT RUN**, no Windows host available.

## Upstream reference and source scope

- Pinned SHA: `2a2c6dcbbb558c0f8145f67f28b3370984f2bf60`, can1357/oh-my-pi v18.6.1. On source-available Windows runner the workflow verifies SHA, patches the `build-binary.ts` `outName` to `cnp-engine`, compiles from source and rejects an external downloaded upstream release EXE.
- **This is a patch-on-clone fork, not yet a GitHub fork under a canoPi repository, and not a full internal rebranding.** It needs an actual repository with CI.
- The OMP source is not redistributed inside source ZIP and license/third party notices are copied from pinned source during the pipeline.

## Hard blockers and next acceptance gate

Sandbox `git ls-remote` to GitHub and `npm view` to registry failed to resolve domains. `rustc`, `cargo`, `bun`, and Windows runner unavailable. Thus there is **no verified EXE**, no proven live OMP synchronization, no provider turn, and no visual runtime E2E. The first legitimate gate is a **successful Windows CI run** producing a compiled PE installer and a real `cnp-engine` RPC smoke transcript. Manual GUI/provider/uninstall testing follows. Any first-run CI failure must be fixed based on exact logs.

Full goals, platform parity, security and retention acceptance tests are in `PRD_V3_IMPLEMENTATION.md`. This milestone does not claim all PRD v3 features are finished.
