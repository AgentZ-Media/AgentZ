# ScriptZ - Monorepo

pnpm-Workspace mit einer Desktop-App, einem Core und einem Designsystem:

- [`packages/core/`](packages/core/) - **alle gemeinsame Logik**: Editor,
  Lexical-Nodes, Plugins, UI-Komponenten inkl. der kompletten App-Schale
  (`components/Shell/AppShell.tsx`), Stores, Business-Logik,
  ScriptZ-spezifische Tokens (Charakter-Palette, A4-Geometrie,
  Papier-Schrift). Die Desktop-Schale importiert von hier via
  `@scriptz/core`. Darf **nie** `@tauri-apps/*` importieren.
  Die vorhandene ESLint-Regel wird erst mit dem Tooling-Ausbau in
  Phase 3 automatisch geprüft.
- [`packages/design/`](packages/design/) - **`@agentz/design`**, das
  Designsystem der AgentZ-Suite (Redesign „Werkbank", 2026-10):
  semantische Tokens hell/dunkel, Alias-Schicht für alte Token-Namen,
  Komponenten-Primitive (`.btn`, `.chip`, `.menu`, `.dlg`, ...),
  UI-Schrift, Icons, Logo. Reines CSS + Daten-Module, kein Framework.
  Details in [`packages/design/README.md`](packages/design/README.md).
- [`apps/desktop/`](apps/desktop/) - die Tauri-Desktop-App (Solid + Rust + Lexical).
  Dünne Schale: registriert `PlatformAdapter` (Tauri-Dialoge, Auto-Updater)
  und `StorageAdapter` (SQLite). Eigene [`CLAUDE.md`](apps/desktop/CLAUDE.md)
  mit App-spezifischen Details.

## Konvention

Produktlogik und UI leben in `packages/core/`: Editor, Lexical-Nodes,
Plugins, App-Schale, Stores, Business-Logik und Export-Generatoren.
`apps/desktop/` verdrahtet diese mit dem Betriebssystem. Tauri-Imports,
native Dialoge, Dateizugriff, Update-Polling und Save-Flush beim
Fensterschließen bleiben in der Desktop-Schale.

Der Core greift über `PlatformAdapter` (`lib/platform.ts`) auf
Plattformdienste zu. `StorageAdapter` (`lib/storage.ts`) beschreibt den
Datenzugriff; `lib/api.ts` registriert den SQL-Default. Die SQLite-
Verbindung liefert `PlatformAdapter.getDb()`. Neue Datenzugriffe
müssen Interface und Implementierung aktualisieren. Schemaänderungen
laufen über additive SQL-Migrationen in `apps/desktop/src-tauri/`.
Änderungen am Datenmodell auch im `.scriptz`-Import/Export abbilden.
Capability-Flags wie `supportsDirectoryWrite` bleiben erhalten.

**Keine Hex- oder rgb-Farbwerte außerhalb von `packages/design/`.**
App-Code (Core, Desktop) referenziert nur `var(--token)`.
Ausnahmen: Inhaltsfarben, die Daten sind (Charakter-Palette in
`packages/core/styles/tokens.css`, `characterColors.ts`), und
OS-Chrome-Nachbauten (macOS-Trafficlights).

## Path-scoped Rules

Details liegen in [`.claude/rules/`](.claude/rules/) und laden nur,
wenn Claude Dateien im jeweiligen Scope anfasst:

- [`desktop-architecture.md`](.claude/rules/desktop-architecture.md) -
  Layout von `packages/core`, `packages/design` und der Desktop-Schale,
  Datenmodell (Stufen, Zielbereich), Legacy-Block-Migration, Data-Flow.
  Lädt bei `apps/desktop/**`-Quellen, `packages/core/**`,
  `packages/design/**`.
- [`i18n.md`](.claude/rules/i18n.md) - Mehrsprachigkeit der App,
  was als User-sichtbar zählt, Anti-Pattern. Lädt bei i18n-Katalogen
  und allen `.ts/.tsx` in `apps/` und `packages/core/`.
- [`release.md`](.claude/rules/release.md) - Release-Checkliste,
  Asset-Naming, Notes schreiben, Workflow-Recovery. Lädt bei
  Versionsdateien, `docs/release-notes/**`, `.github/workflows/release.yml`.

## Befehle (vom Repo-Root)

```bash
pnpm install                 # installiert alle Workspaces
pnpm dev:desktop             # tauri dev der Desktop-App
pnpm build:desktop           # native .app bauen
pnpm typecheck               # TypeScript-Check über alle Workspaces
pnpm test                    # vitest in packages/core
```

Innerhalb eines Workspaces können auch die eigenen Skripte direkt
benutzt werden (`cd apps/desktop && pnpm tauri:dev`).

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
| **docs/release-notes/vX.Y.Z.md** | **Englisch** | Lädt in den GitHub-Release-Body, internationale User |
| **docs/release-notes/_install_footer.md** | **Englisch** | Ditto, wird an jeden Release-Body angehängt |
| App-i18n `packages/core/i18n/de.ts` | Deutsch | DE-Hälfte des bilingualen App-Katalogs |
| App-i18n `packages/core/i18n/en.ts` | Englisch | EN-Hälfte des bilingualen App-Katalogs |
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
