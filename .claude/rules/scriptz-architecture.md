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

Seit Phase 2 des Suite-Fundaments liegt die bisherige App-Logik aus
dem Redesign „Werkbank" in `modules/scriptz/` (UI, Stores, Logik) und
`packages/design/` (Designsystem). `apps/scriptz/` ist eine dünne Schale.
`@agentz/kit` enthält seit Phase 4.1 bis 4.3 die neutralen Bausteine;
`@agentz/desktop` entsteht erst in Phase 5.
Konzept und Arbeitsplan: [`docs/redesign/umsetzung.md`](../../docs/redesign/umsetzung.md),
visuelle Referenz `docs/redesign/concept.html`, Längenziel-Spec
[`docs/feature-laengenziel.md`](../../docs/feature-laengenziel.md).

Der tatsächliche Code ist die Referenz für das aktuelle Verhalten.
Seit Phase 3 gelten außerdem die automatischen Paketgrenzen und
Konventionen aus [`suite-architecture.md`](suite-architecture.md).
Cargo-Workspace, Lockfile und `target/` liegen im Repo-Root;
`apps/scriptz/src-tauri/` bleibt das App-Crate mit seinen Migrationen.
Phase 4.0 hat den Import-Lebenszyklus explizit gemacht. Die Kit-Grundlagen
sind extrahiert; Shell, Einstellungen und Navigation folgen noch.
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
    index.tsx              Explicitly registers platform, SQL and updates
                           before render(), then imports the CSS layers
                           (@agentz/design fonts -> tokens -> legacy ->
                           components, kit styles, then module global.css), mounts <App>.
    App.tsx                <AppShell sidebarFooterSlot={<UpdateIndicator/>}> +
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
  lib/                    serialSave, FlushCoordinator (result: ok + failed).
  stores/                 Toast state.
  ui/                     Modal, ConfirmDialog, ToastHost, Icon, AppMark,
                           BootErrorScreen, DialogFrame, settings primitives.
  styles.css              Neutral CSS on semantic tokens, no legacy aliases.

modules/scriptz/
  styles/
    tokens.css             ScriptZ-only tokens: traffic-light spacer,
                           character palette (--char-*), A4 paper geometry.
    fonts.css              iA Writer Quattro (paper font).
    global.css             Remaining product styles; neutral reset/dialog/
                           settings rules are now owned by Kit.
  components/
    Shell/
      AppShell.tsx         App-Schale: Boot-Sequenz
                           (settings, welcome seed, nav/ui/prefs load,
                           runtime backfill, then migrateLegacyBlocksOnce,
                           then startIdeasStore/startDailyStatsStore/
                           startLibraryData), sidebar | main layout,
                           route rendering, mounts all dialogs once.
                           Prop: sidebarFooterSlot.
      Sidebar.tsx          Dark sidebar: app row, search + new, "Alle
                           Skripte", Ideen, pipeline (stages), folders,
                           "Zuletzt", footer (WritingCounter, trash,
                           settings, host slot).
      libraryData.ts       Shared reactive lists (live scripts + folders),
                           refetched on scriptsBus / foldersBus.
      shortcuts.ts         Global shortcuts (⌘K, ⌘N, ⌘I, ⌘[ ⌘], ⌘\, ⌘⇧\,
                           ⌘J, ⌘⌥←/→, ⌘⇧F, ⌘E, ⌘, ...), window bubble phase.
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
    Palette/CommandPalette.tsx   ⌘K: scripts, ideas, commands; empty = Zuletzt.
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
    Settings/              SettingsDialog + sections/ (Appearance, Writing,
                           Folders incl. length range per folder, Characters,
                           Shortcuts, Updates, About), rangeInput.ts
    Onboarding/            Onboarding (3 steps, ONBOARDING_KEY)
    Activity/              WritingCounter (sidebar footer), ActivityModal
                           (window totals + Heatmap). No goal, no streak.
    Common/                StageGlyph (product status). Neutral components
                           are imported directly from @agentz/kit/ui.
  stores/
    nav.ts                 Route (scripts | ideas | script | trash),
                           history (⌘[ / ⌘]), "Zuletzt" (max 8). Persisted
                           in app_state["nav.state"]; migrates the old
                           app_state["open_tabs"] once. Every route change
                           runs flushAll() first.
    ui.ts                  Sidebar / inspector / timeline (persisted in
                           app_state["ui.layout"]), focus mode (per-script
                           override), open dialogs (palette, capture,
                           settings + section, export, onboarding,
                           activity). Dialogs are parameterless.
    settings.ts            theme, language, highlightingDefault, darkPaper,
                           focusModeDefault (default off), quickMode,
                           showWritingStats (= writing counter, default on),
                           dialogWpm, length_min/max_default_sec, update
                           flags,
                           pruneUnusedCharacters (default off).
    dailyStats.ts, ideas.ts, saveStatus.ts
  lib/
    api.ts                 `api.*` facade = proxy onto the registered
                           ScriptzApiStorage. registerSqlStorageAdapter()
                           explicitly installs the SQL-backed default;
                           importing the facade does not register it.
    storage.ts             ScriptzStorage: product CRUD; ScriptzApiStorage
                           temporarily composes it with KvStore. Registration
                           installs the shared KvStore as well.
                           Includes validateLengthRange.
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
    scriptzFile.ts (.scriptz
    v1, status additive), ideas.ts, dailyWords.ts,
    characterColors.ts, characterUsage.ts (welche Registry-Namen noch
    benutzt werden: gestückelter Scan über characters_meta, SQL-Find/Prune,
    characterUsageBus), characterAutoPrune.ts (optionales Auto-Aufräumen,
    debounced), welcome.ts, format.ts, colors.ts, scriptViewCache.ts,
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

- Host (`apps/scriptz/src/index.tsx`): `registerDesktopPlatform()` ->
  `registerSqlStorageAdapter()` -> `registerDesktopUpdates()` -> `render()`;
  anwendungseigene Import-I/O entfällt. Solid-generierte JSX-Event-Delegation
  bleibt Framework-Verhalten.
- Shell-Lebenszyklus: `startSettingsRuntime()`, `startNavRuntime()` und
  `startRelativeTimeClock()` starten beim Aufbau der `AppShell`.
- Boot (`AppShell`): settings, welcome seed, `navStore.load()`,
  `uiStore.load()`, library prefs, runtime backfill parallel -> danach
  `migrateLegacyBlocksOnce()` -> `startIdeasStore()`,
  `startDailyStatsStore()` und `startLibraryData()` -> `bootReady`.
  Erst dann laufen die Listen-Resources und kann ein Editor ein Skript
  öffnen. Runtime-Backfill und Legacy-Migration bleiben fehlertolerant
  wie bisher; fehlgeschlagene Migrationen werden beim nächsten Start
  erneut versucht.
- Cleanup: Die Shell beendet ihre expliziten Laufzeiten beim Unmount.
  Ein noch laufender Boot darf anschließend keine Resources nachstarten.
  Die Desktop-Schale beendet Updater-Polling und Fenster-Listener;
  HMR entsorgt den Render-Root.
- Navigation: `navStore.go/openScript/back/forward` ruft erst
  `flushAll()` aus dem Kit auf (Editor-Save, nav-Persist), dann wird
  die Route gesetzt. Der Koordinator liefert Fehler/Timeouts als Ergebnis.
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
  Widow/Orphan), das Speichern läuft über `PlatformAdapter.saveAs`
  (Desktop: Tauri-Dialog + plugin-fs). Kein Rust-Code beteiligt.
