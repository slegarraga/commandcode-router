# Architecture

`commandcode-router` is a local protocol adapter with three independent layers.

## Request Path

1. Codex reads a merged local model catalog.
2. Codex sends Responses API traffic to a loopback capability URL.
3. Native model slugs pass through to the native Codex API with the caller's authorization. The router parses `POST /v1/responses` only to detect `commandcode/*` slugs; empty, gzipped, or non-JSON bodies are forwarded unchanged.
4. `commandcode/*` slugs are mapped to reviewed upstream model IDs.
5. Responses history and tools become normalized model messages.
6. The request goes to the official Command Code Chat Completions or Messages endpoint.
7. Normalized stream parts become a complete Responses event lifecycle.

The router never exchanges native Codex credentials for Command Code credentials. They travel to different origins through separate code paths.

## Modules

- `src/responses-request.mjs`: pure Responses-to-message conversion.
- `src/provider.mjs`: protocol selection and Command Code transport.
- `src/responses-stream.mjs`: stateful Responses event writer.
- `src/server.mjs`: loopback HTTP boundary and native pass-through.
- `src/catalog.mjs`: fail-closed native and Command Code catalog merge.
- `src/codex-config.mjs`: ownership-aware config editing.
- `src/installer.mjs`: transactional installation orchestration.
- `src/service.mjs`: headless process lifecycle.
- `src/cli.mjs`: human-facing commands.

Protocol code has no knowledge of launch services or Codex file locations. Installation code does not parse model streams. This keeps failure domains narrow and tests cheap.

## Dependencies

The runtime uses the Vercel AI SDK protocol packages to normalize OpenAI-compatible and Anthropic-compatible streams. They are Apache-2.0 licensed. Process, HTTP, config, key storage, and Responses event generation use Node.js built-ins.

Dependencies are pinned exactly in `package.json` and locked in `package-lock.json`.

## Compatibility Policy

The router fails closed. A model must exist in both the reviewed local profile set and the current official Command Code catalog before it is published to Codex. An unknown upstream model is discoverable during maintenance but is not automatically enabled.
