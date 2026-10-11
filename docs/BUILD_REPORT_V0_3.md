# canoPi v0.3 implementation and verification evidence

Date 2026-10-11. This is NOT an installer release. It is a source milestone based on the user's v0.2 ZIP and v3 PRD. It must **not** be described as ready for install.

## What changed in this turn

- Preserved `docs/ORIGINAL_CANOPI_WORKSPACE.jsx` byte-for-byte and kept the React workspace, umbrella logo, CSS rules, positions and glass typography intact.
- Added `src-tauri/src/native.rs` with **real native PTY source integration** using `portable-pty` (Windows ConPTY backend): create/write/resize/close, read from the OS shell and emit binary-safe base64 events. React Shell buttons and dock are connected to these commands instead of deliberately unavailable stubs.
- Added native per-agent WebviewWindow support on Windows. Each browser uses a separate directory under canoPi's owned user-data root, and only HTTPS/loopback HTTP URLs are permitted. This is an actual WebView2 window, **not** a working OMP browser tool automation adapter. Browser windows are detached, not embedded in the inspector.
- Added explicit opt-in import of OMP `models.yml`, `models.yaml`, or `models.json` definitions only, never copying OMP auth SQLite DB, sessions, or extensions; rejects symlink/oversized files and never overwrites a canoPi model file. The GUI makes the user confirm before import. This does NOT migrate 9Router auth tokens stored in agent.db.
- Fixed Rust reconnect behavior: an unexpectedly ended RPC process removes its own generation from the supervisor registry, allowing a fresh process to reconnect without a full GUI restart.
- Added `BUILD-WINDOWS.cmd` and `scripts/build-windows.ps1`: reproducible pinned-source fork compilation -> actual RPC smoke -> React/Vite -> Rust -> NSIS -> PE checks -> installer ZIP. The script refuses to fake an EXE. Requires build prerequisites and internet on a Windows x64 machine.
- Fixed the CI workflow to create the missing license directory, require Start Menu and Windows Add/Remove Programs registration, and archive the compiled installer `.exe` as well as a ZIP containing that installer and checksums.

## Verification actually performed in this Linux sandbox

| Check | Outcome | Meaning |
|---|---|---|
| Node tests | **38/38 passed** | Protocol framing, UI source-preservation, pure projections, native adapter source contracts. **Not** an installed application test. |
| React JSX syntax transpilation | **Passed** | Syntactic compile with global TypeScript transpileModule; imports not resolved and React did not render. |
| Windows GitHub Actions YAML structural parse | **Passed** | Pipeline format only. Does not imply the pipeline will run successfully. |
| Original JSX checksum | **Passed** | The bundled original is byte-identical to the user upload. |
| Rust `cargo test` | **NOT RUN** | `cargo`/`rustc` absent. Native Rust code remains **uncompiled and unverified**. |
| React `npm run build` | **BLOCKED** | `vite` and npm dependencies unavailable locally; npm registry cannot be reached. |
| Git clone OMP source | **BLOCKED** | github.com DNS/network unreachable from sandbox. |
| Native OMP RPC handshake, provider turn, 9Router | **NOT RUN** | Source-built runtime unavailable locally; no real model call. |
| Windows NSIS installer and ZIP containing installer | **NOT CREATED LOCALLY** | No Windows build runner and no PE executable. The source ZIP is **not** an installer ZIP. |
| Windows GUI functional E2E and uninstaller tests | **NOT RUN** | Requires Windows host and built app. |
| macOS/Linux installers | **NOT IMPLEMENTED** | Native per-platform builds and cleanup policy remain separate work. |

## Known functional gaps that MUST stay visible

1. The new PTY source adapter still needs Rust compilation, terminal ANSI rendering/scrollback polish, resize and Ctrl-C functional testing, and session shutdown stress testing.
2. The native browser is a per-agent interactive **detached window**. Browser tool commands coming from OMP do **not** automatically control the window, and screenshot/click/type/scroll adapter parity is not done. On non-Windows hosts, the storage-isolation policy needs its own validation.
3. Importing provider models does not copy `agent.db`. In particular, existing OMP/9Router credentials are not automatically migrated; an engine-auth/login path still needs end-to-end verification.
4. Advanced extension UI methods, agent event consistency across session switches, crash recovery, and durable project/session state need Windows E2E.
5. No code-signing certificate exists; a future unsigned installer can show Windows SmartScreen warnings.
6. NSIS uninstall Keep/Delete logic exists but the real Windows uninstaller has not executed against real installed canoPi data.
7. Existing OMP source is patched at build time for `cnp-engine`; full CLI internal namespace migration is not done.

## Accurate release definition

The Windows workflow or BUILD-WINDOWS.cmd must produce a real NSIS PE, install it, verify real cnp handshake, run a model turn, verify TODO state and subagent routes, test ConPTY and WebView2 on target Windows, then test keep/delete uninstall. Without all these gates, source milestone is not finished product. The present environment cannot satisfy all those gates or deliver the requested compiled EXE. Do not mark failed/unrun cells as PASS.
