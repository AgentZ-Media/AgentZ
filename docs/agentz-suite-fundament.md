# AgentZ Suite - Plan für das Fundament

> Interne Doku. Stand: 2026-10-03. Status: Phase 1 und 2 gemergt; Phase 3 umgesetzt und lokal geprüft, Review offen; externe Altressourcen offen.
> Gegengeprüft von GPT-6 Astra (Effort High) am 2026-10-03, Befunde
> eingearbeitet (siehe Abschnitt 15).

## Umsetzungsstand (2026-10-03)

- **Phase 0, Code:** PR #19 ist gemergt; Ausgangscommit ist
  `852b20bc63e9de3d6e0ca45711dd5003d4503155`.
- **Phase 1, gemergt:** Web-App, alte Landing und überholte Regeln entfernt;
  Desktop-Schale von Web-Sonderfällen bereinigt, Root-Testbefehl und
  MIT-Lizenz ergänzt, Lockfile und aktive Dokumentation aktualisiert.
  Bundle-Identifier, Datenbankname, Migrationen und persistierte Schlüssel
  bleiben unverändert. PR #20 wurde am 2026-10-03 gemergt
  (`c189125c40a1c3a79a37d94780a11cf83fe1f630`). Phase 4 bis 8 sind
  noch nicht begonnen.
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
  `main` erstellt. Separate PR für diese Phase; noch kein Release.
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
- **Lokal geprüft:** Frozen-Install, Lint, Typecheck, zehn Tooling-Tests,
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

## 1. Ziel

Aus dem ScriptZ-Repo wird das Repo der **AgentZ Suite**: eine Sammlung
lokaler Desktop-Programme für Content Creator (Skripte, Notizen,
Thumbnails, Speech-to-Text, ...), die sich ein Designsystem, eine
UI-Bibliothek, eine App-Schale, eine Release-Pipeline und eine Website
teilen.

Dieser Plan beschreibt **nur das Fundament**: alles, was erledigt sein
muss, damit danach die zweite, dritte, vierte und fünfte App ohne
Umbauten am Bestand dazukommen können. Wie die zweite App konkret
aussieht, ist **nicht** Teil dieses Plans.

**Definition of Done für das Fundament:** Eine neue App lässt sich per
Generator anlegen, startet als Tauri-App mit Sidebar, Einstellungen
(Theme, Sprache, Updates, Über), Toasts, Dialogen, eigener SQLite-
Datenbank und eigenem Icon, lässt sich per Tag releasen, bekommt
Auto-Updates und taucht mit einem Eintrag auf der Website auf. Und das,
ohne dass dafür eine Zeile in ScriptZ oder in einer anderen App
angefasst werden muss.

### 1.1 Ausgangslage

- Es gibt **keine externen Nutzer**. ScriptZ wird ausschließlich intern
  benutzt. Daraus folgt:
  - Keine Rücksicht auf installierte Fremd-Versionen, Updater-Brücken
    oder Daten-Exporte für Nutzer der Web-App nötig.
  - Breaking Changes an Build, Pfaden und Release-Schema sind erlaubt.
  - **Einzige Ausnahme:** die eigenen ScriptZ-Daten auf dem
    Entwickler-Mac. Die liegen in `scriptz.db` im App-Datenordner,
    der am Bundle-Identifier `de.agent-z.scriptz` hängt. Identifier,
    DB-Name, Settings-Schlüssel und `app_state`-Schlüssel bleiben
    deshalb **unverändert**, und vor riskanten Phasen wird gesichert
    (Abschnitt 5).
- [PR #19](https://github.com/AgentZ-Media/AgentZ/pull/19) („ScriptZ
  Studio und Online-Synchronisierung vollständig entfernen") wird vor
  dem Start gemergt. Dieser Plan setzt den Stand **nach** PR #19 voraus:
  kein `apps/studio`, kein Handoff, kein `httpPostJson`/`httpGetJson`
  im `PlatformAdapter`, kein `tauri-plugin-http`, keine
  `SettingsStudio`-Sektion, kein Setting `studio_connect_code`. Nichts
  davon wird im Fundament wieder aufgebaut.
- Nach PR #19 besteht das Repo aus:
  - `apps/desktop` (ScriptZ, Tauri)
  - `apps/web` (ScriptZ im Browser)
  - `apps/landing` (write-scriptz.com, Astro)
  - `packages/core` (`@scriptz/core`, rund 35.000 Zeilen: Editor, Shell,
    Stores, Business-Logik, UI)
  - `packages/design` (`@agentz/design`, CSS-Tokens, Primitive, Icons,
    Logo)
- Bekannte Altlasten, die das Fundament mit erledigt:
  - ESLint ist **nicht installiert**. Die Tauri-Importsperre in
    `packages/core/.eslintrc.json` wird also nie geprüft.
  - Das Root-`package.json` hat **kein `test`-Skript**, obwohl
    `CLAUDE.md` `pnpm test` dokumentiert.
  - Es gibt **keine Root-`LICENSE`**, obwohl `package.json` MIT nennt
    und die README darauf verlinkt.
  - Es gibt **keine CI** für PRs, nur `release.yml`.

### 1.2 Nicht-Ziele (bewusst später)

- Nutzerkonten, Registrierung, Login
- Online-Synchronisierung, Cloud-Backend
- Web-/Browser-Versionen der Apps
- Die zweite App selbst
- Eine „Alles-in-einem"-App, die mehrere Module in einem Fenster vereint
- Code-Signing (Apple Developer ID, Windows EV-Zertifikat)
- Bezahlung, Lizenzen, Abo

Diese Dinge kommen später **für alle Apps gleichzeitig**. Das Fundament
muss sie nicht umsetzen, darf sie aber auch nicht verbauen (siehe
Abschnitt 14).

## 2. Entscheidungen

| # | Frage | Entscheidung |
|---|---|---|
| E1 | Ein großes Programm oder mehrere? | **Mehrere eigenständige Apps**, jede in eigenem Prozess. Jedes Produkt wird als **Modul** gebaut (Abschnitt 6). Das hält eine spätere „Alles-in-einem"-Schale *möglich*, macht sie aber nicht automatisch billig: Adapter, Sprache, Save-Registry und mehrere Stores sind globale Singletons pro Prozess. Das reicht für getrennte Apps und wird im Fundament bewusst nicht weiter abstrahiert. |
| E2 | Name der Suite | **AgentZ Suite** |
| E3 | Domain | **agentz-suite.de** (noch zu registrieren, siehe Phase 7) |
| E4 | Repo-Name | **`AgentZ-Media/AgentZ`**. Das Repo trägt den Suite-Namen, die Tools (ScriptZ, ...) behalten darin ihre eigenen Namen als Apps und Module. |
| E5 | ScriptZ-Name | Bleibt **ScriptZ**, ebenso Bundle-Identifier `de.agent-z.scriptz` und `scriptz.db` |
| E6 | Web-App `apps/web` | **Wird gelöscht**, inkl. Vercel-Projekt und `app.write-scriptz.com` |
| E7 | Landing `apps/landing` | **Wird gelöscht**, inkl. Blog, Vercel-Projekt und `write-scriptz.com`. Ersetzt durch eine neue, minimalistische Suite-Website (Phase 7). |
| E8 | Lizenz | Bleibt vorerst MIT/Open Source. Root-`LICENSE` wird nachgereicht (Phase 1), Lizenzen gebündelter Schriften bleiben erhalten. |
| E9 | Anzahl geteilter Pakete | **Drei** statt vieler Mini-Pakete: `@agentz/design` (CSS), `@agentz/kit` (Solid: UI, i18n, Plattform, Shell), `@agentz/desktop` (Tauri-Host). Grenzen innerhalb von `kit` laufen über Subpath-Exports und Lint-Regeln, nicht über eigene `package.json`s. Aufsplitten geht später jederzeit. |
| E10 | Updater-Signaturschlüssel | **Ein gemeinsamer Schlüssel** für alle Apps (das bestehende Secret-Paar). Alle Apps kommen vom selben Herausgeber. Keine zusätzlichen Secrets pro App. |
| E11 | Sprachen | Alle Apps zweisprachig DE/EN wie ScriptZ heute. Die Website startet ebenfalls DE/EN. |
| E12 | Plattformen | Wie heute: macOS Apple Silicon + Windows x64 |

## 3. Zielstruktur

```
AgentZ/
├── apps/                     ausführbare Programme (dünne Schalen)
│   ├── scriptz/              Tauri-App ScriptZ (heute apps/desktop)
│   │   ├── src/              index.tsx: bootDesktopApp(...)
│   │   └── src-tauri/        tauri.conf.json, build.rs, Migrationen,
│   │                         Capabilities, Icons, main.rs, lib.rs
│   └── site/                 Suite-Website agentz-suite.de (Astro, statisch)
├── modules/                  Produkt-Logik, je ein Modul pro App
│   └── scriptz/              @agentz/scriptz (heute packages/core minus Kit)
├── packages/                 geteilte Infrastruktur, produktneutral
│   ├── design/               @agentz/design   CSS-Tokens, Primitive, Icons, Logo
│   ├── kit/                  @agentz/kit      Solid-UI, i18n, Plattform-Interfaces, Shell
│   └── desktop/              @agentz/desktop  Tauri-Adapter, Updater, Lebenszyklus
├── crates/
│   └── agentz-desktop/       geteilter Rust-Builder (Plugins, SQL, Single-Instance)
├── tooling/
│   ├── new-app/              Generator + Vorlage für neue Apps
│   └── vitest-preset/        gemeinsames Test-Setup (Solid, jsdom, Conditions)
├── docs/
│   ├── release-notes/<app>/  Release-Notes pro App
│   └── ...
├── Cargo.toml                Cargo-Workspace (apps/*/src-tauri + crates/*)
├── Cargo.lock                ein Lockfile für alle Rust-Crates
├── LICENSE
├── tsconfig.base.json
├── eslint.config.js          inkl. Paket-Grenzen
└── pnpm-workspace.yaml       apps/*, modules/*, packages/*, tooling/* + Catalog
```

### 3.1 Abhängigkeitsrichtung (verbindlich)

```
apps/<app>  ──►  modules/<app>  ──►  packages/kit  ──►  packages/design
     │                                     ▲
     └────────►  packages/desktop  ────────┘
```

- `packages/design`: importiert nichts aus dem Repo.
- `packages/kit`: importiert nur `design`. **Kein** `@tauri-apps/*`,
  **kein** Modul, kein Produktwissen (keine Skripte, Charaktere, Ordner).
- `packages/desktop`: importiert `kit` und `@tauri-apps/*`. Kein Modul.
- `modules/<x>`: importiert `kit` und `design`. **Kein** `@tauri-apps/*`,
  keine Apps, **keine anderen Module**.
- `apps/<x>`: verdrahtet Modul + Host. Enthält fast keinen eigenen Code.
- `apps/site`: importiert nur `design`.

Diese Regeln werden per ESLint erzwungen (Phase 3), nicht nur
dokumentiert.

### 3.2 Import ohne Seiteneffekte (verbindlich)

Module und Kit dürfen beim **Import** keine I/O starten: keine
`createResource` mit DB-Zugriff auf Modulebene, kein `api.*`-Aufruf,
keine Timer. Alles mit I/O entsteht erst in der expliziten
Initialisierung (`setup`, Abschnitt 6), nachdem der Host den
`PlatformAdapter` registriert hat.

Hintergrund: Heute startet z. B. `stores/ideas.ts` beim Import eine
Resource mit `api.listIdeas()`. Ohne vorher registrierten Adapter
schlägt sie fehl und liefert eine leere Liste. Im heutigen
`apps/desktop/src/index.tsx` wird das nur durch die Import-Reihenfolge
verhindert. Das ist zu fragil für mehrere Apps.

## 4. Phasenübersicht

| Phase | Inhalt | Art | Ergebnis |
|---|---|---|---|
| 0 | PR #19 mergen, externe Studio-Reste abbauen | Merge + manuell | Studio und Sync sind weg |
| 1 | Web-App + Landing entfernen, Root-Altlasten | PR | Repo enthält nur noch ScriptZ-Desktop, Core, Design |
| 2 | Umbenennen (GitHub, Ordner, Pakete) | GitHub + PR | Zielstruktur steht, Code inhaltlich unverändert |
| 3 | Tooling (TS-Basis, Catalog, ESLint-Grenzen, Test-Preset, CI, Cargo-Workspace) | PR | Grenzen werden automatisch geprüft |
| 4 | `@agentz/kit` aus dem ScriptZ-Modul herauslösen | mehrere PRs | Produktneutrale UI/Shell, ScriptZ ist ein Modul |
| 5 | `@agentz/desktop` + Rust-Crate | PR | Eine Tauri-App braucht nur noch Config + Modul |
| 6 | Release-Pipeline für mehrere Apps | PR + GitHub | Tag `scriptz-v0.9.0` baut, released, Updater läuft |
| 7 | Suite-Website | PR + Vercel/Domain | agentz-suite.de mit Download-Buttons |
| 8 | App-Generator + Abnahmetest | PR | Definition of Done aus Abschnitt 1 erfüllt |

Die Phasen sind sequenziell gedacht. Phase 7 (Website) kann ab Phase 6
parallel laufen.

**Regeln für alle Phasen:**

- Jede Phase ist mindestens ein eigener PR. Ausnahme Phase 0.
  Umstrukturierungen sind laut CLAUDE.md Risiko-Änderungen, also nie
  direkt auf `main`.
- **PR-Größe:** CodeRabbit hat PR #19 mit 108 Dateien übersprungen (das
  Limit hängt vom Tarif ab). Eigene Regel deshalb: Inhaltliche Umbauten
  (Phase 4) bleiben unter 100 Dateien. Reine Verschiebungen (Phase 2)
  dürfen größer sein, weil sie mechanisch sind.
- Verschieben immer per `git mv`, damit die Git-Historie den Dateien
  folgt. Verschieben und inhaltlich Ändern nicht im selben Commit.
- Nach jedem Schritt grün: `pnpm typecheck`, `pnpm test`,
  `pnpm build:scriptz`, ab Phase 3 zusätzlich `pnpm lint` und
  `cargo check --locked`.
- Nach jedem Schritt ScriptZ einmal starten und testen: Skripte öffnen,
  schreiben, Einstellungen, PDF-Export, Ideen, Papierkorb. Bei Phasen
  mit Datenzugriff zuerst gegen eine **Kopie** der DB (Abschnitt 5).
- Verhalten von ScriptZ bleibt über das ganze Fundament **unverändert**.
  Ausnahme: Was in Phase 1 bewusst entfernt wird.

## 5. Datensicherung

Gilt vor **Phase 1, 2, 4, 5 und 6**: alle Phasen, die Boot, Speicherung,
Migrationen, Plugins oder den Updater anfassen.

**Sichern (App vollständig beenden, nicht nur Fenster schließen):**

```bash
DB=~/Library/Application\ Support/de.agent-z.scriptz/scriptz.db
OUT=~/Backups/scriptz/scriptz-$(date +%Y%m%d-%H%M%S)-phase<N>.db
mkdir -p ~/Backups/scriptz
sqlite3 "$DB" ".backup '$OUT'"          # konsistenter Snapshot inkl. WAL
sqlite3 "$OUT" "PRAGMA integrity_check;" # muss "ok" liefern
```

- Kein `cp` der DB-Datei: Bei laufender App oder nicht übertragenem WAL
  ist die Kopie unvollständig oder inkonsistent.
- Dateiname mit Uhrzeit und Phase, damit mehrere Backups am Tag sich
  nicht überschreiben.
- Zusätzlich vor Phase 6 einen `.scriptz`-Export der wichtigsten Skripte.

**Umbauten zuerst gegen eine isolierte Kopie testen:**

- `pnpm dev:scriptz` nutzt denselben App-Datenordner wie die installierte
  App. Für Phasen 4 und 5 deshalb vorher die Arbeits-DB sichern, dann
  testen. Wenn etwas schiefgeht: App beenden, wiederherstellen.

**Wiederherstellen (App beendet):**

```bash
DIR=~/Library/Application\ Support/de.agent-z.scriptz
rm -f "$DIR/scriptz.db-wal" "$DIR/scriptz.db-shm" "$DIR/scriptz.db-journal"
cp "$OUT" "$DIR/scriptz.db"
```

## 6. Das Modul-Konzept

Jedes Produkt ist ein Paket unter `modules/`, das **ein Objekt**
exportiert, das die Shell aus `@agentz/kit` versteht. Das Objekt selbst
ist reine Beschreibung ohne Seiteneffekte (Abschnitt 3.2). Alles mit
I/O und Lebenszyklus entsteht in `setup()`. Skizze, wird in Phase 4.5
finalisiert:

```ts
export interface AppModule {
  /** Stabiler Schlüssel: Tag-Präfix, DB-Name, Identifier-Suffix, Ports. */
  id: string;                          // "scriptz"
  /** Anzeigename. */
  name: string;                        // "ScriptZ"
  /** Logo-Eintrag aus @agentz/design/logo. */
  logo: LogoId;
  /** Texte und Links für "Über" (Tagline-Schlüssel, Website, Repo). */
  about: AboutInfo;
  /** i18n-Katalog des Moduls, wird mit dem Kit-Katalog zusammengeführt. */
  i18n: { de: Catalog; en: Catalog };
  /** Läuft nach dem Kit-Boot (Adapter, KvStore, Basis-Settings, Sprache,
   *  Theme). Erst hier entstehen Stores, Resources, Timer und Effekte. */
  setup(ctx: ModuleContext): Promise<ModuleRuntime>;
}

export interface ModuleRuntime {
  routes: RouteDef[];
  /** Sidebar-Inhalt unterhalb der App-Marke. */
  sidebar: Component;
  /** App-weite Overlays des Moduls (Dialoge, Quick-Capture, Undo-Toasts). */
  overlays?: Component[];
  settings?: {
    /** Eigene Sektionen (z. B. Schreiben, Ordner, Charaktere). */
    sections?: SettingsSection[];
    /** Zusätzliche Zeilen in Kit-Sektionen, z. B. "Dunkles Papier"
     *  unter Darstellung. */
    extend?: Partial<Record<KitSectionId, Component[]>>;
  };
  /** Einträge für die Befehlspalette (⌘K). */
  commands?: () => Command[];
  /** Tastenkürzel mit Kontext (shell, editor, list, dialog). */
  shortcuts?: ShortcutDef[];
  /** Ausstehende Schreibvorgänge sichern. Muss melden, ob es geklappt
   *  hat (Abschnitt 7, Phase 5.2). */
  flushPending?(timeoutMs: number): Promise<FlushResult>;
  /** Optionales Onboarding beim ersten Start. */
  onboarding?: Component;
  /** Effekte, Timer, Listener abbauen. */
  dispose?(): void;
}

export interface ModuleContext {
  platform: PlatformAdapter;
  kv: KvStore;
  /** Shell-Steuerung, z. B. Sidebar ausblenden (ScriptZ-Fokusmodus). */
  shell: ShellControls;
  /** Vom Host injizierte Produktdienste (z. B. später Audio-Aufnahme für
   *  Speech-to-Text). Gemeinsame Interfaces bleiben dadurch schlank. */
  services: Record<string, unknown>;
}
```

Eine App ist dann im Kern:

```ts
// apps/scriptz/src/index.tsx
import { bootDesktopApp } from "@agentz/desktop";

bootDesktopApp({
  id: "scriptz",
  // Lazy: Der Host registriert zuerst Adapter und Updater, dann wird das
  // Modul geladen. Abschnitt 3.2 bleibt trotzdem verbindlich.
  loadModule: () => import("@agentz/scriptz").then((m) => m.scriptzModule),
});
```

## 7. Phasen im Detail

### Phase 0: PR #19 mergen

- PR #19 mergen. Danach `main` lokal ziehen, `pnpm install`, alles grün?
- Das Vercel-Projekt `scriptz-studio` löschen bzw. vom Repo trennen.
  PR #19 entfernt nur den Code. Der Check „Vercel - scriptz-studio"
  schlägt sonst bei jedem PR fehl.
- Externe Studio-Ressourcen (Convex-Deployment, Domains, Secrets)
  prüfen und abbauen.

### Phase 1: Web-App, Landing und Root-Altlasten

Vorher: Datensicherung (Abschnitt 5).

**Löschen:**

- `apps/web/` komplett: IndexedDB-Adapter, MiniSearch, Disclaimer,
  Desktop-Only-Gate, `vercel.json`
- `apps/landing/` komplett: Seiten, Blog, i18n-Katalog, `CLAUDE.md`,
  `vercel.json`. Impressum und Datenschutz werden in Phase 7 aus der
  Git-Historie geholt (Commit-Hash im PR-Text notieren).
- `docs/phase-2-web-app.md`
- `apps/desktop/ScriptZ-Projektplan.md` (ursprünglicher Projektplan,
  durch Code und Regeln überholt). Vorher kurz prüfen, ob noch etwas
  daraus gebraucht wird.
- `.claude/rules/landing-consistency.md`, `.claude/rules/landing-blog.md`
- `.claude/rules/feature-parity.md` (Desktop-↔-Web-Parität gibt es
  nicht mehr). Der noch gültige Teil (was in core lebt, Adapter-Prinzip)
  geht in die neue Regel `suite-architecture.md` (Phase 3).
- Root-`package.json`: Skripte `dev:web`, `build:web`, `dev:landing`,
  `build:landing`
- `release.yml`: Job `trigger-landing`. Secret `VERCEL_DEPLOY_HOOK_URL`
  in GitHub entfernen.
- In `packages/design/scripts/build-logo.mjs` das Kopieren der Icons
  nach `apps/landing/public/img/`
- `pnpm-lock.yaml` per `pnpm install` aktualisieren (`dexie`,
  `minisearch`, Astro fallen weg)

**Im Core anpassen:**

- `AppShellProps.platform: "desktop" | "web"` und alle `"web"`-Zweige
  entfernen, die nur für die Browser-Schale existieren.
- `PlatformAdapter.supportsDirectoryWrite` und ähnliche Feature-Flags
  **behalten**: Sie sind die Naht für spätere Web-Versionen (Abschnitt 14).
  Nur Code löschen, der ausschließlich der Web-Schale dient.
- i18n-Schlüssel, die nur Web/Landing betrafen, aus `de.ts`/`en.ts` entfernen.

**Root-Altlasten:**

- Root-`package.json`: `"test": "pnpm -r --if-present test"` ergänzen.
- `LICENSE` (MIT, Copyright AgentZ Media) im Root anlegen.

**Doku:**

- `CLAUDE.md`: Web, Landing, Feature-Parität, Landing-Konsistenz im
  Abschluss-Workflow streichen.
- `README.md`: Web-App, Landing, write-scriptz.com streichen.
  Vollständig neu geschrieben wird sie in Phase 2.
- `.claude/rules/release.md` / `desktop-release.md`: Landing-Rebuild
  streichen.

**Extern (manuell):**

- Vercel: Projekte für Web und Landing löschen.
- Domains `write-scriptz.com` und `app.write-scriptz.com` aus Vercel
  entfernen. Später auf agentz-suite.de weiterleiten oder auslaufen
  lassen. Eine Entscheidung ist erst nötig, wenn die Domain zur
  Verlängerung ansteht.

**Abnahme:** `pnpm typecheck && pnpm test && pnpm build:desktop` grün,
ScriptZ startet, keine Treffer bei
`grep -ri "apps/web\|apps/landing\|write-scriptz" --exclude-dir=node_modules .`
außer in alten Release-Notes.

### Phase 2: Umbenennen

Vorher: Datensicherung (Abschnitt 5).

**2.1 GitHub (manuell):**

```bash
gh repo rename AgentZ --repo AgentZ-Media/ScriptZ
git remote set-url origin https://github.com/AgentZ-Media/AgentZ.git
gh repo edit AgentZ-Media/AgentZ \
  --description "AgentZ Suite - lokale Desktop-Tools für Content Creator" \
  --homepage "https://agentz-suite.de"
```

- GitHub leitet alte URLs weiter (auch für den Updater). Wir verlassen
  uns trotzdem nirgends darauf: Alle Verweise im Repo werden auf den
  neuen Namen umgestellt.
- Prüfen, dass die Actions-Secrets (`TAURI_SIGNING_PRIVATE_KEY`,
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`) noch da sind. Sie hängen am
  Repo, nicht am Namen.
- CodeRabbit-Installation prüfen: Ist das Repo noch freigegeben?
- Topics setzen (`tauri`, `solidjs`, `content-creator`, ...).
- **Release-Immutability** in den Repo-Einstellungen **nicht**
  aktivieren: Die Zeiger-Releases (Phase 6.3) müssen veränderbar bleiben.
- Lokalen Ordner umbenennen: `~/Desktop/Code/ScriptZ` →
  `~/Desktop/Code/AgentZ`. Das Claude-Memory-Verzeichnis hängt am Pfad
  und muss von
  `~/.claude/projects/-Users-timocorvinus-Desktop-Code-ScriptZ/` in den
  neuen Projektpfad umgezogen werden, sonst ist die Erinnerung weg.

**2.2 Ordner und Pakete (ein PR, nur `git mv` + Suchen/Ersetzen):**

| Alt | Neu |
|---|---|
| Root-Paket `scriptz-monorepo` | `agentz` |
| `apps/desktop/` (Paket `scriptz`) | `apps/scriptz/` (Paket `@agentz/scriptz-app`) |
| `packages/core/` (Paket `@scriptz/core`) | `modules/scriptz/` (Paket `@agentz/scriptz`) |
| `packages/design/` | bleibt |
| Import `@scriptz/core/...` | `@agentz/scriptz/...` |
| Root-Skripte `dev:desktop`, `build:desktop` | `dev:scriptz`, `build:scriptz` |
| `docs/release-notes/v*.md` | `docs/release-notes/scriptz/v*.md` |

- `pnpm-workspace.yaml` um `modules/*` ergänzen.
- `@agentz/kit` und `@agentz/desktop` entstehen erst in Phase 4/5. In
  Phase 2 nur verschieben, nichts aufteilen.
- **`release.yml` im selben PR mitziehen**, sonst ist der Workflow
  zwischenzeitlich kaputt: `projectPath`, Rust-Cache-`workspaces` auf
  `apps/scriptz`, Release-Notes-Pfad auf `docs/release-notes/scriptz/`.
  Das Tag-Schema bleibt bis Phase 6 `v*.*.*`.
- `tauri.conf.json`: Updater-Endpoint vorläufig auf
  `https://github.com/AgentZ-Media/AgentZ/releases/latest/download/latest.json`.
  Final wird er in Phase 6 gesetzt.
- `Cargo.toml`: Paketname bleibt `scriptz`. `authors` →
  `["AgentZ Media"]`. `Cargo.lock` bleibt bis Phase 3 in
  `apps/scriptz/src-tauri/`.
- **Unverändert:** `identifier` (`de.agent-z.scriptz`), `productName`
  (`ScriptZ`), `sqlite:scriptz.db`, Migrationsliste.
- Tests und Builds müssen ohne inhaltliche Änderung laufen. Ein
  ungeplanter Diff ist ein Warnsignal.

**2.3 Doku:**

- `README.md` neu: Suite-Übersicht auf Englisch (Schaufront), Tabelle
  der Apps (vorerst nur ScriptZ), Build-Anleitung, Architektur-Skizze.
- `CLAUDE.md` neu strukturiert: Suite-Ebene (Struktur, Abhängigkeits-
  richtung, Befehle, Abschluss-Workflow, Sprachregeln) plus Verweis auf
  `apps/scriptz/CLAUDE.md`.
- `.claude/rules/*`: `paths:`-Frontmatter auf die neuen Ordner
  umstellen. `desktop-architecture.md` → `scriptz-architecture.md`.
- `.claude/rules/release.md`: die falsche Aussage korrigieren, dass
  `pnpm install --frozen-lockfile` auch `Cargo.lock` absichert. Das tut
  es nicht (dafür `cargo ... --locked`, Phase 3).

### Phase 3: Tooling-Fundament

**3.1 TypeScript:**

- `tsconfig.base.json` im Root nur mit **wirklich gemeinsamen** Optionen
  (`strict`, `target`, `jsx: preserve`, `jsxImportSource: solid-js`,
  `moduleResolution: bundler`, ...). `include`, App-Aliasse (`~`) und
  `types` bleiben pro Paket.
- Typecheck läuft per `pnpm -r typecheck` über alle Pakete.

**3.2 Abhängigkeiten konsistent halten:**

- `packageManager` von `pnpm@9.0.0` auf eine aktuelle pnpm-Version
  heben, die **Catalogs** kann.
- Catalog in `pnpm-workspace.yaml` für Versionen, die in allen Paketen
  gleich sein müssen: `solid-js`, `lexical` + `@lexical/*`, `vite`,
  `vite-plugin-solid`, `vitest`, `typescript`, `@tauri-apps/*`. Pakete
  referenzieren `"catalog:"`. Damit gibt es nie zwei Solid-Versionen.
- Interne Abhängigkeiten immer `workspace:*`.
- **Paket-Konventionen** (in `suite-architecture.md` festhalten, der
  Generator setzt sie um): `type: module`, `exports` mit expliziten
  Subpaths, `sideEffects: ["*.css"]`, `typecheck`- und `test`-Skript.

**3.3 Test-Preset (`tooling/vitest-preset`):**

Das heutige `packages/core/vitest.config.ts` braucht Solid-Plugin,
`browser`/`development`-Conditions und jsdom. Das wird ein gemeinsames
Preset, das jedes Paket per Einzeiler nutzt
(`export default definePackageTest()`), bevor in Phase 4 Tests
zwischen Paketen wandern.

**3.4 ESLint:**

- ESLint 9 (Flat Config) + `typescript-eslint` als Root-devDependency,
  `eslint.config.js` im Root, Skript `pnpm lint`. Die alte
  `packages/core/.eslintrc.json` entfällt.
- Grenzen aus Abschnitt 3.1 als Regeln, z. B. über
  `no-restricted-imports` pro Ordner oder `eslint-plugin-boundaries`:
  - `packages/kit/**` und `modules/**`: kein `@tauri-apps/*`
  - `packages/**`: kein `@agentz/<modul>`
  - `modules/<a>/**`: kein `@agentz/<b>` (anderes Modul)
  - überall: keine relativen Importe über Paketgrenzen
- Bewusst **ohne** Stil-Regeln starten: nur Korrektheit und Grenzen.
  Altlasten per gezieltem `eslint-disable` mit Kommentar markieren,
  nicht Regeln abschwächen.
- Die Farbregel aus CLAUDE.md („keine Hex-/rgb-Werte außerhalb von
  `packages/design`") als Skript `pnpm check:colors` (grep-basiert,
  mit Ausnahmeliste für Charakter-Palette und Trafficlights).

**3.5 Cargo-Workspace:**

- Root-`Cargo.toml` mit `[workspace] members = ["apps/*/src-tauri",
  "crates/*"]`, `resolver = "2"`, gemeinsame
  `[workspace.dependencies]` für `tauri`, `tauri-build`,
  `tauri-plugin-*`, `serde_json`.
- `[profile.release]` (lto, strip, ...) in den Workspace-Root
  hochziehen, weil Profile nur dort gelten.
- **Bestehendes `Cargo.lock` per `git mv` in den Root verschieben**,
  nicht neu erzeugen. So bleiben alle Rust-Versionen gleich. Danach
  einmal `cargo check --locked` muss ohne Änderung am Lockfile durchgehen.
- Gemeinsames `target/` im Root (in `.gitignore`).
- `tauri-action` erkennt Workspaces und das Root-`target/`. Trotzdem
  einmal lokal `pnpm build:scriptz` und prüfen, dass DMG und `.app`
  entstehen.

**3.6 CI (`.github/workflows/ci.yml`, neu):**

- Trigger: `pull_request` und `push` auf `main`
- Job `web` (ubuntu): `pnpm install --frozen-lockfile`, `pnpm lint`,
  `pnpm typecheck`, `pnpm test`, `pnpm check:colors`, Vite-Builds der
  Apps (ohne Tauri-Bundle)
- Job `rust` (ubuntu, mit Tauri-Systempaketen): `cargo check --workspace
  --locked`, optional `cargo clippy --workspace --locked`
- Pfadfilter so wählen, dass Doku-only-PRs schnell durchlaufen.

**3.7 Neue Regel `.claude/rules/suite-architecture.md`:**

Lädt bei `apps/**`, `modules/**`, `packages/**`, `crates/**`. Inhalt:
Zielstruktur, Abhängigkeitsrichtung, Import ohne Seiteneffekte,
Paket-Konventionen, was in `kit` vs. Modul vs. App lebt, Modul-Vertrag,
Port-Tabelle, Regel der Zwei (Abschnitt 8).

### Phase 4: `@agentz/kit` herauslösen

Vorher: Datensicherung (Abschnitt 5).

Das ist der größte Brocken. Ziel: Alles, was nicht ScriptZ-spezifisch
ist, wandert aus `modules/scriptz` nach `packages/kit`. Danach ist
`modules/scriptz` nur noch Fachlogik, `kit` kennt kein einziges Skript.

**Vorgehen pro Schritt:**

1. Datei per `git mv` nach `packages/kit/...` verschieben.
2. Produktwissen aus der Datei herausziehen (Parameter, Slots,
   Registrierung statt fester Imports).
3. In `modules/scriptz` den Import auf `@agentz/kit/...` umstellen.
   Keine dauerhaften Re-Exporte aus dem Modul, sonst bleiben die alten
   Pfade ewig.
4. **CSS mitnehmen:** nicht nur die Datei, sondern auch die Regeln, die
   heute in `styles/global.css` liegen (z. B. sind die Modal-Styles
   dort, `Modal.css` ist fast leer). Alte Token-Namen aus `legacy.css`
   (`--fg-muted`, `--border`, `--brand-500`, `--font-sans`, ...) dabei
   auf die semantischen Tokens umstellen.
5. Tests mitverschieben, alles grün, ScriptZ manuell prüfen.

**Subpath-Exports von `@agentz/kit`:**

| Subpath | Inhalt |
|---|---|
| `@agentz/kit/ui` | Solid-Komponenten |
| `@agentz/kit/i18n` | Sprach-Engine + Kit-Katalog |
| `@agentz/kit/platform` | `PlatformAdapter`, `KvStore`, `DbConnection`, Plattform-Erkennung, Tastatur-Helfer, Updates-Slot |
| `@agentz/kit/stores` | toasts, Basis-Settings, ui-Grundzustand, Nav-Fabrik |
| `@agentz/kit/shell` | `SuiteShell`, Modul-Vertrag, Settings-Dialog, Befehlspalette, Shortcuts, Boot |
| `@agentz/kit/lib` | produktneutrale Helfer (`serialSave`, Flush-Koordinator, Format-Helfer) |
| `@agentz/kit/styles.css` | Basis-, Shell-, Common-, Settings-, Palette-CSS |

**Reihenfolge.** Die Grundlagen kommen zuerst, weil fast jede
UI-Komponente sie braucht und die Lint-Grenzen aus Phase 3 sonst
Zwischenstände blockieren:

**4.0 Vorarbeit im Modul (noch nichts verschieben)**

- **Import-Seiteneffekte entfernen** (Abschnitt 3.2): `stores/ideas.ts`
  und alle anderen Module-Level-Resources, -Timer und -Effekte in
  Fabriken/Init-Funktionen umbauen, die erst nach dem Boot laufen.
- **Persistierte Schlüssel festschreiben:** ein Test, der die Liste
  aller Settings- und `app_state`-Schlüssel samt JSON-Form fixiert, damit
  beim Umzug nichts umbenannt wird. Stand heute:
  - Settings: siehe Tabelle in 4.4
  - `app_state`: `nav.state`, `open_tabs` (Legacy), `ui.layout`,
    `library.view`, `onboarding_completed_v1`, `welcome_seeded_v3`,
    `welcome_script_id_v1`, der Legacy-Block-Migrationsmarker sowie die
    Fokus- und Quick-Mode-Schlüssel. Vollständige Liste beim Umsetzen
    per `grep -rn "AppState(" modules/scriptz` erheben.
  - Werden diese verloren oder umbenannt, gehen Layout und Verlauf
    verloren oder die Willkommensinhalte werden erneut angelegt.

**4.1 Grundlagen → Kit**

- **i18n-Engine** → `@agentz/kit/i18n`. Exporte heute: `language`
  (Signal), `applyResolvedLanguage`, `resolveLanguage`,
  `detectSystemLanguage`, `t`, `tPlural`, `getCurrentLocale`,
  `localeCompare`, Typen `Language`, `LanguagePref`, `TranslationKey`.
  Alle müssen mit.
- **Kataloge zusammensetzbar machen:**
  - Kit-Katalog mit allem Produktneutralen: Buttons, Dialoge, Toasts,
    Settings-Gerüst (Darstellung, Sprache, Tastatur, Updates, Über),
    Boot-Fehler, Update-Meldungen.
  - Modul-Katalog mit dem Rest. Die Shell führt beide zusammen.
  - Typsicherheit bleibt: entweder Namensräume (`kit.*`, `scriptz.*`)
    oder eine generische Fabrik
    (`createI18n<typeof kitDe & typeof scriptzDe>()`). Kriterium: Ein
    Tippfehler in einem Schlüssel ist weiterhin ein Typfehler.
  - Test pro Katalog: EN hat dieselben Schlüssel wie DE.
- **Speichern:** `serialSave` ins Kit. `saveFlush` wird zum
  **Flush-Koordinator**, der ein Ergebnis meldet. Heute verschluckt
  `flushAll()` Fehler und meldet auch nach Timeout keinen Fehlschlag.
  Neu: `flushAll(timeout): Promise<{ ok: boolean; failed: string[] }>`.
  Kit-eigene Saves (Settings, `app_state`) registrieren sich dort
  genauso wie Modul-Saves.
- `stores/toasts.ts`, `lib/keys.ts` (`isModKey`, `K()`,
  `formatHotkey`), `lib/updates.ts` (Slot), `lib/platform.ts` → Kit.
  `ExportPdfDeps` (kennt `ScriptCharacter`) bleibt im Modul.

**4.2 UI-Primitive → `@agentz/kit/ui`**

- `components/Common/`: `Modal`, `ConfirmDialog`, `ToastHost`, `Icon`,
  `AppMark` (Logo per Parameter statt fest), `BootErrorScreen`,
  `dismissOnDialog`, `Common.css`, `Modal.css` + zugehörige Regeln aus
  `global.css`
- `components/Settings/DialogFrame.tsx`, `sections/parts.tsx`
  (Bausteine für Einstellungszeilen)
- Bleiben im Modul: `StageGlyph` (Produktionsstufen sind ScriptZ-
  Fachlichkeit), `rangeInput.ts` und die Range-Felder (hängen an
  `lib/lengthGoal`).

**4.3 Speicher → `@agentz/kit/platform`**

- **`StorageAdapter` aufteilen:**
  - `KvStore` im Kit: `getSetting`, `setSetting`, `getAppState`,
    `setAppState`. Braucht jede App.
  - Alles andere (Skripte, Ordner, Snapshots, Ideen, Charaktere, Suche,
    Export) bleibt als `ScriptzStorage` im Modul, inklusive seiner
    SQL-Implementierung.
  - Die SQL-Implementierung von `KvStore` (Tabellen `settings`,
    `app_state`) liegt im Kit und läuft über `DbConnection`.
- **Tabellen-Konvention:** `settings` und `app_state` gehören dem Kit
  und sehen in jeder App gleich aus. Alle anderen Tabellen gehören dem
  Modul.

**4.4 Einstellungen**

Heute mischt `stores/settings.ts` Allgemeines und ScriptZ-Spezifisches.
Vollständige Liste (nach PR #19):

| Schlüssel | Ziel |
|---|---|
| `theme`, `language`, `update_check_enabled`, `hourly_update_check` | Kit (`baseSettings`) |
| `highlighting_default`, `quick_mode_auto_enable`, `dialog_wpm`, `focus_mode_default`, `show_writing_stats`, `dark_paper`, `prune_unused_characters`, `length_min_default_sec`, `length_max_default_sec` | Modul (`scriptzSettings`) |

- Schlüssel und gespeicherte Werte bleiben **identisch**, damit die
  vorhandene `scriptz.db` ohne Migration weiterläuft.
- `SettingsDialog` wird ein Gerüst:
  - Kit liefert: Darstellung (Theme, Sprache), Tastatur (generiert aus
    der Shortcut-Registry), Updates, Über (Texte und Links aus
    `module.about`, heute fest in `SettingsAbout.tsx`).
  - Modul liefert eigene Sektionen: Schreiben, Ordner, Charaktere.
  - Modul ergänzt Kit-Sektionen per `settings.extend`: z. B. bleibt
    „Dunkles Papier" unter Darstellung, wo es heute steht.

**4.5 Shell und Modul-Vertrag → `@agentz/kit/shell`**

- `AppModule`/`ModuleRuntime`/`ModuleContext` (Abschnitt 6) finalisieren.
- `SuiteShell` aus dem heutigen `AppShell.tsx` bauen:
  - Boot: Kit-Boot (`KvStore`, Basis-Settings, Sprache, Theme auf
    `<html>`) → `module.setup(ctx)` → Render. Fehler →
    `BootErrorScreen`. Beim Abbau `runtime.dispose()`.
  - Layout: Sidebar-Rahmen (App-Marke, Modul-Sidebar, Footer-Slot für
    Host-Elemente wie den Update-Indikator) | Hauptbereich mit Routen.
    Sichtbarkeit über `ShellControls` steuerbar (ScriptZ-Fokusmodus
    blendet heute die Sidebar aus).
  - Globale Dialoge und Overlays: Settings, Confirm, Toasts, plus
    `runtime.overlays`.
  - **Shortcut-Registry mit Kontext** (`shell`, `editor`, `list`,
    `dialog`): Die heutigen „globalen" Shortcuts in `Shell/shortcuts.ts`
    sind Fenster-Ereignisse, keine systemweiten Shortcuts. Die Registry
    muss IME-Eingabe, `defaultPrevented` und die bestehenden
    Lexical-Handler respektieren. Kit kennt ⌘, (Einstellungen) und ⌘K
    (Palette), das Modul registriert den Rest. Die Tastatur-Übersicht in
    den Einstellungen wird aus der Registry generiert.
  - Befehlspalette: Rahmen und Suche ins Kit, Einträge liefert das Modul.
  - Onboarding: Kit stellt den Mechanismus (einmal anzeigen, Flag in
    `app_state`), Modul liefert den Inhalt.
- **Navigation:** `stores/nav.ts` ist heute ScriptZ-Routen + Verlauf +
  „Zuletzt". Ins Kit kommt eine generische Fabrik
  (`createNavStore<Route>()` mit Zurück/Vor und Persistenz in
  `app_state`). Routen-Typen und „Zuletzt geöffnete Skripte" bleiben im
  Modul. Der Schlüssel `nav.state` und sein Format bleiben gleich.
- `stores/ui.ts`: Grundzustand (offene Dialoge, Sidebar ein/aus) ins
  Kit, Panels wie Inspector/Fokus ins Modul. `ui.layout` bleibt gleich.

**4.6 ScriptZ als Modul**

- `modules/scriptz/index.ts` exportiert `scriptzModule: AppModule`.
- `AppShell.tsx` verschwindet. Was ScriptZ-spezifisch war, wandert in
  `setup()` bzw. die Runtime:
  - Boot-Schritte: `ensureWelcomeContent`, `migrateLegacyBlocksOnce`,
    `backfillRuntimeStats`, `libraryPrefs.load`
  - Effekte mit Cleanup: `startCharacterAutoPrune`
  - Overlays: `QuickCapture`, `StageUndoToast`, `ExportDialog`
- ScriptZ-Tokens (`styles/tokens.css`: Charakter-Palette,
  A4-Geometrie) und Papier-Schrift (iA Writer Quattro, WOFF2 + Lizenz)
  bleiben im Modul.
- **PDF-Schriften:** `lib/exportPdf.ts` lädt die TTFs heute per
  `fetch("/fonts/iAWriterQuattroS-*.ttf")` aus `apps/desktop/public/fonts/`.
  Weil die App-Schale dünn wird, ziehen die TTFs samt Lizenztext ins
  Modul und werden als gebündelte Asset-URLs importiert
  (`import url from "./assets/fonts/...ttf?url"`).
- **Abnahme 4.6:** PDF-Export aus dem fertigen Desktop-Bundle (nicht nur
  im Dev-Modus) funktioniert und nutzt die richtige Schrift.

**4.7 Design-Altlasten und Kit-Unabhängigkeit**

- Neue Apps und das Kit dürfen `legacy.css` **nicht** importieren und
  keine Legacy-Token-Namen verwenden (Grep-Check in `check:colors` oder
  eigenes `check:tokens`). ScriptZ darf `legacy.css` vorerst behalten.
  Es würde Fehler im Kit aber verdecken, deshalb der folgende Test.
- **Mini-Testmodul** in `packages/kit/__tests__/fixtures/` (eine Route,
  eine Settings-Sektion, ein Overlay, zwei Übersetzungen):
  - Vitest rendert die Shell damit (Boot, Settings-Registry, i18n-Merge,
    Shortcut-Registry, Import ohne Seiteneffekte).
  - Zusätzlich **einmal visuell** prüfen: eine kleine Vite-Seite, die
    nur `@agentz/design` (ohne `legacy.css`) und `@agentz/kit/styles.css`
    lädt und das Mini-Modul rendert. Hell und dunkel. Ein Vitest-Render
    belegt nicht, dass das CSS stimmt.

**Abnahme Phase 4:**

- `grep -rE "script|Script|character|folder" packages/kit` findet nur
  noch Treffer ohne ScriptZ-Fachbezug (z. B. `<script>`, `description`).
- ScriptZ verhält sich unverändert, Layout, Verlauf und Einstellungen
  sind nach dem Update noch da, keine doppelten Willkommensinhalte.
- Alle bisherigen Tests laufen, verteilt auf Kit und Modul. Das Kit hat
  eigene Tests (siehe 4.7).

### Phase 5: `@agentz/desktop` und Rust-Crate

Vorher: Datensicherung (Abschnitt 5).

**5.1 `packages/desktop` (`@agentz/desktop`):**

Wandert aus `apps/scriptz/src`:

- `lib/platform.ts` → Tauri-`PlatformAdapter`. DB-Name aus der App-ID
  (`sqlite:${id}.db`), nicht fest verdrahtet.
- `lib/tauri.ts`
- `stores/updates.ts` → Updater-Store (Polling, Download, Installation)
- `components/Common/UpdateIndicator.tsx` + `.css`
- Close-Flush aus `App.tsx`
- Neue Funktion `bootDesktopApp({ id, loadModule, services? })`:
  1. Adapter und Updater registrieren
  2. CSS-Reihenfolge laden (Design-Fonts → Tokens → Komponenten → Kit)
  3. Modul per `loadModule()` laden
  4. `<SuiteShell module={...} footer={<UpdateIndicator/>} />` rendern
  5. Lebenszyklus verdrahten (5.2)

Danach besteht `apps/scriptz/src` nur noch aus `index.tsx` und
`vite-env.d.ts`.

**5.2 Lebenszyklus (Host-Vertrag):**

Alle Ausstiegspfade laufen über denselben Flush-Koordinator (Phase 4.1):

| Pfad | Verhalten |
|---|---|
| Fenster schließen | `flushAll(2000)`, dann Fenster zerstören (wie heute). Auf macOS bleibt die App im Dock. |
| Menü „Beenden" / ⌘Q | `flushAll`, dann `exit`. Heute nicht abgefangen, prüfen und angleichen. |
| Dock-Klick bei geschlossenem Fenster (macOS) | Fenster neu öffnen bzw. zeigen |
| Zweiter Start derselben App | **Single-Instance:** vorhandenes Fenster fokussieren, kein zweiter Prozess, der dieselbe DB öffnet |
| **Update installieren** | **Download → Bearbeitung sperren → `flushAll` → nur bei `ok` installieren → Neustart.** Bei Fehlschlag Installation abbrechen und Toast zeigen. |

Der letzte Punkt behebt ein bestehendes Risiko: `updates.ts` ruft heute
`downloadAndInstall()` auf und flusht erst im späteren `restart()`. Auf
Windows kann die Installation den Prozess vorher beenden, ungesicherte
Änderungen gingen verloren. Neu: `download()` und `install()` getrennt
aufrufen und dazwischen flushen.

**Menü:** Standard-App-Menü (Über, Einstellungen ⌘,, Ausblenden,
Beenden; Bearbeiten mit Rückgängig/Kopieren/Einfügen) mit Produktname
aus der Konfiguration. Menü-Aktionen laufen über dieselbe Befehls- und
Flush-Logik wie die Tastenkürzel.

**5.3 Geteilte Vite-Konfiguration:**

- Eigener Subpath `@agentz/desktop/vite` (getrennt vom Browser-Einstieg,
  damit Node-Code nicht im App-Bundle landet):
  `defineDesktopViteConfig({ port })` mit Solid-Plugin, Tauri-Dev-Host,
  HMR, `envPrefix`, Build-Target.
- **Ports pro App als Trio:** Vite-Port, HMR-Port und `devUrl` in
  `tauri.conf.json` gehören zusammen. ScriptZ bleibt bei 1420/1421, die
  nächste App 1430/1431 usw. Port-Tabelle in `suite-architecture.md`.

**5.4 `crates/agentz-desktop`:**

```rust
pub fn run() {
    agentz_desktop::builder(agentz_desktop::Config {
        db_url: "sqlite:scriptz.db",
        migrations: migrations(),
    })
    // App-spezifische Plugins/Commands hier anhängen
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
```

- Das Crate registriert die Standard-Plugins aller Apps in der richtigen
  Reihenfolge: **single-instance zuerst**, dann window-state,
  clipboard-manager, os, updater, process, opener, dialog, fs, sql.
- Es gibt einen `tauri::Builder` zurück, damit Apps eigene Plugins und
  Commands ergänzen können (z. B. später Audio für Speech-to-Text).
- **Plugins bleiben direkte Abhängigkeiten der App.** Tauri liest die
  Berechtigungs-Metadaten der Plugins über Cargo-`links`-Variablen,
  die nur an direkte Abhängige weitergereicht werden. Nur transitiv über
  das Crate eingebundene Plugins würden beim Auflösen der Capabilities
  fehlen. Deshalb listet jede App die Plugins zusätzlich als
  `{ workspace = true }` in ihrem `Cargo.toml`. Der Generator erzeugt das.
- **`global-shortcut`** ist **kein** Standard-Plugin: ScriptZ registriert
  es heute, nutzt es aber nicht (alle Kürzel sind Fenster-Ereignisse),
  und `global-shortcut:default` erlaubt ohnehin kein Registrieren. In
  ScriptZ entfernen. Apps, die systemweite Kürzel brauchen (z. B.
  Speech-to-Text), binden es selbst ein, mit expliziten Berechtigungen
  und konfigurierbarem Kürzel, damit sich Apps nicht in die Quere kommen.
- **window-state** braucht nichts Zusätzliches: Das Plugin speichert im
  app-spezifischen Konfigurationsordner, unterschiedliche Identifier
  trennen die Apps.
- Migrationen bleiben **pro App**. Das Crate exportiert zusätzlich
  `KIT_BASELINE_SQL` (Tabellen `settings`, `app_state`), die neue Apps
  als Migration 1 eintragen. ScriptZ hat beide Tabellen schon in
  `001_baseline.sql` und bleibt unverändert.
- Jede App behält **`build.rs`** (`tauri_build::build()`), `main.rs`,
  `lib.rs` und direkte Abhängigkeiten auf `tauri`, `tauri-build`,
  `serde_json`.
- **Capabilities und CSP:** Eine geprüfte Basis (Vorlage im Generator)
  plus app-spezifische Ergänzungen. Jede App behält ihre eigene
  `capabilities/default.json`, weil Tauri sie pro App liest. Nach PR #19
  prüfen, ob `connect-src` noch `api.github.com`/`github.com` braucht
  (der Updater läuft über Rust, nicht über die Webview-CSP).

**Abnahme Phase 5:** `apps/scriptz` enthält nur `index.html`,
`src/index.tsx`, `vite.config.ts` (Einzeiler), `package.json` und
`src-tauri/` mit `tauri.conf.json`, `build.rs`, `Cargo.toml`, Icons,
Capabilities, Migrationen, `main.rs` und kurzem `lib.rs`. ScriptZ läuft
unverändert, Daten sind da. Zweiter Start fokussiert das vorhandene
Fenster, ⌘Q und Fenster schließen verlieren keine Eingaben.

### Phase 6: Release-Pipeline für mehrere Apps

Vorher: Datensicherung (Abschnitt 5) und `.scriptz`-Export.

**6.1 Das Problem:**

- Tags heißen heute `v0.8.4`. Bei mehreren Apps ist unklar, welche App
  gemeint ist.
- Der Updater fragt `releases/latest/download/latest.json` ab.
  „Latest" ist bei GitHub **ein** Release pro Repo. Sobald App B
  released, bekäme ScriptZ das `latest.json` von App B.

**6.2 Tag-Schema und Release-Erstellung:**

- `<app-id>-v<semver>`, z. B. `scriptz-v0.9.0`, `notes-v0.1.0`
- Workflow-Trigger: `tags: ['*-v*.*.*']`
- Job `prepare` parst den Tag → `app_id`, `version` und prüft:
  - `apps/<app_id>/` existiert
  - Version stimmt in `apps/<app_id>/package.json`, `tauri.conf.json`,
    `src-tauri/Cargo.toml` **und** im Root-`Cargo.lock` mit dem Tag
    überein (bricht sonst ab)
  - `docs/release-notes/<app_id>/v<version>.md` existiert
- **Release vorab selbst anlegen:** `tauri-action@v0` bietet keinen
  `make_latest`-Input. Deshalb legt `prepare` das Release per
  `gh release create <tag> --latest=false --title "<Produkt> <Version>"
  --notes-file ...` an und gibt die `releaseId` an beide Build-Jobs
  weiter (`tauri-action`-Input `releaseId`). So wird kein App-Release
  je GitHubs „Latest".
- Builds: macOS → Windows sequenziell (wie heute), weil `tauri-action`
  `latest.json` zusammenführt. Rust-Builds mit `--locked`.
- `projectPath: apps/${{ app_id }}`, Rust-Cache-Key pro App + OS.
- Alte Tags `v0.6.0` bis `v0.8.4` bleiben als Historie unangetastet.

**6.3 Updater pro App: Zeiger-Release**

Jede App bekommt ein festes Release mit dem Tag **`<app-id>-latest`**,
als veröffentlichtes *Pre-Release* (nie „Latest", aber öffentlich
abrufbar; der Pre-Release-Status stört den Updater nicht). Es enthält:

- `latest.json` (Kopie aus dem versionierten Release, die Download-URLs
  darin zeigen auf das versionierte Release)
- Installer mit **stabilem Dateinamen aus der App-ID**:
  `<id>-macos-arm64.dmg`, `<id>-windows-x64-setup.exe`

Damit gilt pro App:

- Updater-Endpoint: `https://github.com/AgentZ-Media/AgentZ/releases/download/<id>-latest/latest.json`
- Website-Downloads: `.../releases/download/<id>-latest/<id>-macos-arm64.dmg`

Die Website braucht keinen GitHub-API-Abruf und keinen Deploy-Hook.

**Job `publish-pointer`** (nach beiden Builds):

- `concurrency: pointer-<app_id>` mit `cancel-in-progress: false`, damit
  zwei Releases derselben App nicht gleichzeitig den Zeiger schreiben.
- Unmittelbar vorher die Version im aktuellen Zeiger-`latest.json` lesen.
  Ist der Kandidat **nicht neuer** (semver), abbrechen. Das verhindert,
  dass ein alter Workflow-Rerun den Zeiger zurücksetzt.
- Das neue `latest.json` prüfen: beide Plattformen vorhanden, Signaturen
  nicht leer, alle URLs erreichbar.
- Reihenfolge: **zuerst Installer, zuletzt `latest.json`** hochladen.
  `gh release upload --clobber` löscht das alte Asset vor dem Upload,
  ist also nicht atomar. Bricht der Upload ab, fehlt das Asset. Recovery:
  Job erneut ausführen (er ist idempotent).
- Abschluss-Check ohne Authentifizierung: `curl -fsSIL` auf
  `latest.json` und beide Installer.
- Zeiger-Body: kurzer Text („Immer die aktuelle Version von <Produkt>,
  Release-Notes: <Link>"), wird bei jedem Lauf aktualisiert.
- Existiert das Zeiger-Release noch nicht, legt der Job es an
  (`gh release create <id>-latest --prerelease --latest=false`).

Verworfene Alternative: `latest.json` als statische Datei auf
agentz-suite.de. Dann würde ein kaputter Website-Deploy die Updates
stoppen.

**6.4 Weitere Punkte:**

- **Install-Footer:** `docs/release-notes/_install_footer.md` hat
  „ScriptZ" fest im Text (`xattr -cr /Applications/ScriptZ.app`). Wird
  zur Vorlage mit Platzhalter `{{PRODUCT_NAME}}`, die der Workflow
  ersetzt.
- **Versions-Skript:** `pnpm release:bump <app> <version>` setzt die
  Version in `package.json`, `tauri.conf.json`, `Cargo.toml`,
  aktualisiert `Cargo.lock` (`cargo update -p <crate> --precise` bzw.
  `cargo check`) und legt die Release-Notes-Datei aus einer Vorlage an.
- **Signaturschlüssel:** der bestehende, für alle Apps (E10).
- **Regeln:** `.claude/rules/release.md` und `desktop-release.md` zu
  einer `release.md` für alle Apps zusammenführen (Tag-Schema,
  Checkliste, Bump-Skript, Zeiger-Release, Recovery bei
  fehlgeschlagenem Lauf).

**6.5 Erster Release unter neuem Schema:**

- `scriptz-v0.9.0` mit Release-Notes „Interner Umbau zur AgentZ Suite,
  keine sichtbaren Änderungen".
- Die installierte 0.8.4 nutzt noch den alten Update-Kanal
  (`releases/latest`) und findet das neue Release dort nicht, weil es
  mit `--latest=false` erstellt wird. **Einmal manuell installieren**
  (DMG von `scriptz-latest`). Da es keine weiteren Nutzer gibt, ist keine
  Brücken-Version nötig.
- Danach mit `scriptz-v0.9.1` prüfen, dass der Auto-Updater die neue
  Version findet, lädt, vorher flusht und installiert.

### Phase 7: Suite-Website (`apps/site`)

**Anforderung:** klein, minimalistisch, eine Seite. Suite-Intro, pro
App eine Karte mit Name, Icon, Satz zur Funktion und Download-Buttons
(macOS, Windows). Dazu Impressum und Datenschutz.

- **Astro**, statischer Build, Vercel. Astro kennt ihr schon und es
  liefert ohne Zusatzaufwand statisches HTML.
- Nutzt **`@agentz/design`** (Tokens, Fonts, `.btn`). Die frühere
  Ausnahme „Landing pflegt eigene Tokens" entfällt. Damit sieht die
  Website automatisch aus wie die Apps.
- **Datengetrieben:** `apps/site/src/apps.ts` listet die Apps:
  `{ id, name, tagline: {de, en}, status: "available" | "soon" }`.
  Icon und Download-URLs werden aus `id` gebaut (Schema aus Phase 6.3).
  `soon` zeigt die Karte ohne Buttons. Auf `available` wird erst nach
  dem ersten erfolgreichen Release umgestellt.
- **Versionsanzeige** optional per Build-Zeit-Abruf von
  `<id>-latest/latest.json`. Sonst weglassen, das hält die Seite statisch.
- **DE/EN:** `/` Deutsch, `/en/` Englisch, Sprachwahl im Footer. Kleiner
  Katalog, gleiche i18n-Regeln wie bisher.
- **Pflichtseiten (deutsches Recht):** Impressum und Datenschutz, auf
  Deutsch. Die Texte aus der alten Landing (Git-Historie, siehe Phase 1)
  an die Suite anpassen: Anbieter, Domain, kein Tracking, Downloads über
  GitHub.
- **Kein** Blog, **kein** Tracking, **keine** Cookies (dann ist auch
  kein Cookie-Banner nötig).
- **Extern (manuell):**
  - Domain `agentz-suite.de` registrieren
  - Vercel-Projekt anlegen: Root `apps/site`, Build `pnpm build:site`.
    Ignored-Build-Step so, dass Änderungen an `apps/site`,
    `packages/design`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` und Root-
    `package.json` einen Deploy auslösen.
  - DNS auf Vercel, HTTPS
- Root-Skripte `dev:site`, `build:site`
- Neue Regel `.claude/rules/site.md` (lädt bei `apps/site/**`): Aufbau,
  App-Liste pflegen, Sprachregeln.
- Abschluss-Workflow in `CLAUDE.md`: Bei neuer App oder geändertem
  App-Namen/Icon auch `apps/site/src/apps.ts` prüfen. Das ersetzt die
  alte Landing-Konsistenz-Regel.

### Phase 8: App-Generator und Abnahmetest

**8.1 Generator `pnpm new-app <id> "<Name>"`** (`tooling/new-app/`):

Prüft zuerst:

- `id` ist kleingeschrieben, `[a-z][a-z0-9-]*`, und nicht reserviert
  (`site`, `design`, `kit`, `desktop`, `core`, `new-app`, `latest`, ...).
- Es gibt weder `apps/<id>` noch `modules/<id>`. **Nie überschreiben.**

Legt an:

- `modules/<id>/`: `package.json` (`@agentz/<id>`, Konventionen aus
  Phase 3.2), `index.ts` mit minimalem `AppModule` (eine Startseite,
  i18n-Kataloge DE/EN), `styles.css`, `tsconfig.json`,
  `vitest.config.ts` (Preset), ein Beispieltest
- `apps/<id>/`: `package.json` (`@agentz/<id>-app`, Version `0.1.0`),
  `index.html`, `src/index.tsx`, `vite.config.ts` (nächstes freies
  Port-Trio), `src-tauri/` mit:
  - `tauri.conf.json`: `productName`, `identifier: de.agent-z.<id>`,
    `devUrl` passend zum Port, Updater-Endpoint `<id>-latest`,
    gemeinsamer `pubkey`, Basis-CSP, Fenstergrößen
  - `Cargo.toml` (Workspace-Mitglied, Plugins als direkte
    Abhängigkeiten), `build.rs`, `main.rs`, `lib.rs`
    (`agentz_desktop::builder`), `migrations/001_baseline.sql`
    (`KIT_BASELINE_SQL`), `capabilities/default.json` (Basis)
  - Icons (siehe 8.2)
- `docs/release-notes/<id>/`
- Root-Skripte `dev:<id>`, `build:<id>`
- Eintrag in `apps/site/src/apps.ts` mit `status: "soon"`
- `apps/<id>/CLAUDE.md` aus Vorlage

Danach führt der Generator `pnpm install` und `cargo check` aus, damit
`pnpm-lock.yaml` und `Cargo.lock` aktualisiert sind.

Gegenstück `pnpm remove-app <id>` entfernt alles wieder (für den
Abnahmetest und Fehlversuche).

**8.2 Icons pro App:**

`packages/design/scripts/build-logo.mjs` schreibt heute fest nach
`apps/desktop/...` und braucht Google Chrome. Umbau:

- Parameter `--app <id>`: Ziel `apps/<id>/src-tauri/icons/` und
  `apps/site/public/img/<id>.png`
- Logo-Daten pro App (Glyphe/Farbe) in `@agentz/design/logo` als
  `LOGOS[id]`. Das Suite-Logo (AgentZ-Marke für Website und Favicon)
  als eigener Eintrag.
- Der Generator ruft das Skript auf. Fehlt Chrome, kopiert er ein
  mitgeliefertes Platzhalter-Icon-Set, damit `tauri build` trotzdem
  funktioniert.

**8.3 Abnahmetest (Definition of Done):**

1. `pnpm new-app sandbox "Sandbox"`
2. `pnpm dev:sandbox` startet eine Tauri-App mit Sidebar, Startseite,
   Einstellungen (Theme hell/dunkel, Sprache DE/EN, Updates, Über),
   Toast, Confirm-Dialog. **Gleichzeitig** läuft `pnpm dev:scriptz`.
   Fensterpositionen beider Apps bleiben nach Neustart getrennt erhalten.
3. `sandbox.db` liegt in `~/Library/Application Support/de.agent-z.sandbox/`,
   ScriptZ-Daten sind unberührt.
4. `pnpm lint && pnpm typecheck && pnpm test` grün, CI grün.
5. Probe-Release `sandbox-v0.1.0` als **veröffentlichtes Pre-Release**
   (ein Draft reicht nicht, der Updater braucht öffentliche URLs):
   DMG, EXE, `latest.json`, Zeiger `sandbox-latest` aktualisiert.
   Downloads funktionieren **ohne** GitHub-Login. ScriptZ' Zeiger und
   „Latest" bleiben unberührt.
6. `sandbox-v0.1.1` releasen: Die installierte 0.1.0 aktualisiert sich
   selbst.
7. Website-Eintrag auf `available` stellen: Karte und Download-Links
   funktionieren.
8. In ScriptZ (`modules/scriptz`, `apps/scriptz`) wurde **keine Datei**
   geändert (`git diff --stat` prüfen).
9. `pnpm remove-app sandbox`, Releases und Tags `sandbox-*` löschen.

Wenn ein Schritt eine Änderung an ScriptZ oder am Kit erzwingt, ist das
Fundament noch nicht fertig. Dann zuerst das Kit verbessern und den Test
wiederholen.

**8.4 Doku `docs/neue-app.md`:**

Checkliste von „Idee" bis „erster Release": Generator, Namen, Icon,
Modul-Vertrag ausfüllen, eigene Tabellen/Migrationen, Port, Release-
Notes, Website-Eintrag, `CLAUDE.md` der App.

## 8. Regel der Zwei

Ins Kit wandert nur, was **heute** produktneutral ist oder was ein
**zweites** Modul tatsächlich braucht. Nicht vorab abstrahieren:

- Lexical-Editor-Basis (`@agentz/kit/editor` oder eigenes Paket) erst,
  wenn die Notizen-App startet. Der ScriptZ-Editor bleibt bis dahin
  vollständig im Modul.
- Ordner, Papierkorb, Snapshots, Suche: Klingen generisch, sind aber
  heute eng mit Skripten verwoben. Erst ins Kit, wenn ein zweites Modul
  sie braucht. Dann mit dem echten zweiten Anwendungsfall entwerfen.
- PDF-Export bleibt im Modul.
- `dark_paper` bleibt im Modul: „Papier" ist ein ScriptZ-Konzept.

## 9. Was in welchem Paket landet (Übersicht)

| Heute (`packages/core`) | Ziel |
|---|---|
| `components/Common/*` außer `StageGlyph` | `kit/ui` |
| `components/Settings/DialogFrame`, `sections/parts`, `SettingsDialog` (als Gerüst) | `kit/ui` / `kit/shell` |
| `components/Settings/rangeInput` | Modul (hängt an `lengthGoal`) |
| `Settings/sections/SettingsAppearance`, `SettingsShortcuts`, `SettingsUpdates`, `SettingsAbout` | `kit/shell` (Über parametrisiert) |
| `Settings/sections/SettingsWriting`, `SettingsFolders`, `SettingsCharacters` | Modul |
| `components/Shell/AppShell`, `Sidebar` (Rahmen), `shortcuts` (Registry) | `kit/shell` |
| `components/Shell/libraryData`, Sidebar-Inhalt | Modul |
| `components/Palette/CommandPalette` (Rahmen) | `kit/shell`, Einträge im Modul |
| `components/Onboarding` (Mechanismus) | `kit/shell`, Inhalt im Modul |
| `components/Editor`, `Script`, `Library`, `Ideas`, `Export`, `Activity` | Modul |
| `stores/toasts` | `kit/stores` |
| `stores/settings` | Basis → Kit, Rest → Modul (Phase 4.4) |
| `stores/nav`, `stores/ui` | Fabrik/Grundzustand → Kit, Rest → Modul |
| `stores/ideas`, `dailyStats`, `saveStatus` | Modul (`saveStatus` ggf. Kit, falls generisch) |
| `lib/platform`, `updates`, `keys`, `db` | `kit/platform` |
| `lib/storage` | `KvStore` → Kit, Rest → Modul |
| `lib/serialSave`, `saveFlush` (→ Flush-Koordinator), `format` (Datums-/Zahlformat) | `kit/lib` |
| restliche `lib/*` (Skripte, Lex, Runtime, Charaktere, Snapshots, Suche, Export, `.scriptz`-Format, Busse) | Modul |
| `i18n/index.ts` (Engine) | `kit/i18n` |
| `i18n/de.ts`, `en.ts`, `parts/*` | Kit-Katalog + Modul-Katalog |
| `styles/tokens.css`, `fonts.css`, `assets/fonts` | Modul (ScriptZ-Tokens, Papier-Schrift) |
| `styles/global.css` | Basis + Regeln der Kit-Komponenten → Kit, Rest → Modul |
| `apps/desktop/public/fonts/*.ttf` (PDF-Schriften) | Modul, als gebündelte Assets |
| `apps/desktop/src/lib/platform.ts`, `tauri.ts`, `stores/updates.ts`, `UpdateIndicator`, Close-Flush | `@agentz/desktop` |
| `apps/desktop/src-tauri/src/lib.rs` (Plugin-Liste) | `crates/agentz-desktop` |

## 10. Doku und Regeln: Endzustand

| Datei | Inhalt |
|---|---|
| `README.md` (EN) | Suite-Übersicht, Apps, Build, Architektur |
| `LICENSE` | MIT |
| `CLAUDE.md` (DE) | Suite-Struktur, Abhängigkeitsrichtung, Befehle, Abschluss-Workflow, Sprachregeln |
| `apps/scriptz/CLAUDE.md` | ScriptZ-Spezifika (Datenmodell, Editor, Migrationen) |
| `.claude/rules/suite-architecture.md` | Kit vs. Modul vs. App, Modul-Vertrag, Import ohne Seiteneffekte, Paket-Konventionen, Ports, Regel der Zwei |
| `.claude/rules/scriptz-architecture.md` | heute `desktop-architecture.md`, auf Modul-Pfade umgestellt |
| `.claude/rules/i18n.md` | Kit- vs. Modul-Katalog, Website |
| `.claude/rules/release.md` | Tag-Schema, Bump-Skript, Zeiger-Release, Checkliste, Recovery |
| `.claude/rules/site.md` | Website pflegen |
| `docs/neue-app.md` | Checkliste neue App |
| `docs/agentz-suite-fundament.md` | dieser Plan, wird beim Abarbeiten aktualisiert |
| `packages/design/README.md` | Logo pro App, ScriptZ nicht mehr einziger Nutzer |

Gelöscht: `feature-parity.md`, `landing-consistency.md`,
`landing-blog.md`, `desktop-release.md` (in `release.md` aufgegangen),
`docs/phase-2-web-app.md`, `apps/landing/CLAUDE.md`. `docs/studio-spec.md`
nach PR #19 prüfen und ggf. löschen. `docs/redesign/` bleibt als
Designreferenz.

Die Tabelle „Sprache pro Artefakt" in `CLAUDE.md` an die neuen Pfade
anpassen (Landing-Kataloge → Website-Katalog, App-i18n → Kit- und
Modul-Kataloge).

## 11. Externe Aufgaben (Checkliste)

Nicht per Code erledigbar, gesammelt für den Überblick:

- [ ] PR #19 mergen
- [ ] Vercel: Projekte `scriptz-studio`, Web, Landing löschen
- [ ] Convex/Studio-Ressourcen abbauen
- [ ] Domains `write-scriptz.com`, `app.write-scriptz.com` aus Vercel
      entfernen, über Weiterleitung oder Auslaufen entscheiden
- [ ] Secret `VERCEL_DEPLOY_HOOK_URL` entfernen
- [ ] GitHub-Repo in `AgentZ` umbenennen, Beschreibung, Homepage, Topics
- [ ] Release-Immutability aus lassen
- [ ] Lokalen Ordner umbenennen + Claude-Memory-Pfad umziehen
- [ ] CodeRabbit-Freigabe prüfen
- [ ] Domain `agentz-suite.de` registrieren
- [ ] Vercel-Projekt für `apps/site` anlegen, Domain verbinden
- [ ] Zeiger-Release `scriptz-latest` beim ersten Release prüfen
- [ ] ScriptZ 0.9.0 einmal manuell installieren

## 12. Risiken

| Risiko | Gegenmaßnahme |
|---|---|
| Datenverlust in `scriptz.db` | Identifier, DB-Name, Settings- und `app_state`-Schlüssel bleiben (per Test fixiert), konsistente Backups vor jeder riskanten Phase (Abschnitt 5) |
| Ungesicherte Eingaben beim Update | Flush vor Installation, Abbruch bei Fehlschlag (Phase 5.2) |
| Stores laufen vor dem Adapter | Import ohne Seiteneffekte (Abschnitt 3.2), Lazy-Modul-Laden, Boot-Test |
| Phase 4 bricht den Editor unbemerkt | kleine Schritte, Tests mitverschieben, nach jedem Schritt manuell testen, Verhalten bleibt gleich |
| Kit sieht ohne ScriptZ-CSS kaputt aus | Legacy-Token-Check, visueller Test des Mini-Moduls (Phase 4.7) |
| Riesige PRs, die niemand prüfen kann | Verschieben und Ändern trennen, inhaltliche PRs unter 100 Dateien |
| Abstraktion auf Vorrat | Regel der Zwei (Abschnitt 8), Mini-Testmodul statt Spekulation |
| Rust-Abhängigkeiten ändern sich beim Workspace-Umbau | `Cargo.lock` verschieben statt neu erzeugen, überall `--locked` |
| Capabilities lösen sich nicht auf | Plugins als direkte Abhängigkeiten jeder App (Phase 5.4) |
| Ein App-Release wird „Latest" oder der Zeiger springt zurück | Release vorab mit `--latest=false`, `concurrency` + Versionsvergleich im Zeiger-Job |
| Lint-Regeln werden still umgangen | CI bricht bei Verstößen ab, `eslint-disable` nur mit Begründung |

## 13. Reihenfolge auf einen Blick

```
0  PR #19 mergen, Vercel/Convex aufräumen
1  PR: Web + Landing löschen, test-Skript, LICENSE        (Backup)
2  GitHub umbenennen → PR: Ordner/Pakete/Release-Notes-Pfad
   umbenennen, release.yml mitziehen, README/CLAUDE neu    (Backup)
3  PR: tsconfig.base, pnpm-Catalog, Test-Preset, ESLint + Grenzen,
   ci.yml, Cargo-Workspace mit verschobenem Cargo.lock
4  PRs (Backup): 4.0 Seiteneffekte + Schlüssel-Test → 4.1 Grundlagen
   (i18n, Saver, Plattform) → 4.2 UI → 4.3 KvStore → 4.4 Settings
   → 4.5 Shell + Modul-Vertrag → 4.6 ScriptZ als Modul (+ PDF-Fonts)
   → 4.7 Legacy-Check + visueller Kit-Test
5  PR (Backup): @agentz/desktop, Lebenszyklus + sicherer Updater,
   Vite-Helfer, crates/agentz-desktop
6  PR (Backup): Release-Pipeline (Tag-Schema, --latest=false,
   Zeiger-Release, Bump-Skript)
   → scriptz-v0.9.0 manuell installieren → scriptz-v0.9.1 Updater-Test
7  PR: apps/site + Domain/Vercel        (ab 6 parallel möglich)
8  PR: Generator, Logo pro App, docs/neue-app.md → Sandbox-Abnahmetest
```

## 14. Für später (nicht umsetzen, nur nicht verbauen)

Damit Konten, Sync und Web-Versionen später **für alle Apps gleichzeitig**
kommen können:

- **Kit bleibt plattformneutral.** Kein `@tauri-apps/*` in `kit` und
  Modulen (Lint-Regel). Eine spätere Web- oder Cloud-Schale ist dann
  „nur" ein weiterer Host neben `@agentz/desktop`.
- **UI und Fachlogik nutzen das Storage-Interface** ihres Moduls, nicht
  direkt SQL. Die modulspezifische SQL-Implementierung darf im Modul
  liegen. Ein Sync- oder Cloud-Adapter kann sich später dazwischenschalten.
- **IDs** für neue Fachdaten per `crypto.randomUUID()` (ScriptZ macht
  das schon). Weitere Sync-Vorbereitungen (Zeitstempel überall,
  Soft-Delete/Tombstones) werden **erst entschieden, wenn Sync konkret
  wird**, nicht pauschal vorab.
- **Ein Platz für „Konto" in der Shell.** Kein Code, aber die
  Settings-Registry erlaubt eine weitere Kit-Sektion, ohne Module
  anzufassen.
- **App-übergreifende Funktionen** (z. B. Notiz → Skript) laufen später
  über definierte Schnittstellen (Deep-Links oder gemeinsamer Sync),
  **nie** über direkte Modul-Importe.

## 15. Review-Historie

**2026-10-03, GPT-6 Astra (Effort High) via Codex CLI.** Übernommen:

- Konsistente DB-Sicherung per `sqlite3 .backup` + `integrity_check`,
  Wiederherstellung, Phase 4 in die Sicherungsliste (Abschnitt 5)
- Flush vor Update-Installation, Flush-Koordinator mit Erfolgsmeldung,
  alle Ausstiegspfade (Phase 4.1, 5.2)
- Import ohne Seiteneffekte, Lazy-Modul-Laden, `setup()` statt `boot()`
  (Abschnitt 3.2, 6)
- `build.rs` und direkte Plugin-Abhängigkeiten pro App (Phase 5.4, 8.1)
- `--latest=false` über vorab erstelltes Release statt nicht vorhandenem
  `make_latest`-Input; `concurrency`, Versionsvergleich, Upload-
  Reihenfolge und Verifikation im Zeiger-Job (Phase 6.2, 6.3)
- `Cargo.lock` in den Workspace-Root verschieben, `--locked`, Lockfile
  im Bump-Skript (Phase 3.5, 6.4)
- Release-Notes-Pfad und `release.yml` im selben PR; Root-`test`-Skript
  in Phase 1; Grundlagen vor UI extrahieren; `rangeInput` bleibt im
  Modul (Phase 1, 2, 4)
- Vollständige Settings-Liste, `app_state`-Schlüssel per Test fixiert,
  `settings.extend` für Zeilen in Kit-Sektionen (Phase 4.0, 4.4)
- Overlays, Cleanup, Shell-Steuerung, „Über" parametrisiert,
  injizierte Dienste im Modul-Vertrag (Abschnitt 6)
- PDF-TTFs als Modul-Assets, PDF-Export aus dem Bundle als Abnahme
  (Phase 4.6)
- CSS-Regeln aus `global.css` mitnehmen, Legacy-Token-Check, visueller
  Test ohne ScriptZ-CSS (Phase 4, 4.7)
- Test-Preset, pnpm-Catalog, Paket-Konventionen, Vite-Helfer als
  eigener Subpath (Phase 3.2, 3.3, 5.3)
- Shortcut-Registry mit Kontext, `global-shortcut` kein Standard
  (Phase 4.5, 5.4)
- Single-Instance, Menü, Dock-Verhalten, Capabilities als Basis plus
  Ergänzung (Phase 5.2, 5.4)
- Generator: ID-Validierung, reservierte Namen, Port-Trio, Lockfiles,
  Icons ohne Chrome, Installer-Namen aus der ID, veröffentlichtes
  Pre-Release, Download ohne Login, `soon` → `available`, Vercel-
  Ignore inkl. Lockfile (Phase 7, 8)
- E1 vorsichtiger formuliert, pauschale Sync-Vorbereitungen gestrichen,
  Speicherregel präzisiert (Abschnitt 2, 14)
- Root-`LICENSE`, Schriftlizenzen, CodeRabbit-Limit korrekt
  eingeordnet, vollständige i18n-Exporte, Begründung der manuellen
  Erstinstallation korrigiert

Nicht übernommen: Renovate/Dependabot (optional, kann jederzeit später
kommen).
