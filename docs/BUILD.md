# Building from source

## Status and prerequisites

Internal version **0.0.1**. Windows native compilation is unverified for this snapshot; known source defects remain. Successful frontend tests/builds do not establish desktop readiness.

For frontend work: Git, Node.js 22 (at least 22.16 for the build scripts' `import.meta.dirname` usage), npm. For the Windows desktop pipeline additionally install PowerShell, Python 3, Rust/Cargo with appropriate Windows native build tools, Bun and WebView2 prerequisites required by Tauri 2. Dependency installs and upstream fetches need network access. Signing requires separately provisioned certificates; none are distributed here.

```sh
npm ci
npm test
npm run build
```

These commands test/build the frontend only. `npm test` includes source-contract/regex checks; the previously reported 122-test baseline is not proof of OAuth, router, provider, installer or platform acceptance. Rerun against the exact manifest commit and report actual results.

## Engine inputs

`upstream/PINNED_COMMIT.txt` records the exact Oh My Pi source commit (`2a2c6dcbbb558c0f8145f67f28b3370984f2bf60`). `scripts/patch-omp.mjs` and `patches/omp/` apply canoPi's source changes. Engine EXEs, generated upstream legal files and `ENGINE-PROVENANCE.json` are deliberately absent from source.

The Windows pipeline clones its dedicated `_upstream/oh-my-pi` build checkout, checks out the pin, applies the patches, compiles the engine, copies upstream `LICENSE` and `THIRD-PARTY-NOTICES.txt` into `src-tauri/resources/licenses/`, generates provenance and stages `src-tauri/resources/engine/cnp-engine.exe`. It does not rename an upstream release binary. `scripts/build-engine.ps1` is an additional engine recipe using a separate dedicated `upstream/oh-my-pi` checkout; its toolchain fallback does not establish desktop compile success.

**Both engine recipes reset their dedicated upstream checkout. Never point them at a working source checkout containing your own changes.**

## Windows pipeline

Run in a native Windows developer shell from a disposable checkout:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-windows.ps1
# Or interactive wrapper:
.\BUILD-WINDOWS.cmd
```

The default pipeline can install/uninstall its generated application and touches app-specific state. Run on a disposable Windows test machine after reviewing the script. `-SkipInstallTest` skips that lifecycle test only; a build with skipped tests is not validated installation evidence.

A supplied engine must have matching provenance:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-windows.ps1 -EngineExe C:\build-inputs\cnp-engine.exe -EngineProvenance C:\build-inputs\ENGINE-PROVENANCE.json -SkipInstallTest
```

`ENGINE-PROVENANCE.json` is generated and validated by `scripts/verify-engine-provenance.py`, never fabricated. Tauri validates configured resource inputs during Cargo checks/tests as well as packaging: missing EXE/legal files must be generated before native compilation. Do not create placeholder resources to obtain a green result.

Pipeline outputs live in ignored `release/`; source checkout, source export and installer release are distinct artifacts. `SOURCE-MANIFEST.json` is deterministic source provenance; it is not engine provenance or a code signature. Review source/legal closure, run Rust/engine checks, perform Windows installer lifecycle and real user-flow acceptance before recommending a binary.

## Preserved test fixture

`docs/ORIGINAL_CANOPI_WORKSPACE.jsx` is retained solely because `tests/package-contract.test.mjs` reads it as a source-preservation fixture. It is not the application entrypoint, a current screenshot or product readiness evidence. Internal plans and development reports are excluded.
