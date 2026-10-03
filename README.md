# AgentZ Suite

Local desktop tools for content creators, built in one open-source repository.
The suite is growing out of ScriptZ: shared design, reusable application
infrastructure, and independent apps with their own data and releases.

**ScriptZ is the product app.** The shared foundation was verified with a
separate generated app, including independent releases and real updates.
That temporary app has been removed after acceptance. The shared kit provides
the application shell, neutral UI, settings, navigation, and infrastructure.
The shared desktop host supplies native integration and safe shutdown.
The release pipeline supports independent app channels. A static bilingual
suite website and an app generator are included. Website deployment is managed
separately. Progress and architecture decisions
are tracked in the [foundation plan](docs/agentz-suite-fundament.md) (German).

## Apps

| App | Purpose | Platforms | Source | Download |
|---|---|---|---|---|
| **ScriptZ** | Offline script editor for TikTok, Reels, YouTube Shorts, and sketches | macOS Apple Silicon, Windows x64 | [App](apps/scriptz/) · [Module](modules/scriptz/) | [App channel](https://github.com/AgentZ-Media/AgentZ/releases/tag/scriptz-latest) |

ScriptZ combines automatic script formatting, two-speaker Quick Mode,
character colors, runtime estimates, a speaker timeline, ideas, snapshots,
and PDF export. It uses a local SQLite database and needs no account.
Its editor and writing workflow stay intact during the suite migration.

The `scriptz-latest` channel is published. Both platform installers and their
updater signatures have been verified. Stable download links are [macOS Apple Silicon](https://github.com/AgentZ-Media/AgentZ/releases/download/scriptz-latest/scriptz-macos-arm64.dmg)
and [Windows x64](https://github.com/AgentZ-Media/AgentZ/releases/download/scriptz-latest/scriptz-windows-x64-setup.exe).

For first-time installation, see the
[macOS and Windows instructions](docs/release-notes/_install_footer.md).

## Current architecture

```text
apps/scriptz/              @agentz/scriptz-app
  src/                    Thin frontend entry point connecting module and host
  src-tauri/              App identity, SQLite migrations, icons and capabilities
apps/site/                @agentz/site
                          Static Astro website, app catalog and legal pages
modules/scriptz/          @agentz/scriptz
                          ScriptZ AppModule, editor, product UI and data
packages/kit/             @agentz/kit
                          SuiteShell, settings, navigation, neutral UI and ports
packages/desktop/         @agentz/desktop
                          Native adapters, updater, lifecycle and Vite config
crates/agentz-desktop/     Shared Rust plugins, menus and lifecycle handshake
packages/design/          @agentz/design
                          Shared CSS tokens, primitives, fonts, icons, assets
tooling/vitest-preset/     Shared Solid/jsdom test configuration
tooling/release/           Version bump, release validation and channel publishing
tooling/new-app/           Independent app/module generator and controlled removal
Cargo.toml / Cargo.lock   Rust workspace and shared dependency lockfile
tsconfig.base.json        Shared TypeScript compiler options
docs/release-notes/
  scriptz/                ScriptZ release notes
```

The native app connects the ScriptZ module to the operating system.
The module uses platform and storage interfaces; it does not import Tauri.
The design package provides framework-independent styles and data.

```text
apps/scriptz → modules/scriptz → packages/kit → packages/design
```

The native app renders `scriptzModule` through the shared `SuiteShell`.
Product routes, settings sections, commands, and overlays come from the module.
Tauri integration lives in `@agentz/desktop` and the shared Rust crate.
Apps keep their database identity, migrations, icons, and capabilities.
The dependency direction is:

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
pnpm dev:site             # serve the suite website locally
pnpm build:site           # build the static website
pnpm check:astro          # check package, color and token rules in Astro
pnpm lint                # check package boundaries and correctness
pnpm typecheck           # check all TypeScript workspaces
pnpm test                # run tooling rule tests and workspace tests
pnpm check:colors        # check colors outside the design system
pnpm check:tokens        # reject legacy tokens in Kit and new packages
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

A standalone Kit fixture is available with
`pnpm --filter @agentz/kit test:fixture` at `http://127.0.0.1:4174`.
It exercises the shared shell with a small test module and uses no ScriptZ
module or legacy stylesheet.

The website provides German and English homepages plus German legal pages,
without runtime JavaScript, tracking, or cookies. Its app catalog in
`apps/site/src/apps.ts` hides downloads for `soon` entries; switch an app to
`available` only after both installers are published and verified. A local
build does not publish the site. Domain and Vercel setup are managed separately.

Repository conventions live in [CLAUDE.md](CLAUDE.md), ScriptZ details in
[apps/scriptz/CLAUDE.md](apps/scriptz/CLAUDE.md), package rules in
[the suite architecture guide](.claude/rules/suite-architecture.md), and design usage in
[packages/design/README.md](packages/design/README.md).

## Creating another app

Run `pnpm new-app mein-tool "Mein Tool"` to generate a thin Tauri app, its
product module, isolated database and bundle ID, DE/EN strings, icons, release
notes directory, and a website entry marked `soon`. The generator allocates
matching development ports and updates both lockfiles. Existing paths are
never overwritten; a failed run restores the tracked inputs it changed.

`pnpm remove-app mein-tool` removes a generated app and its registry entries.
It also removes later edits inside those app/module directories, so commit
work you want to keep first. It preserves installed apps, local user data,
Git tags, and GitHub releases. See the [new app guide](docs/neue-app.md) for
product development, migrations, releases, and acceptance checks.

## Releases

Releases use `<app-id>-v<semver>` tags, such as `scriptz-v0.9.0`.
Each app publishes macOS and Windows builds, then updates its own
`<app-id>-latest` channel. App releases do not replace GitHub's repository-wide
“Latest”. Historical `v0.x.y` tags remain available.

`pnpm release:bump <app> <version>` updates all four native/package version
files together. Notes live in `docs/release-notes/<app>/`; the workflow adds
the shared installation footer. A manually dispatched release workflow is
always a build-only rehearsal: no publication, signing secrets, or channel
changes. See the [release checklist](.claude/rules/release.md) before publishing.

Existing ScriptZ 0.8.4 installations still use the old channel. Install 0.9.0
or newer manually once to adopt the app-specific updater. The real in-app update
from 0.9.0 to 0.9.1 has been verified on macOS.

## License and credits

- [MIT License](LICENSE).
- iA Writer Quattro © Information Architects Inc., SIL OFL 1.1.
- Schibsted Grotesk © The Schibsted Grotesk Project Authors, SIL OFL 1.1.
- Built by [AgentZ](https://linktr.ee/deragentz).
