# Changelog

All notable changes will be documented here. The project follows [Semantic Versioning](https://semver.org/) and the structure of [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Fixed

- Codex no longer spends five WebSocket reconnect attempts before reaching Command Code or the native origin. The integration now selects a dedicated `commandcode_router` model provider with `supports_websockets = false`, so Codex uses its HTTPS transport directly. Existing marker blocks are upgraded in place on the next install.
- Request compression no longer hides Command Code routing. Codex compresses Responses bodies with zstd when `enable_request_compression` is on; the router now decodes zstd (and Brotli/deflate) before sniffing the model, so those turns reach Command Code instead of the native origin.
- Command Code turns no longer fail with `Invalid prompt: System messages are not allowed`. The Responses `instructions` and any `system`/`developer` input items are now passed through the AI SDK `system` option instead of as conversation messages.
- A model that is not included in the caller's Command Code plan now reports an actionable message instead of a generic upstream failure.
- The generated picker catalog now follows Codex's account-scoped remote catalog and continuously merges it with reviewed Command Code models, instead of freezing native availability at install time.

## [0.1.2] - 2026-09-04

### Fixed

- The local proxy no longer rejects Codex turns with a 16 MiB request-body cap. Long threads, tools, and attachments are forwarded as-is.

## [0.1.1] - 2026-09-03

### Changed

- Releases publish to npm from GitHub Actions with provenance via OIDC. The package requires the `release` environment as a trusted publisher. The publish job uses Node 24 and npm 11.5.1+, the minimum that can exchange the GitHub OIDC token.

## [0.1.0] - 2026-09-03

### Changed

- `commandcode-router install` asks for a Command Code API key when none is stored, checks it against the official Provider API before saving, and is the one-command happy path (`npx --yes commandcode-router install`).

### Fixed

- Native Codex turns no longer fail when `POST /v1/responses` is empty, gzipped, or not JSON. JSON parsing is only a routing sniff for `commandcode/*` slugs; other bodies are forwarded unchanged.

### Added

- Headless Codex integration with native-model pass-through.
- Official Command Code Chat Completions and Messages transports.
- Responses streaming for text, reasoning, function tools, and freeform tools.
- Transactional install, uninstall, credential storage, health checks, and catalog refresh.
- Curated model catalog gated by live Command Code discovery.
