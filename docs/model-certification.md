# Model Certification

Model discovery answers one question: does Command Code currently advertise this ID? Certification answers the harder question: can Codex use it safely and predictably?

## Required Evidence

A new or changed profile should demonstrate:

1. The model ID appears in the official `/provider/v1/models` response.
2. The selected protocol is correct: Chat Completions or Messages.
3. A plain streamed text turn completes with numeric usage.
4. A function call streams, executes in Codex, and accepts its result on the next turn.
5. `apply_patch` survives the freeform-to-function bridge and returns as a custom tool call.
6. The advertised reasoning levels produce valid requests and visible summary events when supported.
7. Context length and input modalities match current authoritative metadata.
8. Authentication, entitlement, rate-limit, timeout, and upstream-error behavior is understandable and does not leak response bodies.

## Profile Changes

Profiles live in `config/models.json`. Keep display metadata factual. Never infer context length or capabilities from a model family name. Include evidence in the pull request and update `compHash` when behavior changes.

`commandcode-router models refresh` intersects reviewed profiles with live discovery. It never lists an unknown model automatically.

## Release Gate

Unit and integration fixtures are mandatory in CI. A maintainer performs a real-provider smoke run before a release that changes protocol behavior or model profiles. Live tests are not run on untrusted pull requests because they require credentials and consume account usage.
