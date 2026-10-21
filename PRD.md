# PRD: canoPi Desktop — v0.3 (2026-10-21)

> **Source of truth**: Existing build reports + reality check.
> **Status**: Initial PRD berdasarkan build artifacts yang sudah ada.

---

## 1. PRODUCT IDENTITY

| Field | Value |
|-------|-------|
| **Product** | canoPi Desktop |
| **Package** | `canopi-desktop` (Tauri v2 + Vite) |
| **Platform** | Windows (primary), Linux, macOS |
| **Framework** | Vite + Tauri v2 (Rust backend) |
| **Language** | TypeScript (frontend) + Rust (backend) |

---

## 2. CURRENT STATE (Dari build artifacts)

### Build Reports
- `BUILD_AND_E2E_REPORT.md` — Full build pipeline & E2E test results
- `CANOPI_V0_3_BUILD_REPORT.md` — v0.3 build details
- `CANOPI_V0_3_TEST_RESULTS.txt` — Test output
- `ENGINE-PROVENANCE.json` — Engine/build provenance tracking

### Release Pipeline
- GitHub Actions untuk build Windows
- `BUILD-WINDOWS.cmd` script
- Release artifacts di `release/` folder

---

## 3. TECH STACK — SPEC vs REALITY

| Layer | **Target** | **Current (v0.3)** | **Gap** |
|-------|------------|---------------------|---------|
| **Frontend** | Vite + TypeScript + React/Preact/Svelte | Vite + (need to verify) | Unknown |
| **Backend** | Tauri v2 (Rust) | Tauri v2 ✅ | ✅ |
| **Language** | TS strict + Rust | Need verify TS config | Medium |
| **Build** | Vite + Tauri CLI | Vite + Tauri + GitHub Actions ✅ | ✅ |
| **Testing** | Vitest + Playwright + Tauri E2E | E2E reports exist ✅ | Partial |
| **CI/CD** | GitHub Actions (matrix: Win/Linux/macOS) | Windows only | Medium |
| **Signing** | Code signing (Windows) | Not configured | Major |
| **Auto-update** | Tauri updater | Not configured | Major |

---

## 4. ARCHITECTURE

```
canopi-release-build-8fa721e/
├── src/                     # Frontend source (Vite)
├── src-tauri/               # Tauri/Rust backend
│   ├── src/
│   │   ├── main.rs          # Entry point
│   │   ├── commands.rs      # Tauri commands
│   │   └── ...              # Rust modules
│   ├── Cargo.toml
│   ├── tauri.conf.json      # Tauri config
│   └── build.rs
├── public/                  # Static assets
├── .github/workflows/       # GitHub Actions
├── release/                 # Release artifacts
├── patches/                 # Dependency patches
├── upstream/                # Upstream deps
├── _upstream/               # Internal upstream
├── assets/                  # App icons, etc.
├── tests/                   # E2E tests
├── scripts/                 # Build scripts
├── dist/                    # Vite build output
├── package.json
├── tsconfig.json            # (verify exists)
├── vite.config.ts
├── tauri.conf.json          # (root copy?)
├── PRD.md                   # This file
├── SPEC.md                  # Spec template
├── CHANGELOG.md
├── README.md
├── BUILD_AND_E2E_REPORT.md
├── CANOPI_V0_3_BUILD_REPORT.md
├── CANOPI_V0_3_TEST_RESULTS.txt
├── ENGINE-PROVENANCE.json
└── BUILD-WINDOWS.cmd
```

---

## 5. IMMEDIATE ACTION ITEMS

### P0 — Foundation
- [ ] **Verify TypeScript setup**: `tsconfig.json` strict mode
- [ ] **Verify frontend framework**: React/Preact/Svelte/Vanilla?
- [ ] **Code signing**: Windows certificate setup untuk distribution
- [ ] **Auto-updater**: Tauri updater config + GitHub releases

### P1 — Cross-platform
- [ ] **Linux build**: GitHub Actions matrix (AppImage/.deb/.rpm)
- [ ] **macOS build**: GitHub Actions matrix (universal .dmg)
- [ ] **CI/CD matrix**: Windows + Linux + macOS parallel

### P2 — Quality
- [ ] **Unit tests**: Vitest (frontend) + cargo test (Rust)
- [ ] **E2E tests**: Playwright/Tauri driver (expand existing)
- [ ] **Linting**: ESLint + clippy + rustfmt
- [ ] **Bundle size audit**

### P3 — Distribution
- [ ] **Microsoft Store** / **Snapcraft** / **Homebrew** publishing
- [ ] **Telemetry/analytics** (opt-in)
- [ ] **Crash reporting** (Sentry/Rust backtrace)

---

## 6. OPEN QUESTIONS

1. **Frontend framework**: Apa yang dipakai di `src/`?
2. **Code signing cert**: Sudah ada cert Windows (EV/code signing)?
3. **Updater endpoint**: GitHub Releases atau custom server?
4. **Target Windows version**: Windows 10 1909+? Windows 11 only?
5. **Rust MSRV**: Minimum Supported Rust Version?

---

## 7. REFERENCES

- [BUILD_AND_E2E_REPORT.md](./BUILD_AND_E2E_REPORT.md) — Build pipeline details
- [CANOPI_V0_3_BUILD_REPORT.md](./CANOPI_V0_3_BUILD_REPORT.md) — v0.3 specifics
- [CANOPI_V0_3_TEST_RESULTS.txt](./CANOPI_V0_3_TEST_RESULTS.txt) — Test results
- [ENGINE-PROVENANCE.json](./ENGINE-PROVENANCE.json) — Provenance tracking
