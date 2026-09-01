# Contributing

Thank you for helping make Command Code work well inside Codex.

## Principles

Keep the router small, explicit, and boring. Protocol boundaries deserve validation and clear errors. Avoid hidden fallbacks, speculative compatibility, global state, and abstractions that only rename one operation.

The project uses only documented, entitlement-respecting Command Code APIs. Contributions that bypass plan restrictions or depend on reverse-engineered private endpoints will not be accepted.

## Workflow

1. Open an issue for behavior changes or new model support.
2. Fork the repository and create a focused branch.
3. Add or update an executable contract in `test/`.
4. Run `npm run verify` and `npm run test:coverage`.
5. Open a pull request with the user-visible behavior, risks, and verification evidence.

Keep pull requests narrow. Do not mix formatting sweeps with behavior changes. Public APIs and config formats require a changelog entry.

## Model Changes

Follow [docs/model-certification.md](docs/model-certification.md). Discovery alone is not certification. A profile should remain unlisted until its protocol, tools, streaming, reasoning behavior, and context metadata are supported by evidence.

## Commits

Use short, imperative subjects. Explain why in the body when the change is not self-evident. Do not include credentials, raw prompts, provider responses, or customer data in commits or fixtures.

By contributing, you agree that your contribution is licensed under the MIT License.
