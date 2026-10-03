# ScriptZ Desktop - Claude context

Fast, local script editor for short-form video creators (TikTok, Reels,
YouTube Shorts). Tauri 2 shell + Solid + TypeScript + Lexical editor
(vanilla, no React). All persistence, search, export and CRUD lives in
TypeScript via `@tauri-apps/plugin-sql`; the Rust crate is plugin
wiring + schema migrations only. macOS Apple Silicon + Windows x64 are
first-class; Linux not (yet) shipped.

This codebase was deliberately stripped down in 2026-05 and redesigned
as the "Werkbank" in 2026-10 (sidebar shell, four block types, stages,
length range; plan in [`docs/redesign/umsetzung.md`](../../docs/redesign/umsetzung.md)).
Since then almost all UI and logic lives in `packages/core/` and the
design system in `packages/design/`; this app is a thin Tauri shell
(`App.tsx` renders the shared `AppShell` and adds close-flush +
auto-updater). Der tatsächliche Code ist die Referenz für das
aktuelle Verhalten.

## Path-scoped Rules

Details lazy-load aus [`/.claude/rules/`](../../.claude/rules/):

- [`desktop-architecture.md`](../../.claude/rules/desktop-architecture.md)
  - Layout von `packages/core`, `packages/design`, `src/` und
  `src-tauri/`, Stufen + Zielbereich, das per-script Character-Modell,
  Legacy-Block-Migration, Editor → DB Data-Flow. Lädt bei
  `apps/desktop/src/**`, `apps/desktop/src-tauri/**`, `packages/core/**`
  und `packages/design/**`.
- [`desktop-release.md`](../../.claude/rules/desktop-release.md) -
  In-App-Updater (`tauri-plugin-updater` + minisign), Versionen in vier
  Dateien, macOS-`xattr`/SmartScreen-Erstinstall, Windows-Toolchain-Setup.
  Lädt bei Versionsdateien und `src-tauri/**`.
- [`/.claude/rules/release.md`](../../.claude/rules/release.md) -
  zentrale Release-Pipeline (3 Jobs, Asset-Naming, Recovery).

## Top-Level Layout

```
src/                    Thin Solid shell: index.tsx (adapters + CSS
                        layers), App.tsx (AppShell + close flush +
                        updater), lib/platform.ts (Tauri PlatformAdapter),
                        stores/updates.ts, components/Common/UpdateIndicator
src-tauri/              Rust backend (Tauri 2): plugin wiring + SQL migrations
package.json            pnpm scripts (dev, tauri:dev, tauri:build, typecheck)
tsconfig.json
vite.config.ts
```

Detail-Layout der Subverzeichnisse: siehe `desktop-architecture.md`.

## Conventions (wichtig)

- **TypeScript owns persistence.** All SQL lives in
  `packages/core/lib/` (`scripts.ts`, `folders.ts`, ...); the plugin-sql
  connection comes from `PlatformAdapter.getDb()` in `src/lib/platform.ts`.
  There are no Tauri commands for data access - the Rust side opens no
  DB connections. Schema changes are additive SQL migrations in
  `src-tauri/migrations/` (latest: `007_werkbank.sql`), registered in
  `src-tauri/src/lib.rs`.
- **All entities use UUIDv4 string IDs.** Never auto-increment integers.
- **Timestamps** are JS Unix-millis (`Date.now()`).
- **No `any` in TypeScript.** Data types in `packages/core/lib/types.ts`.
- **Lexical: vanilla only.** No `@lexical/react`. We
  `editor.setRootElement(ref)` and **must** call
  `registerRichText(editor)` - without it,
  `CONTROLLED_TEXT_INSERTION_COMMAND` has no default handler and typing
  silently breaks for any selection that lands on an element-type anchor.
- **Visual ALLCAPS in Charakter blocks is CSS-only** (`text-transform`).
  Mutating text nodes inside a node-transform on every keystroke fights
  Lexical's selection model and freezes input after one or two
  characters. Only the parent `characterName` attribute is synced via a
  transform - that's safe because it doesn't touch text-node children.
- **Empty blocks must be CHILDLESS** when handed to Lexical. Don't
  pre-append `$createTextNode("")` - Lexical's reconciler then renders
  nothing useful and WebKit can't place a caret. With no children,
  the reconciler injects a managed `<br>` placeholder automatically.
- **Solid stores:** small modules under `packages/core/stores/`.
  Components subscribe via getters; mutations go through store actions.
  Navigation is `stores/nav.ts` (routes, history ⌘[ / ⌘], "Zuletzt"),
  panel/dialog state is `stores/ui.ts`. **No tabs** - the sidebar shell
  replaced the tab bar in 2026-10.
- **Exactly four block types: Action (⌘1), Charakter (⌘2), Dialog (⌘3),
  Parenthetical (⌘4).** Parenthetical is NOT retired: it was briefly
  dropped during the redesign and deliberately brought back on
  2026-10-03 (typing `(` in a Dialog opens one, `)` jumps back into the
  Dialog - `plugins/parentheticalLive.ts`; it counts 0 s for the runtime
  and no dialog words). Kamera, Caption and SFX were deliberately removed
  in 2026-10 - don't reintroduce them. Old content with those three is
  converted to Action on every read (`lib/legacyBlocks.ts`) and once at
  boot (`lib/legacyBlocksMigration.ts`). Any new code path that parses
  `content_json` must run it through `normalizeLegacyContent` /
  `normalizeLegacyTree` first.
- **Stages** (`ScriptStatus`: `writing` -> `ready` -> `shot` ->
  `online`, UI labels Schreiben/Drehbereit/Gedreht/Online) are set via
  `api.setScriptStatus`. "Idee" is a UI stage only (ideas page), not a
  script status.
- **Length goal is a range** (min/max seconds), per folder
  (`api.setFolderLengthRange`) or as global default in the settings;
  resolved in `lib/lengthGoal.ts`. "Under" is information, never an
  error - only "over" uses the warn colour. Spec:
  [`docs/feature-laengenziel.md`](../../docs/feature-laengenziel.md).
- **No hex colours** outside `packages/design/` - use `var(--token)`.

## Commands

```bash
pnpm install                # installs node deps
pnpm tauri:dev              # full app with hot-reload + Rust rebuild
pnpm dev                    # Vite-only frontend (no Tauri shell)
pnpm typecheck              # tsc --noEmit
pnpm build                  # Vite prod bundle → dist/
pnpm tauri:build            # native bundle at
                            #   macOS:   src-tauri/target/release/bundle/macos/ScriptZ.app
                            #           + .dmg in bundle/dmg/
                            #   Windows: src-tauri/target/release/bundle/nsis/
                            #           ScriptZ_<version>_x64-setup.exe
cargo check --manifest-path src-tauri/Cargo.toml
```

## Don'ts

- **Never start the dev server on your own.** The user runs it. Use
  `pnpm typecheck` and `cargo check` for verification, and describe what
  to look for if a manual UI check is needed.
- **No `@lexical/react`.** Solid + React don't mix.
- **No new Tauri commands for data.** Persistence runs through
  `@tauri-apps/plugin-sql` from `src/lib/`. The Rust crate intentionally
  has no `invoke_handler`; if you find yourself wanting one for CRUD,
  you're probably reinventing what plugin-sql already gives you.
- **No localStorage for script content.** Persistence is SQLite.
- **No telemetry.** App works fully offline. The only network call is
  the hourly updater poll to
  `https://github.com/AgentZ-Media/ScriptZ/releases/latest/download/latest.json`
  (no body, no identifier) plus the manifest-driven binary download
  when the user clicks the update pill.
- **Don't reintroduce global characters, projects, tags, aliases,
  character bibles, per-script overrides, the series field, or
  vibrancy chrome.** They were deliberately removed in 2026-05 to bring
  the app closer to an iA Writer-style minimal editor. If you think you
  need them, talk to the user first.
- **Don't mutate text-node content from a node transform on every
  keystroke.** It will break typing after 1-2 characters. Use CSS or
  intercept `CONTROLLED_TEXT_INSERTION_COMMAND` to transform the payload
  before insertion.
- **Don't reintroduce the pre-Werkbank chrome or pressure mechanics**
  (removed 2026-10): tabs / tab bar, the browser dashboard with
  MomentumStrip, EditorToolbar block pills, EditorRail, SprintPill,
  weekly word goal (`weeklyWordGoal`), streak display, idea badge
  setting, "Guten Morgen" greeting, the three retired block types
  (Kamera, Caption, SFX - Parenthetical stays). The
  replacement is the adaptive writing counter (`lib/writingCounter.ts`,
  sidebar footer) and the info-only Inspector. Talk to the user first.
- **Don't put settings into the Inspector.** It shows information only;
  settings live in the SettingsDialog.
- **Don't use ⌘I for italic.** ⌘I is the global idea quick-capture;
  ScriptZ has no italic.

## Out of scope (per spec + post-cleanup)

Drehtage / Drehplanung, Locations als Entität, Notizen-Block, Person-am-
Charakter, Bilder, ElevenLabs, Drag&Drop, Cloud-Sync, Accounts, Telemetry,
Kollaboration, Hook als eigener Block, **alle AI-Features**
(OpenRouter-Anbindung, automatische Skript-Zusammenfassungen, KI im
Editor - bewusst rausgenommen 2026-05-09, Gimmick mit zu wenig
Mehrwert), Plugin-System, mehrere Skript-Layouts, Industry-Standard-
Drehbuch-Layout (Courier 12pt). Plus removed in 2026-05: Projects, Tags,
Series, global Characters with bible/aliases/description, per-script
display-name/color overrides, vibrancy chrome. Removed in 2026-10
("Werkbank"): Kamera/Caption/SFX blocks, tabs, weekly
word goal, streak, sprint timer.

## Troubleshooting

- **`sqlite locked`** - should not happen (single plugin-sql
  connection); if it does, check no migration fired mid-write.
- **Typing dies after a few keystrokes** - this is the
  `registerRichText` regression. The editor MUST call
  `registerRichText(editor)` after `setRootElement`.
- **Empty Charakter block won't accept input** - pre-appending an empty
  `$createTextNode("")` is the cause; leave the new ElementNode childless
  and call `next.select(0, 0)` instead.
- **A character keeps re-appearing in the Inspector cast / autocomplete
  after delete** - both reflect what's in `content_json`. If the name
  still appears in any Charakter block, it'll be re-added on the next
  save. Empty the block (or change the name) instead of trying to delete
  the character.
- **Script won't open / Lexical throws "type not found"** - content
  with a retired block type reached `parseEditorState` without going
  through `normalizeLegacyContent`. Fix the read path, don't
  re-register the old node classes.
- **Old scripts still contain Kamera/Caption/SFX blocks after an
  update** - the
  boot migration sets `app_state["migration.legacy_blocks_v1"]` only
  after a complete run; if a script failed, it retries on the next
  start. Reads normalize on the fly in the meantime.
