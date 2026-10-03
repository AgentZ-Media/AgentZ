# AgentZ Suite

pnpm- und Cargo-Monorepo für eigenständige, lokale Desktop-Apps für Content
Creator. Repository `AgentZ-Media/AgentZ`. Aktuell einzige App: ScriptZ.

## Struktur

| Pfad | Paket | Inhalt |
|---|---|---|
| `apps/<app>/` | `@agentz/<app>-app` | Dünne Tauri-Schale: App-ID, Icons, Capabilities, SQL-Migrationen. |
| `modules/<app>/` | `@agentz/<app>` | Produkt: Routen, UI, Fachlogik, Storage, eigene i18n. Exportiert ein `AppModule`. |
| `packages/kit/` | `@agentz/kit` | Produktneutral: `SuiteShell`, UI, i18n-Engine, Basis-Settings, Navigation, Shortcuts, Toasts, `KvStore`, Speicherkoordination. |
| `packages/desktop/` | `@agentz/desktop` | Tauri-Host: Plattformadapter, Updater, Fenster-/Quit-Lebenszyklus, `@agentz/desktop/vite`. |
| `crates/agentz-desktop/` | Rust | Standard-Plugins, macOS-Menü, Single-Instance, Quit-Handshake, `KIT_BASELINE_SQL`. |
| `packages/design/` | `@agentz/design` | Tokens, CSS-Primitive, Schriften, Icons, Logos. Kein Framework. |
| `apps/site/` | `@agentz/site` | Statische Astro-Website (DE/EN) mit App-Liste. |
| `tooling/` | | Generator (`new-app`), Release-Skripte, Prüfungen, Test-Preset. |

Abhängigkeitsrichtung (ESLint erzwingt sie):

```text
apps/<app> -> modules/<app> -> packages/kit -> packages/design
    |                              ^
    +------> packages/desktop ------+
apps/site -> packages/design
```

Kein Tauri in Kit oder Modulen, kein Produktwissen im Kit, keine Importe
zwischen Produkten. Details: [`suite-architecture.md`](.claude/rules/suite-architecture.md).

## Regeln, die nicht aus dem Code offensichtlich sind

- **Daten der installierten App sind heilig.** Bundle-Identifier, DB-Name
  (`sqlite:<id>.db`), veröffentlichte Migrationen sowie Settings- und
  `app_state`-Schlüssel samt JSON-Form nie ändern. Schemaänderungen nur als
  neue, angehängte Migration. `pnpm dev:<app>` nutzt dieselben Daten wie die
  installierte App: vor Arbeit an Speicher, Migrationen oder Boot die DB sichern
  (siehe [`apps/scriptz/CLAUDE.md`](apps/scriptz/CLAUDE.md)).
- **Keine I/O beim Import.** Stores, Resources, Timer und Listener entstehen
  erst in `setup(ctx)` und werden über `ctx.onDispose()` abgebaut.
- **Speichern über den Flush-Koordinator** (`registerFlusher`). Inhalt
  (`content`, Standard) blockiert Navigation, Export und Snapshots, UI-Zustand
  (`state`) nie. Schließen und Beenden warten auf beides.
- **Farben nur als `var(--token)`** außerhalb von `packages/design`.
  Ausnahmen: Inhaltsfarben als Daten (Charakter-Palette) und OS-Nachbauten.
  Kit und neue Apps nutzen kein `legacy.css` (`check:colors`, `check:tokens`).
- **Jeder sichtbare Text in DE und EN** (siehe [`i18n.md`](.claude/rules/i18n.md)).
- **Neue Apps nur über `pnpm new-app`**, Releases nur über
  `pnpm release:bump` und Tags `<app>-vX.Y.Z` (siehe [`release.md`](.claude/rules/release.md)).
- **Regel der Zwei:** Ins Kit kommt nur, was heute produktneutral ist oder ein
  zweites Produkt wirklich braucht.

## Befehle (Repo-Root)

```bash
pnpm install --frozen-lockfile
pnpm dev:scriptz | build:scriptz      # App starten / native bauen
pnpm dev:site | build:site            # Website
pnpm lint && pnpm typecheck && pnpm test
pnpm check:colors && pnpm check:tokens && pnpm check:astro
pnpm build:frontends                  # Vite-Builds ohne native Bundles
cargo check --workspace --locked
pnpm new-app <id> "<Name>" | remove-app <id>
pnpm release:bump <app> <version>
```

Die CI (`CI passed`, Pflicht für `main`) führt Lint, Typecheck, Tests, alle
Checks, Frontend-Builds und `cargo check` aus. Den Dev-Server startet der User
selbst; zur Prüfung reichen die Befehle oben.

## Workflow nach jeder Änderung (wichtig)

Nach **jeder** abgeschlossenen Aufgabe **niemals automatisch committen,
pushen oder releasen**, außer der User hat es für genau diese Aufgabe
ausdrücklich freigegeben. Stattdessen kurz zusammenfassen:

1. **Was wurde geändert?** Ein Satz plus Liste der angefassten Dateien.
2. **Konsistenz-Check:** Müssen Versionen synchron gezogen werden? Neue App
   oder geänderter App-Name/Icon: auch `apps/site/src/apps.ts` und das Logo prüfen.
3. **Empfehlung:**
   - **Trivial** (Tippfehler, Kommentar): Direkt-Commit auf `main`, kein Release.
   - **Kleiner, wichtiger Bugfix:** Commit + Patch-Release `<app>-vX.Y.Z+1`.
   - **Feature oder nicht-trivialer Refactor:** PR (CodeRabbit), danach ggf.
     Minor-Release.
   - **Risiko-Änderung** (Migrationen, Speicherformat, Build-Pipeline):
     immer PR, nie direkt.
4. **Auf Antwort warten.** Erst handeln, wenn der User sagt, was er will.

## Sprache pro Artefakt

| Artefakt | Sprache |
|---|---|
| `README.md`, Paket-READMEs, `docs/release-notes/**` | Englisch (Schaufront) |
| Code-Kommentare, Testnamen, Konsolenmeldungen | Englisch |
| `CLAUDE.md`, `.claude/rules/*`, `docs/*.md` | Deutsch |
| i18n-Kataloge (Kit, Module, Website) | DE und EN, jeweils vollständig |
| Impressum, Datenschutz | Deutsch (deutsches Recht) |
| Commit-Messages, PR-Texte | Deutsch |

Ausnahme: veröffentlichte SQL-Migrationen bleiben wie sie sind, auch mit
deutschen Kommentaren (Prüfsummen).

Deutsche Texte: normaler Bindestrich, **kein Em-Dash**, **echte Umlaute**
(ä, ö, ü, ß), nie ae/oe/ue/ss als Ersatz. Englische Texte: Bindestriche als
Standard, Em-Dashes sparsam.
