---
paths:
  - "apps/scriptz/src/**"
  - "apps/scriptz/src-tauri/**"
  - "modules/scriptz/**"
---

# ScriptZ: Architektur

Allgemeine Regeln stehen in [`apps/scriptz/AGENTS.md`](../../apps/scriptz/AGENTS.md),
Suite-Grenzen in [`suite-architecture.md`](suite-architecture.md).

## Aufbau des Moduls

- `module.tsx`: `scriptzModule.setup(ctx)` startet Produkt-Settings,
  Navigation, Layout und Bibliothekspräferenzen, seedet das Welcome-Skript,
  füllt Runtime-Statistiken nach (`lib/runtimeBackfill.ts`: nach einer
  Formeländerung einmal alle Skripte, Flag `migration.runtime_stats_v2`),
  migriert Legacy-Blöcke und startet erst
  danach Ideen-, Statistik- und Bibliotheks-Resources. Liefert Routen
  (Inbox, Skripte, Ideen, Skript, Papierkorb, Agent-Modus), Sidebar, Overlays
  (QuickCapture, Neues Skript, Export, Stufen-Undo), Befehle, Shortcuts,
  Einstellungen, Onboarding.
- `lib/`: `api.ts` ist ein Proxy auf den registrierten `ScriptzStorage`
  (`registerSqlStorageAdapter()` installiert den SQL-Default). Fachlogik:
  `scripts.ts`, `folders.ts`, `snapshots.ts`, `search.ts`/`fts.ts` (FTS5),
  `lex.ts`, `runtime.ts`/`timing.ts` (gleiche Formel), `lengthGoal.ts`,
  `legacyBlocks*.ts`, `exportPdf.ts`, `scriptzFile.ts`, `*Bus.ts`.
- `components/Editor/`: Lexical-Mount, vier Nodes, Plugins (smartEnter,
  blockHotkeys, parentheticalLive, Picker, Autocomplete, inlineFormat,
  allcaps, highlight, colorPicker), `persistence.ts`.
- `components/Common/`: Widgets, die mehrere Bereiche nutzen
  (`ContextMenu`, `FolderMenu`, `PromptDialog`, `folderColor`, Auswahl mit
  `SelectionBar`, `SelectCheck`, `selection.ts` und `createListSelection`),
  dazu `motion`, `StageGlyph` und `keyboard.ts`. Ein Widget eines einzelnen
  Bereichs bleibt in dessen Ordner.
- `stores/`: `nav.ts` (Routen, „Zuletzt" für ⌘K, Kodierung von
  `nav.state`), `open.ts` („Offen"-Liste der Sidebar, `nav.open`),
  `peek.ts` (Seitenpanel der Listen), `ui.ts` (Inspector, Zeitleiste,
  Fokus, Quick-Mode, Produktdialoge, `ui.layout`, eingeklappte
  Sidebar-Bereiche `sidebar.sections`), `settings.ts` (Produkt-Settings),
  `ideas`, `dailyStats`.
- `i18n/`: Produktkataloge, mit dem Kit-Katalog komponiert.

Theme, Sprache, Updater-Flags, Navigation-Historie, Shell und Dialoge gehören
dem Kit. Die Listen-Seiten haben oben nur einen leeren Streifen (`PageBar`):
Fensterziehfläche und, bei ausgeblendeter Sidebar, der Button zum
Einblenden. Filter, Ansicht, Gruppierung, Sortierung und Auswahl stehen in
der Werkzeugzeile direkt über der Liste. Nur das Skript hat eine echte
Kopfleiste. Vor/Zurück gibt es nur als ⌘[ / ⌘]. Im Skript genügen ⌘\ und
die Befehlspalette, deshalb setzt das Modul `revealsSidebar: true`.

## Arbeitsbereich: Offen, Seitenpanel, Board

- **Offen** (Sidebar, unter Pipeline und Ordnern, beide einklappbar): jedes
  Skript, das die volle Skriptansicht zeigt, kommt dazu und bleibt bis zum
  Schließen (✕, Mittelklick, Kontextmenü). Bewusst keine Tab-Leiste oben.
  Neu geöffnete Skripte stehen oben; bereits offene behalten beim Wechseln
  ihren Platz. Bei maximal 50 Einträgen fällt das älteste unten heraus.
  Mit `close_finished_scripts` (Standard an) verlässt ein Skript die Liste,
  wenn es in die letzte Stufe wechselt; das angezeigte erst beim Wechsel,
  Rückgängig innerhalb von 15 s holt es zurück (`openStore.syncStatuses`).
- **Seitenpanel**: Mit `open_scripts_in_panel` (Standard aus) öffnet ein
  Klick in Liste oder Board das Skript rechts neben der Liste, sonst in der
  großen Ansicht; ⌥-Klick macht jeweils das andere. Es
  ist ein vollwertiger `ScriptScreen` mit `peek` (ohne Inspector, Fokus
  und Agent). Nur Großöffnen nimmt es in „Offen" auf. Es gibt nie zwei
  `ScriptScreen` gleichzeitig.
- **Board**: Inbox, Alle Skripte und Ordner wählen Liste oder Board
  (`library.mode` je Seite). Spalten: offene Ideen, dann die Stufen in
  ihrer Reihenfolge (Inbox ohne die letzte). Karte ziehen setzt die Stufe
  (Undo-Toast), eine Idee auf eine Stufe wird zum Skript.

## Migrationen

`001_baseline` bis `015_sync_newer_versions` in
`apps/scriptz/src-tauri/migrations/` sind veröffentlicht und unveränderlich. `007` ergänzt `scripts.status`,
`status_changed_at` und den Ordner-Zielbereich. `008_agent` legt
`agent_memory`, `agent_chats` und `agent_learned` an. `009_local_changes`
ergänzt eine lokale Replikat-ID und kompakte Änderungsmarker mit Triggern für
alle Inhaltstabellen, einschließlich Agentendaten; keine Cloud-Anbindung.
Vertrag und Grenzen: [`local-storage.md`](../../docs/local-storage.md).
`010_agent_sessions` ergänzt `agent_chats.kind`/`title`/`folder_id`
(Sitzungen des Agent-Modus) und `ideas.source_chat_id` (Idee von Ida
gespeichert), rein additiv, plus den Trigger `agent_sessions_outlive_script`:
endgültiges Löschen eines Skripts löst Sitzungen atomar davon, statt sie per
Kaskade mitzulöschen. `011_track_agent_sessions` nimmt diese Spalten in die
Update-Trigger des Änderungsfeeds auf. `012_agent_learned_text` ergänzt
`agent_learned.learned_text` (zuletzt gelernter Text) samt Update-Trigger.
`013_large_library_indexes` ist rein additiv: ein Covering-Index über alle
Spalten der Skriptliste (`idx_scripts_summary`, sie liegen in der Zeile hinter
`content_json`), Indizes für Ordnerzählung und Löschpfade sowie
`scripts_fts_map`, die jedem Skript eine feste rowid im Suchindex gibt
(`lib/fts.ts` löscht darüber statt per Vollscan über `script_id`). Eine neue
Spalte der Skriptliste gehört in eine neue Migration mit erweitertem
Covering-Index (`lib/__tests__/queryPlans.test.ts` schlägt sonst fehl).
`014_cloud_sync` ist rein additiv: `sync_records` (Buchführung der
Synchronisierung, keine Inhaltstabelle) und `daily_word_log_remote`
(Schreibstatistik anderer Geräte). `015_sync_newer_versions` ergänzt
`sync_records.extra` und `sync_parked`: Felder und Datensätze neuerer
App-Versionen bleiben erhalten, bis ein Update sie kennt.
Jede neue Spalte einer Inhaltstabelle braucht dasselbe: Trigger neu anlegen
und `CONTENT_ENTITIES` ergänzen (Tests in `lib/__tests__/localChanges.test.ts`
schlagen sonst fehl). Die Umwandlung von Kamera/Caption/SFX in Action ist bewusst keine SQL-Migration
(siehe unten).

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
  Stufen brauchen dort keine Anpassung. Bei Gruppierung nach Stufe trägt nur
  der Gruppenkopf das Stufen-Symbol. Ideen stehen als kompakte Zeilen
  darunter: die neuesten 10, zweispaltig (`library.inboxIdeas`, zeilenweise
  links, rechts) 20, der Rest hinter „weitere anzeigen“; ein Filter zeigt
  alle Treffer.
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

## Papierkorb

„Löschen“ setzt `scripts.archived_at`. Nach 30 Tagen
(`TRASH_RETENTION_DAYS`) löscht `lib/trashAutoPurge.ts` den Eintrag
endgültig (kurz nach dem Start, dann stündlich, `api.purgeExpiredTrash`);
jede Zeile im Papierkorb zeigt die verbleibenden Tage. Mit Konto folgt die
Cloud über den Änderungsfeed.

## Färbung, Hook und Bewegung

- **Eine Färbe-Regel** (`lib/tint.ts`) für Editor (`plugins/highlight.ts`),
  PDF und Export-Vorschau: Charakter in eigener Farbe, Dialog und
  Parenthetical in der Farbe darüber, ein Action-Block beendet den
  Sprechlauf. Wem Wörter für Statistik und Zeitleiste zugerechnet werden,
  regeln `lex.ts`/`timing.ts`.
- **Hook-Zonen** 3 / 5 / 10 s ab dem ersten Dialog, Regie davor zählt nicht
  (`timelineMath.ts`: `firstDialogStart`, `hookMarks`). Sichtbar nur als
  ruhige Markierung: Balken im linken Papierrand (`Script/HookMarks.tsx`)
  und gestufte Zonen in der Zeitleiste.
- **Bewegung** über `components/Common/motion.tsx`/`motion.css`
  (Zahl-Tween, rollende Zähler `BumpNumber`, Flug in die Seitenleiste,
  Aufleuchten, View Transition beim Öffnen). Kurven und Dauern kommen aus
  den Bewegungs-Tokens des Designs (`--spring`, `--ease-out`, `--t-glide`
  usw.). Reduzierte Bewegung schaltet alles ab. Der Fertig-Moment
  (Symbol springt, Lichtring, Punkt-Feuerwerk, Textmarker über dem Titel)
  hängt an `library.justFinished(id)`.
- **Schreibmaschine im Fokus** (`focus_typewriter`, Standard aus): die
  Caret-Zeile bleibt mittig, andere Sprechläufe treten zurück; nur
  DOM-Attribute (`data-tw-current`), nie Editor-State.
- **Rückgängig in Toasts**: `pushToast(text, kind, timeout, { action })`
  aus dem Kit. Papierkorb, Verschieben (Skripte und Ideen) und Ideen
  löschen (`api.restoreIdea`) nutzen es.

## Legacy-Blöcke

Für Kamera/Caption/SFX gibt es keine Node-Klassen. Jeder Lesepfad
(Editor, `lex.ts`, PDF, Plaintext, `.scriptz`-Import, Snapshot-Restore und
-Vorschau) normalisiert sie zu Action. `migrateLegacyBlocksOnce()` schreibt
beim Boot einmal alle Skripte um (`internalRewrite`: keine Wörter ins
Tageslog, `updated_at` bleibt). Das Flag `migration.legacy_blocks_v1` wird
nur nach vollständigem Lauf gesetzt. Snapshots bleiben unverändert.

## Agent

Persönlicher Schreib-Agent mit eigenem Namen, Look und Persona.

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
- **Nur in der großen Skriptansicht.** Im Seitenpanel gibt es weder Chat
  noch Agent-Button noch Rechtsklick-Menü; `Mod+L` öffnet den Chat nur, wenn
  `navStore.activeScriptId()` gesetzt ist (große Ansicht), sonst den
  Agent-Modus.
  Der Chat startet in jedem Skript geschlossen und merkt sich nur für die
  Sitzung, in welchen Skripten er offen ist (`agentUi.chatOpen(scriptId)`).
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
  90 s Ruhe, rückwirkend nur per Button. Ein schon gelerntes Skript lernt er
  erst nach einer nennenswerten Änderung erneut (`lib/agent/learnChange.ts`:
  ein Zehntel der Wörter, mindestens 6, höchstens 25, oder eine neue Figur);
  der Lern-Turn bekommt dann die neuen Zeilen als Ausschnitt. Sichtbar ist
  das Lernen in Sidebar und Chat-Kopf („lernt gleich aus …“ während der
  Ruhezeit, „lernt aus …“ währenddessen), danach als Toast mit dem Weg in den
  Chat des Skripts und als Abschnitt „Lernstand“ im Inspector. Als
  abgeschlossen gilt ein Skript ab der Lern-Stufe `agent.learn_stage` (leer =
  letzte Stufe, spätere Stufen zählen mit, `lib/agent/learnStage.ts`). Eine gewählte Stufe liegt immer
  zwischen erster und letzter: Wird sie gelöscht, rückt sie auf die nächste
  vor; landet sie vorn oder hinten, gilt wieder der Standard. Unbekannte IDs
  fallen beim Lesen auf die letzte Stufe zurück. Gedächtnis ist nicht Teil des
  `.scriptz`-Exports.
- **Storage-Grenze:** `agent/chats.ts` und `agent/memory.ts` delegieren an
  `ScriptzStorage.agent`; SQL liegt in `agent/sqlStorage.ts`.
- **Chats** pro Skript in `agent_chats` (`items_json`), Lernstand in
  `agent_learned` (Inhalts-Hash und gelernter Text). Rohes JSON wird nie
  angezeigt; Tool-Aufrufe laufen über `components/Agent/labels.ts`.
- **Settings** unter `agent.*` (siehe `stores/agentSettings.ts`), Effort
  überall standardmäßig `medium`. `agent.enabled = false` startet keinen
  Prozess.
- **Aufträge** (`lib/agent/jobs.ts`): Einstieg prüfen, Kürzen, Tempo
  erhöhen, Härteres Ende, Fakten prüfen, Feedback. Der Chat zeigt nur das
  kurze Label, das Modell bekommt die englische Instruktion. Vier Türen,
  kein Knopf in der Kopfleiste: Karten im leeren Chat, Chips am Problem
  (Einstieg-Chip über der Eröffnung, Kürzen/Tempo an der zu langen Länge in
  der Zeitleiste), Rechtsklick (inkl. „Mehr wie {Figur}“) und ⌘K.
- **Karten zeigen vorher, was passiert** (`Agent/proposalMetrics.ts`):
  Laufzeit gegen den Zielbereich, Sprecherwechsel, längste Zeile und beim
  Einstieg „Konflikt nach X s“ (`propose_options` mit optionalem
  `conflict_block`/`current_conflict_block`). Hover zeigt den Vorschlag
  gestrichelt im Papier (`editorBridge.showProposalPreview`, nur Attribute
  und Overlay). Eingefügte Zeilen leuchten kurz auf (`data-ag-new`).
- **Faktencheck im Text** (`Agent/ClaimMarks.tsx`): die Behauptungen des
  letzten Checks werden per CSS Custom Highlight API unterstrichen und
  nummeriert, solange der Chat offen ist.
- **Kontext Länge.** Der Skript-Chat bekommt Längenziel und Sprechtempo in
  den Instruktionen, Sitzungen vor jeder Nachricht eine Zeile `[Session: ...]`
  mit Ordner, Ziel, Wortbudget, Entwürfen samt gemessener Laufzeit und
  gespeicherten Ideen (`lib/agent/writingContext.ts`, gleiche Formel wie die
  Zeitleiste).
- **Laufzeiten rechnet nur die App.** `get_current_script`, `read_script`
  und `list_scripts` liefern `runtime` nach `lib/runtime.ts` mit der WPM aus
  den Einstellungen. Der Prompt verbietet dem Modell, selbst Wörter zu
  zählen oder Laufzeiten zu nennen, die es nicht von der App hat; zu einem
  gerade geschriebenen Entwurf nennt es keine Zeit, die zeigt das Panel.

## Agent-Modus

Eigene Route `agent` (`components/AgentMode/`). Einstieg oben in der
Sidebar, `Mod+L` außerhalb eines Skripts, `Mod+Shift+L` überall, ⌘K, Ideen-Seite
(„Ideen mit Ida finden“, „Mit Ida ausschreiben“).

- **Sitzungen** sind Zeilen in `agent_chats` mit `kind = 'session'`; eine neue
  Sitzung wird erst mit der ersten Nachricht gespeichert. `stores/agent.ts`
  (Teile unter `stores/agent/`) hält jeden Chat genau einmal (`byScript`/`byChat`
  in `stores/agent/registry.ts`): das Panel löst seinen
  Chat über `sessionFor(scriptId)` (neueste Zeile zuerst) auf, damit Panel,
  Agent-Modus und Lernen dasselbe Objekt und dieselbe Schreibwarteschlange
  nutzen. Gelöschte Skripte und Ordner gleicht `reconcileLiveChats` nach;
  Löschen einer Sitzung läuft über `discard()`.
- **Ideen-Karten** über `propose_ideas`, Speichern nur auf Wunsch (Button oder
  `save_ideas`) mit Quittung und Rückgängig; gespeicherte Ideen tragen
  `source_chat_id`. Antwortvorschläge über `suggest_replies`.
- **Entwürfe** brauchen kein Tool und keine Tabelle: der Agent schreibt einen
  Block `:::draft id="…" title="…" idea="…"` in seine Antwort, der live ins
  Entwurfs-Panel gestreamt wird (`lib/agent/drafts.ts`). Gleiche `id` = neue
  Version, Änderungen gegenüber der Vorversion sind markiert. Verworfen und
  übernommen stehen als Chat-Einträge (`draft-discarded`, `handoff`) im
  Verlauf.
- **Fertig** legt über den Dialog ein normales Skript an (Ordner, Stufe, Idee
  als umgesetzt, `api.markIdeaUsed`). „Gespräch mitnehmen“ hängt die Sitzung
  an das Skript (`attachToScript`): ab dann ist sie dessen Chat, der
  Codex-Thread wird mit Skript-Instruktionen und -Tools neu geladen
  (`thread/unsubscribe`, dann `thread/resume`). Der Agent legt nie selbst
  Skripte an.

## Datenfluss

- Editor -> 250 ms Debounce (`persistence.ts`) -> `api.updateScript`:
  `content_json`, FTS5, `characters_meta`, Runtime-Statistiken und positive
  Wort-Deltas ins `daily_word_log`, alles aus einem einzigen Parse des
  Dokuments. Ein Teardown-Flush mit leerem Editor überschreibt nie
  gespeicherten Inhalt.
- Ein Autosave meldet sich über `scriptSavedBus` mit der neuen Zusammenfassung:
  `libraryData` und das offene Skript ersetzen nur diese eine Zeile, Lernen und
  Export-Vorschau folgen. `scriptsBus` bleibt für Änderungen an der Liste
  (anlegen, Stufe, Ordner, Umbenennen, Papierkorb) und lädt neu; dabei behält
  `keepUnchanged` die Objekte unveränderter Zeilen, damit Listen nur geänderte
  Zeilen neu rendern. Seiten lesen Skripte und Ordner aus `library`, keine
  eigenen `listScripts`/`listFolders`-Abfragen.
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

## Synchronisierung

Konto und Abgleich gehören dem Kit ([`cloud-sync.md`](../../docs/cloud-sync.md)).
ScriptZ liefert `lib/sync/adapter.ts` (Tabellen, Reihenfolge, Fremdschlüssel,
Konfliktkopien für Skripte und Ideen, `SYNCED_SETTINGS`) und `stores/sync.ts`
(Busse, Agent-Store, Settings neu laden). Eingehende Skripte laden ein offenes
Skript über `remoteScriptBus` neu. Im Sidebar-Fuß sitzt der Konto-Button des
Kits an der Stelle des Schreibzählers; die Aktivität bleibt über ⌘K erreichbar.
Der letzte Onboarding-Schritt fragt „nur dieses Gerät“ oder „Anmelden oder
kostenlos registrieren“.
