# commandcode-router

[![CI](https://github.com/slegarraga/commandcode-router/actions/workflows/ci.yml/badge.svg)](https://github.com/slegarraga/commandcode-router/actions/workflows/ci.yml)
[![MIT licensed](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Use Command Code models inside Codex. Headless by design: no menu bar item, tray app, settings window, or second chat interface.

`commandcode-router` adds curated Command Code models to Codex's native model picker, translates Codex Responses requests to Command Code's official Chat Completions and Messages endpoints, and translates streaming text, reasoning, functions, and freeform `apply_patch` calls back into Responses events.

> [!IMPORTANT]
> This is an independent, early-stage project. It uses only the documented Command Code Provider API. Command Code's Go plan does not include Provider API access; GOAT or a higher plan is required. The router does not use undocumented endpoints or bypass plan limits.

## What It Does

- Keeps native Codex models working through a transparent pass-through.
- Publishes reviewed Command Code profiles in Codex's existing picker.
- Supports both OpenAI-compatible and Anthropic-compatible Command Code endpoints.
- Preserves streaming text, reasoning summaries, function tools, and `apply_patch`.
- Stores the Command Code key in a mode `0600` file and never puts it in Codex config.
- Binds only to `127.0.0.1` behind a random capability URL.
- Installs as a headless launch service on macOS. There is deliberately no menu bar UI.
- Owns only a marked config block and refuses to overwrite another router.

## Requirements

- macOS with Codex installed. Other platforms can run `commandcode-router serve`, but automatic service installation is currently macOS-first.
- Node.js 22.19 or newer.
- A Command Code API key with Provider API access.

## Install

Node.js 22.19+ and a Command Code API key with Provider API access (GOAT or higher). Create the key in [Studio](https://commandcode.ai/settings/keys).

```sh
npx --yes github:slegarraga/commandcode-router install
```

`install` asks for the API key if one is not already stored, checks it against the official Provider API, saves it with mode `0600`, writes the Codex integration, and starts the headless service. Fully quit Codex (Cmd+Q on macOS) and reopen it. Command Code models then appear beside native models in the picker.

### Install From a Clone

```sh
git clone https://github.com/slegarraga/commandcode-router.git
cd commandcode-router
npm ci
npm link
commandcode-router install
```

The installer fails closed if `openai_base_url` or `model_catalog_json` already belongs to you or another router. Remove that integration intentionally before installing this one.

## Commands

```text
commandcode-router install          Prompt for a key if needed, then install
commandcode-router key set          Store or replace the API key
commandcode-router status           Show install, key, and service state
commandcode-router doctor           Run local health checks
commandcode-router models refresh   Reconcile reviewed models with the live API
commandcode-router start            Start the headless service
commandcode-router stop             Stop the service
commandcode-router uninstall        Remove integration; preserve the API key
commandcode-router key remove       Delete the API key and stop the service
```

`COMMAND_CODE_API_KEY` and `COMMANDCODE_API_KEY` override the stored key. `CODEX_HOME` is respected.
For an isolated or foreground-only setup, `install --no-service` writes the integration without registering a background service; run `serve` yourself and use `uninstall --no-service` when removing it.

## Architecture

```text
Codex model picker
        |
        v
127.0.0.1 + random capability path
        |
        +-- native model ------> native Codex API
        |
        `-- commandcode/* -----> official Command Code Provider API
                                  | Chat Completions
                                  ` Messages
```

The protocol core is deliberately separate from installation and process management. See [Architecture](docs/architecture.md), [Threat Model](docs/threat-model.md), and [Model Certification](docs/model-certification.md).

## Development

```sh
npm ci
npm run verify
npm run test:coverage
```

Tests use simulated upstream servers and isolated Codex homes. They do not consume Command Code credits or modify your real Codex configuration. A real-provider smoke test is a separate release gate because it requires a maintainer credential.

Contributions are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md) and read [SECURITY.md](SECURITY.md) before reporting a vulnerability.

## License

MIT. See [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md).
