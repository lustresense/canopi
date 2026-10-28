# canoPi

A work-in-progress desktop workspace for AI-assisted conversations, tools and project context. React/Vite frontend, Tauri/Rust host, source-built Oh My Pi engine integration.

**Internal version 0.0.1. Development source snapshot, not a beta or stable release. No ready-to-install, verified installer is provided by this source publication.** Windows is the intended desktop target; current Windows compilation and end-to-end acceptance remain unverified.

## Scope

The source contains conversation rendering, provider/model configuration interfaces, runtime event projection, a project workspace and Kanban interface. Their presence is not an end-to-end capability guarantee. OAuth login is a stub, native SmartRouter is incomplete, Cloud Light is broken, and a missing Rust `Deserialize` import remains unresolved. See [known limitations](docs/KNOWN_LIMITATIONS.md).

## Getting started

- [Build from source](docs/BUILD.md): prerequisites, engine dependency and validation gates.
- [Installation status](docs/INSTALL.md): no production installer recommendation.
- [Configuration](docs/CONFIGURATION.md): provider setup and credential safety.
- [Troubleshooting](docs/TROUBLESHOOTING.md).

For a frontend-only developer preview:

```sh
npm ci
npm test
npm run dev
```

Open the local URL printed by Vite. A browser preview does not provide the Tauri native bridge or prove engine/provider flows work. Once a validated desktop build exists, configure a supported provider/model before attempting a conversation; tool execution may affect local files. Use disposable projects during development.

## Source and contributions

Public source: https://github.com/lustresense/canopi . The checked-in `SOURCE-MANIFEST.json` identifies the exact development commit, export policy hash and per-file hashes. This tree is generated, not the authoritative development workspace. Report reproducible issues against the public repository; never attach provider keys or raw personal session data. No binary release, signing or compatibility promise is implied by a source push.

No screenshot is presented as current acceptance evidence. The included assets are source assets, not proof of this snapshot's runtime behavior.

## License

[MIT](LICENSE), with retained upstream attribution. See [third-party notices](THIRD_PARTY_NOTICES.md) for engine, dependency and font notice obligations.
