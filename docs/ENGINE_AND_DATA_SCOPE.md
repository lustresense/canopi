# Engine and data ownership boundary

`canoPi.exe` is the single installed desktop product. Internally it starts a `cnp-engine.exe` process shipped as a Tauri resource. This is ordinary multi-process application architecture, not two separately installed products. The bundle is built from the pinned OMP source after a tracked build-recipe patch; no independent `omp` installation is required at runtime.

`cnp-engine` **does not yet mean the entire OMP CLI was rewritten or every upstream string renamed**. RPC method names and legacy flags are retained because the engine protocol depends on them. Source-fork branding of executable is implemented, command-line `cnp` registration and full namespace rebrand are future milestone gates.

Existing OMP config and existing user-owned project directories are never silently imported or deleted. For Windows source milestone, application data root is app-local `app.canopi.desktop` and profile data under that root plus `~/.canopi` home config. Every cleanup target must carry a matching `.canopi-owner` marker. The delete-data uninstall script rejects missing ownership markers and all reparse points, and **defaults to Keep** unless an interactive user explicitly chooses Delete. Windows semantics must still be verified by real installer/uninstaller tests. Other OSes require separate platform behavior, not a copy of Windows NSIS hooks.

Do not substitute a global OMP binary when bundled runtime is missing. An installation without cnp-engine is an invalid deployment, not an opportunity to mutate the user's global OMP environment.

---

## Code signing prerequisites (release owner only)

Production Windows releases require an OV (Organization Validated) code-signing certificate. The following are **external prerequisites** that must be provisioned by the release owner; no private key or certificate material is stored in the repository.

### Required certificate metadata (configure as GitHub Secrets)

| Secret name | Value | Description |
|-------------|-------|-------------|
| `CANOPI_CERT_PFX` | Base64-encoded `.pfx` file | `certutil -encode certificate.pfx base64cert.txt` |
| `CANOPI_CERT_PASSWORD` | PFX export password | Used to import the certificate into the runner's cert store |
| `CANOPI_CERT_THUMBPRINT` | SHA-1 thumbprint (uppercase, no spaces) | From cert Details tab; used for `certificateThumbprint` in `tauri.conf.json` and verification gate |
| `CANOPI_CERT_SUBJECT` | Full certificate subject DN | e.g. `CN=canoPi Project, O=Organization, L=City, S=State, C=US`; verified against `SignerCertificate.Subject` |
| `CANOPI_CERT_DIGEST_ALGORITHM` | `sha256` | Signature hash algorithm (must match certificate) |
| `CANOPI_CERT_TIMESTAMP_URL` | e.g. `http://timestamp.sectigo.com` | RFC 3161 timestamp server URL |

### Supported Tauri signing interfaces (v2.8+)

1. **`bundle.windows.certificateThumbprint`** — Installed cert lookup by SHA-1 thumbprint (Windows cert store).
2. **`bundle.windows.digestAlgorithm`** — `"sha256"` (required).
3. **`bundle.windows.timestampUrl`** — RFC 3161 timestamp server URL.
4. **`bundle.windows.tsp`** — `true` to use Time-Stamp Protocol (RFC 3161).
5. **`bundle.windows.signCommand`** — Optional custom sign command (`CustomSignCommandConfig` enum: `Command(string)` or `CommandWithOptions{cmd, args[]}`). `%1` placeholder is replaced with binary path. Use for Azure Key Vault, HSM, or cross-platform `osslsigncode`.

### What gets signed (all must pass `Get-AuthenticodeSignature` `Valid` with matching thumbprint AND subject)

- `src-tauri/target/release/canoPi.exe` (main GUI binary via Tauri `signCommand`)
- `src-tauri/target/release/engine/cnp-engine.exe` (bundled sidecar via explicit `sign-engine.ps1` BEFORE staging; signed copy bundled, unsigned original preserved for provenance)
- NSIS installer `src-tauri/target/release/bundle/nsis/*.exe` (via Tauri `signCommand`)
- NSIS uninstaller (embedded in installer; signed via `!uninstfinalize` hook using same `signCommand`; verified post-install by extracting installer with 7z and checking embedded uninstaller)

### Signing implementation details (v2.8+)

1. **Engine binary**: `sign-engine.ps1` signs the staged engine copy at `src-tauri/resources/engine/cnp-engine.exe` using `signtool.exe` with `/tr` (RFC3161) and `/td sha256`. Unsigned original preserved at build-time for `compiledEngineSha256` provenance.
2. **Main binary + installer + uninstaller**: Tauri `bundle.windows.signCommand` invoked via `--config` override pointing to generated JSON with `CustomSignCommandConfig` (cmd=powershell.exe, args invoking `sign-engine.ps1` with `%1` placeholder). Same command signs main binary, installer, and uninstaller via `!uninstfinalize`.
3. **Timestamp verification**: `Get-AuthenticodeSignature` `.TimeStamperCertificate` must not be null (RFC3161 verified).
4. **Subject verification**: `SignerCertificate.Subject` must exactly match expected DN.
### Verification gate (fail closed for production)

`build-windows.ps1` reads `CANOPI_CERT_THUMBPRINT` and `CANOPI_CERT_SUBJECT` from environment. If `ReleaseMode=Signed`:
1. All three executables above must have `AuthenticodeSignature.Status == 'Valid'`.
2. `SignerCertificate.Thumbprint` must equal expected thumbprint (case-insensitive).
3. `SignerCertificate.Subject` must equal expected subject DN exactly.
4. Engine provenance manifest (`ENGINE-PROVENANCE.json`) is updated with `signedEngineSha256`, `signedEngineBytes`, `authenticodeThumbprint`, `timestampRfc3161`.
5. `BUILD-MANIFEST.json` `signing.codeSigned = true` with full metadata.

If `ReleaseMode=Development` (default):
- Build succeeds unsigned.
- Warning emitted; `signing.codeSigned = false`.
- No signature verification runs.

### Source ZIP provenance integrity

The source ZIP (`canoPi-source-<ver>.zip`) contains **only git-tracked source files and lockfiles**. It does NOT contain:
- Compiled `cnp-engine.exe` (built from pinned upstream at build time)
- Installer binary
- Any certificate or private key material

Signed engine bytes are tracked separately in `ENGINE-PROVENANCE.json` via `signedEngineSha256` (post-signing), distinct from `compiledEngineSha256` (pinned unsigned provenance). No fabricated reproducibility claim.
