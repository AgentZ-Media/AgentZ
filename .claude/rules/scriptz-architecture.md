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
  (Inbox, Skripte, Ideen, Skript, Papierkorb), Sidebar, Overlays (QuickCapture,
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
`status_changed_at` und den Ordner-Zielbereich. `008_agent` legt
`agent_memory`, `agent_chats` und `agent_learned` an. Die Abschaffung von
Kamera/Caption/SFX ist bewusst keine SQL-Migration (siehe unten).

## Stufen und Zielbereich

- Stufen sind konfigurierbar (Einstellungen > Stufen, `lib/stages.ts`,
  Settings-Schlüssel `script_stages` als JSON `[{"id","label"?}]`, leer =
  Standard `writing` -> `ready` -> `shot` -> `online`). 2 bis 10 Stufen; neue
  Skripte starten auf der ersten, die letzte gilt als abgeschlossen.
  `scripts.status` speichert die Stufen-ID, Umbenennen und Umsortieren
  ändern keine Zeile. Eingebaute IDs ohne eigenen Namen folgen der Sprache,
  neue Stufen bekommen eine UUID. Entfernen verschiebt vorher alle Skripte
  (inkl. Papierkorb) per `api.reassignScriptStatus` auf die vorherige Stufe.
  Unbekannte IDs liest `lib/scripts.ts` als erste Stufe.
- Das Stufen-Symbol (`StageGlyph`, `stageGlyph(step, total)` aus
  `@agentz/design/icons`) füllt sich um `step / total`; die letzte Stufe ist
  das gefüllte Abschluss-Symbol. Überall Stufen über `scriptStages()` und
  `stageLabel()` lesen, nie feste IDs oder `stage.*`-Schlüssel.
- „Idee" ist nur eine UI-Stufe (Ideen-Seite). Gesetzt über
  `api.setScriptStatus` (StageChip, Auswahl, ⌘⌥←/→ mit Undo-Toast);
  `status_changed_at` ändert sich nur bei echtem Wechsel, `updated_at` gar
  nicht.
- Die letzte Stufe gilt als erledigt (`isFinalStage`). Die Inbox (Route
  `inbox`, ganz oben in der Sidebar und nur sichtbar, solange etwas offen ist)
  zeigt offene Ideen und alle Skripte davor (`library.inProgress`). Eigene
  Stufen brauchen dort keine Anpassung.
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

## Agent

Persönlicher Schreib-Agent mit eigenem Namen, Look und Persona. Visuelle
Referenz: `docs/agent/screens.html`.

- **Provider-neutral.** `lib/agent/types.ts` definiert `AgentProvider`,
  `AgentThread` und `AgentEvent`. Einzige Integration heute:
  `lib/agent/codex/` spricht JSON-RPC mit `codex app-server` über
  `services.codexHost` (`@agentz/desktop`, Rust in
  `crates/agentz-desktop/src/codex.rs`, Permission `agentz-desktop:codex`).
  Weitere Provider (OpenRouter, lokal) implementieren nur dieses Interface.
- **Codex isoliert.** Start mit `web_search="live"`, Shell, Apps, Plugins,
  Sub-Agenten und Codex-Gedächtnis per `features.*=false` aus, MCP-Server des
  Users pro Thread deaktiviert, Sandbox `read-only`, Freigaben werden
  abgelehnt. Der Agent sieht nur die eigenen Tools aus `lib/agent/tools.ts`.
  `code_mode_host` nicht abschalten.
- **Nur Vorschläge.** `propose_options` liefert 1 bis 3 Optionen, eingefügt
  per Klick über `components/Agent/editorBridge.ts` in die normale
  Lexical-History (⌘Z). Ziele tragen den Text der Zielblöcke als Anker
  (`anchorTarget`/`resolveTarget`): verschobene Zeilen werden nachgeführt,
  geänderte oder mehrdeutige abgelehnt. Nach dem Einfügen sind die übrigen
  Optionen gesperrt.
- **Chats speichern** seriell und über einen `state`-Flusher
  (`agent-chats`), damit Schließen auf eingefügte Optionen wartet. „Neuer
  Chat" speichert einen leeren Chat als Grenze. Als gelernt markiert wird nur
  nach einem abgeschlossenen Lern-Turn.
- **Gedächtnis** (`lib/agent/memory.ts`, Tabelle `agent_memory`): global,
  pro Ordner, Charakter (Grundprofil plus Ordnerversion) und Beziehung.
  Einträge sind gedeckelt (`MEMORY_LIMITS`). Pro Thread wird ein Schnappschuss
  in die Instruktionen eingefroren. Lernen ist immer optional: aus dem Chat
  (abschaltbar), aus abgeschlossenen Skripten nach `agent.learn_since` und
  90 s Ruhe, rückwirkend nur per Button. Gedächtnis ist nicht Teil des
  `.scriptz`-Exports.
- **Chats** pro Skript in `agent_chats` (`items_json`), Lernstand in
  `agent_learned` (Inhalts-Hash). Rohes JSON wird nie angezeigt; Tool-Aufrufe
  laufen über `components/Agent/labels.ts`.
- **Settings** unter `agent.*` (siehe `stores/agentSettings.ts`), Effort
  überall standardmäßig `medium`. `agent.enabled = false` startet keinen
  Prozess.

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
