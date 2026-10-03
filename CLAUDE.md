# ScriptZ - Monorepo

pnpm-Workspace mit drei Apps, einem geteilten Core und einem Designsystem:

- [`packages/core/`](packages/core/) - **alle gemeinsame Logik**: Editor,
  Lexical-Nodes, Plugins, UI-Komponenten inkl. der kompletten App-Schale
  (`components/Shell/AppShell.tsx`), Stores, Business-Logik,
  ScriptZ-spezifische Tokens (Charakter-Palette, A4-Geometrie,
  Papier-Schrift). Desktop und Web importieren von hier via
  `@scriptz/core`. Darf **nie** `@tauri-apps/*` importieren
  (ESLint-Rule blockt das).
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
- [`apps/web/`](apps/web/) - die Browser-Version unter
  `app.write-scriptz.com` (Solid + Vite, Vercel-Deploy). Dünne Schale:
  `PlatformAdapter` (Blob-Download), `StorageAdapter` (IndexedDB +
  MiniSearch), plus Web-Chrome (Disclaimer, Desktop-Only-Gate < 1024 px).
- [`apps/landing/`](apps/landing/) - die Marketing-Seite write-scriptz.com
  (Astro, statisch, Vercel-Deploy). Eigenständig, importiert nichts aus
  `core`. Eigene [`CLAUDE.md`](apps/landing/CLAUDE.md).

## Konvention

Desktop und Web sind **eine App, zwei Schalen**. Jedes neue Feature
landet zuerst in `packages/core/` - dann profitieren beide Apps
automatisch. Eine App-spezifische Implementierung gibt es nur, wenn
die Plattform es erzwingt (Tauri-only-API vs. Browser-only-API).

**Keine Hex- oder rgb-Farbwerte außerhalb von `packages/design/`.**
App-Code (Core, Desktop, Web) referenziert nur `var(--token)`.
Ausnahmen: Inhaltsfarben, die Daten sind (Charakter-Palette in
`packages/core/styles/tokens.css`, `characterColors.ts`), und
OS-Chrome-Nachbauten (macOS-Trafficlights). Die Landing ist davon
ausgenommen, sie pflegt eigene Tokens.

Die Landing bleibt davon getrennt - sie ist Marketing, keine App.
Wenn die Landing eine Information aus den Apps braucht (z.B. die
aktuelle Version), holt sie sie zur Build-Zeit von GitHub Releases,
nicht via Workspace-Import.

## Path-scoped Rules

Details liegen in [`.claude/rules/`](.claude/rules/) und laden nur,
wenn Claude Dateien im jeweiligen Scope anfasst:

- [`feature-parity.md`](.claude/rules/feature-parity.md) - Desktop/Web-
  Adapter-Pattern, was in `core` vs. App lebt, wann eine Differenz OK
  ist. Lädt bei `apps/desktop/**`, `apps/web/**`, `packages/core/**`,
  `packages/design/**`.
- [`desktop-architecture.md`](.claude/rules/desktop-architecture.md) -
  Layout von `packages/core`, `packages/design` und der Desktop-Schale,
  Datenmodell (Stufen, Zielbereich), Legacy-Block-Migration, Data-Flow.
  Lädt bei `apps/desktop/**`-Quellen, `packages/core/**`,
  `packages/design/**`.
- [`i18n.md`](.claude/rules/i18n.md) - Mehrsprachigkeit (App + Landing),
  was als User-sichtbar zählt, Anti-Pattern. Lädt bei i18n-Katalogen
  und allen `.ts/.tsx/.astro` in `apps/` und `packages/core/`.
- [`landing-consistency.md`](.claude/rules/landing-consistency.md) -
  Wann eine App-Änderung die Landing mit-anpassen muss. Lädt bei
  `apps/landing/**`, App-Quellcode, `packages/core/components/**`,
  `packages/core/styles/**`, `packages/design/**`.
- [`release.md`](.claude/rules/release.md) - Release-Checkliste,
  Asset-Naming, Notes schreiben, Workflow-Recovery. Lädt bei
  Versionsdateien, `docs/release-notes/**`, `.github/workflows/release.yml`.

## Befehle (vom Repo-Root)

```bash
pnpm install                 # installiert alle Workspaces
pnpm dev:desktop             # tauri dev der Desktop-App
pnpm dev:web                 # vite dev der Web-App (localhost:5173)
pnpm dev:landing             # astro dev der Landing
pnpm build:desktop           # native .app bauen
pnpm build:web               # statische Web-App nach apps/web/dist
pnpm build:landing           # statische Landing bauen
pnpm typecheck               # tsc/astro check über alle Workspaces
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
2. **Konsistenz-Check:** Ist die Landing mit betroffen (siehe
   [`landing-consistency.md`](.claude/rules/landing-consistency.md))?
   Müssen Versionen synchron gezogen werden? Wenn ja, sagen.
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
   - **Landing-only Änderung** (Texte, Bilder, Marketing): Direkt-
     Commit reicht, kein Versions-Bump - Vercel deployed bei Push.
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
| Landing `apps/landing/src/i18n/de.ts` | Deutsch | DE-Hälfte des bilingualen Landing-Katalogs |
| Landing `apps/landing/src/i18n/en.ts` | Englisch | EN-Hälfte des bilingualen Landing-Katalogs |
| Impressum + Datenschutz | Deutsch | Deutsches Recht, deutscher Anbieter |
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
deutschsprachigen Texten (Landing-DE, `i18n/de.ts`, interne Doku)
immer `ä`, `ö`, `ü`, `ß` statt `ae`, `oe`, `ue`, `ss`.
Auch wenn die Tastatur das gerade nicht hergibt - dann lieber kurz
suchen als ein "haendisch" ins Repo schreiben.

In **englischen Texten** (README, Release-Notes, `i18n/en.ts`,
Landing-EN) sind normale Bindestriche ebenfalls Default; Em-Dashes
sind nicht verboten, aber sparsam. Keine Smart-Quotes erzwingen.
