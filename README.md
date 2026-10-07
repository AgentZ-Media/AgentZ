# AgentZ Suite

Local desktop tools for content creators, built in one open-source repository.
Every app is independent - its own data, bundle ID and release channel - and
shares one design system, application kit, desktop host and release pipeline.

## Apps

| App | Purpose | Platforms | Download |
|---|---|---|---|
| **ScriptZ** | Offline script editor for TikTok, Reels, YouTube Shorts and sketches | macOS Apple Silicon, Windows x64 | [macOS](https://github.com/AgentZ-Media/AgentZ-Suite/releases/download/scriptz-latest/scriptz-macos-arm64.dmg) · [Windows](https://github.com/AgentZ-Media/AgentZ-Suite/releases/download/scriptz-latest/scriptz-windows-x64-setup.exe) |

ScriptZ formats scripts while you type (action, character, dialog,
parenthetical), with two-speaker Quick Mode, character colors, runtime
estimates against a target range, a speaker timeline, an ideas inbox,
snapshots and PDF export. Everything stays in a local SQLite database, with
no telemetry. An optional free account syncs between devices, encrypted in
transit and at rest.

The apps are not notarized yet. On first launch, macOS needs one click on
"Open Anyway" under System Settings → Privacy & Security, and Windows
SmartScreen needs "More info" → "Run anyway"; see the
[installation notes](docs/release-notes/_install_footer.md).
Updates are signed and install from inside the app. Under *Settings →
Updates* you can opt into **nightly builds**: untested previews of `main`,
built at most every three hours and clearly marked by a night sky in the app.

## Repository

```text
apps/<app>/          Thin Tauri app: identity, icons, capabilities, migrations
apps/site/           Astro website (German/English) and account (Convex)
modules/<app>/       Product module: UI, logic and storage of one app
packages/kit/        Product-neutral shell, UI, i18n, settings, navigation
packages/desktop/    Tauri host: platform adapter, updater, app lifecycle
packages/design/     Design tokens, CSS primitives, fonts, icons, logos
crates/agentz-desktop/  Shared Rust plugins, menu, single instance, quit handshake
tooling/             App generator, release scripts, checks, test preset
```

```text
apps/<app> → modules/<app> → packages/kit → packages/design
    └──────→ packages/desktop ────┘
```

The dependency direction is enforced by ESLint: the Kit has no product
knowledge and no Tauri, products never import each other.

## Development

Requirements: Node.js 24+, pnpm (version pinned in `package.json`), Rust
stable and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

```bash
pnpm install --frozen-lockfile
pnpm dev:scriptz             # run ScriptZ
pnpm build:scriptz           # native app and installer (target/release/bundle/)
pnpm dev:site                # website
pnpm dev:site:backend        # account backend (Convex dev deployment)
pnpm lint && pnpm typecheck && pnpm test
pnpm check:colors && pnpm check:astro
cargo check --workspace --locked
```

CI runs all of these plus the frontend builds on every pull request.
The development app uses the same data folder as the installed app - back up
your database before working on storage or migrations
(see [`apps/scriptz/AGENTS.md`](apps/scriptz/AGENTS.md)).

## New apps and releases

`pnpm new-app <id> "<Name>"` generates a complete app: Tauri host, product
module, isolated database and bundle ID, German/English strings, icons, release
notes folder and a website entry. `pnpm remove-app <id>` removes it again.
See the [new app guide](docs/neue-app.md) (German).

Releases use tags like `scriptz-v0.9.2`. `pnpm release:bump <app> <version>`
updates all version files; the workflow builds macOS and Windows, signs the
updates and moves the app's `<app>-latest` channel. Every three hours the
nightly workflow builds new changes on `main` into the `<app>-nightly` channel.
Details: [release rules](.claude/rules/release.md) (German).

## License and credits

- [MIT License](LICENSE).
- iA Writer Quattro © Information Architects Inc., SIL OFL 1.1.
- Schibsted Grotesk © The Schibsted Grotesk Project Authors, SIL OFL 1.1.
- Built by [AgentZ](https://linktr.ee/deragentz).
