# Configuration

The interface exposes provider/model setup, but not every path is complete. Configure credentials only on your local machine through reviewed app settings. Never commit keys, `.env` files, auth/session databases, exported profiles or personal conversation histories.

OAuth is currently a stub; a login control is not a working authentication flow. Native SmartRouter remains incomplete. Do not assume a successful status indicator means a provider request has been tested. No production-provider or paid-request validation is claimed here.

The desktop runtime requires the generated engine resource and the Tauri bridge. A frontend browser preview cannot exercise that bridge. Use a disposable project and verify the selected provider/model explicitly before running tools. Tool execution may modify local files.

Generated engine provenance, local models/configuration, signing credentials and certificates are private build/runtime inputs, not publication files. Include only redacted diagnostics in issue reports.
