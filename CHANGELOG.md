# Changelog

All notable changes will be documented here. The project follows [Semantic Versioning](https://semver.org/) and the structure of [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

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
