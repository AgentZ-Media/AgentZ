---
paths:
  - "apps/scriptz/src/**"
  - "apps/scriptz/src-tauri/**"
  - "modules/scriptz/**"
---

# ScriptZ: Architektur

Allgemeine Regeln stehen in [`apps/scriptz/CLAUDE.md`](../../apps/scriptz/CLAUDE.md),
Suite-Grenzen in [`suite-architecture.md`](suite-architecture.md). Visuelle
Referenz des Designs: `docs/redesign/concept.html`.

## Aufbau des Moduls

- `module.tsx`: `scriptzModule.setup(ctx)` startet Produkt-Settings,
  Navigation, Layout und Bibliothekspräferenzen, seedet das Welcome-Skript,
  füllt Runtime-Statistiken nach, migriert Legacy-Blöcke und startet erst
  danach Ideen-, Statistik- und Bibliotheks-Resources. Liefert Routen
  (Skripte, Ideen, Skript, Papierkorb), Sidebar, Overlays (QuickCapture,
  Export, Stufen-Undo), Befehle, Shortcuts, Einstellungen, Onboarding.
- `lib/`: `api.ts` ist ein Proxy auf den registrierten `ScriptzStorage`
  (`registerSqlStorageAdapter()` installiert den SQL-Default). Fachlogik:
  `scripts.ts`, `folders.ts`, `snapshots.ts`, `search.ts`/`fts.ts` (FTS5),
  `lex.ts`, `runtime.ts`/`timing.ts` (gleiche Formel), `lengthGoal.ts`,
  `legacyBlocks*.ts`, `exportPdf.ts`, `scriptzFile.ts`, `*Bus.ts`.
- `components/Editor/`: Lexical-Mount, vier Nodes, Plugins (smartEnter,
  blockHotkeys, parentheticalLive, Picker, Autocomplete, inlineFormat,
  allcaps, highlight, colorPicker), `persistence.ts`.
- `stores/`: `nav.ts` (Routen, „Zuletzt", Kodierung von `nav.state`),
  `ui.ts` (Inspector, Zeitleiste, Fokus, Quick-Mode, Produktdialoge,
  `ui.layout`), `settings.ts` (Produkt-Settings), `ideas`, `dailyStats`.
- `i18n/`: Produktkataloge, mit dem Kit-Katalog komponiert.

Theme, Sprache, Updater-Flags, Navigation-Historie, Shell und Dialoge gehören
dem Kit. Die Listen-Seitenköpfe (`PageBar`) zeigen den Button zum Einblenden
der Sidebar, im Skript genügen ⌘\ und die Befehlspalette. Deshalb setzt das
Modul `revealsSidebar: true` und die Shell blendet keinen eigenen Button ein.

## Migrationen

`001_baseline` bis `007_werkbank` in `apps/scriptz/src-tauri/migrations/` sind
veröffentlicht und unveränderlich. `007` ergänzt `scripts.status`,
`status_changed_at` und den Ordner-Zielbereich. Die Abschaffung von
Kamera/Caption/SFX ist bewusst keine SQL-Migration (siehe unten).

## Stufen und Zielbereich

- `ScriptStatus`: `writing` -> `ready` -> `shot` -> `online`. „Idee" ist nur
  eine UI-Stufe (Ideen-Seite). Gesetzt über `api.setScriptStatus`
  (StageChip, Auswahl, ⌘⌥←/→ mit Undo-Toast); `status_changed_at` ändert sich
  nur bei echtem Wechsel, `updated_at` gar nicht.
- Zielbereich in Sekunden je Ordner oder global
  (`length_min_default_sec`/`length_max_default_sec`, leer = aus). Auflösung:
  Ordner -> Standard -> keiner (`resolveLengthRange`).

## Charaktere

Keine globale Tabelle. Beim Speichern liest `lib/scripts.ts` die Namen aus
den Charakter-Blöcken (`extractCharacterNames`), gleicht sie ohne
Groß-/Kleinschreibung mit `scripts.characters_meta` ab und behält vorhandene
Farben; neue Namen bekommen die nächste freie Palettenfarbe. Die app-weite
Farb-Registry `character_colors` wächst mit und lässt sich in den
Einstellungen aufräumen (manuell oder automatisch nach 4 s Ruhe,
`characterAutoPrune.ts`); das Löschen prüft die Nutzung erneut.

## Legacy-Blöcke

Die Node-Klassen für Kamera/Caption/SFX existieren nicht mehr. Jeder Lesepfad
(Editor, `lex.ts`, PDF, Plaintext, `.scriptz`-Import, Snapshot-Restore und
-Vorschau) normalisiert sie zu Action. `migrateLegacyBlocksOnce()` schreibt
beim Boot einmal alle Skripte um (`internalRewrite`: keine Wörter ins
Tageslog, `updated_at` bleibt). Das Flag `migration.legacy_blocks_v1` wird
nur nach vollständigem Lauf gesetzt. Snapshots bleiben unverändert.

## Datenfluss

- Editor -> 250 ms Debounce (`persistence.ts`) -> `api.updateScript`:
  `content_json`, FTS5, `characters_meta`, Runtime-Statistiken und positive
  Wort-Deltas ins `daily_word_log`. Ein Teardown-Flush mit leerem Editor
  überschreibt nie gespeicherten Inhalt.
- Editor, Titel und Ideen registrieren `content`-Flushes; Layout, Navigation,
  Fokus, Quick-Mode und Einstellungen sind `state`. Navigation, Export und
  Snapshots warten nur auf `content`.
- Änderungen an Stufe oder Ordnern bumpen `scriptsBus`/`foldersBus`;
  `libraryData` lädt neu, Sidebar, Listen und Inspector folgen.
- Auto-Snapshot alle 5 min bei ungespeicherten Änderungen, manuell ⌘⇧S,
  maximal 50 pro Skript.
- Suche (⌘K): `api.globalSearch` -> FTS5 BM25 -> Treffer mit `<mark>`.
- PDF: `exportPdf.ts` (pdf-lib, A4, Widow/Orphan) mit den TTFs aus
  `assets/fonts/` per `?url`; gespeichert über `PlatformAdapter.saveAs`.
