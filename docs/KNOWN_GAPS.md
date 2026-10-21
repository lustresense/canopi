# Known remaining gaps against PRD v3

Status following 2026-10-12 verified source build:

1. **Windows native compile**: PASS. 51 Rust tests pass, 76 JS runtime/contract tests pass, Vite production build passes. Tauri packages `canoPi-Setup-1.0.0-win-x64.exe` (NSIS) under `release/`.
2. **Engine source build and provenance**: PASS. Pinned OMP commit `2a2c6dcbbb558c0f8145f67f28b3370984f2bf60` built from source via GNU toolchain with fork patches applied (`build-binary.ts`, `main.ts`, `transport-fetch.ts`). Engine hash `09d6b7641ac28a7551ab069f8da255988f74a3a527297c4544c6a689c3ef0f5b` recorded in `ENGINE-PROVENANCE.json` and verified in pipeline.
3. **Engine communication**: Engine runs headless with hidden child RPC-UI pipes (`--mode rpc-ui`). No terminal/PTY emulator; pseudo-terminal layer removed.
4. **Native browser surface**: WebView2 per-agent windows implemented with fail-closed registration (`run_registration_sequence`) before initial navigation; navigation or hook failures immediately close the surface.
5. **Provider boundary and transport security**: Upstream `transportFetch` overlay (`patches/omp/0002-canoPi-transport-endpoint-security.patch`) enforces loopback-only HTTP, blocks never-trustable IP ranges, verifies explicit trust for private endpoints, and guards redirects. Selective provider import with SHA-256 digest preview avoids silent credential leaks.
6. **Code signing prerequisite**: An EV/OV code-signing certificate is an external prerequisite for Signed production builds. The release pipeline fails closed when `ReleaseMode=Signed` without credentials. Development builds emit an unsigned installer.
7. **Installer and uninstall verification**: Lab tests on disposable profiles pass for owned root deletion, marker check, junction refusal, and external preservation. Multi-user isolation and clean VM matrix (WU01-WU12) remain external verification items.
8. **Mac/Linux**: Not shipped in this build; Windows x64 only.

Implementation order remains governed by `PRD.md` (v3). Treat source milestone v0.2 as partial technical progress, not completed requirements.
