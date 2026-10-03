---
paths:
  - "apps/desktop/src/**"
  - "apps/desktop/src-tauri/**"
  - "packages/core/**"
  - "packages/design/**"
---

# Desktop-App: Architektur-Detail

Tauri 2 shell + Solid + TypeScript + Lexical editor (vanilla, no React).
All persistence, search, export and CRUD lives in TypeScript; the Rust
crate is reduced to plugin wiring + schema migrations. macOS Apple
Silicon + Windows x64 are first-class; Linux not (yet) shipped.

Seit dem Redesign „Werkbank" (2026-10, Branch `redesign-werkbank`) liegt
praktisch die gesamte App in `packages/core/` (UI, Stores, Logik) und
`packages/design/` (Designsystem). `apps/desktop/` ist eine dünne Schale.
Konzept und Arbeitsplan: [`docs/redesign/umsetzung.md`](docs/redesign/umsetzung.md),
visuelle Referenz `docs/redesign/concept.html`, Längenziel-Spec
[`docs/feature-laengenziel.md`](docs/feature-laengenziel.md).

Der ursprüngliche Projektplan (`ScriptZ-Projektplan.md`) ist veraltet -
bei Widerspruch gilt der Code.

## Repo-Layout (Detail)

```
apps/desktop/
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
                           length_max_sec. The 3-block-type reduction is
                           deliberately NOT SQL (see "Legacy-Blöcke").
    capabilities/default.json, tauri.conf.json, Cargo.toml
  src/
    index.tsx              Registers PlatformAdapter + updates store
                           (import side effects), then the CSS layers
                           (@agentz/design fonts -> tokens -> legacy ->
                           components, then core global.css), mounts <App>.
    App.tsx                <AppShell platform="desktop"
                           sidebarFooterSlot={<UpdateIndicator/>}> +
                           onCloseRequested -> flushAll(2000) + updater
                           background polling. Nothing else.
    lib/platform.ts        Tauri PlatformAdapter: plugin-sql Database as
                           getDb(), dialogs, fs, opener, http, os.
    lib/tauri.ts           isTauri flag / thin invoke wrapper (rare).
    stores/updates.ts      tauri-plugin-updater, registered into the
                           core `updates` slot.
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

packages/core/
  styles/
    tokens.css             ScriptZ-only tokens: traffic-light spacer,
                           character palette (--char-*), A4 paper geometry.
    fonts.css              iA Writer Quattro (paper font).
    global.css             Resets + pre-redesign classes (.btn-primary,
                           .modal*, .pill, .cselect*, ...) restyled on tokens.
  components/
    Shell/
      AppShell.tsx         Shared shell for desktop + web: boot sequence
                           (settings, welcome seed, nav/ui/prefs load,
                           runtime backfill, then migrateLegacyBlocksOnce,
                           then markLibraryReady), sidebar | main layout,
                           route rendering, mounts all dialogs once.
                           Props: platform, topSlot, sidebarFooterSlot.
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
      ScriptRow, PageBar, SelectionBar (multi PDF / Studio / move / stage /
      trash), ContextMenu, PromptDialog, HandoffDialog (Studio transfer),
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
                           (used by Studio).
      persistence.ts       Debounced save (250 ms) through a serialized
                           queue (lib/serialSave.ts), auto snapshot (5 min),
                           flush on teardown.
      activeBlockReporter, canvasFocus, characterReconcile, predict.ts,
      ColorPickerPopover, SnapshotsDialog, PaperLayout.css.
      nodes/               3 ElementNode subclasses
        BaseScriptzNode    shared base, getBlockType()
        Scriptz{Action,Character,Dialog}Node
        index.ts           BLOCK_HOTKEYS (⌘1-3), blockLabel()
      plugins/
        smartEnter.ts      Enter/Backspace state machine (3 types)
        blockHotkeys.ts    ⌘1/⌘2/⌘3 -> Action/Character/Dialog
        blockDropdown.tsx  Tab opens the block-type picker
        characterDropdown.tsx  caret-anchored autocomplete, ranked by
                           predict.ts
        inlineFormat.ts    ⌘B / ⌘U (no italic: ⌘I = idea capture)
        allcaps.ts         characterName attribute sync (UPPER is CSS)
        highlight.ts       per-block --char-tint
        colorPicker.tsx    character colour popover (3 entry points)
    Ideas/                 IdeasPage (+ parts/), QuickCapture (⌘I modal),
                           ideaGroups.ts, similar.ts, folderColor.ts
    Export/                ExportDialog (⌘E, live preview via pdfPreview.ts)
    Settings/              SettingsDialog + sections/ (Appearance, Writing,
                           Folders incl. length range per folder, Characters,
                           Shortcuts, Studio, Updates, About), rangeInput.ts
    Onboarding/            Onboarding (3 steps, ONBOARDING_KEY)
    Activity/              WritingCounter (sidebar footer), ActivityModal
                           (window totals + Heatmap). No goal, no streak.
    Common/                Icon, StageGlyph, AppMark, Modal, ConfirmDialog,
                           ToastHost, BootErrorScreen
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
                           flags, studio connect code.
    dailyStats.ts, ideas.ts, saveStatus.ts, toasts.ts
  lib/
    api.ts                 `api.*` facade = proxy onto the registered
                           StorageAdapter. Registers the SQL-backed default
                           adapter (desktop) on import.
    storage.ts             StorageAdapter interface (incl. setScriptStatus,
                           setFolderLengthRange, ListScriptsQuery.status),
                           validateLengthRange.
    platform.ts            PlatformAdapter slot (getDb, saveAs, openFile,
                           openUrl, ...), applyPlatformToDocument.
    db.ts                  getDb() via PlatformAdapter + settings/app_state.
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
                           action block, min 5 s).
    timing.ts              computeTimeline(): per-block segments, sum ==
                           runtime.ts (same formula).
    lengthGoal.ts          LengthRange, resolveLengthRange (folder ->
                           global default -> none), lengthStatus
                           (none/under/in/over), formatRange, parseClock.
    writingCounter.ts      pickWritingWindow(): smallest window with words
                           (week -> month -> year -> total).
    legacyBlocks.ts        normalizeLegacyContent / normalizeLegacyTree.
    legacyBlocksMigration.ts  migrateLegacyBlocksOnce() (boot).
    exportPdf.ts, exportSelection.ts (multi PDF), scriptzFile.ts (.scriptz
    v1, status additive), handoff.ts (Studio), ideas.ts, dailyWords.ts,
    characterColors.ts, welcome.ts, keys.ts, format.ts, colors.ts,
    saveFlush.ts (flushAll: awaits buffered + in-flight writes),
    serialSave.ts (serialized "latest draft wins" saver for every
    autosave/commit field), scriptViewCache.ts, updates.ts (updater slot),
    *Bus.ts (scripts/folders/ideas/dailyStats pub-sub).
  i18n/                    de.ts / en.ts + parts/{shell,script,dialogs}.ts
                           (see i18n.md)
```

Gestrichen im Redesign (2026-10, bewusst, nicht wieder einführen):
Tabs/`TabBar`/`stores/tabs.ts`, `Browser/` inkl. `MomentumStrip`,
`EditorToolbar`, `EditorRail`, `SprintPill`, `ScriptView`, `CommandBar`,
`IdeasDrawer`, das Plugin `parentheticalLive`, die Blocktypen
Parenthetical/Kamera/Caption/SFX, Wochenziel und Streak-Anzeige.

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

## Legacy-Blöcke (Parenthetical/Kamera/Caption/SFX)

Die Node-Klassen existieren nicht mehr; Lexical würde alten Content
ablehnen. Deshalb:

- **On-the-fly**: Jeder Pfad, der Content parst, läuft über
  `lib/legacyBlocks.ts` (Editor-Load, `lex.ts`, PDF, Plaintext,
  `.scriptz`-Import, Snapshot-Restore in `snapshots.ts` und im Web-Adapter,
  SnapshotsDialog). Alte Typen werden zu `scriptz-action`,
  Parenthetical-Text wird in `( … )` gesetzt, falls nötig.
- **Boot-Migration**: `migrateLegacyBlocksOnce()` schreibt einmalig alle
  Skripte (inkl. Papierkorb) über `api` um, mit `internalRewrite: true`
  (keine Wörter ins Tageslog, `updated_at` bleibt). Flag
  `app_state["migration.legacy_blocks_v1"]`; bei einem Fehler bleibt das
  Flag weg und der nächste Start versucht es erneut. Snapshots bleiben
  unverändert und werden beim Restore normalisiert.
- Keine SQL-Migration dafür - `content_json` ist ein JSON-Blob.

## Data flow

- Boot (`AppShell`): settings, welcome seed, `navStore.load()`,
  `uiStore.load()`, library prefs, runtime backfill parallel -> danach
  `migrateLegacyBlocksOnce()` -> `markLibraryReady()`. Erst dann laufen
  Listen-Queries und kann ein Editor ein Skript öffnen.
- Navigation: `navStore.go/openScript/back/forward` ruft erst
  `flushAll()` (Editor-Save, nav-Persist), dann wird die Route gesetzt.
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
- Suche: ⌘K -> `api.globalSearch` -> FTS5 BM25 (Desktop) bzw. MiniSearch
  (Web) -> `SearchHit[]` mit `<mark>`-Snippets.
- PDF-Export: `lib/exportPdf.ts` baut die Bytes (pdf-lib, A4,
  Widow/Orphan), das Speichern läuft über `PlatformAdapter.saveAs`
  (Desktop: Tauri-Dialog + plugin-fs). Kein Rust-Code beteiligt.
