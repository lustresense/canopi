# Troubleshooting

- **Frontend preview lacks native functions:** expected outside Tauri; `npm run dev` is a UI preview, not a desktop runtime test.
- **Tauri reports missing bundled resources:** source omits the engine EXE and generated upstream legal files. Generate them through the pinned source-build pipeline; never use placeholders.
- **Rust compile fails near `Deserialize`:** known unresolved source defect. Current Windows compilation is unverified; documentation/publication did not fix application code.
- **OAuth returns a stub/unavailable result:** known limitation, not a credential retry problem. Never paste credentials into issues.
- **Native SmartRouter or Cloud Light fails:** known incomplete/broken features, not accepted workflows.
- **Source-contract tests pass but user flows fail:** regex/static checks are not end-to-end acceptance. Capture the actual error, manifest commit and exact command/platform.
- **Build produces no trusted installer:** inspect `release/_logs/` locally; redact usernames, absolute paths, keys and session data before sharing. An incomplete pipeline is not a release.

Report minimal reproducible issues at https://github.com/lustresense/canopi/issues . Do not upload raw personal data or secrets.
