# Security Policy

## Supported Versions

Until 1.0, only the latest release receives security fixes.

## Reporting

Do not open a public issue for a vulnerability. Use GitHub's private vulnerability reporting for this repository. Include the affected version, impact, reproduction, and any suggested mitigation. Do not include a real API key or private prompt history.

You should receive an acknowledgement within 72 hours. We aim to provide an initial severity assessment within seven days.

## Security Boundaries

- The server binds to loopback and requires an unguessable capability path.
- The Command Code key is stored separately with mode `0600` and is never written to Codex config.
- Request or response bodies are not logged.
- Native Codex authorization is forwarded only to the native Codex origin.
- The Command Code key is sent only to the configured Command Code Provider API origin.
- Installation refuses to replace user-owned router or catalog settings.

See [docs/threat-model.md](docs/threat-model.md) for assumptions and residual risks.
