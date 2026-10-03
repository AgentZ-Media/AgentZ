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
