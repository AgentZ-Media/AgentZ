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

# Suite: Architektur

Jede App ist eigenständig: eigener Prozess, eigene App-ID, eigene Datenbank,
eigene Releases. Gemeinsam sind Design, Kit, Desktop-Host, Tooling und Website.

## Grenzen

`tooling/checks/architecture.mjs` (ESLint) erzwingt die Richtung aus
`AGENTS.md`, auch für Typ-Importe, dynamische Importe, `require` und
TS-Aliasse. Paketübergreifend nur über den Paketnamen und dessen `exports`;
relative Pfade nur innerhalb eines Pakets. Ein unbekanntes `@agentz/*`-Paket
ist ein Fehler, bis seine Grenze festgelegt ist. Tooling gehört nie ins Bundle.

## Lebenszyklus

- Kit und Module starten beim Import keine I/O, Timer oder Effekte.
- Der Desktop-Host registriert Plattform, `KvStore` und Updater, lädt dann
  `loadModule()` (Produkt-Styles, Produkt-Storage, Modul) und rendert die
  `SuiteShell`. Die Shell lädt Basis-Settings, Sprache und Theme, startet die
  relative Uhr und ruft `module.setup(ctx)` auf.
- In `setup`: nach jedem `await` `ctx.signal` prüfen, Aufräumen sofort über
  `ctx.onDispose()` registrieren, reaktive Arbeit nach einem `await` mit
  `ctx.runOwned()` binden. Die Shell beendet auch eine Runtime, die erst nach
  Unmount fertig wird.
- Speichern: `registerFlusher(fn, name, kind)`. `content` (Standard) für
  Nutzerinhalt, `state` für UI-Zustand und Einstellungen. Navigation und
  `requireSuccessfulFlush()` prüfen nur `content`; Fenster schließen, Beenden
  und Update-Installation brauchen ein vollständig erfolgreiches `flushAll`.
  Schlägt es wiederholt fehl, fragt der Host „Trotzdem schließen/beenden?".

## Modul-Vertrag

Typen in `packages/kit/shell/types.ts`. `AppModule` ist reine Beschreibung
(ID, Name, Logo, Über-Texte, Kataloge); `setup(ctx)` liefert die
`ModuleRuntime`: Routen, Sidebar, optional Footer, Overlays, Einstellungen
(eigene Sektionen und `settings.extend` für Kit-Sektionen), Befehle,
Shortcuts mit Kontext, Onboarding, `flushPending`, `dispose`.
`revealsSidebar: true` nur, wenn das Modul selbst einen Button zum Einblenden
der Sidebar anbietet; sonst zeigt die Shell einen.

Die Sidebar-Einträge eines Moduls nutzen die Kit-Klassen `.nav` und für den
aktiven Eintrag `.is-on`: Die Shell legt darüber eine gleitende Auswahl
(`NavIndicator`), auch über mehrere Scrollbereiche. Hinter dem Kopf der
Sidebar zeigen Stable-Builds das Punktraster der App-Kachel (`SideDots`),
Nightly-Builds den Nachthimmel.

Das Kit liefert ⌘K (Palette), ⌘, (Einstellungen) und ⌘\ (Sidebar) sowie die
Sektionen Darstellung, Tastatur, Updates und Über. Die Tastatur-Übersicht
entsteht aus derselben Registry wie die Handler; die Registry respektiert
`defaultPrevented`, IME-Eingabe und offene Dialoge.

## Paket-Konventionen

- ESM, explizite `exports`, `sideEffects: ["*.css"]` für neue Laufzeitpakete.
- Interne Abhängigkeiten `workspace:*`, externe Versionen über `catalog:` aus
  `pnpm-workspace.yaml`.
- `tsconfig.base.json` nur mit gemeinsamen Optionen; Tests über
  `@agentz/vitest-preset` (`definePackageTest()`).
- Die Kit-Fixture (`pnpm --filter @agentz/kit test:fixture`, Port 4174) prüft
  die Shell ohne ScriptZ.

## Desktop und Rust

- Root-`Cargo.toml` mit `apps/*/src-tauri` und `crates/*`, ein `Cargo.lock`,
  ein `target/`. Cargo immer mit `--locked`.
- `agentz_desktop::builder(Config { id, migrations })`; die DB heißt
  `sqlite:<id>.db` auf beiden Seiten. Standard-Plugins bleiben zusätzlich
  direkte Abhängigkeiten jeder App (Tauri liest Capabilities über Cargo
  `links`). Capabilities nur so weit wie nötig; `global-shortcut` ist keine
  Basis.
- Tauri-JS-Pakete im Catalog und die Rust-Crates immer gemeinsam
  aktualisieren; Major/Minor müssen übereinstimmen, sonst bricht der Build.
- Ports: Vite, HMR und `devUrl` gehören zusammen. ScriptZ 1420/1421, jede
  weitere App das nächste freie Paar in Zehnerschritten (vergibt der Generator).

## Neue Apps

`pnpm new-app <id> "<Name>"` erzeugt App, Modul, Icons, Kataloge,
Release-Notes-Ordner, Logo- und Website-Eintrag und aktualisiert beide
Lockfiles. Meldet er fremde Änderungen im `pnpm-lock.yaml`, den Diff vor dem
Commit prüfen. `pnpm remove-app <id>` entfernt nur Generiertes mit
Eigentumsnachweis, auch spätere Änderungen in diesen Ordnern. Details:
[`docs/neue-app.md`](../../docs/neue-app.md).

## Große Datenmengen

Apps müssen mit zehntausenden Dokumenten flüssig bleiben. Dafür gilt:

- **Gezielte Updates statt Neuladen.** Ein Autosave meldet das eine geänderte
  Element (Event mit Nutzlast) und Caches ersetzen nur diese Zeile; ein
  Versions-Bus, der die ganze Liste neu lädt, ist für strukturelle Änderungen.
  Neu geladene Listen laufen durch `keepUnchanged` (`@agentz/kit/lib`), damit
  unveränderte Zeilen ihr Objekt und damit ihr DOM behalten.
- **Rendern nach Identität oder Position.** `<For>` nur über Objekte mit
  stabiler Identität; Listen, die bei jeder Änderung neu berechnet werden
  (Gruppen, Spalten, Zeitleisten, gestreamte Blöcke), mit `<Index>`. Pro Zeile
  gelesene Auswahl- oder Hover-Zustände über `createSelector`, Signale mit
  Layout- oder Listendaten mit `equals: sameData`. Lange Listen paginieren.
- **Pro Tastendruck nur Konstantes.** Kein Durchlaufen des ganzen Dokuments,
  keine DOM-Abfragen über die Seite und kein Layout-Lesen direkt nach einem
  Editor-Update; Messungen per `requestAnimationFrame` bündeln, abgeleitete
  Daten entprellen, Update-Listener ohne geänderte Knoten früh verlassen.
- **SQL ohne Inhaltsspalten.** Listenabfragen lesen nur Übersichtsspalten über
  einen Covering-Index (große Text- oder JSON-Spalten liegen in
  Überlaufseiten), Löschpfade und Fremdschlüssel haben Indizes, FTS-Zeilen
  werden über ihre rowid angesprochen. Ein Speichern parst das Dokument einmal.
- **Begrenzte Caches.** Was pro Dokument im Speicher bleibt (geladene Chats,
  Ansichtszustand, Parser-Caches), hat eine Obergrenze und räumt das am
  längsten Unbenutzte zuerst. `Intl`-Formatter über `formatDate`/`formatNumber`.
- **Dauerhafte Animationen** nur über `transform`/`opacity`, damit sie auf dem
  Compositor laufen.

## Regel der Zwei und Ausblick

- Ins Kit nur, was heute produktneutral ist oder ein zweites Produkt wirklich
  braucht. Lexical, Ordner, Papierkorb, Snapshots, Suche und PDF bleiben in
  ScriptZ, bis ein zweites Produkt sie braucht.
- Konten, Sync und Web-Versionen kommen später für alle Apps gleichzeitig.
  Deshalb: Kit bleibt plattformneutral, UI und Fachlogik nutzen das
  Storage-Interface ihres Moduls, neue Fach-IDs sind UUIDs, und
  app-übergreifende Funktionen laufen nie über direkte Modul-Importe.
