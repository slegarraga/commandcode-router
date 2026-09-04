# Changelog

All notable changes will be documented here. The project follows [Semantic Versioning](https://semver.org/) and the structure of [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Fixed

- Native Codex turns no longer fail when `POST /v1/responses` is empty, gzipped, or not JSON. JSON parsing is only a routing sniff for `commandcode/*` slugs; other bodies are forwarded unchanged.

### Added

- Headless Codex integration with native-model pass-through.
- Official Command Code Chat Completions and Messages transports.
- Responses streaming for text, reasoning, function tools, and freeform tools.
- Transactional install, uninstall, credential storage, health checks, and catalog refresh.
- Curated model catalog gated by live Command Code discovery.
