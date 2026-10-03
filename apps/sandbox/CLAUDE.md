# Sandbox

Desktop host: `apps/sandbox`; product logic: `modules/sandbox`.
Use the shared Kit and semantic design tokens; no imports from other products.
Run `pnpm dev:sandbox`, `pnpm build:sandbox`, `pnpm lint`, `pnpm typecheck`, `pnpm test`.
Ports: Vite 1430, HMR 1431; database: `sqlite:sandbox.db`; identifier: `de.agent-z.sandbox`.
Product migrations are append-only. Never modify a shipped migration.
Release notes: `docs/release-notes/sandbox/vX.Y.Z.md`; tags: `sandbox-vX.Y.Z`; updater pointer: `sandbox-latest`.
See `docs/neue-app.md` and `.claude/rules/suite-architecture.md`.
