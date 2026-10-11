# Engine and data ownership boundary

`canoPi.exe` is the single installed desktop product. Internally it starts a `cnp-engine.exe` process shipped as a Tauri resource. This is ordinary multi-process application architecture, not two separately installed products. The bundle is built from the pinned OMP source after a tracked build-recipe patch; no independent `omp` installation is required at runtime.

`cnp-engine` **does not yet mean the entire OMP CLI was rewritten or every upstream string renamed**. RPC method names and legacy flags are retained because the engine protocol depends on them. Source-fork branding of executable is implemented, command-line `cnp` registration and full namespace rebrand are future milestone gates.

Existing OMP config and existing user-owned project directories are never silently imported or deleted. For Windows source milestone, application data root is app-local `app.canopi.desktop` and profile data under that root plus `~/.canopi` home config. Every cleanup target must carry a matching `.canopi-owner` marker. The delete-data uninstall script rejects missing ownership markers and all reparse points, and **defaults to Keep** unless an interactive user explicitly chooses Delete. Windows semantics must still be verified by real installer/uninstaller tests. Other OSes require separate platform behavior, not a copy of Windows NSIS hooks.

Do not substitute a global OMP binary when bundled runtime is missing. An installation without cnp-engine is an invalid deployment, not an opportunity to mutate the user's global OMP environment.
