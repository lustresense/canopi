# Changelog

All notable changes to canoPi Desktop will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Native OAuth provider support (Antigravity, Codex, Google, OpenRouter, Groq, Mistral, xAI, DeepSeek, Together)
- Smart Router preset (local proxy at 127.0.0.1:20128/v1) — id `canopi-router`, label `Smart Router`
- OAuth login flow with provider endpoint override and runtime token storage
- Provider onboarding UI with chip selector and connection status

### Changed
- BUILTIN_PROVIDERS extended with `canopi-router` (loopback endpoint, auto-trusted, OpenAI-compatible transport)
- ProviderSetupSection: chip-based selection + card detail, no design overhaul
- NativeDialog: input-based replyable prompts for OAuth callback

### Technical
- Rust allowlist: `login`, `get_login_providers`, `refreshProvider`, `provider_status`
- Timeout for `login` command: 600s (was catch-all 15s)
- `transport-fetch.ts`: loopback endpoints bypassed (no trust flow required)
- Test coverage: provider-onboarding (16), syntax (16), oauth-login (11), smart-router-preset (3)

### Added
- CHANGELOG.md initialized

---

## [0.3.0] - 2026-10-14

### Added
- Vite + Tauri v2 desktop app (canopi-desktop)
- Release build pipeline with GitHub Actions
- Windows build script (BUILD-WINDOWS.cmd)
- Build & E2E test report
- Engine provenance tracking (ENGINE-PROVENANCE.json)
- Test results documentation

### Technical
- Package: canopi-desktop (Tauri + Vite)
- Git initialized with commit history
- Node.js dependencies locked

### Known Limitations
