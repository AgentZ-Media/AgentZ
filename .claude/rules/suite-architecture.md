---
paths:
  - "apps/**"
  - "modules/**"
  - "packages/**"
  - "crates/**"
  - "tooling/**"
  - "eslint.config.js"
  - "tsconfig.base.json"
  - "pnpm-workspace.yaml"
  - "Cargo.toml"
---

# Suite: Architektur und Paket-Konventionen

Die Suite entwickelt unabhängige lokale Desktop-Apps in einem Repository.
Jede App behält ihre Datenbank, App-ID, Produktlogik und Releases. Maßgeblich
ist der [Fundament-Plan](../../docs/agentz-suite-fundament.md). Der
[Umsetzungsstand](../../docs/agentz-suite-fortschritt.md) hält Fortschritt
und Prüfungen fest.

## Bestand und Ziel auseinanderhalten

**Stand Phase 4.1 bis 4.3:** `apps/scriptz` verdrahtet das Produktmodul
`modules/scriptz` und Tauri. `packages/kit` enthält neutrale UI, i18n,
Plattform-Interfaces, KvStore, Toasts und Speicherhelfer. Das ScriptZ-Modul
behält vorerst AppShell, Einstellungen und Navigation. `packages/design`
enthält Tokens, CSS, Schriften, Icons und Logo. `tooling/vitest-preset`
bündelt die Testkonfiguration.

**Erst später:** Gemeinsame Shell und Modul-Vertrag folgen innerhalb von
Phase 4; `packages/desktop` und `crates/agentz-desktop` in Phase 5. Website
und App-Generator folgen in Phase 7 beziehungsweise 8. Kein Import darf
deren Existenz voraussetzen.

Zielrichtung (die Grenzen werden bereits jetzt per ESLint geprüft):

```text
apps/<app> -> modules/<app> -> packages/kit -> packages/design
    |                              ^
    +------> packages/desktop ------+

apps/site -> packages/design
```

- `design` importiert nichts aus dem Repo und bleibt frameworkunabhängig.
- `kit` importiert nur `design`: kein Tauri, kein Produktwissen.
- `desktop` importiert `kit` und Tauri, keine Produktmodule.
- Produktmodule importieren `kit` und `design`, keine Apps, anderen
  Module oder `@tauri-apps/*`.
- Apps verbinden ihr eigenes Modul mit dem Host. Sie enthalten die
  App-Konfiguration und native Migrationen.
- Paketübergreifende Importe verwenden den öffentlichen Paketnamen und
  dessen explizite Exporte. Relative Pfade sind nur innerhalb desselben
  Pakets erlaubt. Neue öffentliche Einstiege bewusst in `exports` anlegen.
- Tooling ist Build-/Testkonfiguration und gehört nicht ins App-Bundle.

ESLint startet bewusst ohne Formatierungsregeln. Ausnahmen nicht durch
breitere Grenzen kaschieren, sondern gezielt und mit Begründung behandeln.
`pnpm check:colors` prüft zusätzlich harte Hex-/rgb-Farben in CSS und
TSX außerhalb von `packages/design`; Charakter-Palette und der neutrale
Color-Picker-Platzhalter haben gezielte Ausnahmen. Zukünftige Nachbauten
von OS-Trafficlights brauchen eine ebenso gezielte Ausnahme.
Test-Fixtures sowie berechnete Charakter-/PDF-Farbdaten in TypeScript
werden nicht als UI-Tokens behandelt. Neue UI-Farben sind semantische
Design-Tokens.
`pnpm check:tokens` untersagt Legacy-Token-Namen und `legacy.css`-Imports
im Kit einschließlich Fixtures sowie in neuen Apps/Modulen/Paketen. Nur
der bestehende ScriptZ-Code und das Designpaket behalten die Übergangsschicht.

## Import und Lebenszyklus

Module und Kit starten beim Import **keine I/O**:
keine DB-Resources, keine `api.*`-Aufrufe, keine Timer oder automatisch
laufenden Effekte mit Seiteneffekten. Datenzugriff beginnt in einer
expliziten Initialisierung nach Registrierung des Plattformadapters.
Timer, Listener und Effekte brauchen einen definierten Aufräumpfad.

Seit Phase 4.0 startet ScriptZ eigene I/O, Timer und Ressourcen nur
explizit. `apps/scriptz/src/index.tsx` ruft vor `render()` in dieser
Reihenfolge `registerDesktopPlatform()`, `registerSqlStorageAdapter()`
und `registerDesktopUpdates()` auf. `AppShell` startet die Einstellungen,
Navigation und relative Uhr über `startSettingsRuntime()`,
`startNavRuntime()` und `startRelativeTimeClock()`.

Erst nach den Boot-Ladevorgängen und der Legacy-Migration folgen
`startIdeasStore()`, `startDailyStatsStore()` und `startLibraryData()`.
Alle liefern Cleanup-Funktionen; `AppShell` beendet die Laufzeiten beim
Unmount und startet nach einem während des Bootens erfolgten Unmount
keine nachträglichen Resources. Die Desktop-Schale beendet ebenfalls
Updater-Polling und Fenster-Listener. Solid-generierte JSX-Event-Delegation
ist Framework-Verhalten, keine anwendungseigene Import-I/O.

Das Kit deklariert `sideEffects: ["*.css"]` und explizite Subpath-Exporte.
Die App-/Modulpakete behalten vorerst das Standardverhalten für Laufzeit-
Seiteneffekte; der Import-Lebenszyklus allein ist keine Freigabe für
pauschales `sideEffects: false`.

## Paket-Konventionen und gemeinsame Konfiguration

- ESM mit `"type": "module"`.
- Explizite `exports` für öffentliche Subpaths; keine Wildcard-Freigabe
  sämtlicher interner Dateien. ScriptZ behält während der Migration
  seine bestehenden Wildcard-Subpaths; Phase 4 verengt diese beim
  Herauslösen des Kits. Asset-Globs im Designpaket bleiben zulässig.
- Neue seiteneffektfreie Laufzeitpakete deklarieren
  `"sideEffects": ["*.css"]`, damit ihre Styles beim Tree-Shaking erhalten
  bleiben. Weitere notwendige Initialisierung explizit deklarieren;
  Bestand siehe oben.
- Interne Abhängigkeiten verwenden `workspace:*`. Gemeinsame externe
  Versionen kommen aus dem Catalog in `pnpm-workspace.yaml` über
  `catalog:`. Die pnpm-Version steht verbindlich in `package.json`.
- `tsconfig.base.json` enthält nur gemeinsame Compileroptionen. `include`,
  `types` und lokale Aliasse wie `~` bleiben im jeweiligen Paket.
- Pakete mit TypeScript erhalten ein `typecheck`-Skript. Testbare Pakete
  nutzen das gemeinsame Preset und ein `test`-Skript; kein dupliziertes
  Solid-/jsdom-Setup pro Paket.

```ts
import { definePackageTest } from "@agentz/vitest-preset";

export default definePackageTest();
```

Das Preset stellt das Solid-Plugin, jsdom sowie die Auflösungsbedingungen
`browser` und `development` bereit. Produktspezifisches Test-Setup
(z. B. Sprache und Adapter) bleibt beim Produkt und wird dort ergänzt.

Vom Repo-Root: `pnpm lint`, `pnpm typecheck`, `pnpm test`,
`pnpm check:colors`, `pnpm check:tokens`, `pnpm build:frontends`.
Der Frontend-Build erstellt keine nativen Installer. Die PR-CI prüft diese
Schritte und `cargo check --workspace --locked`. `pnpm test` prüft zuerst
die Tooling-Regeln mit dem Node-Test-Runner, danach die Pakettests.

## Rust-Workspace

Root-`Cargo.toml` bündelt die App-Crates unter `apps/*/src-tauri`, gemeinsame
Abhängigkeiten und das Release-Profil. `Cargo.lock` wurde aus ScriptZ in
den Root verschoben, ohne die vorhandenen Rust-Versionen zu aktualisieren.
`crates/*` wird erst ergänzt, wenn Phase 5 tatsächlich eine Crate anlegt;
ein leerer Cargo-Glob wäre kein gültiges Workspace-Mitglied.

Build-Ausgaben liegen in `target/` im Repo-Root. Ohne explizites Target
entstehen Installer unter `target/release/bundle/`, mit explizitem Target
unter `target/<target-triple>/release/bundle/`. `pnpm install
--frozen-lockfile` schützt nur das JavaScript-Lockfile; Rust-Prüfungen
verwenden zusätzlich `--locked`.

Tauri-JS-Pakete im pnpm-Catalog und die zugehörigen Rust-Crates immer
zusammen aktualisieren und anschließend beide Lockfiles prüfen. Die
Rust-Angabe `"2"` ist nur der erlaubte Versionsbereich; `Cargo.lock`
fixiert den tatsächlich verwendeten Stand. Nach `cargo update` deshalb
auch die kompatiblen JS-Versionen abgleichen und den nativen Build prüfen.

Die Farbprüfung ist bewusst eine Textprüfung für CSS/TSX. `.ts` und
HTML werden nicht erfasst; CSS-IDs wie `#add` oder `#face` können als
Farbwerte erscheinen. Solche Fälle gezielt behandeln, nicht ganze
UI-Dateien freistellen.

## Wer verantwortet was?

- **Kit:** produktneutrale Solid-UI, i18n-Engine, Toasts, Plattform-
  Interfaces, KvStore und Speicherhelfer. Shell, Basiseinstellungen und
  Nav-Fabrik folgen in Phase 4.4/4.5. Kein Wissen über Skripte oder Charaktere.
- **Modul:** Produktdaten, Storage-Interface und dessen SQL-Implementierung,
  Screens, fachliche Stores, eigene i18n-Texte und Einstellungen. Der
  ScriptZ-Editor samt Lexical-Nodes und PDF-Export bleibt hier.
- **Desktop-Host (ab Phase 5):** Plattformadapter, native Dialoge,
  Updater, Fenster-Lebenszyklus und sichere Save-Flush-Integration.
- **App:** Modul und Host verbinden; App-ID, Datenbankname, Icons,
  Capabilities und additive Produktmigrationen konfigurieren.

UI und Fachlogik nutzen das Storage-Interface ihres Moduls. Die
SQL-Implementierung darf im selben Modul liegen; native APIs bleiben
hinter dem Plattformadapter. Bundle-Identifier `de.agent-z.scriptz`,
`scriptz.db`, Migrationen und persistierte Schlüssel sind beim
strukturellen Umbau unverändert zu erhalten.

## Bereits extrahierte Kit-APIs

- `@agentz/kit/platform`: `PlatformAdapter`, `DbConnection`, `KvStore`,
  Tastatur-Helfer und Update-Slot. Adapter werden explizit registriert.
  Der SQL-KvStore nutzt die injizierte Verbindung; Datenbankname und
  Migrationen bleiben Host-Verantwortung. Das Kit greift nur auf
  `settings` und `app_state` zu. `createSqlKvStore(getDb)` erzeugt ihn,
  `setKvStore()` registriert ihn; `getKvStore()` und `kvStore` liefern
  den Zugriff. ScriptZ registriert beide Speicherteile gemeinsam über
  `setStorageAdapter()` und die vorläufige `ScriptzApiStorage`-Fassade.
- `@agentz/kit/i18n`: gemeinsame Sprachauflösung und typsichere Katalog-
  Komposition mit `createI18n()` beziehungsweise `createModuleI18n()`.
  Produktneutrale Texte gehören ins Kit, Produkttexte ins Modul.
- `@agentz/kit/lib`: `serialSave`, `FlushCoordinator`, `registerFlusher`
  und `flushAll(timeout)`. Ein Flush liefert `{ ok, failed }`; Fehler,
  negative Save-Ergebnisse und Timeouts sind keine erfolgreiche Sicherung.
  Registrierungen beim Abbau entfernen, ausstehende Saves vorher sichern.
- `@agentz/kit/stores`: Toast-Zustand.
- `@agentz/kit/ui`: neutrale Dialoge, Icons, parametrisierbare App-Markierung,
  Boot-Fehler, Toast-Host und Settings-Bausteine.
- `@agentz/kit/styles.css`: zugehörige Styles mit semantischen Tokens,
  ohne Abhängigkeit von ScriptZ-CSS oder `legacy.css`.

`ExportPdfDeps`, Lexical, Produkt-Routen und Produkt-Storage bleiben im
ScriptZ-Modul. Keine dauerhaften Reexports alter Modulpfade anlegen.

## Geplanter Modul-Vertrag (Phase 4.5, noch keine API)

`AppModule` beschreibt ID, Namen, Logo, Über-Texte und i18n-Kataloge als
reine Daten. Sein `setup(ctx)` läuft erst nach Adapter, KvStore,
Basiseinstellungen, Sprache und Theme. Es liefert Routen, Sidebar,
optionale Overlays, Einstellungen, Befehle, Tastenkürzel und Onboarding.
`flushPending` sichert ausstehende Änderungen mit überprüfbarem Ergebnis;
`dispose` entfernt Timer, Listener und Effekte. `ModuleContext` injiziert
Plattform, KvStore, Shell-Steuerung und produktbezogene Dienste.

Der Host lädt das Modul später lazy, nachdem er Adapter und Updater
registriert hat. Das ersetzt **nicht** die Regel gegen I/O beim Import.
Die konkrete API wird erst bei der Extraktion in Phase 4.5 festgelegt.

## Ports

Vite-Port, HMR-Port und Tauri-`devUrl` immer gemeinsam pflegen:

| App | Vite | HMR | Tauri devUrl | Stand |
|---|---|---|---|---|
| ScriptZ | 1420 | 1421 | `http://localhost:1420` | aktiv |
| Nächste App | 1430 | 1431 | `http://localhost:1430` | reserviertes Schema |

Weitere Apps erhalten das nächste freie Paar in Zehnerschritten. Bei
Remote-Entwicklung (`TAURI_DEV_HOST`) nutzt ScriptZ den separaten
HMR-Port 1421; lokal verwendet HMR standardmäßig den Vite-Server.
Die reservierten Portpaare bleiben pro App eindeutig.

## Regel der Zwei

Ins Kit kommt nur, was heute bereits produktneutral ist oder ein zweites
Modul tatsächlich braucht. Nicht für hypothetische Apps abstrahieren.

- Lexical bleibt vollständig in ScriptZ, bis ein zweites Produkt ihn braucht.
- Ordner, Papierkorb, Snapshots und Suche bleiben mit ihrem aktuellen
  Skript-Datenmodell im Modul. Erst ein echter zweiter Anwendungsfall
  bestimmt eine gemeinsame Abstraktion.
- PDF-Export und `dark_paper` bleiben ScriptZ-Funktionen.
- Gemeinsame Bausteine dürfen keine ScriptZ-Imports als versteckte
  Voraussetzung haben. Die spätere Kit-Abnahme muss ohne ScriptZ-CSS
  und ohne ScriptZ-Modul funktionieren.
