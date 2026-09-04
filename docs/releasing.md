# Releasing

1. Confirm CI is green on the release commit.
2. Run `npm ci`, `npm run verify`, `npm run test:coverage`, and `npm run validate:codex` from a clean checkout.
3. Run the private real-provider smoke checklist for both protocols, reasoning, a function call, and `apply_patch`.
4. Confirm the live catalog contains every shipped profile and inspect dependency licenses and `npm audit`.
5. Move relevant entries from `Unreleased` to the version and date in `CHANGELOG.md`.
6. Update `package.json` with `npm version` and review the generated commit and tag.
7. Push the tag and create GitHub release notes. The Release workflow publishes to npm with provenance from the protected `release` environment via OIDC. Configure that environment as a trusted publisher on npmjs.com before the first tag; do not put an npm token in repository secrets.
8. Install the published package into an isolated `CODEX_HOME` and repeat `doctor`, one native turn, and one Command Code turn.

Never expose a maintainer API key to pull-request workflows. Never publish from a dirty worktree.
