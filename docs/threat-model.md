# Threat Model

## Assets

- Command Code API key.
- Native Codex authorization.
- Prompt, tool, and workspace-derived content carried in requests.
- Codex configuration and model catalog integrity.

## Trust Boundaries

Codex, the local router process, the native Codex origin, and the Command Code Provider API are separate principals. The local account and its processes are trusted. Other network hosts are not.

## Controls

- Listen on `127.0.0.1`, never a wildcard interface.
- Require a random capability segment in every route.
- Store credentials outside Codex config with mode `0600` in a mode `0700` directory.
- Send the Command Code key only through the Command Code transport.
- Forward native authorization only through the native pass-through.
- Never log request bodies, response bodies, authorization, keys, or capability values.
- Cap request bodies and reject malformed JSON before routing.
- Use atomic file replacement for config, catalog, state, and credentials.
- Mark owned config and refuse conflicting root settings.
- Use only the official Provider API; do not implement entitlement bypasses.

## Residual Risks

A process running as the same operating-system user can read local memory or protected files. A malicious Codex extension or compromised dependency can observe routed content. The local capability URL is not a substitute for operating-system isolation. Provider availability, retention, and account controls remain subject to Command Code's service.

Users should rotate a key after suspected compromise and run `commandcode-router key remove` before forensic collection.
