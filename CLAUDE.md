# AgentZ Suite - Monorepo

pnpm-Workspace für eigenständige lokale Desktop-Tools für Content Creator.
Repository: `AgentZ-Media/AgentZ`, Root-Paket: `agentz`.
ScriptZ ist derzeit die einzige App. Der
[Fundament-Plan](docs/agentz-suite-fundament.md) beschreibt den schrittweisen
Umbau; die nachfolgende Trennung von Bestand und Ziel ist verbindlich.
Der [Umsetzungsstand](docs/agentz-suite-fortschritt.md) dokumentiert
abgeschlossene Schritte, Prüfungen und offene Punkte.

## Aktuelle Struktur (Phase 4.1 bis 4.3)

- [`apps/scriptz/`](apps/scriptz/) - `@agentz/scriptz-app`, die dünne
  Tauri-Schale für ScriptZ. Registriert Plattform- und Speicheranbindung,
  native Dialoge, Auto-Updater und Save-Flush beim Fensterschließen.
  Rust verdrahtet Plugins und SQL-Migrationen. App-Regeln stehen in
  [`apps/scriptz/CLAUDE.md`](apps/scriptz/CLAUDE.md).
- [`modules/scriptz/`](modules/scriptz/) - `@agentz/scriptz`, derzeit
  **ScriptZ-Logik und Produkt-UI**: Editor, Lexical-Nodes, Plugins,
  App-Schale, fachliche Stores und Export-Generatoren. Shell, Einstellungen
  und Navigation werden in den nächsten Schritten getrennt. Darf **nie**
  `@tauri-apps/*` importieren.
- [`packages/kit/`](packages/kit/) - `@agentz/kit`, produktneutrale
  Solid-Bausteine, i18n-Engine, Plattform-Interfaces, KvStore, Toasts
  und Speicherkoordination. Kein Tauri und kein Produktwissen.
- [`packages/design/`](packages/design/) - `@agentz/design`, das
  Designsystem der Suite: semantische Tokens hell/dunkel, Legacy-Aliasse,
  CSS-Primitive, UI-Schrift, Icons und Logo. Reines CSS und Daten-Module,
  kein Framework. Details in der [Paket-README](packages/design/README.md).
- [`tooling/vitest-preset/`](tooling/vitest-preset/) -
  `@agentz/vitest-preset`, gemeinsame Solid-/jsdom-Testkonfiguration.
- [`docs/release-notes/scriptz/`](docs/release-notes/scriptz/) -
  ScriptZ-Release-Notes. Der gemeinsame Install-Footer bleibt in
  `docs/release-notes/_install_footer.md`.

Aktuelle Abhängigkeitsrichtung:

```text
apps/scriptz -> modules/scriptz -> packages/kit -> packages/design
```

## Zielstruktur (noch nicht umgesetzt)

Der Kit-Kern ist vorhanden; gemeinsame Shell und Modul-Vertrag folgen
innerhalb von Phase 4. `@agentz/desktop` und die Rust-Crate
`crates/agentz-desktop` entstehen in Phase 5. Website und Generator
folgen später und dürfen heute nicht als vorhanden vorausgesetzt werden.

```text
apps/<app> -> modules/<app> -> packages/kit -> packages/design
    |                              ^
    +------> packages/desktop ------+
```

- `design` importiert nichts aus dem Repo.
- `kit` importiert nur `design`: keine Tauri-Imports und kein Produktwissen.
- `desktop` importiert `kit` und Tauri, keine Module.
- Produktmodule importieren `kit` und `design`, keine Apps oder anderen Module.
- Apps verdrahten Produktmodul und Host; `apps/site` nutzt nur `design`.

ESLint prüft die Paketgrenzen. `tsconfig.base.json`, der pnpm-Catalog
und `@agentz/vitest-preset` bündeln gemeinsame Konfiguration. Der
Cargo-Workspace nutzt `Cargo.toml`, das verschobene `Cargo.lock` und
`target/` im Repo-Root. `crates/*` kommt erst als Workspace-Mitglied
hinzu, wenn Phase 5 die erste Crate anlegt. PR-CI prüft JavaScript und
Rust. Das Release-Schema bleibt bis Phase 6 `vX.Y.Z`; der App-Name
bleibt ScriptZ.

## Konventionen während des Umbaus

ScriptZ behält sein Verhalten. Produktlogik und UI leben vorerst in
`modules/scriptz/`, OS-Integration in `apps/scriptz/`. Allgemeine Bausteine
werden erst in ihren vorgesehenen Phasen extrahiert.

Das Modul greift über `PlatformAdapter` aus `@agentz/kit/platform` auf
Plattformdienste zu. Das Kit verantwortet `KvStore` für `settings` und
`app_state`; das Produkt-Storage in `modules/scriptz/lib/storage.ts`
beschreibt die fachlichen Datenzugriffe; `lib/api.ts` stellt `registerSqlStorageAdapter()` für die
explizite Registrierung des SQL-Defaults bereit. Der App-Einstieg
registriert Plattform, Storage und Updater vor dem Rendern. Die
SQLite-Verbindung liefert `PlatformAdapter.getDb()`. Neue Datenzugriffe müssen Interface und
Implementierung aktualisieren. Schemaänderungen laufen über additive
SQL-Migrationen in `apps/scriptz/src-tauri/`. Änderungen am Datenmodell
auch im `.scriptz`-Import/Export abbilden. Capability-Flags wie
`supportsDirectoryWrite` bleiben erhalten.

Bundle-Identifier `de.agent-z.scriptz`, `productName` ScriptZ, `scriptz.db`,
Migrationen sowie persistierte Settings- und `app_state`-Schlüssel bleiben
beim strukturellen Umbau unverändert. Vor riskanten Phasen gilt die
[Datensicherung](docs/agentz-suite-fundament.md#5-datensicherung).

**Keine Hex- oder rgb-Farbwerte außerhalb von `packages/design/`.**
App- und Modul-Code referenzieren nur `var(--token)`. Ausnahmen:
Inhaltsfarben als Daten (Charakter-Palette in
`modules/scriptz/styles/tokens.css`, `characterColors.ts`) und
OS-Chrome-Nachbauten (macOS-Trafficlights). `pnpm check:colors`
prüft diese Grenze mit einer gezielten Ausnahmeliste.

Module dürfen beim Import keine I/O, Resources mit Datenzugriff
oder Timer starten. Seit Phase 4.0 beginnt ScriptZ seinen eigenen
Lebenszyklus explizit: `AppShell` startet Einstellungen, Navigation und
relative Uhr; Ideen, Tagesstatistik und Bibliotheks-Resources folgen
erst nach den Boot-Schritten und der Legacy-Migration. Beim Unmount
werden diese Laufzeiten beendet. Solid-generierte JSX-Event-Delegation
ist von dieser Regel gegen anwendungseigene Import-I/O zu unterscheiden.
Der Kit-Kern ist extrahiert; die Shell bleibt vorerst im Modul und der
Desktop-Host in der App. Paket-Konventionen und die Regel der Zwei stehen
in der Suite-Regel.

## Path-scoped Rules

Details liegen in [`.claude/rules/`](.claude/rules/) und laden bei
Dateien im jeweiligen Scope:

- [`suite-architecture.md`](.claude/rules/suite-architecture.md) -
  Paketgrenzen, Konfiguration, Seiteneffekte, Modul-Vertrag und Ports.
- [`scriptz-architecture.md`](.claude/rules/scriptz-architecture.md) -
  ScriptZ-Modul, Design und App-Schale, Datenmodell, Migration und Data-Flow.
- [`i18n.md`](.claude/rules/i18n.md) - zweisprachige Kataloge und
  User-sichtbare Texte in ScriptZ.
- [`desktop-release.md`](.claude/rules/desktop-release.md) -
  ScriptZ-Updater, Signing, Versionen und Plattform-Setup.
- [`release.md`](.claude/rules/release.md) - aktuelle Release-Pipeline,
  Asset-Naming, Notes und Workflow-Recovery.

## Befehle (vom Repo-Root)

```bash
pnpm install --frozen-lockfile # installiert die JS-Workspaces
pnpm dev:scriptz               # tauri dev der ScriptZ-App
pnpm build:scriptz             # native App und Installer bauen
pnpm lint                      # Paketgrenzen und Korrektheit
pnpm typecheck                 # TypeScript über alle Workspaces
pnpm test                      # Tooling-Regeln und Pakettests
pnpm check:colors              # Farben außerhalb des Designsystems
pnpm check:tokens              # keine Legacy-Tokens im Kit/neuen Paketen
pnpm build:frontends           # Vite-Builds ohne native Bundles
cargo check --workspace --locked # Rust-Workspace ohne Lockfile-Änderung
```

Die pnpm-Version ist in `package.json` festgelegt. Gemeinsame
JS-Versionen stehen im Catalog von `pnpm-workspace.yaml`; interne
Abhängigkeiten verwenden `workspace:*`.

Workspace-Befehle sind auch direkt nutzbar, z. B.
`pnpm --filter @agentz/scriptz-app tauri:dev` oder
`pnpm --filter @agentz/scriptz test`. `pnpm install --frozen-lockfile`
sichert nur `pnpm-lock.yaml`, nicht `Cargo.lock`; dafür ist Cargo mit
`--locked` zuständig. Signierte Updater-Artefakte benötigen den privaten
Release-Schlüssel; ein lokaler Build ohne diesen ist keine Release-Abnahme.

## Workflow nach jeder Änderung (wichtig)

Nach **jeder** abgeschlossenen Aufgabe (Feature, Fix, Refactor,
Doku-Update, egal was) **niemals automatisch committen, pushen oder
releasen**. Stattdessen einmal kurz innehalten und dem User eine
Zusammenfassung + Optionen geben:

1. **Was wurde geändert?** Ein Satz, plus Liste der angefassten
   Dateien. So kann der User selbst nochmal drüberschauen, bevor
   irgendwas rausgeht.
2. **Konsistenz-Check:** Müssen Versionen synchron gezogen werden?
   Wenn ja, sagen.
3. **Empfehlung + Optionen** für das weitere Vorgehen, abhängig von
   der Art der Änderung:
   - **Trivial** (Tippfehler, Kommentar, kleines Style-Detail):
     Direkt-Commit auf `main` reicht. Kein Release nötig.
   - **Kleiner, aber wichtiger Bugfix** (User merkt's, betrifft alle):
     Direkt-Commit auf `main` + Patch-Release `vX.Y.Z+1` empfehlen,
     damit der Auto-Updater die Fix ausrollt. Release-Checkliste
     durchgehen.
   - **Neues Feature oder nicht-trivialer Refactor:** PR auf GitHub
     vorschlagen, damit CodeRabbit drüberschaut. Erst nach Review +
     Merge ggf. Minor-Release `vX.Y+1.0`.
   - **Risiko-Änderung** (Migrations, Storage-Format, Build-Pipeline):
     Immer PR, nie direkt - egal wie klein.
4. **Auf Antwort warten.** Erst handeln, wenn der User explizit sagt
   was er will (z.B. "ja, Patch-Release" oder "PR machen" oder "nur
   committen, kein Release"). Niemals in einem Rutsch durchziehen,
   auch wenn die Empfehlung offensichtlich scheint.

Diese Regel gilt **immer**, auch wenn der User vorher schon eine
Aufgabe ähnlich abgewickelt hat. Jede Änderung ist neu zu bewerten.

## Sprache pro Artefakt (wichtig)

Nicht alles im Repo läuft in derselben Sprache. Die Regel ist nach
**Zielpublikum** sortiert:

| Artefakt | Sprache | Warum |
|---|---|---|
| **README.md** im Repo-Root | **Englisch** | GitHub-Schaufront, internationales Publikum |
| **docs/release-notes/scriptz/vX.Y.Z.md** | **Englisch** | Lädt in den GitHub-Release-Body, internationale User |
| **docs/release-notes/_install_footer.md** | **Englisch** | Ditto, wird an jeden Release-Body angehängt |
| App-i18n `modules/scriptz/i18n/de.ts` | Deutsch | DE-Hälfte des bilingualen App-Katalogs |
| App-i18n `modules/scriptz/i18n/en.ts` | Englisch | EN-Hälfte des bilingualen App-Katalogs |
| **Code-Kommentare** (alle Apps) | **Englisch** | Code-Kommentare laufen einheitlich auf Englisch - das gesamte Repo wurde umgestellt |
| **Doku-Markdown** (CLAUDE.md, docs/*.md außer release-notes) | **Deutsch** | Interne Doku, deutsches Team |
| **Commit-Messages, PR-Texte** | Deutsch | Interne Kommunikation |

Faustregel: Was **auf GitHub als Schaufront** sichtbar ist (README,
Release-Notes) **und Code-Kommentare** laufen auf Englisch. Was
**interne Doku** ist (CLAUDE.md, docs/*.md, Commit-Messages), bleibt
Deutsch. Die zweisprachigen i18n-Kataloge sind ein Sonderfall - siehe
[`i18n.md`](.claude/rules/i18n.md).

### Stil

In **deutschen Texten** wird normaler Bindestrich verwendet, **kein
Em-Dash**. Auch in von Claude generierten Texten.

**Echte Umlaute, keine ASCII-Ersatzschreibung.** In allen
deutschsprachigen Texten (`i18n/de.ts`, interne Doku)
immer `ä`, `ö`, `ü`, `ß` statt `ae`, `oe`, `ue`, `ss`.
Auch wenn die Tastatur das gerade nicht hergibt - dann lieber kurz
suchen als ein "haendisch" ins Repo schreiben.

In **englischen Texten** (README, Release-Notes, `i18n/en.ts`) sind normale Bindestriche ebenfalls Default; Em-Dashes
sind nicht verboten, aber sparsam. Keine Smart-Quotes erzwingen.
