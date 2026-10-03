# AgentZ Suite - Umsetzungsprotokoll

Details zu Umsetzung, Prüfung und offenen Nacharbeiten des
[Fundament-Plans](agentz-suite-fundament.md). Der Plan enthält die Architektur
und Phasen; dieses Protokoll hält die konkreten Ergebnisse fest.

## Umsetzungsstand (2026-10-03)

- **Phase 0, Code:** PR #19 ist gemergt; Ausgangscommit ist
  `852b20bc63e9de3d6e0ca45711dd5003d4503155`.
- **Phase 1, gemergt:** Web-App, alte Landing und überholte Regeln entfernt;
  Desktop-Schale von Web-Sonderfällen bereinigt, Root-Testbefehl und
  MIT-Lizenz ergänzt, Lockfile und aktive Dokumentation aktualisiert.
  Bundle-Identifier, Datenbankname, Migrationen und persistierte Schlüssel
  bleiben unverändert. PR #20 wurde am 2026-10-03 gemergt
  (`c189125c40a1c3a79a37d94780a11cf83fe1f630`).
- **Sicherung:** Vor Phase 1 konsistenter SQLite-Snapshot der lokalen
  Arbeitsdatenbank; `PRAGMA integrity_check` meldet `ok`.
- **Automatische Prüfung:** `pnpm install --frozen-lockfile`,
  `pnpm typecheck`, `pnpm test` (36 Dateien / 261 Tests) und
  `git diff --check` erfolgreich. Bekannte Warnungen der importseitigen
  Store-Initialisierung bleiben für Phase 4.0 offen.
- **Native Builds:** `pnpm build:desktop` erzeugt macOS-App und DMG,
  endet aber beim Signieren des Updater-Archivs mit einem Fehler:
  `TAURI_SIGNING_PRIVATE_KEY` ist lokal nicht gesetzt. Das ist keine
  erfolgreiche Release-Abnahme. Lokale Funktionsprüfung separat mit
  temporärer QA-App-ID und deaktivierten Updater-Artefakten; die
  eingecheckte Tauri-Konfiguration bleibt unverändert.
- **Native Funktionsprüfung:** Separater Release-Build mit
  `identifier=de.agent-z.scriptz.phase1-smoke`,
  `productName=ScriptZ Phase 1 QA` und `createUpdaterArtifacts=false`
  erfolgreich. Gegen eine Kopie der Arbeitsdatenbank getestet: vorhandenes
  Skript öffnen, neues Skript schreiben/speichern/erneut öffnen,
  Einstellungen, Ideen und Papierkorb anzeigen, PDF exportieren.
  Exportdatei geprüft: eine A4-Seite, erwarteter Text, eingebettete
  iA-Writer-Quattro-Schrift. `/tmp` ist durch die bestehende Dateifreigabe
  gesperrt; der Export im Benutzerordner funktioniert. QA-App beendet,
  Testtext in der isolierten DB gespeichert. Die produktive DB stimmt
  als logischer SQL-Dump mit der Sicherung vor dem Umbau überein.
  Windows-Build und signierter Update-Zyklus wurden nicht geprüft.
- **Rechtstexte für Phase 7:** Impressum und Datenschutz liegen im
  Ausgangscommit unter `apps/landing/src/pages/impressum.astro` bzw.
  `apps/landing/src/pages/datenschutz.astro`. Wiederherstellbar mit
  `git show <Ausgangscommit>:<Pfad>`; bei der neuen Website aktualisieren.
- **Historische Doku:** Dieser Plan und `docs/redesign/` enthalten bewusst
  noch alte Pfade als Ausgangslage. Der Verweis-Check aus Phase 1 gilt für
  aktive Quellen, Build-Konfiguration und aktuelle Anleitungen; diese
  historischen Dokumente und alte Release-Notes sind ausgenommen.
- **Extern offen:** Vercel-Projekte, Domains, Studio-Ressourcen und das
  GitHub-Secret `VERCEL_DEPLOY_HOOK_URL` wurden nicht verändert. Das
  Entfernen ihres Codes deaktiviert bestehende Deployments nicht.
### Phase 2: Umbenennen

- **Branch:** `fundament/phase-2`, aus dem gemergten `main` erstellt.
  Vor Beginn SQLite-Snapshot mit erfolgreichem Integritätscheck gesichert.
- **Historie:** Commit `c2cfab3` enthält ausschließlich 326 unveränderte
  Dateiverschiebungen (`R100`); alle Pfad- und Namensanpassungen folgen
  separat. App: `apps/scriptz` / `@agentz/scriptz-app`, Modul:
  `modules/scriptz` / `@agentz/scriptz`, Root-Paket: `agentz`.
- **GitHub:** Repository in `AgentZ-Media/AgentZ` umbenannt, Remote,
  Beschreibung, Homepage und Topics aktualisiert. Beide vorhandenen
  Updater-Secrets sind weiterhin vorhanden. Bestehender Release `v0.8.4`
  unverändert erreichbar und nicht unveränderlich; Immutability wurde
  nicht aktiviert. Der neue Updater-Endpunkt liefert das bestehende
  Manifest mit macOS-/Windows-Einträgen und Signaturen.
- **Release-Pfade:** Versionsnotizen unter `docs/release-notes/scriptz/`,
  gemeinsamer Install-Footer bleibt eine Ebene darüber. Workflow-Pfade
  angepasst; Tags bleiben bis Phase 6 `vX.Y.Z`.
- **Doku:** README und Root-CLAUDE auf Suite-Ebene aktualisiert;
  vorhandene und geplante Pakete ausdrücklich getrennt. Aktive Regeln,
  Links, Imports, Logo-Ausgabe und historische Font-URLs angepasst.
- **Prüfung:** Frozen-Install, Typecheck und 261 Tests erfolgreich.
  219 Quellcode-Dateien gegen Phase 1 verglichen: ausschließlich die
  vorgesehenen Pfad-/Namensersetzungen. Rust-Lockfile, Migrationen und
  Persistenz unverändert; Tauri-Konfiguration nur am Updater-Endpunkt
  geändert. Alle 23 Versionsnotizen unverändert erhalten.
- **Native Abnahme:** `pnpm build:scriptz` mit `--locked`, temporärer
  QA-App-ID und `createUpdaterArtifacts=false` erfolgreich; macOS-App und
  DMG erzeugt. Isoliert mit DB-Kopie geprüft: vorhandenes Skript öffnen,
  neues Skript schreiben/speichern/erneut öffnen, Einstellungen samt neuem
  Repository-Link, Ideen, Papierkorb und PDF-Export. Die PDF enthält eine
  A4-Seite mit dem erwarteten Text und eingebetteter iA-Writer-Schrift.
  QA-App beendet, Testinhalt dauerhaft in der Kopie gespeichert;
  produktive DB unverändert gegenüber dem Snapshot. Windows und
  signierter Update-Zyklus bleiben ungeprüft.
- **Review-Stand:** PR #21 am 2026-10-03 nach Freigabe gemergt
  (`628b25543689bcf62eb0fd29127449637368e5be`). Kein Release.
  Interne Gegenprüfung abgeschlossen ohne offene Befunde.
- **Buildcache:** Verschobene Cargo-Artefakte enthielten absolute alte
  Plugin-Pfade. Einmaliger `cargo clean` am neuen Manifest beseitigt diese;
  in der README als Hinweis für vorhandene Checkouts dokumentiert.
- **Lokale Ordner:** Der physische Haupt-Checkout und die T3-Worktree-
  Ordner bleiben während der aktiven Sessions an ihren bisherigen Orten.
  An dem Haupt-Checkout hängen mehrere Worktrees. Ein separater,
  koordinierter Umzug mit Reparatur ihrer Git-Verknüpfungen bleibt offen;
  die pfadgebundene Claude-Projekterinnerung wird dabei mitgenommen.
  Das beeinträchtigt die Suite-Struktur im Repository nicht.
- **Externe Altressourcen:** Vercel/Studio/alte Domains weiterhin offen
  wie bei Phase 1. Neue Domain nur als geplante Homepage eingetragen;
  noch keine Registrierung und kein Website-Deployment.

### Phase 3: Tooling-Fundament

- **Branch:** `fundament/phase-3`, im selben Worktree aus dem gemergten
  `main` erstellt. PR #22 am 2026-10-03 nach Review und grüner CI
  gemergt (`67a4e1da31f28a6e800d993ae156de25ba6f68f5`); kein Release.
- **JavaScript:** pnpm 10.34.6 mit zentralem Catalog. Bestehende direkte
  App-/Modul-Abhängigkeiten behalten exakt ihre aufgelösten Versionen.
  Root-TypeScript-Basis; `include`, Aliasse und Laufzeittypen bleiben
  paketlokal. Solid-/jsdom-Test-Preset unter `tooling/vitest-preset` mit
  eigenen Abhängigkeiten und individuellen Test-Overrides.
- **Grenzen:** ESLint 9 Flat Config mit Korrektheitsregeln und lokaler
  Architekturregel. Prüft auch Reexports, dynamische Imports, `require`,
  Typimporte und TS-Aliasse; neue Workspaces werden über ihre Manifeste
  erkannt. Farbprüfung für CSS/TSX mit deklarationsgenauen Ausnahmen für
  Charakterfarben. Bestehende Fehlermeldungsfarben in `Common.css` nutzen
  jetzt semantische Tokens. Allgemeine TS-Farbdaten und Test-Fixtures
  sind nicht Teil dieser UI-Prüfung.
- **Rust:** Root-Workspace und gemeinsames Release-Profil; `Cargo.lock`
  bytegleich verschoben. `crates/*` wird erst mit der ersten Crate in
  Phase 5 ergänzt, weil Cargo leere Workspace-Globs nicht akzeptiert.
  Gemeinsames `target/`; Release-Caches und `--locked` angepasst.
- **CI:** Neue PR-/Main-Pipeline mit JavaScript- und Linux-Rust-Prüfung.
  Reine Doku-Änderungen überspringen schwere Jobs; `CI passed` bleibt als
  eindeutige Sammelprüfung verfügbar. Externe Vercel-Altprojekte sind
  weiterhin separat offen.
- **Konventionen:** Neue Suite-Regel beschreibt Paketgrenzen, Ports,
  Modul-Vertrag und Regel der Zwei. Bestehende ScriptZ-Importinitialisierung
  und breite Subpath-Exporte bleiben ausdrücklich bis Phase 4 erhalten.
- **Lokal geprüft:** Frozen-Install, Lint, Typecheck, elf Tooling-Tests,
  261 ScriptZ-Tests, Farbprüfung, Frontend-Build und
  `cargo check --workspace --locked` erfolgreich. Interne Gegenprüfung
  abgeschlossen ohne offene Befunde.
- **Native Abnahme:** macOS-App und DMG erfolgreich mit temporärer
  QA-App-ID und deaktivierten Updater-Artefakten gebaut. Gesicherte
  Datenbankkopie verwendet; vorhandenes Skript geöffnet, neues Skript
  geschrieben, gespeichert und nach App-Neustart erneut geöffnet.
  Einstellungen und PDF-Export geprüft. PDF: eine A4-Seite, korrekter
  Text und eingebettete iA-Writer-Schrift. Produktive Datenbank gegenüber
  dem Snapshot unverändert. Windows-Bundle und signierter Update-Zyklus
  bleiben ungeprüft.

### Nacharbeiten vor Phase 4

- CodeRabbit-Befunde in PR #22 behoben: CI-Checkouts ohne persistierte
  Zugangsdaten; Architekturprüfung akzeptiert Pakete erst mit Manifest.
- `CI passed` ist auf GitHub für `main` verpflichtend, an GitHub Actions
  gebunden und gilt auch für Administratoren. Aktueller Basisbranch ist
  erforderlich. Per API eingerichtet und zurückgelesen.
- Tauri-JS-/Rust-Versionen gemeinsam aktualisieren: als Regel dokumentiert.
- Grenzen der CSS-/TSX-Farbprüfung inklusive möglicher CSS-ID-Treffer
  dokumentiert. Allgemeine TS-Dateien und HTML bleiben außerhalb.
- Manueller macOS-/Windows-Release-Probelauf ohne Veröffentlichung für
  Phase 6 ergänzt.
- Ungenutzter `apps/scriptz/src-tauri/target` im aktiven Worktree entfernt
  (ca. 1,4 GB); `apps/desktop/src-tauri/target` war dort bereits weg.
  Buildcaches anderer aktiver Worktrees bleiben bei ihren Sessions.
- Vercel übernimmt Timo ausdrücklich selbst. Keine externen Projekte
  oder Git-Anbindungen verändert.
- Fortschrittslog aus dem Architekturplan in diese Datei ausgelagert.

### Phase 4.0: Expliziter Start und Persistenz-Verträge

- **Umfang:** Vorarbeit im bestehenden Modul; noch kein Kit und keine
  Dateiverschiebungen. Branch `fundament/phase-4-0` aus dem gemergten
  `main`, im selben Worktree. Dokumentationsnacharbeiten in einem
  eigenen Commit vor den Codeänderungen.
- **Lebenszyklus:** Host registriert Plattform, SQL und Updater explizit
  vor dem Rendern. Settings, Navigation und Zeitaktualisierung starten
  mit der Shell; Ideen-, Statistik- und Bibliotheksresources erst nach
  Boot und Legacy-Migration. Cleanup entfernt Listener, Timer und
  Subscriptions und sichert gepufferte Navigation. Solid-eigene
  JSX-Eventdelegation ist von der Import-Regel getrennt.
- **Abgebrochener Start:** Verspätete Daten-, Settings-, Layout-, Fokus-
  und Präferenzantworten dürfen einen neuen Lauf nicht überschreiben;
  Onboarding startet nicht nach dem Abbau der Shell.
- **Persistenz:** Verhaltenstests fixieren alle 13 Settings-Schlüssel,
  String-Kodierung sowie Navigation, Legacy-Tabs, Layout, Bibliotheksansicht,
  Fokus, Quick Mode, Welcome-, Onboarding- und Migrationsmarker.
- **Prüfung:** Lint, Typecheck, Farbprüfung, elf Tooling-Tests und
  290 ScriptZ-Tests grün. Unabhängige Gegenprüfung; gefundene Lücke bei
  verspäteten Layout-/Fokusantworten behoben und durch Tests abgesichert.
  Bekannte Solid-Warnungen in bestehenden interaktiven Tests und
  Bundle-Größenwarnung bleiben, keine importseitigen DB-Fehler mehr.
- **Native Abnahme:** macOS-App und DMG mit isolierter QA-ID und
  deaktivierten Updater-Artefakten erfolgreich gebaut (`--locked`).
  Gegen konsistente DB-Kopie geprüft: Bestand öffnen, Idee anlegen und
  live aktualisieren, Skript schreiben, Statistik, Theme/Sprache/Inspector,
  PDF-Export, Neustart sowie letzte Eingabe direkt vor Fensterschluss.
  Einstellungen, Verlauf und Inhalt bleiben erhalten; PDF mit einer
  A4-Seite, korrektem Text und eingebetteter iA-Writer-Schrift.
  Keine doppelten Welcome-Inhalte; produktive DB unverändert.
- **Merge:** PR #23 nach grüner Pflicht-CI gemergt (`b147cf4`). Kein Release.
  Windows-Bundle und signierter Update-Zyklus weiterhin nicht geprüft.


### Phase 4.1 bis 4.3: Kit-Grundlagen, neutrale UI und KvStore

- **Basis:** Im selben Worktree auf dem gemergten `main` fortgesetzt.
  Neue konsistente Sicherung: `~/Backups/scriptz/scriptz-20261003-192711-phase4-kit.db`;
  SQLite-Integritätsprüfung erfolgreich.
- **Kit:** Eigenes Workspace-Paket mit expliziten Subpath-Exports und
  `sideEffects: ["*.css"]`. Plattform-Interfaces, Tastatur-Helfer, Update-
  Slot, Toasts und serialisierte Saves aus dem Produktmodul herausgelöst.
  Flush-Koordination meldet fehlgeschlagene oder abgelaufene Sicherungen
  als `{ ok, failed }`.
- **Sprache:** Engine und neutrale DE-/EN-Texte im Kit; ScriptZ behält
  seine Produktkataloge und komponiert sie typsicher mit dem Kit-Katalog.
- **UI:** Neutrale Dialoge, Toast-Host, Icons, parametrisierbares AppMark,
  Boot-Fehler und Einstellungsbausteine einschließlich CSS ins Kit
  verschoben. Semantische Tokens ersetzen dort die Legacy-Aliasse.
  `check:tokens` prüft Kit, Fixtures und künftige Pakete auf Legacy-Tokens
  und Imports der Kompatibilitätsschicht.
- **Daten:** KvStore besitzt `settings` und `app_state`, Produkt-Storage
  die fachlichen Tabellen. Datenbankname, Migrationen, Schlüssel und
  persistierte Formate bleiben unverändert.
- **Noch im Modul:** AppShell, Settings-Store/-Dialog, Navigation,
  Produkt-Routen und Editor. Deren Trennung folgt in Phase 4.4 bis 4.7.

- **Prüfung:** Typecheck, ESLint, 17 Tooling-Tests, 46 Kit-Tests und
  278 Modultests sowie Farb-/Tokenprüfung und Frontend-Build erfolgreich.
  Native macOS-App und DMG mit temporärer QA-ID gebaut; vorhandene Daten,
  Editor, neues Dokument, Autosave, Einstellungen, Dark Mode und Sprachwechsel
  mit DB-Kopie geprüft. Testtext und Settings dauerhaft gespeichert;
  produktive Datenbank gegenüber der Sicherung unverändert.

- **Merge:** PR #24 nach grüner Pflicht-CI gemergt
  (`f508d784d4eb4ff785eae87e0d02bc7901b4d7f3`). Kein Release.

### Phase 4.4 bis 4.7: SuiteShell und eigenständiges Produktmodul

- **Shell-Vertrag:** `AppModule`, `ModuleContext` und `ModuleRuntime`
  verbinden die neutrale SuiteShell mit Produkt-Routen, Sidebar, Overlays,
  Einstellungen, Befehlen und Onboarding. Abbruchsignal, früh registriertes
  Cleanup und `runOwned()` sichern den asynchronen Lebenszyklus.
- **Settings und Navigation:** Vier Basis-Settings im Kit, fachliche
  Settings und `dark_paper` im Modul. Gemeinsame Settings-Sektionen,
  Shortcut-Registry, Befehlspalette sowie Navigation/Layout-Persistenz
  werden vom Kit getragen; ScriptZ liefert Texte, Routen und Produktdaten.
  Bestehende Schlüssel und JSON-Formate bleiben erhalten.
- **ScriptZ-Modul:** `scriptzModule.setup(ctx)` ersetzt die eigene
  AppShell. Welcome, Migrationen, Backfill, fachliche Resources und
  Overlays bleiben Produktaufgabe. Der Host registriert Kit-KvStore und
  `ScriptzStorage` separat; die gemischte Speicherfassade entfällt.
- **Paketgrenzen und Assets:** Öffentliche Modul-Exporte auf Einstieg,
  Storage und Styles begrenzt. PDF-TTFs liegen mit Lizenz im Modul und
  werden über `?url` gebündelt; Papierfonts und Produkt-Tokens bleiben dort.
- **Unabhängige Fixture:** Kleines Testmodul mit Route, eigener Settings-
  Sektion, Overlay und Übersetzungen. Als Vitest-Fixture und separat
  startbare Vite-Seite ohne ScriptZ-Import oder Legacy-Styles angelegt.

- **Abnahme:** 17 Tooling-, 74 Kit- und 302 Modultests, Typecheck, ESLint,
  Farb-/Legacy-Tokenprüfung und Frontend-Build erfolgreich. Unabhängiges
  Kit-Testmodul ohne ScriptZ/Legacy-CSS in Hell und Dunkel visuell geprüft,
  inklusive eigener Settings-Sektion, Sprache und Über-Seite.
- **Desktop:** macOS-App und DMG aus dem Release-Build mit QA-ID gebaut.
  Bestehende Daten, Editor-Kürzel, Fokusmodus, Palette/Suche, modulare
  Einstellungen, Layout und Neustart mit isolierter DB geprüft. Unmittelbar
  vor Fensterschluss eingegebener Text ist nach Neustart vorhanden.
  PDF aus dem Bundle enthält eine A4-Seite, erwarteten Text und eingebettete
  iA-Writer-Quattro-Schrift; vier TTF-Schriftschnitte zusätzlich im Test geprüft.
  Produktive DB und bestehende Welcome-/Migrationsmarker unverändert.
  Kein Release; Windows und signierter Update-Zyklus sind nicht geprüft.

### Phase 5: Gemeinsamer Desktop-Host und Rust-Crate

- **Sicherung:** Konsistente SQLite-Sicherung unter
  `~/Backups/scriptz/scriptz-20261003-203928-phase5.db`; Integritätsprüfung
  erfolgreich, 71 Skripte. Für Phase 6 zusätzlich alle 71 Skripte über den
  bestehenden `.scriptz`-Serializer exportiert und mit dessen Parser geprüft:
  `~/Backups/scriptz/exports-phase6-20261003`.
- **Host:** `bootDesktopApp` übernimmt Plattform, KvStore, Updater, gemeinsame
  Styles, SuiteShell und Lebenszyklus. ScriptZ lädt nur sein Modul, dessen
  Produkt-Storage und Styles. Gemeinsame Vite-Konfiguration als separater
  Node-Einstieg `@agentz/desktop/vite`; ScriptZ behält 1420/1421.
- **Native Basis:** `agentz_desktop::builder(Config)` registriert Standard-
  Plugins mit Single-Instance zuerst, Menüs und Quit-Handshake. Migrationen,
  App-ID, Icons und Capabilities bleiben pro App. ScriptZs sieben Migrationen
  und `scriptz.db` bleiben erhalten; neue Apps erhalten `KIT_BASELINE_SQL`.
- **Datensicherheit:** Fensterschluss und Beenden prüfen denselben Flush;
  Update-Installation erst nach Download, Eingabesperre und erfolgreichem
  Flush. Fehlschläge verhindern den Ausstieg beziehungsweise die Installation.
- **Prüfungen:** 24 Desktop-, 74 Kit-, 302 Modul- und 17 Tooling-Tests
  sowie zwei Rust-Tests erfolgreich. Pflicht-CI in
  [PR #26](https://github.com/AgentZ-Media/AgentZ/pull/26) grün und auf
  `main` gemergt (`69c0d7c`).
- **Produktions-Build:** macOS-App und DMG mit isolierter QA-ID
  `de.agent-z.scriptz.phase5-desktop-smoke` gebaut. Ein beim Wiederöffnen
  gefundener nativer Deadlock wurde durch einen Worker und deduplizierte
  Öffnungsanfragen behoben. Fehlende Styles im Produktions-Bundle wurden
  auf Rollups entfernten Paketeinstieg zurückgeführt; korrigierte
  `sideEffects`-Deklaration und ein Regressionstest am echten
  Produktions-CSS sichern die Einbindung ab.
- **Native Abnahme:** Heller Editor und dunkle Einstellungen visuell
  geprüft; native Menüs wechseln zwischen Deutsch und Englisch.
  Fensterschluss/Wiederöffnen und ⌘Q erhalten die letzte Eingabe.
  Ein zweiter Prozess beendet sich mit Code 0; nur eine Instanz bleibt
  aktiv. PDF-Export enthält eine A4-Seite, den erwarteten Text und eine
  eingebettete Schrift. 28 Ideen und vier Papierkorb-Einträge stimmen.
- **Daten:** QA-Datenbank mit 72 Skripten; der logische SQL-Dump der
  produktiven Datenbank ist per SHA identisch mit der Sicherung.
  Kein Release, keine Windows- oder signierte Update-Abnahme in Phase 5.
- **Separat:** Gelbe PNG-/ICNS-/ICO-Icons auf Timos Wunsch neu generiert;
  [PR #27](https://github.com/AgentZ-Media/AgentZ/pull/27) enthält diese
  Korrektur getrennt von Phase 5 und ist in Review.

### Phase 6: Releases und Update-Kanäle pro App

- **Sicherung:** `~/Backups/scriptz/scriptz-20261003-210318-phase6.db`
  über SQLite gesichert, Integritätsprüfung erfolgreich. Die 71 geprüften
  `.scriptz`-Exporte aus der Vorbereitung bleiben zusätzlich verfügbar.
- **Pipeline:** App-Tags `<id>-v<semver>`, Prüfung von App-ID, vier Versionen
  und Release-Notes; macOS und Windows bauen nacheinander. Versionierte
  Releases werden nicht als repositoryweites „Latest“ markiert. Wiederholte
  Läufe bewahren vollständig veröffentlichte Plattform-Artefakte.
- **Zeiger:** `<id>-latest` ist ein veröffentlichter Pre-Release mit stabilen
  Installer-Namen und `latest.json`. Versionsvergleich und ein reservierter
  Versionsmarker verhindern Rücksprünge; Installer werden vor dem Manifest
  hochgeladen. Signaturen und versionsgebundene Manifest-URLs werden geprüft.
- **Werkzeuge:** `pnpm release:bump <app> <version>` synchronisiert die vier
  Versionsdateien und stellt sie bei Fehlschlag wieder her. ScriptZ auf 0.9.0
  vorbereitet, Updater-Endpoint auf `scriptz-latest` umgestellt. Gemeinsame
  Release-Regel ersetzt die frühere separate Desktop-Release-Regel.
- **Probelauf:** Manuelles `workflow_dispatch` ist immer Build-only, ohne
  Signing-Secrets, Tags, Release-Publikation oder Veränderung der Kanäle;
  Installer bleiben sieben Tage als Workflow-Artefakte abrufbar.
- **Stand:** Implementiert; Prüfungen laufen. Noch kein erfolgreicher Live-
  Release, öffentlicher Zeiger-Download oder echter Update-Zyklus behauptet.
  0.9.0 muss einmal manuell installiert und anschließend das signierte
  Update auf 0.9.1 geprüft werden. Website und Generator folgen separat.
