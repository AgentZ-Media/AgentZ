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

**Stand Phase 4:** `apps/scriptz` verdrahtet das Produktmodul
`modules/scriptz` und Tauri. `packages/kit` enthält die gemeinsame
`SuiteShell`, neutrale UI, i18n, Basis-Settings, Navigation, Plattform-
Interfaces, KvStore, Toasts und Speicherhelfer. Das ScriptZ-Modul
exportiert `scriptzModule: AppModule` und liefert Fachlogik und
Produkt-Erweiterungen. `packages/design` enthält Tokens, CSS, Schriften,
Icons und Logo; `tooling/vitest-preset` die Testkonfiguration.

**Erst später:** `packages/desktop` und `crates/agentz-desktop` in Phase 5.
Website und App-Generator folgen in Phase 7 beziehungsweise 8. Kein Import
darf deren Existenz voraussetzen.

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

Der Host registriert Plattform, Kit-KvStore, Produkt-Storage und Updater
vor `render()`. `SuiteShell` startet den Basis-Settings-Lebenszyklus und
lädt Sprache/Theme, bevor sie `module.setup(ctx)` aufruft. ScriptZ startet
dort Produkt-Settings, Navigation und relative Uhr, lädt seine Boot-Daten
und migriert Legacy-Blöcke. Erst danach starten Ideen-, Statistik- und
Bibliotheksresources.

`ctx.signal` kennzeichnet einen abgebrochenen Boot. Cleanup sofort über
`ctx.onDispose()` registrieren, nicht erst am Ende einer langen asynchronen
Initialisierung. Nach jedem `await` das Signal prüfen; reaktive synchrone
Initialisierung nach einem `await` mit `ctx.runOwned()` an die Shell-Lebensdauer
binden. Diese Funktion trägt Ownership nicht über ein weiteres `await`.
Die Shell beendet auch eine erst nach Unmount zurückkehrende Runtime.
Die Desktop-Schale beendet Updater-Polling und Fenster-Listener.
Solid-generierte JSX-Event-Delegation ist Framework-Verhalten,
keine anwendungseigene Import-I/O.

Das Kit deklariert `sideEffects: ["*.css"]` und explizite Subpath-Exporte.
Die App-/Modulpakete behalten vorerst das Standardverhalten für Laufzeit-
Seiteneffekte; der Import-Lebenszyklus allein ist keine Freigabe für
pauschales `sideEffects: false`.

## Paket-Konventionen und gemeinsame Konfiguration

- ESM mit `"type": "module"`.
- Explizite `exports` für öffentliche Subpaths; keine Wildcard-Freigabe
  sämtlicher interner Dateien. ScriptZ exportiert nur den Moduleinstieg,
  `./storage` und `./styles.css`. Asset-Globs im Designpaket bleiben zulässig.
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

- **Kit:** produktneutrale Solid-UI und Shell, i18n, Basis-Settings,
  Nav-Fabrik, allgemeiner Dialogzustand, Shortcuts, Toasts, Plattform-
  Interfaces, KvStore und Speicherhelfer. Kein Wissen über Skripte oder Charaktere.
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
  den Zugriff. Produkt-Storage wird separat registriert; `ScriptzStorage`
  enthält ausschließlich fachliche Operationen.
- `@agentz/kit/i18n`: gemeinsame Sprachauflösung und typsichere Katalog-
  Komposition mit `createI18n()` beziehungsweise `createModuleI18n()`.
  Produktneutrale Texte gehören ins Kit, Produkttexte ins Modul.
- `@agentz/kit/lib`: `serialSave`, `FlushCoordinator`, `registerFlusher`
  und `flushAll(timeout)`. Ein Flush liefert `{ ok, failed }`; Fehler,
  negative Save-Ergebnisse und Timeouts sind keine erfolgreiche Sicherung.
  `requireSuccessfulFlush()` bricht abhängige Aktionen bei Fehler ab.
  Neutrale Formatierung und relative Uhr liegen ebenfalls hier.
  Registrierungen beim Abbau entfernen, ausstehende Saves vorher sichern.
- `@agentz/kit/stores`: Toasts, Basis-Settings, allgemeiner Dialogzustand
  und generische Navigation/Layout-Persistenz. Die Schlüssel `theme`,
  `language`, `update_check_enabled` und `hourly_update_check` gehören
  zu den Basis-Settings; `dark_paper` bleibt im Produkt.
- `@agentz/kit/ui`: neutrale Dialoge, Icons, parametrisierbare App-Markierung,
  Boot-Fehler, Toast-Host und Settings-Bausteine.
- `@agentz/kit/shell`: `SuiteShell`, Modul-Vertrag, Settings-Dialog,
  Befehlspalette und Shortcut-Registry.
- `@agentz/kit/styles.css`: zugehörige Styles mit semantischen Tokens,
  ohne Abhängigkeit von ScriptZ-CSS oder `legacy.css`.

`ExportPdfDeps`, Lexical, Produkt-Routen und Produkt-Storage bleiben im
ScriptZ-Modul. Keine dauerhaften Reexports alter Modulpfade anlegen.

## Modul-Vertrag

Die verbindlichen Typen stehen in `packages/kit/shell/types.ts`.
`AppModule` beschreibt ID, Namen, Logo, Über-Texte und i18n-Kataloge als
reine Daten. `setup(ctx)` läuft nach Adapter, KvStore, Basis-Settings,
Sprache und Theme. Sein `ModuleRuntime` liefert Routen mit Match-Prädikaten,
Sidebar-Inhalt und optional Footer, Overlays, Einstellungen, Befehle,
Tastenkürzel und Onboarding. Das Kit kennt die Produkt-Route-Union nicht.

`ModuleContext` injiziert `platform`, `kv`, `shell`, `services` sowie
`signal`, `onDispose()` und `runOwned()`. `ShellControls` steuert allgemeine
Dialoge und Sidebar; Fokus blendet die Sidebar aus, ohne die gespeicherte
Präferenz zu überschreiben. `dispose()` beendet die Runtime;
`flushPending()` meldet bei Bedarf ein überprüfbares Flush-Ergebnis.

`settings.sections` ergänzt fachliche Seiten; `settings.extend` hängt
Zeilen an vorhandene Kit-Sektionen. Appearance, Shortcuts, Updates und
About gehören ins Kit. Die Shortcut-Hilfe entsteht aus derselben Registry
wie die globalen Handler. Lokale Lexical-/Listen-Handler bleiben lokal und
können reine Dokumentationseinträge liefern. Kontexte (`shell`, `editor`,
`list`, `dialog`), Composition und bereits behandelte Events beachten.

Befehlssuche und Ranking bleiben Produktaufgabe; das Kit stellt Palette,
Abbruchsignal, Ladezustand und Tastaturnavigation bereit. Onboarding-Inhalt
und Markername kommen vom Modul; die Shell verwaltet Anzeige und Abschluss.
Persistierte Marker und JSON-Formate niemals im strukturellen Umbau ändern.

## Unabhängige Kit-Abnahme

`packages/kit/__tests__/fixtures/` enthält ein kleines Modul mit eigener
Route, Einstellungsseite, Overlay und DE-/EN-Texten. Die Tests rendern die
Shell ohne ScriptZ-Import. `pnpm --filter @agentz/kit test:fixture` startet
dieselbe Fixture auf `http://127.0.0.1:4174`; die Seite importiert nur
Design- und Kit-Styles, kein `legacy.css`. Hell/Dunkel sowie Sprache,
Einstellungen und Shortcuts lassen sich dort unabhängig prüfen.

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
