# Lokale Speicherung und Vorbereitung der Synchronisierung

Die App arbeitet weiterhin ausschließlich mit ihrer lokalen SQLite-Datenbank.
Es gibt weder eine Convex-Verbindung noch Konten, Uploads, zusätzliche Timer oder
Netzwerkanfragen. Editor, Flush-Koordinator, Export und Einstellungen behalten
ihren bisherigen Ablauf. Diese Änderung ist die lokale Grundlage für eine
spätere Synchronisierung, keine fertige Synchronisierung.

## Schnittstellen

`modules/scriptz/lib/storage.ts` definiert `ScriptzStorage`. Die `api`-Fassade
leitet Aufrufe an den aktuell registrierten Adapter weiter. Der Desktop nutzt
weiter den SQL-Adapter. Zwei Teilbereiche ergänzen den bestehenden Vertrag:

- `agent: AgentStorage`: Chat-Verläufe, Gedächtnis einschließlich Charakterprofilen
  und Beziehungen sowie Lernmarkierungen. Die bestehenden Agenten-Funktionen
  behalten Validierung, Normalisierung und UI-Benachrichtigungen. Nur die
  Datenbankzugriffe sind in `agent/sqlStorage.ts` gekapselt.
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
| Ideen einschließlich Notizen und Verknüpfungen | `ideas` |
| Automatische und manuelle Skriptversionen | `snapshots` |
| App-weite Charakterfarben | `character_colors` |
| Alle gespeicherten Agenten-Chats, auch frühere Chats | `agent_chats` |
| Agenten-Gedächtnis, Charakterprofile und Beziehungen | `agent_memory` |
| Lernstand des Agenten | `agent_learned` |
| Bestehende tägliche Schreibstatistik | `daily_word_log` |

Charaktere bleiben wie bisher Teil des Skriptinhalts; eine neue globale
Charaktertabelle entsteht nicht. `settings`, `app_state` und der aus Inhalten
neu aufbaubare FTS-Suchindex sind ausgeschlossen. Die Testabdeckung gleicht diese
Liste mit dem tatsächlichen Datenbankschema ab.

## Atomare Änderungsverfolgung

Migration `009_local_changes.sql` ergänzt zwei Tabellen und SQLite-Trigger.
Alle veröffentlichten Migrationen und bisherigen Inhaltstabellen bleiben
unverändert. Bereits vorhandene Datensätze erhalten initial einen Marker;
ihr Inhalt, ihre IDs und Zeitstempel werden dabei nicht umgeschrieben.

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
Transaktion. Eine spätere Übertragung muss diese Abläufe und ihre Abhängigkeiten
berücksichtigen; die aktuelle Änderung verspricht keine atomare Übertragung
einer gesamten Benutzeraktion.

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
keine Zeitstempel oder Cloud-Versionen. Ein späterer Cloud-Empfänger muss diese
IDs zur wiederholbaren Verarbeitung verwenden.

Metadaten und Inhalte werden in einem einzigen SQLite-SELECT gelesen. Dadurch
passen Marker und Inhalt auch bei gleichzeitigem Speichern zusammen. Die
Seitengröße wird vor dem Laden der Inhalte begrenzt (Standard 100, maximal
1.000 Datensätze). Große Chats können dennoch große Seiten ergeben; ein
späterer Transport braucht zusätzlich eine Begrenzung nach übertragenen Bytes.
Ändert sich ein schon gelesener Datensatz erneut, erhält er eine höhere Sequenz
und erscheint wieder hinter dem bisherigen Cursor.

Der Feed ist eine zusammengefasste Sicht auf aktuelle Datensätze und Löschungen,
kein vollständiges Bearbeitungsprotokoll und keine über mehrere Seiten
festgehaltene Momentaufnahme. Abhängige Datensätze müssen beim späteren Empfang
entsprechend behandelt werden.

## Grenze zur späteren Convex-Anbindung

Die folgenden Aufgaben gehören ausdrücklich zur anschließenden Anbindung:

- Anmeldung, Kontozuordnung und getrennte Checkpoints je Konto und lokaler
  Datenbank; vorhandene Daten dürfen bei einem Kontowechsel nicht automatisch
  einem anderen Konto zugeordnet werden.
- Erstabgleich und fortsetzbare Übertragung. Ein Cursor darf erst nach
  bestätigter Annahme der zugehörigen Änderungen fortgeschrieben werden.
- Gesonderte Serverrevisionen als Grundlage für Konflikterkennung; lokale
  Sequenzen oder `updated_at` allein bestimmen keinen Gewinner.
- Eingehende Änderungen mit sauberem lokalen Schreibweg, aktualisierter Suche
  und UI sowie Vermeidung einer endlosen Rückübertragung.
- Löschkonflikte, Aufbewahrung und sichere Bereinigung von Tombstones.
- Gerätebezogene Interpretation der Schreibstatistik, damit Werte verschiedener
  Geräte nicht überschrieben oder doppelt gezählt werden.
- Provider-Thread-IDs in Chats sind lokale Fortsetzungsinformationen; kopierter
  Chatinhalt macht einen lokalen Provider-Thread nicht auf anderen Geräten
  verfügbar.
- Behandlung geklonter oder wiederhergestellter Datenbanken: die lokale UUID
  reist mit der Datenbank. Zwei gleichzeitig verwendete Kopien dürfen nicht
  dieselbe Remote-Replikatidentität beanspruchen; die spätere Anbindung muss
  diesen Fall erkennen und gegebenenfalls eine neue Identität samt Erstabgleich
  vergeben.

Die bestehenden `.scriptz`-Importe und -Exporte bleiben unverändert. Sie sind
weiterhin Einzel-Skript-Dateien, kein Backup aller Agentendaten. Lokale
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
Spaltenabdeckung, Änderungsseiten, Neustarts, wiederholtes Speichern, Undo,
Löschungen und Kaskaden sowie Rollback bei Fehlern. Separate Agenten-Tests prüfen
Chat-Wiederherstellung, frühere Chats, Gedächtnisgrenzen und Adapterwechsel.
Die regulären Editor-, Export- und Flush-Tests bleiben unverändert.
