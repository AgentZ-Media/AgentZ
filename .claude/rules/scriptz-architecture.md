---
paths:
  - "apps/scriptz/src/**"
  - "apps/scriptz/src-tauri/**"
  - "modules/scriptz/**"
  - "packages/design/**"
---

# ScriptZ: Architektur-Detail

Tauri 2 shell + Solid + TypeScript + Lexical editor (vanilla, no React).
All persistence, search, export and CRUD lives in TypeScript; the Rust
crate is reduced to plugin wiring + schema migrations. macOS Apple
Silicon + Windows x64 are first-class; Linux not (yet) shipped.

Produktlogik aus dem Redesign „Werkbank" liegt in `modules/scriptz/`
(UI, fachliche Stores, Datenmodell, Editor). `packages/design/` enthält
das Designsystem, `packages/kit/` die gemeinsame Shell und Infrastruktur.
`apps/scriptz/` verdrahtet `scriptzModule` mit SuiteShell und den nativen
Adaptern. `@agentz/desktop` entsteht erst in Phase 5.
Konzept und Arbeitsplan: [`docs/redesign/umsetzung.md`](../../docs/redesign/umsetzung.md),
visuelle Referenz `docs/redesign/concept.html`, Längenziel-Spec
[`docs/feature-laengenziel.md`](../../docs/feature-laengenziel.md).

Der tatsächliche Code ist die Referenz für das aktuelle Verhalten.
Seit Phase 3 gelten außerdem die automatischen Paketgrenzen und
Konventionen aus [`suite-architecture.md`](suite-architecture.md).
Cargo-Workspace, Lockfile und `target/` liegen im Repo-Root;
`apps/scriptz/src-tauri/` bleibt das App-Crate mit seinen Migrationen.
Phase 4 hat Lebenszyklus, Shell, gemeinsame Einstellungen und Navigation
von der Produktlogik getrennt.
Prüfungen und offene Punkte stehen im
[Umsetzungsstand](../../docs/agentz-suite-fortschritt.md).

## Repo-Layout (Detail)

```
apps/scriptz/
  src-tauri/
    src/lib.rs             Tauri Builder + plugin wiring + plugin-sql
                           migration list (001-007). No commands, no
                           business logic.
    migrations/
      001_baseline.sql     Idempotent baseline schema.
      002_ai_cleanup.sql   Drops the old AI columns/settings.
      003_redesign.sql     daily_word_log, ideas table,
                           scripts.last_word_count sentinel.
      004_word_count_sentinel.sql  Sentinel backfill.
      005_runtime_stats.sql  dialog_word_count / direction_block_count
                           (runtime estimate inputs, sentinel -1).
      006_idea_folders.sql   Ideas in folders.
      007_werkbank.sql     Additive: scripts.status (TEXT NOT NULL
                           DEFAULT 'writing') + status_changed_at +
                           idx_scripts_status, folders.length_min_sec /
                           length_max_sec. The retirement of Kamera/
                           Caption/SFX is deliberately NOT SQL (see
                           "Legacy-Blöcke").
    capabilities/default.json, tauri.conf.json, Cargo.toml
  src/
    index.tsx              Explicitly registers platform, Kit KV, product SQL
                           and updates
                           before render(), then imports the CSS layers
                           (@agentz/design fonts -> tokens -> legacy ->
                           components, kit styles, then module global.css), mounts <App>.
    App.tsx                <SuiteShell module={scriptzModule} footer={...}> +
                           onCloseRequested -> flushAll(2000) + updater
                           background polling. Nothing else.
    lib/platform.ts        Tauri PlatformAdapter: plugin-sql Database as
                           getDb(), dialogs, fs, opener, os.
    lib/tauri.ts           isTauri flag / thin invoke wrapper (rare).
    stores/updates.ts      tauri-plugin-updater, registered into the
                           Kit `updates` slot.
    components/Common/UpdateIndicator.tsx   Update pill (sidebar footer).

packages/design/           @agentz/design - suite design system (see its README)
  tokens.css               Semantic tokens light/dark/dark-paper
                           (:root, [data-theme="dark"], [data-paper="dark"]).
  legacy.css               Alias layer: old token names (--fg-muted,
                           --bg-elev-*, --brand-*, ...) -> new tokens.
                           New code must not use them.
  components.css           .btn, .chip, .fchip, kbd, .menu/.menu-it, .scrim,
                           .dlg, .toast, .sw-t, .seg, .field, .num-f, .rng-f ...
  fonts.css                Schibsted Grotesk (UI, offline via fontsource).
  icons.ts                 ICONS (24er stroke icons), STAGE_GLYPHS (14er).
  logo.ts                  Dot-matrix Z (LOGO_DOTS ...).
  assets/                  Generated logo files + app icon (SVG, 1024 PNG).
  scripts/build-logo.mjs   Exports assets/ + the full
                           Tauri icon set from logo.ts (build:logo).

packages/kit/              @agentz/kit - product-neutral application primitives
  platform/               PlatformAdapter, DbConnection, KvStore + SQL,
                           key helpers, updater slot. No Tauri imports.
  i18n/                   Shared language engine and neutral DE/EN catalog.
  lib/                    serialSave, FlushCoordinator (result: ok + failed),
                           requireSuccessfulFlush, time/number formatting.
  stores/                 Toasts, baseSettings, createNavStore, createLayoutStore,
                           state persistence and general shell dialog state.
  shell/                  SuiteShell, AppModule/ModuleRuntime/ModuleContext,
                           settings, command palette and shortcut registry.
  ui/                     Modal, ConfirmDialog, ToastHost, Icon, AppMark,
                           BootErrorScreen, DialogFrame, settings primitives.
  styles.css              Neutral CSS on semantic tokens, no legacy aliases.

modules/scriptz/
  index.ts                Exports scriptzModule: AppModule.
  module.tsx              Product setup: boot, lifecycle, routes, sidebar,
                           overlays, commands, settings, onboarding.
  assets/fonts/           iA Writer Quattro WOFF2 + PDF TTFs and license.
  styles/
    tokens.css             ScriptZ-only tokens: traffic-light spacer,
                           character palette (--char-*), A4 paper geometry.
    fonts.css              iA Writer Quattro (paper font).
    global.css             Remaining product styles; neutral reset/dialog/
                           settings rules are now owned by Kit.
  components/
    Shell/
      Sidebar.tsx          Product navigation: search + new, all scripts,
                           ideas, pipeline stages, folders and recent scripts.
                           Product footer has writing counter/trash/settings;
                           Kit owns brand, sidebar frame and host footer slot.
      libraryData.ts       Shared reactive lists (live scripts + folders),
                           refetched on scriptsBus / foldersBus.
      shortcuts.ts         Product ShortcutDef entries; global handlers are
                           installed by Kit. Local Lexical/list handlers stay
                           local and supply documentation-only entries.
    Library/
      ScriptsPage.tsx      Script list: groups by stage/folder/none, filter,
                           sort, selection mode, length range per row.
      ScriptRow, PageBar, SelectionBar (shared by scripts + ideas: multi
      PDF / move / stage or "Zu Skripten" / trash or delete),
      SelectCheck (tri-state group / "Alle auswählen" checkbox),
      selection.ts (pure helpers: checkState, toggleIds, rangeBetween),
      ContextMenu, PromptDialog,
      TrashPage, actions.ts (shared script/folder ops + toasts), dnd.ts
      (row -> sidebar folder), prefs.ts (grouping/sort in app_state).
    Palette/commands.tsx   Product search/ranking, scripts, ideas and commands;
                           empty = recent. Kit owns palette UI and query lifetime.
    Script/
      ScriptScreen.tsx     Editor screen ({ scriptId }): TopBar, paper,
                           Inspector, Timeline, focus chrome, recovery.
      TopBar.tsx           Breadcrumb, TitleInput, StageChip (+ menu),
                           Quick/colour toggles, export button.
      Inspector.tsx        Info only (runtime vs. range, cast shares,
                           "Aus der Idee", stage since ...). No settings.
      Timeline.tsx         Mini track + ⌘J expanded speaker lanes, hover
                           link to blocks, click jumps.
      GutterLabel.tsx      Block-type label next to the caret block.
      FocusChrome.tsx      Focus pill (length / session words / exit).
      StageChip, StageToast (undo), stageActions.ts (stepStage),
      liveEditor.ts, timelineMath.ts (pure), RecoveryPanel, TitleInput.
    Editor/
      Editor.tsx           Lexical mount: createEditor, registerRichText,
                           registerHistory, plugins below. readOnly prop
                           (used by the version preview in SnapshotsDialog -
                           same engine, no copy).
      persistence.ts       Debounced save (250 ms) through a serialized
                           queue (@agentz/kit/lib), auto snapshot (5 min),
                           flush on teardown.
      activeBlockReporter, canvasFocus, characterReconcile, predict.ts,
      ColorPickerPopover, SnapshotsDialog, PaperLayout.css.
      nodes/               4 ElementNode subclasses
        BaseScriptzNode    shared base, getBlockType()
        Scriptz{Action,Character,Dialog,Parenthetical}Node
        index.ts           BLOCK_HOTKEYS (⌘1-4), blockLabel()
      plugins/
        smartEnter.ts      Enter/Backspace state machine (4 types;
                           Parenthetical -> Dialog)
        blockHotkeys.ts    ⌘1/⌘2/⌘3/⌘4 -> Action/Character/Dialog/
                           Parenthetical
        parentheticalLive.ts  "(" in a Dialog opens a Parenthetical
                           (splits the line at the caret), ")" closes it
                           and jumps into the next Dialog
        blockDropdown.tsx  Tab opens the block-type picker
        characterDropdown.tsx  caret-anchored autocomplete, ranked by
                           predict.ts
        inlineFormat.ts    ⌘B / ⌘U (no italic: ⌘I = idea capture)
        allcaps.ts         characterName attribute sync (UPPER is CSS)
        highlight.ts       per-block --char-tint (Character, Dialog,
                           Parenthetical)
        colorPicker.tsx    character colour popover (3 entry points)
    Ideas/                 IdeasPage (+ parts/; rows open in place into
                           IdeaEditor, no side panel; selection mode like the
                           scripts page: checkboxes, ⌘A, ⇧-range, bulk move /
                           convert into scripts of a stage / delete - closes
                           the open row),
                           QuickCapture (⌘I modal),
                           ideaGroups.ts, similar.ts, folderColor.ts
    Export/                ExportDialog (⌘E, live preview via pdfPreview.ts)
    Settings/              moduleSettings.ts: Writing, Folders, Characters;
                           DarkPaperSetting extends Kit Appearance.
                           rangeInput.ts and product field primitives remain.
    Onboarding/            Product content (3 steps). Kit manages the once flag
                           onboarding_completed_v1 and completion.
    Activity/              WritingCounter (sidebar footer), ActivityModal
                           (window totals + Heatmap). No goal, no streak.
    Common/                StageGlyph (product status). Neutral components
                           are imported directly from @agentz/kit/ui.
  stores/
    nav.ts                 Product Route (scripts | ideas | script | trash),
                           recent metadata (max 8) and legacy open_tabs decoder.
                           Kit owns history (⌘[ / ⌘]) and buffered persistence;
                           nav.state keeps its existing JSON shape.
    ui.ts                  Inspector, timeline, focus/quick mode and product
                           dialogs. Binds Kit sidebar state to createLayoutStore
                           for the unchanged complete ui.layout object.
    settings.ts            Product settings: highlighting, focus, quick mode,
                           writing stats, dark paper, words/minute, length
                           range and unused-character pruning. Kit owns theme,
                           language and both updater flags.
    dailyStats.ts, ideas.ts, saveStatus.ts
  lib/
    api.ts                 `api.*` facade = proxy onto the registered
                           ScriptzStorage. registerSqlStorageAdapter()
                           explicitly installs the SQL-backed default;
                           importing the facade does not register it.
    storage.ts             ScriptzStorage: product CRUD only, plus
                           validateLengthRange. Kit KV is separately registered.
    db.ts                  getDb() via Kit PlatformAdapter.
    types.ts               Script, ScriptSummary (+ status,
                           status_changed_at), Folder (+ length_min_sec,
                           length_max_sec), ScriptStatus, Stage,
                           SCRIPT_STATUSES, isScriptStatus ...
    scripts.ts             CRUD, setScriptStatus, duplicate, archive/
                           restore/purge, characters_meta reconcile,
                           runtime stats, backfill.
    folders.ts             Flat folders, setFolderLengthRange, INBOX_FOLDER_ID.
    snapshots.ts           Auto + manual, 50-per-script cap.
    search.ts / fts.ts     FTS5 BM25 over scripts_fts.
    lex.ts                 Lexical JSON -> blocks / teleprompter text /
                           character names / dialog words per character.
    runtime.ts             Runtime estimate (dialog words / WPM + 2 s per
                           action block, min 5 s; Character and
                           Parenthetical count 0 s).
    timing.ts              computeTimeline(): per-block segments, sum ==
                           runtime.ts (same formula).
    lengthGoal.ts          LengthRange, resolveLengthRange (folder ->
                           global default -> none), lengthStatus
                           (none/under/in/over), formatRange, parseClock.
    writingCounter.ts      pickWritingWindow(): smallest window with words
                           (week -> month -> year -> total).
    legacyBlocks.ts        normalizeLegacyContent / normalizeLegacyTree.
    legacyBlocksMigration.ts  migrateLegacyBlocksOnce() (boot).
    exportPdf.ts (incl. product ExportPdfDeps), exportSelection.ts (multi PDF),
    scriptzFile.ts (.scriptz v1, status additive), ideas.ts, dailyWords.ts,
    characterColors.ts, characterUsage.ts (welche Registry-Namen noch
    benutzt werden: gestückelter Scan über characters_meta, SQL-Find/Prune,
    characterUsageBus), characterAutoPrune.ts (optionales Auto-Aufräumen,
    debounced), welcome.ts, format.ts (printed page count), colors.ts,
    scriptViewCache.ts,
    *Bus.ts (scripts/folders/ideas/dailyStats pub-sub).
  i18n/                    Product catalogs de.ts / en.ts + parts;
                           typed composition with @agentz/kit/i18n.
                           Language state and engine belong to Kit.
```

Gestrichen im Redesign (2026-10, bewusst, nicht wieder einführen):
Tabs/`TabBar`/`stores/tabs.ts`, `Browser/` inkl. `MomentumStrip`,
`EditorToolbar`, `EditorRail`, `SprintPill`, `ScriptView`, `CommandBar`,
`IdeasDrawer`, die Blocktypen Kamera/Caption/SFX, Wochenziel und
Streak-Anzeige. Parenthetical (samt `parentheticalLive`) war zwischenzeitlich
gestrichen und ist seit 2026-10-03 bewusst wieder da.

## Stufen und Zielbereich

- **Stufe** (`ScriptStatus`): `writing` (Schreiben) -> `ready`
  (Drehbereit) -> `shot` (Gedreht) -> `online`. In der UI kommt `idea`
  als Vorstufe dazu (`Stage`), das ist aber kein Skript-Status, sondern
  die Ideen-Seite. Gesetzt über `api.setScriptStatus` (StageChip,
  SelectionBar, ⌘⌥←/→ via `stageActions.ts`, mit Undo-Toast);
  `status_changed_at` ändert sich nur bei echtem Wechsel.
- **Zielbereich**: Minimum/Maximum in Sekunden, je Ordner
  (`folders.length_min_sec/max_sec`, `api.setFolderLengthRange`) oder
  global als Standard (Settings `length_min_default_sec` /
  `length_max_default_sec`, leer = aus). Auflösung in
  `lengthGoal.ts::resolveLengthRange`: Ordner -> Standard -> keiner.
  „Darunter" ist Information (gedämpft), nur „darüber" nutzt `--warn`.

## Characters - das Per-Script-Modell

Characters live **only** inside the script that uses them. There is no
global character table.

- The Lexical state contains `scriptz-character` blocks with a
  `characterName` attribute (uppercased, kept in sync by `allcaps.ts`).
- On every save, `lib/scripts.ts` walks the JSON via
  `extractCharacterNames` (`lib/lex.ts`), reconciles the result against
  `scripts.characters_meta` (JSON array of `{name, color}`) and writes the
  merged list back. Names match case-insensitively; **colors are sticky**.
  New names get the next free color from `DEFAULT_PALETTE` in
  `lib/characterColors.ts`.
- The UI reads `script.characters` for the Inspector cast list, the cast
  dots in `ScriptRow` and the autocomplete dropdown. There is no
  "create character" UI - it happens implicitly when you type a new name
  into a Charakter block.
- Die app-weite Farb-Registry (`character_colors`) wächst bei jedem Save
  mit (auch Zwischenstände beim Tippen). Einstellungen > Charaktere kann
  sie aufräumen: „Jetzt prüfen" scannt `characters_meta` aller Skripte
  (Papierkorb zählt mit, Snapshots nicht) seitenweise mit UI-Pausen und
  löscht nach Bestätigung; der Schalter „Nur verwendete Namen behalten"
  räumt nach jedem Save/Purge/Restore, der einen Namen verliert, nach
  4 s Ruhe automatisch auf (`lib/characterAutoPrune.ts`). Das Löschen
  prüft selbst noch einmal nach, ein zwischendurch wieder getippter Name
  bleibt.

## Legacy-Blöcke (Kamera/Caption/SFX)

Die Node-Klassen existieren nicht mehr; Lexical würde alten Content
ablehnen. Parenthetical gehört **nicht** dazu - es ist ein regulärer
Blocktyp und läuft unverändert durch. Deshalb:

- **On-the-fly**: Jeder Pfad, der Content parst, läuft über
  `lib/legacyBlocks.ts` (Editor-Load, `lex.ts`, PDF, Plaintext,
  `.scriptz`-Import, Snapshot-Restore in `snapshots.ts`,
  SnapshotsDialog-Vorschau über den Editor-Load). Alte Typen werden zu `scriptz-action`, Text und
  Formatierung bleiben.
- **Boot-Migration**: `migrateLegacyBlocksOnce()` schreibt einmalig alle
  Skripte (inkl. Papierkorb) über `api` um, mit `internalRewrite: true`
  (keine Wörter ins Tageslog, `updated_at` bleibt). Flag
  `app_state["migration.legacy_blocks_v1"]`; bei einem Fehler bleibt das
  Flag weg und der nächste Start versucht es erneut. Snapshots bleiben
  unverändert und werden beim Restore normalisiert.
- Keine SQL-Migration dafür - `content_json` ist ein JSON-Blob.

## Data flow

- Host (`apps/scriptz/src/index.tsx`): Plattform -> SQL-KvStore ->
  Produkt-SQL-Adapter -> Updater -> `render()`. Keine anwendungseigene
  Import-I/O; Solid-generierte JSX-Event-Delegation bleibt Framework-Verhalten.
- Shell: `SuiteShell` startet Basis-Settings und lädt Theme/Sprache,
  dann `scriptzModule.setup(ctx)`. Das Modul startet seine eigenen
  Einstellungen, Navigation, Layout und relative Uhr.
- Produkt-Boot: Welcome-Seed, Navigation/Layout, Bibliothekspräferenzen
  und Runtime-Backfill, danach Legacy-Block-Migration und fachliche
  Resources. Erst die fertige Runtime liefert Routen und Produkt-UI an
  die Shell. Backfill und Legacy-Migration behalten ihr fehlertolerantes
  Verhalten; fehlgeschlagene Migrationen werden später erneut versucht.
- Cleanup: Abbruchsignal und früh registrierte `ctx.onDispose()`-Callbacks
  schützen auch den asynchronen Boot. `ctx.runOwned()` bindet synchrone
  reaktive Arbeit nach einem `await` an die Shell-Lebensdauer. Die Shell
  beendet die Runtime, auch wenn sie erst nach Unmount fertig wird.
  Die App beendet Updater-Polling/Fenster-Listener; HMR entsorgt den Root.
- Navigation: Die Kit-Nav-Fabrik ruft vor Routenwechsel `flushAll()` auf.
  Bei Fehler oder Timeout bleibt die bisherige Route aktiv. Das Modul
  liefert Routen, „Zuletzt"-Metadaten und die unveränderte JSON-Kodierung.
  `ScriptScreen` mountet pro `scriptId` den Editor.
- Editor `onUpdate` -> 250 ms debounce (`persistence.ts`) -> JSON ->
  `api.updateScript` -> `lib/scripts.ts` schreibt `content_json`,
  refresht FTS5, reconciled `characters_meta`, aktualisiert Runtime-Stats
  (`dialog_word_count`, `direction_block_count`) und bucht positive
  Wort-Deltas in `daily_word_log`.
- Live-Anzeigen: `liveEditor.ts` liefert Blockliste (debounced) und
  Caret-Block (sofort) -> Timeline (`timing.ts`), Inspector
  (`runtime.ts` + `lengthGoal.ts`), GutterLabel, FocusPill.
- Stufe/Zielbereich: `api.setScriptStatus` / `api.setFolderLengthRange`
  -> `scriptsBus` / `foldersBus` bump -> `libraryData` refetcht ->
  Sidebar-Zähler, ScriptsPage-Gruppen, Inspector aktualisieren sich.
- Auto-Snapshot alle 5 min solange dirty, manuell ⌘⇧S, Cap 50 pro
  Skript (in `createSnapshot` und `restoreSnapshot` erzwungen).
- Suche: ⌘K -> `api.globalSearch` -> SQLite-FTS5 BM25 -> `SearchHit[]` mit `<mark>`-Snippets.
- PDF-Export: `lib/exportPdf.ts` baut die Bytes (pdf-lib, A4,
  Widow/Orphan); TTFs kommen per `?url` aus `assets/fonts/` im Modul.
  Das Speichern läuft über `PlatformAdapter.saveAs`
  (Desktop: Tauri-Dialog + plugin-fs). Kein Rust-Code beteiligt.
