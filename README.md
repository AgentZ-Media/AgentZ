# AgentZ Suite

Local desktop tools for content creators, built in one open-source repository.
The suite is growing out of ScriptZ: shared design, reusable application
infrastructure, and independent apps with their own data and releases.

**ScriptZ is the only app currently included.** The shared application kit,
desktop host, multi-app release pipeline, website, and app generator are
planned work, not available features. Progress and architecture decisions
are tracked in the [foundation plan](docs/agentz-suite-fundament.md) (German).

## Apps

| App | Purpose | Platforms | Source | Download |
|---|---|---|---|---|
| **ScriptZ** | Offline script editor for TikTok, Reels, YouTube Shorts, and sketches | macOS Apple Silicon, Windows x64 | [App](apps/scriptz/) · [Module](modules/scriptz/) | [Latest release](https://github.com/AgentZ-Media/AgentZ/releases/latest) |

ScriptZ combines automatic script formatting, two-speaker Quick Mode,
character colors, runtime estimates, a speaker timeline, ideas, snapshots,
and PDF export. It uses a local SQLite database and needs no account.
Its editor and writing workflow stay intact during the suite migration.

For first-time installation, see the
[macOS and Windows instructions](docs/release-notes/_install_footer.md).

## Current architecture

```text
apps/scriptz/              @agentz/scriptz-app
  src/                    Solid frontend entry point and Tauri adapters
  src-tauri/              Rust plugin wiring, SQLite migrations, app config
modules/scriptz/          @agentz/scriptz
                          ScriptZ editor, UI, stores, and application logic
packages/design/         @agentz/design
                          Shared CSS tokens, primitives, fonts, icons, assets
tooling/vitest-preset/     Shared Solid/jsdom test configuration
Cargo.toml / Cargo.lock   Rust workspace and shared dependency lockfile
tsconfig.base.json        Shared TypeScript compiler options
docs/release-notes/
  scriptz/                ScriptZ release notes
```

The native app connects the ScriptZ module to the operating system.
The module uses platform and storage interfaces; it does not import Tauri.
The design package provides framework-independent styles and data.

```text
apps/scriptz → modules/scriptz → packages/design
```

Later phases will extract product-neutral Solid components and the app shell
into `@agentz/kit`, and Tauri integration into `@agentz/desktop` with a shared
Rust crate. Those packages do not exist yet. The target dependency direction is:

```text
apps/<app> → modules/<app> → packages/kit → packages/design
    └──────→ packages/desktop ────┘
```

Each product will remain a separate desktop app. Cross-app accounts, cloud
sync, and a combined all-in-one app are outside the foundation's scope.

## Development

Use pnpm 10.34.6 (pinned in `package.json`), Node.js 24+, Rust, and the native
Tauri build prerequisites for your platform. The current desktop targets
are macOS Apple Silicon and Windows x64.

Run from the repository root:

```bash
pnpm install --frozen-lockfile
pnpm dev:scriptz          # start ScriptZ with the native Tauri shell
pnpm build:scriptz        # build the ScriptZ native app and installer
pnpm lint                # check package boundaries and correctness
pnpm typecheck           # check all TypeScript workspaces
pnpm test                # run tooling rule tests and workspace tests
pnpm check:colors        # check colors outside the design system
pnpm build:frontends     # build app frontends without native bundles
cargo check --workspace --locked # check Rust without changing the lockfile
```

If updating an existing checkout after the folder migration, run the install
command again to refresh workspace links. If a native build then reports
missing permission files under the old `apps/desktop` path, clear the stale
Rust build cache once and rebuild:

```bash
cargo clean --manifest-path apps/scriptz/src-tauri/Cargo.toml
pnpm build:scriptz
```

Shared JavaScript dependency versions live in the pnpm workspace catalog;
internal packages use `workspace:*`. Package tests use
`@agentz/vitest-preset`. The PR workflow runs lint, typechecks, tests, color
checks, frontend builds, and a locked Cargo workspace check.

Cargo uses the repository-root `Cargo.lock` and `target/` directory. Native
bundles are written to `target/release/bundle/`, or
`target/<target-triple>/release/bundle/` when building an explicit Rust target.
The existing Rust dependency versions are preserved.

Creating signed updater artifacts requires the release signing key.
A local build without that key may produce the app and installer before
failing at the updater-signing step.

The development app uses the same `de.agent-z.scriptz` application data
folder and `scriptz.db` as the installed app. Back up your database before
working on storage, migrations, or app initialization; the
[foundation plan](docs/agentz-suite-fundament.md#5-datensicherung) describes
the SQLite backup and isolated-test workflow.

Repository conventions live in [CLAUDE.md](CLAUDE.md), ScriptZ details in
[apps/scriptz/CLAUDE.md](apps/scriptz/CLAUDE.md), package rules in
[the suite architecture guide](.claude/rules/suite-architecture.md), and design usage in
[packages/design/README.md](packages/design/README.md).

## Releases

Releases currently use `vX.Y.Z` tags and publish ScriptZ for macOS and
Windows through GitHub Actions. ScriptZ notes live in
[`docs/release-notes/scriptz/`](docs/release-notes/scriptz/); the shared
installation footer remains one directory above. App-prefixed tags and
independent release channels are planned for a later foundation phase.
See the [release checklist](.claude/rules/release.md) before publishing.

## License and credits

- [MIT License](LICENSE).
- iA Writer Quattro © Information Architects Inc., SIL OFL 1.1.
- Schibsted Grotesk © The Schibsted Grotesk Project Authors, SIL OFL 1.1.
- Built by [AgentZ](https://linktr.ee/deragentz).
