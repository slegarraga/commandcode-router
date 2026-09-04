# Changelog

All notable changes will be documented here. The project follows [Semantic Versioning](https://semver.org/) and the structure of [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Changed

- `commandcode-router install` asks for a Command Code API key when none is stored, checks it against the official Provider API before saving, and is the one-command happy path (`npx --yes github:slegarraga/commandcode-router install`).

### Added

- Headless Codex integration with native-model pass-through.
- Official Command Code Chat Completions and Messages transports.
- Responses streaming for text, reasoning, function tools, and freeform tools.
- Transactional install, uninstall, credential storage, health checks, and catalog refresh.
- Curated model catalog gated by live Command Code discovery.
