# Known remaining gaps against PRD v3

Release-blocking and unverified:

1. **Windows native compile**: no local `cargo` or `rustc`, no Windows environment. Rust supervisor is authored but uncompiled. Must repair any compiler errors from first Windows CI run.
2. **Frontend dependency build**: no local Vite packages; the production JSX transpiles but the full React app has not rendered/tested in this version.
3. **Engine build**: this ZIP intentionally carries a source patch, not OMP repository or EXE. Pinned OMP checkout, source rename, Bun build, real RPC protocol and model operations await Windows CI.
4. **Installer and uninstall**: NSIS hook, safe deletion script, mock-data tests authored but untested on Windows. Need real install, registry registration, uninstall Keep/Delete, symlink/reparse and multiuser tests.
5. **9Router/provider onboarding**: missing; do not silently import existing profile, especially secrets. Configure in canoPi profile via native tested setup.
6. **Native browser surface**: agent-isolated WebView2 not implemented, controls intentionally unsupported. A GUI mock is unacceptable.
7. **Terminal**: ConPTY session process not implemented, shell controls intentionally unsupported.
8. **Extension parity**: approval UX and some dynamic widgets require native RPC-UI capability audit and implementation. Unsupported controls must be honest.
9. **Mac/Linux**: no native packaging, CLI/binary names/GUI integration or full uninstall retention design; not shipped. Windows EXE works only on Windows.
10. **Full rebrand**: `cnp-engine` is a source-built executable artifact name; full internal CLI namespace `cnp`, other OMP strings/config namespaces not yet comprehensively forked. Preserve protocol compatibility.
11. **Security and data**: native startup isolated app roots are marked, but richer credential storage, importer, own migration and robust single-user/multi-user OS cleanup must be verified before distributing.
12. **Complete UX**: significant feature parity and screenshot/keyboard/accessibility E2E tests remain. Source-level component/style equivalence alone is not screenshot fidelity.

Implementation order remains governed by `PRD.md` (v3). Treat source milestone v0.2 as partial technical progress, not completed requirements.
