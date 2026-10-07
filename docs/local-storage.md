# Lokale Speicherung und Änderungsfeed

Die App arbeitet immer mit ihrer lokalen SQLite-Datenbank. Die hier
beschriebene Änderungsverfolgung ist die lokale Grundlage der
Cloud-Synchronisierung; Konto, Verschlüsselung und Abgleich beschreibt
[`cloud-sync.md`](cloud-sync.md). Ohne Anmeldung gibt es keine Uploads.

## Schnittstellen

`modules/scriptz/lib/storage.ts` definiert `ScriptzStorage`. Die `api`-Fassade
leitet Aufrufe an den aktuell registrierten Adapter weiter. Der Desktop nutzt
den SQL-Adapter. Neben den Inhaltsfunktionen enthält der Vertrag zwei
Teilbereiche:

- `agent: AgentStorage`: Chat-Verläufe einschließlich der Sitzungen des
  Agent-Modus (`getChat`, `deleteChat`, `listSessions`), Gedächtnis
  einschließlich Charakterprofilen und Beziehungen sowie Lernmarkierungen.
  Validierung, Normalisierung und UI-Benachrichtigungen liegen in den
  Agenten-Funktionen, nur die Datenbankzugriffe sind in
  `agent/sqlStorage.ts` gekapselt. Adapterneutral in `agent/chats.ts` bleiben
  das Wiederherstellen gespeicherter Einträge (`parseItems`) sowie Entwurfs- und
  Sitzungszusammenfassungen; ein weiterer Adapter liefert nur Datensätze.
- `localChanges: LocalChangeStore`: liest die lokale Datenbankidentität und
  seitenweise Änderungen. Dieser Vertrag setzt kein bestimmtes Cloud-System
  voraus. Er verändert weder Inhalte noch einen Synchronisierungsstatus.

Der produktneutrale `KvStore` für Einstellungen und `app_state` bleibt getrennt.
Ein alternativer Speicheradapter muss beide Teilbereiche ausdrücklich anbieten.
Es gibt keinen versteckten Rückfall auf die Desktop-Datenbank.

## Umfang der erfassten Inhalte

| Inhalt | Tabelle |
|---|---|
| Skripte einschließlich Papierkorb, Stufe, Charakteren und zugeordneten Farben | `scripts` |
| Ordner und deren Zielbereiche | `folders` |
| Ideen einschließlich Notizen, Verknüpfungen und Herkunft aus einer Agenten-Sitzung | `ideas` |
| Automatische und manuelle Skriptversionen | `snapshots` |
| App-weite Charakterfarben | `character_colors` |
| Alle gespeicherten Agenten-Chats, auch frühere Chats, und Sitzungen des Agent-Modus mit Titel, Ordner und Entwürfen | `agent_chats` |
| Agenten-Gedächtnis, Charakterprofile und Beziehungen | `agent_memory` |
| Lernstand des Agenten | `agent_learned` |
| Tägliche Schreibstatistik | `daily_word_log` |

Charaktere sind Teil des Skriptinhalts; es gibt keine globale
Charaktertabelle. `settings`, `app_state` und der aus Inhalten
neu aufbaubare FTS-Suchindex samt seiner rowid-Zuordnung (`scripts_fts_map`)
sind ausgeschlossen. Die Testabdeckung gleicht diese
Liste mit dem tatsächlichen Datenbankschema ab.

## Atomare Änderungsverfolgung

Migration `009_local_changes.sql` ergänzt zwei Tabellen und SQLite-Trigger,
die Struktur der Inhaltstabellen ändert sie nicht. Bereits vorhandene
Datensätze erhalten initial einen Marker;
ihr Inhalt, ihre IDs und Zeitstempel werden dabei nicht umgeschrieben.

Die Update-Trigger nennen ihre Spalten einzeln, damit Speichern mit
identischen Werten keinen Marker erzeugt. `010_agent_sessions.sql` ergänzt
Spalten an `agent_chats` und `ideas`; `011_track_agent_sessions.sql` legt die
beiden Update-Trigger mit diesen Spalten neu an, `012_agent_learned_text.sql`
ebenso für `agent_learned.learned_text`. **Jede künftige Spalte einer
Inhaltstabelle braucht dasselbe:** Trigger in einer neuen Migration neu anlegen
und `CONTENT_ENTITIES` (`lib/localChanges/entities.ts`) ergänzen. Die Tests
gleichen Tabellen, Spalten und Trigger mit dem vollständigen Schema ab und
schlagen sonst fehl. Entwicklungsdatenbanken, die `010` vor `009` erhalten
haben, enden nach `011` mit denselben Triggern.

`local_replica` enthält eine dauerhaft gespeicherte UUID für diese lokale
Datenbank. `local_changes` enthält je Inhaltstyp und Datensatz höchstens einen
Marker: eine monoton steigende lokale Sequenz und `upsert` oder `delete`.

Trigger schreiben den Marker innerhalb desselben SQLite-Statements wie die
Inhaltsänderung. Kann der Marker nicht geschrieben werden, wird auch die
Inhaltsänderung zurückgerollt. Das erfasst ebenfalls Fremdschlüssel-Kaskaden,
Entknüpfungen, automatische Bereinigungen und interne Umschreibungen. Reine
Updates mit identischen Werten erzeugen keine neue Änderung. Charakterfarben
verwenden entsprechend der bestehenden SQLite-NOCASE-Identität einen mit
SQLite `upper()` normalisierten Schlüssel.

Die Atomarität gilt für das einzelne SQL-Statement samt Triggern. Bestehende
Fachoperationen aus mehreren Statements werden dadurch nicht zu einer einzigen
Transaktion. Die Übertragung muss diese Abläufe und ihre Abhängigkeiten
berücksichtigen; der Änderungsfeed verspricht keine atomare Übertragung einer
gesamten Benutzeraktion.

Wiederholte Änderungen ersetzen den Marker des Datensatzes durch eine neue
Sequenz. Es wird kein zweites Exemplar des Skript- oder Chatinhalts gespeichert.
Löschungen hinterlassen einen kleinen Marker ohne Inhalt (Tombstone), auch bei
geleertem Papierkorb oder gelöschten alten Snapshots. Diese Marker werden vorerst
nicht entfernt. Der Platzbedarf richtet sich somit nach vorhandenen und seit
Migration gelöschten Datensätzen, nicht nach der Zahl der automatischen Saves.

## Lesen des lokalen Änderungsstands

`api.localChanges.readChanges({ afterSequence: 0, limit: 100 })` liefert:

- `formatVersion: 1` und `replicaId`;
- `changes` mit Inhaltstyp, ID, Sequenz, stabiler `changeId` und Operation;
- bei `upsert` die vollständige aktuelle Tabellenzeile, bei `delete` `null`;
- `nextCursor`: die letzte gelieferte Sequenz oder bei leerer Seite den
  übergebenen Cursor.

Die Änderung-ID ist `replicaId:sequence`. Solange sich ein Datensatz nicht
ändert, liefern wiederholte Abfragen dieselbe ID. Sequenzen sind lokal und
keine Zeitstempel oder Cloud-Versionen. Die Synchronisierung macht
Wiederholungen über den Inhalts-Hash unschädlich.

Metadaten und Inhalte werden in einem einzigen SQLite-SELECT gelesen. Dadurch
passen Marker und Inhalt auch bei gleichzeitigem Speichern zusammen. Die
Seitengröße wird vor dem Laden der Inhalte begrenzt (Standard 100, maximal
1.000 Datensätze). Große Chats können dennoch große Seiten ergeben; ein
Transport begrenzt deshalb zusätzlich nach übertragenen Bytes.
Ändert sich ein schon gelesener Datensatz erneut, erhält er eine höhere Sequenz
und erscheint wieder hinter dem bisherigen Cursor.

Der Feed ist eine zusammengefasste Sicht auf aktuelle Datensätze und Löschungen,
kein vollständiges Bearbeitungsprotokoll und keine über mehrere Seiten
festgehaltene Momentaufnahme. Abhängige Datensätze müssen beim Empfang
entsprechend behandelt werden.

## Nutzung durch die Synchronisierung

Der Sync-Adapter (`lib/sync/adapter.ts`) liest diesen Feed ab dem
hochgeladenen Cursor und schreibt eingehende Datensätze mit eigenen Upserts
(nie `INSERT OR REPLACE`, das würde Kaskaden auslösen). Die Trigger erfassen
auch diese Schreibvorgänge; die Engine erkennt sie am unveränderten
Inhalts-Hash und lädt sie nicht erneut hoch. Für den Abgleich gilt:

- Cursor und Buchführung gehören zu Konto, Schlüssel und Gerät
  (`app_state.sync.state`, Tabelle `sync_records`, Migration 014). Ein anderes
  Konto übernimmt die Daten nur nach Rückfrage.
- Ein Cursor rückt erst nach bestätigter Annahme vor; Konflikte erkennt die
  Cloud-Revision, nicht `updated_at` oder die lokale Sequenz.
- Abhängige Datensätze werden in Reihenfolge `folders`, `scripts`,
  `agent_chats`, `ideas`, `snapshots`, `agent_memory`, `agent_learned`,
  `character_colors` geschrieben, Löschungen umgekehrt.
- Tombstones bleiben lokal und in der Cloud erhalten.
- Die Schreibstatistik synchronisiert pro Gerät (`daily_word_log_remote`).
- Provider-Thread-IDs bleiben lokal.
- Eine geklonte oder wiederhergestellte Datenbank trägt die Geräte-ID der
  Synchronisierung mit; zwei gleichzeitig benutzte Kopien teilen sich dann
  deren Schreibstatistik.

`.scriptz`-Importe und -Exporte sind Einzel-Skript-Dateien, kein Backup aller
Agentendaten. Lokale
Änderungsmarker und Replikatidentität gehören nicht in dieses Austauschformat;
importierte Skripte werden über ihre normalen Schreibwege erfasst.

## Prüfung

### Ausführung und Wiederanlauf der Migration

Die in `Cargo.lock` gebundenen Versionen sind `tauri-plugin-sql 2.4.0` und
`sqlx-sqlite 0.8.6`. Der SQLite-Migrator (`sqlx-sqlite/src/migrate.rs`,
`Migrate::apply`) führt das gesamte Migrationsskript und den erfolgreichen
Versionsvermerk in `_sqlx_migrations` in **derselben Transaktion** aus. Erst
danach wird committed. Ein Fehler oder Prozessabbruch vor dem Commit lässt
somit keinen erfolgreich verbuchten Teilstand der Migration zurück. Beim
nächsten App-Start kann die noch nicht verbuchte Migration erneut laufen;
nach erfolgreichem Commit wird sie anhand von Version und Prüfsumme erkannt.
Die anschließend separat geschriebene Ausführungsdauer ist nur Diagnosemetadatum.

Das SQL-Plugin veröffentlicht den Pool sowohl beim Vorladen als auch im
`load`-Command erst nach erfolgreichem `migrator.run`. Reguläre App-Zugriffe
erhalten daher keinen Pool mitten in der Installation. SQLite serialisiert
Schreibtransaktionen; zusätzlich verwendet der Desktop-Host das
Single-Instance-Plugin. Das ist keine Freigabe für parallele externe
Datenbankwerkzeuge während eines Upgrades. Nach einem fehlgeschlagenen Laden
ist ein App-Neustart der vorgesehene Wiederanlauf, kein erneutes `load` im
selben Prozess: Das Plugin entnimmt die Migrationen vor ihrer Ausführung aus
seiner internen Registrierung.

Diese Einordnung beruht auf der Prüfung des gebundenen Abhängigkeitscodes.
Die unten genannten SQLite-Tests prüfen Daten und Trigger; sie simulieren
keinen Prozessabbruch des Tauri-Hosts.

### Automatisierte Abdeckung

Integrationstests führen die echten Migrationen in isolierten SQLite-Datenbanken
aus. Sie prüfen die Übernahme bestehender Inhalte, vollständige Tabellen- und
Spaltenabdeckung samt Update-Triggern, beide Migrationsreihenfolgen,
Sitzungen und Ideen-Herkunft, Änderungsseiten, Neustarts, wiederholtes Speichern, Undo,
Löschungen und Kaskaden sowie Rollback bei Fehlern. Separate Agenten-Tests prüfen
Chat-Wiederherstellung, frühere Chats, Gedächtnisgrenzen und Adapterwechsel.
