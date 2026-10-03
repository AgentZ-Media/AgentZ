# AgentZ Suite - Plan für das Fundament

> Interne Doku. Stand: 2026-10-03. Status: Plan, noch nicht begonnen.

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
    der am Bundle-Identifier `de.agent-z.scriptz` hängt. Identifier und
    DB-Name bleiben deshalb **unverändert** (siehe Abschnitt 5).
- [PR #19](https://github.com/AgentZ-Media/ScriptZ/pull/19) („ScriptZ
  Studio und Online-Synchronisierung vollständig entfernen") wird vor
  dem Start gemergt. Dieser Plan setzt den Stand **nach** PR #19 voraus:
  kein `apps/studio`, kein Handoff, kein `httpPostJson`/`httpGetJson`
  im `PlatformAdapter`, kein `tauri-plugin-http`, keine
  `SettingsStudio`-Sektion. Nichts davon wird im Fundament wieder
  aufgebaut.
- Nach PR #19 besteht das Repo aus:
  - `apps/desktop` (ScriptZ, Tauri)
  - `apps/web` (ScriptZ im Browser)
  - `apps/landing` (write-scriptz.com, Astro)
  - `packages/core` (`@scriptz/core`, rund 35.000 Zeilen: Editor, Shell,
    Stores, Business-Logik, UI)
  - `packages/design` (`@agentz/design`, CSS-Tokens, Primitive, Icons,
    Logo)

### 1.2 Nicht-Ziele (bewusst später)

- Nutzerkonten, Registrierung, Login
- Online-Synchronisierung, Cloud-Backend
- Web-/Browser-Versionen der Apps
- Die zweite App selbst
- Code-Signing (Apple Developer ID, Windows EV-Zertifikat)
- Bezahlung, Lizenzen, Abo

Diese Dinge kommen später **für alle Apps gleichzeitig**. Das Fundament
muss sie nicht umsetzen, darf sie aber auch nicht verbauen (siehe
Abschnitt 14).

## 2. Entscheidungen

| # | Frage | Entscheidung |
|---|---|---|
| E1 | Ein großes Programm oder mehrere? | **Mehrere eigenständige Apps**, aber jedes Produkt wird als **Modul** gebaut (Abschnitt 6). Eine spätere „Alles-in-einem"-App wäre dann nur eine weitere Schale, die mehrere Module einhängt. Die Entscheidung bleibt damit billig umkehrbar. |
| E2 | Name der Suite | **AgentZ Suite** |
| E3 | Domain | **agentz-suite.de** (noch zu registrieren, siehe Phase 7) |
| E4 | Repo-Name | **`AgentZ-Media/AgentZ-Suite`** |
| E5 | ScriptZ-Name | Bleibt **ScriptZ**, ebenso Bundle-Identifier `de.agent-z.scriptz` und `scriptz.db` |
| E6 | Web-App `apps/web` | **Wird gelöscht**, inkl. Vercel-Projekt und `app.write-scriptz.com` |
| E7 | Landing `apps/landing` | **Wird gelöscht**, inkl. Blog, Vercel-Projekt und `write-scriptz.com`. Ersetzt durch eine neue, minimalistische Suite-Website (Phase 7). |
| E8 | Lizenz | Bleibt vorerst MIT/Open Source. Für das Fundament ohne Belang. |
| E9 | Anzahl geteilter Pakete | **Drei** statt vieler Mini-Pakete: `@agentz/design` (CSS), `@agentz/kit` (Solid: UI, i18n, Plattform, Shell), `@agentz/desktop` (Tauri-Host). Grenzen innerhalb von `kit` laufen über Subpath-Exports und Lint-Regeln, nicht über eigene `package.json`s. Aufsplitten geht später jederzeit. |
| E10 | Updater-Signaturschlüssel | **Ein gemeinsamer Schlüssel** für alle Apps (ein Secret-Paar im Repo). Weniger Verwaltung, alle Apps sind ohnehin derselbe Herausgeber. |
| E11 | Sprachen | Alle Apps zweisprachig DE/EN wie ScriptZ heute. Die Website startet ebenfalls DE/EN. |

## 3. Zielstruktur

```
AgentZ-Suite/
├── apps/                     ausführbare Programme (dünne Schalen)
│   ├── scriptz/              Tauri-App ScriptZ (heute apps/desktop)
│   │   ├── src/              index.tsx: bootDesktopApp(scriptzModule)
│   │   └── src-tauri/        tauri.conf.json, Migrationen, Icons, main.rs
│   └── site/                 Suite-Website agentz-suite.de (Astro, statisch)
├── modules/                  Produkt-Logik, je ein Modul pro App
│   └── scriptz/              @agentz/scriptz (heute packages/core minus Kit)
├── packages/                 geteilte Infrastruktur, produktneutral
│   ├── design/               @agentz/design   CSS-Tokens, Primitive, Icons, Logo
│   ├── kit/                  @agentz/kit      Solid-UI, i18n, Plattform-Interfaces, Shell
│   └── desktop/              @agentz/desktop  Tauri-Adapter, Updater, Close-Flush
├── crates/
│   └── agentz-desktop/       geteilter Rust-Builder (Plugins, SQL, Fenster)
├── tooling/
│   └── new-app/              Generator + Vorlage für neue Apps
├── docs/
│   ├── release-notes/<app>/  Release-Notes pro App
│   └── ...
├── Cargo.toml                Cargo-Workspace (apps/*/src-tauri + crates/*)
├── tsconfig.base.json
├── eslint.config.js          inkl. Paket-Grenzen
└── pnpm-workspace.yaml       apps/*, modules/*, packages/*, tooling/*
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

## 4. Phasenübersicht

| Phase | Inhalt | Art | Ergebnis |
|---|---|---|---|
| 0 | PR #19 mergen | Merge | Studio und Sync sind weg |
| 1 | Web-App + Landing entfernen | PR | Repo enthält nur noch ScriptZ-Desktop, Core, Design |
| 2 | Umbenennen (GitHub, Ordner, Pakete) | PR + GitHub-Einstellungen | Zielstruktur steht, Code noch unverändert |
| 3 | Tooling (TS-Basis, ESLint-Grenzen, CI, Cargo-Workspace) | PR | Grenzen werden automatisch geprüft |
| 4 | `@agentz/kit` aus dem ScriptZ-Modul herauslösen | mehrere PRs | Produktneutrale UI/Shell, ScriptZ ist ein Modul |
| 5 | `@agentz/desktop` + Rust-Crate | PR | Eine Tauri-App braucht nur noch Config + Modul |
| 6 | Release-Pipeline für mehrere Apps | PR + Secrets | Tag `scriptz-v0.9.0` baut, released, Updater läuft |
| 7 | Suite-Website | PR + Vercel/Domain | agentz-suite.de mit Download-Buttons |
| 8 | App-Generator + Abnahmetest | PR | Definition of Done aus Abschnitt 1 erfüllt |

Die Phasen sind sequenziell gedacht. Phase 7 (Website) kann ab Phase 6
parallel laufen.

**Regeln für alle Phasen:**

- Jede Phase ist mindestens ein eigener PR. Ausnahme Phase 0.
  Umstrukturierungen sind laut CLAUDE.md Risiko-Änderungen, also nie
  direkt auf `main`.
- **CodeRabbit überspringt PRs mit mehr als 100 Dateien.** Reine
  Verschiebungen (Phase 2) dürfen größer sein, weil sie mechanisch sind.
  Für inhaltliche Umbauten (Phase 4) den PR so schneiden, dass er
  unter 100 Dateien bleibt.
- Verschieben immer per `git mv`, damit die Git-Historie den Dateien
  folgt. Verschieben und inhaltlich Ändern nicht im selben Commit.
- Nach jedem Schritt grün: `pnpm typecheck`, `pnpm test`,
  `pnpm build:scriptz`, ab Phase 3 zusätzlich `pnpm lint` und
  `cargo check`.
- Nach jedem Schritt ScriptZ einmal starten und gegen die echte
  `scriptz.db` testen: Skripte öffnen, schreiben, Einstellungen,
  Export. Vorher die DB sichern (siehe Abschnitt 5).
- Verhalten von ScriptZ bleibt über das ganze Fundament **unverändert**.
  Ausnahme: Was in Phase 1 bewusst entfernt wird.

## 5. Datensicherung

Vor Phase 1 und vor jeder Phase, die `src-tauri` anfasst (2, 5, 6):

```bash
cp ~/Library/Application\ Support/de.agent-z.scriptz/scriptz.db \
   ~/Desktop/scriptz-backup-$(date +%Y%m%d).db
```

Zusätzlich vor Phase 6 einen `.scriptz`-Export der wichtigsten Skripte.

## 6. Das Modul-Konzept

Jedes Produkt ist ein Paket unter `modules/`, das **ein Objekt**
exportiert, das die Shell aus `@agentz/kit` versteht. Grobe Skizze, wird
in Phase 4.5 finalisiert:

```ts
export interface AppModule {
  /** Stabiler Schlüssel: Tag-Präfix, DB-Name, Bundle-Identifier-Suffix. */
  id: string;                       // "scriptz"
  /** Anzeigename. */
  name: string;                     // "ScriptZ"
  /** i18n-Katalog des Moduls, wird mit dem Kit-Katalog zusammengeführt. */
  i18n: { de: Catalog; en: Catalog };
  /** Modul-spezifischer Boot (Willkommensinhalte, Backfills, Migrationen
   *  auf Datenebene). Läuft nach dem Kit-Boot. */
  boot?(ctx: ModuleContext): Promise<void>;
  /** Routen und was sie rendern. */
  routes: RouteDef[];
  /** Sidebar-Inhalt unterhalb der App-Marke. */
  sidebar: Component<SidebarProps>;
  /** Zusätzliche Einstellungs-Sektionen (Allgemein, Darstellung, Tastatur,
   *  Updates, Über liefert das Kit). */
  settingsSections?: SettingsSection[];
  /** Einträge für die Befehlspalette (⌘K). */
  commands?: (ctx) => Command[];
  /** Tastenkürzel, die global gelten und in den Einstellungen gelistet werden. */
  shortcuts?: ShortcutDef[];
  /** Ausstehende Schreibvorgänge vor dem Fensterschließen leeren. */
  flushPending?(timeoutMs: number): Promise<void>;
  /** Optionales Onboarding beim ersten Start. */
  onboarding?: Component;
}
```

Eine App ist dann im Kern:

```ts
// apps/scriptz/src/index.tsx
import { bootDesktopApp } from "@agentz/desktop";
import { scriptzModule } from "@agentz/scriptz";
import "@agentz/scriptz/styles.css";

bootDesktopApp(scriptzModule);
```

## 7. Phasen im Detail

### Phase 0: PR #19 mergen

- PR #19 mergen. Danach `main` lokal ziehen, `pnpm install`, alles grün?
- Das Vercel-Projekt `scriptz-studio` in Vercel löschen bzw. vom Repo
  trennen. PR #19 entfernt nur den Code. Der Check
  „Vercel - scriptz-studio" schlägt sonst bei jedem PR fehl.
- Externe Studio-Ressourcen (Convex-Deployment, Domains, Secrets)
  prüfen und abbauen.

### Phase 1: Web-App und Landing entfernen

**Löschen:**

- `apps/web/` komplett: IndexedDB-Adapter, MiniSearch, Disclaimer,
  Desktop-Only-Gate, `vercel.json`
- `apps/landing/` komplett: Seiten, Blog, i18n-Katalog, `CLAUDE.md`,
  `vercel.json`
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
- `release.yml`: Job `trigger-landing` und das Secret
  `VERCEL_DEPLOY_HOOK_URL`
- In `packages/design/scripts/build-logo.mjs` das Kopieren der Icons
  nach `apps/landing/public/img/`
- `pnpm-lock.yaml` neu erzeugen (`dexie`, `minisearch`, Astro fallen weg)

**Im Core anpassen:**

- `AppShellProps.platform: "desktop" | "web"` und alle `"web"`-Zweige
  entfernen, die nur für die Browser-Schale existieren.
- `PlatformAdapter.supportsDirectoryWrite` und ähnliche Feature-Flags
  **behalten**: Sie sind die Naht für spätere Web-Versionen (Abschnitt 14).
  Nur Code löschen, der ausschließlich der Web-Schale dient.
- i18n-Schlüssel, die nur Web/Landing betrafen, aus `de.ts`/`en.ts` entfernen.

**Doku:**

- `CLAUDE.md`: Web, Landing, Feature-Parität, Landing-Konsistenz im
  Abschluss-Workflow streichen.
- `README.md`: Web-App, Landing, write-scriptz.com streichen.
  Vollständig neu geschrieben wird sie in Phase 2.
- `.claude/rules/release.md` / `desktop-release.md`: Landing-Rebuild
  streichen.

**Extern (manuell, nicht per Code):**

- Vercel: Projekte für Web und Landing löschen.
- Domains `write-scriptz.com` und `app.write-scriptz.com`: aus Vercel
  entfernen. Später auf agentz-suite.de weiterleiten oder auslaufen
  lassen. Eine Entscheidung ist erst nötig, wenn die Domain zur
  Verlängerung ansteht.

**Abnahme:** `pnpm typecheck && pnpm test && pnpm build:desktop` grün,
ScriptZ startet, keine Treffer bei
`grep -ri "apps/web\|apps/landing\|write-scriptz" --exclude-dir=node_modules .`
außer in alten Release-Notes.

### Phase 2: Umbenennen

**2.1 GitHub (manuell, über Einstellungen oder `gh`):**

```bash
gh repo rename AgentZ-Suite --repo AgentZ-Media/ScriptZ
git remote set-url origin https://github.com/AgentZ-Media/AgentZ-Suite.git
gh repo edit AgentZ-Media/AgentZ-Suite \
  --description "AgentZ Suite - lokale Desktop-Tools für Content Creator" \
  --homepage "https://agentz-suite.de"
```

- GitHub leitet alte URLs weiter, darauf verlassen wir uns aber nirgends.
  Alle Verweise im Repo werden auf den neuen Namen umgestellt.
- Prüfen, dass Actions-Secrets (`TAURI_SIGNING_PRIVATE_KEY`,
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`) mit umgezogen sind. Sie hängen
  am Repo, nicht am Namen, sollten also bleiben.
- CodeRabbit-Installation prüfen: Ist das Repo noch freigegeben?
- Topics setzen (`tauri`, `solidjs`, `content-creator`, ...).
- Lokalen Ordner umbenennen: `~/Desktop/Code/ScriptZ` →
  `~/Desktop/Code/AgentZ-Suite`. Danach das Claude-Memory-Verzeichnis
  beachten: Es hängt am Pfad und muss von
  `~/.claude/projects/-Users-timocorvinus-Desktop-Code-ScriptZ/` in den
  neuen Projektpfad umgezogen werden, sonst ist die Erinnerung weg.

**2.2 Ordner und Pakete (ein PR, nur `git mv` + Suchen/Ersetzen):**

| Alt | Neu |
|---|---|
| Root-Paket `scriptz-monorepo` | `agentz-suite` |
| `apps/desktop/` (Paket `scriptz`) | `apps/scriptz/` (Paket `@agentz/scriptz-app`) |
| `packages/core/` (Paket `@scriptz/core`) | `modules/scriptz/` (Paket `@agentz/scriptz`) |
| `packages/design/` | bleibt |
| Import `@scriptz/core/...` | `@agentz/scriptz/...` |
| Root-Skripte `dev:desktop`, `build:desktop` | `dev:scriptz`, `build:scriptz` |
| `pnpm test` (nur core) | `pnpm -r --if-present test` |

- `pnpm-workspace.yaml` um `modules/*` (später `tooling/*`) ergänzen.
- `@agentz/kit` und `@agentz/desktop` entstehen erst in Phase 4/5. In
  Phase 2 nur verschieben, nichts aufteilen.
- Pfade in `release.yml` (`projectPath`, `workspaces` für den
  Rust-Cache) auf `apps/scriptz` umstellen.
- `tauri.conf.json`: Updater-Endpoint vorläufig auf
  `https://github.com/AgentZ-Media/AgentZ-Suite/releases/latest/download/latest.json`.
  Final wird er in Phase 6 gesetzt.
- `Cargo.toml`: Paketname bleibt `scriptz`. `authors` →
  `["AgentZ Media"]`.
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
- `docs/release-notes/v*.md` → `docs/release-notes/scriptz/v*.md`
  (Pfad im Workflow folgt in Phase 6).

### Phase 3: Tooling-Fundament

**3.1 TypeScript:**

- `tsconfig.base.json` im Root mit den heute pro Paket duplizierten
  Optionen (`strict`, `jsx: preserve`, `jsxImportSource: solid-js`,
  `moduleResolution: bundler`, ...). Jedes Paket macht nur `extends`.
- Typecheck läuft per `pnpm -r typecheck` über alle Pakete.

**3.2 ESLint (heute faktisch nicht aktiv):**

`packages/core/.eslintrc.json` sperrt `@tauri-apps/*`, aber ESLint ist
im Repo **nicht installiert**. Die Regel wird also nie geprüft.

- ESLint 9 (Flat Config) + `typescript-eslint` als Root-devDependency,
  `eslint.config.js` im Root, Skript `pnpm lint`.
- Grenzen aus Abschnitt 3.1 als Regeln, z. B. über `no-restricted-imports` pro
  Ordner oder `eslint-plugin-boundaries`:
  - `packages/kit/**` und `modules/**`: kein `@tauri-apps/*`
  - `packages/**`: kein `@agentz/<modul>`
  - `modules/<a>/**`: kein `@agentz/<b>` (anderes Modul)
  - überall: keine relativen Importe über Paketgrenzen
    (`../../packages/...`)
- Bewusst **ohne** Stil-Regeln starten (keine Prettier-Debatte): nur
  Korrektheit und Grenzen. Altlasten per gezieltem `eslint-disable` mit
  Kommentar markieren, nicht Regeln abschwächen.
- Die Farbregel aus CLAUDE.md („keine Hex-/rgb-Werte außerhalb von
  `packages/design`") als Skript `pnpm check:colors` (grep-basiert,
  mit Ausnahmeliste für Charakter-Palette und Trafficlights).

**3.3 CI (`.github/workflows/ci.yml`, neu):**

Heute gibt es nur `release.yml`. Ein Fehler fällt also erst beim
Release-Build auf.

- Trigger: `pull_request` und `push` auf `main`
- Job `web` (ubuntu): `pnpm install --frozen-lockfile`, `pnpm lint`,
  `pnpm typecheck`, `pnpm test`, `pnpm check:colors`,
  `pnpm -r --filter "./apps/*" build` (nur Vite-Frontends, kein Tauri-Bundle)
- Job `rust` (ubuntu, mit Tauri-Systempaketen): `cargo check --workspace`,
  `cargo clippy --workspace -- -D warnings` (Clippy optional zu Beginn)
- Pfadfilter so wählen, dass Doku-only-PRs schnell durchlaufen

**3.4 Cargo-Workspace:**

- Root-`Cargo.toml` mit `[workspace] members = ["apps/*/src-tauri",
  "crates/*"]`, `resolver = "2"`. Gemeinsame `[workspace.dependencies]`
  für `tauri`, `tauri-plugin-*`, `serde_json`.
- `[profile.release]` (lto, strip, ...) in den Workspace hochziehen,
  weil Profile nur im Workspace-Root gelten.
- Gemeinsames `target/` im Root (in `.gitignore`). Der Rust-Cache in
  `release.yml`/`ci.yml` zeigt dann auf den Root.
- `tauri build` mit `projectPath: apps/scriptz` funktioniert in
  Workspaces, das Bundle-Ausgabeverzeichnis wandert aber nach
  `target/` im Root. Im ersten Release-Lauf (Phase 6) prüfen, ob
  `tauri-action` die Artefakte findet.

**3.5 Neue Regel `.claude/rules/suite-architecture.md`:**

Lädt bei `apps/**`, `modules/**`, `packages/**`. Inhalt: Zielstruktur,
Abhängigkeitsrichtung, was in `kit` vs. Modul vs. App lebt,
Modul-Vertrag, „Regel der Zwei" (Abschnitt 8).

### Phase 4: `@agentz/kit` herauslösen

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
4. Tests mitverschieben, alles grün, ScriptZ manuell prüfen.

**Subpath-Exports von `@agentz/kit`:**

| Subpath | Inhalt |
|---|---|
| `@agentz/kit/ui` | Solid-Komponenten |
| `@agentz/kit/i18n` | Sprach-Engine + Kit-Katalog |
| `@agentz/kit/platform` | `PlatformAdapter`, `KvStore`, `DbConnection`, Plattform-Erkennung, Tastatur-Helfer |
| `@agentz/kit/stores` | toasts, Basis-Settings, ui-Grundzustand, Nav-Fabrik |
| `@agentz/kit/shell` | `SuiteShell`, Modul-Vertrag, Settings-Dialog, Befehlspalette, Boot |
| `@agentz/kit/lib` | produktneutrale Helfer (`serialSave`, `saveFlush`, Format-Helfer) |
| `@agentz/kit/styles.css` | Shell-, Common-, Settings-, Palette-CSS |

**Reihenfolge (von wenig zu stark gekoppelt):**

**4.1 UI-Primitive → `@agentz/kit/ui`**

Kandidaten, die heute schon (fast) nichts von ScriptZ wissen:

- `components/Common/`: `Modal`, `ConfirmDialog`, `ToastHost`, `Icon`,
  `AppMark`, `BootErrorScreen`, `dismissOnDialog`, `Common.css`,
  `Modal.css`
- `components/Settings/DialogFrame.tsx`, `rangeInput.ts`,
  `sections/parts.tsx` (Bausteine für Einstellungszeilen)
- `stores/toasts.ts`, `lib/serialSave.ts`, `lib/saveFlush.ts`
- `AppMark`: Die Logo-Daten (`@agentz/design/logo`) pro App
  parametrisieren, damit jede App ihre eigene Marke zeigen kann.

Bleiben im Modul: `StageGlyph` (Produktionsstufen sind ScriptZ-Fachlichkeit).

**4.2 i18n → `@agentz/kit/i18n`**

Heute: ein Katalog `de.ts`/`en.ts`, Typ aus den Schlüsseln von `de`
abgeleitet, `t()` global.

Ziel:

- Engine (`currentLanguage`, `resolveLanguage`, `detectSystemLanguage`,
  `t`, Interpolation) ins Kit.
- **Kit-Katalog** mit allem Produktneutralen: Buttons (OK, Abbrechen,
  Löschen), Dialoge, Toasts, Settings-Gerüst (Darstellung, Sprache,
  Tastatur, Updates, Über), Boot-Fehler, Update-Meldungen.
- **Modul-Katalog** mit dem Rest. Die Shell führt beide zusammen.
- Typsicherheit bleibt: Schlüssel bekommen einen Namensraum (`kit.*`,
  `scriptz.*`) oder das Modul registriert seinen Katalog über eine
  generische Fabrik (`createI18n<typeof kitDe & typeof scriptzDe>()`),
  sodass `t()` weiterhin jeden Schlüssel gegen den DE-Katalog prüft.
  Variante in 4.2 festlegen. Kriterium: Ein Tippfehler in einem
  Schlüssel ist weiterhin ein Typfehler.
- Prüfung „EN hat dieselben Schlüssel wie DE" als Test pro Katalog.
- `.claude/rules/i18n.md` anpassen: wo welcher Text hingehört.

**4.3 Plattform und Speicher → `@agentz/kit/platform`**

- `PlatformAdapter` produktneutral machen:
  - `ExportPdfDeps` (kennt `ScriptCharacter`) wandert ins Modul.
  - Übrig bleiben: `platform`, `supportsDirectoryWrite`, `getDb`,
    `getVersion`, `openUrl`, `revealInFolder`, `saveDialog`, `saveAs`,
    `openFile`, `pickDirectory`, `writeFileTo`.
- `lib/updates.ts` (Updates-Slot) ins Kit.
- `lib/keys.ts` (`isModKey`, `K()`, `formatHotkey`) ins Kit.
- **`StorageAdapter` aufteilen:**
  - `KvStore` im Kit: `getSetting`, `setSetting`, `getAppState`,
    `setAppState`. Braucht jede App.
  - Alles andere (Skripte, Ordner, Snapshots, Ideen, Charaktere, Suche,
    Export) bleibt als `ScriptzStorage` im Modul.
  - Die SQL-Implementierung von `KvStore` (Tabellen `settings`,
    `app_state`) liegt im Kit und läuft über `DbConnection`.
- **Konvention für Tabellen:** `settings` und `app_state` gehören dem
  Kit und sehen in jeder App gleich aus. Alle anderen Tabellen gehören
  dem Modul.

**4.4 Einstellungen → `@agentz/kit/stores` + `@agentz/kit/shell`**

Heute mischt `stores/settings.ts` Allgemeines und ScriptZ-Spezifisches.

| Schlüssel | Ziel |
|---|---|
| `theme`, `language`, `update_check_enabled`, `hourly_update_check` | Kit (`baseSettings`) |
| `highlighting_default`, `quick_mode_auto_enable`, `dialog_wpm`, `focus_mode_default`, `show_writing_stats`, `dark_paper` | Modul (`scriptzSettings`) |

- Schlüssel und gespeicherte Werte bleiben **identisch**, damit die
  vorhandene `scriptz.db` ohne Migration weiterläuft.
- `SettingsDialog` wird ein Gerüst mit Sektions-Registry:
  - Kit liefert: Darstellung (Theme, Sprache), Tastatur (generiert aus
    der Shortcut-Registry), Updates, Über.
  - Modul liefert zusätzlich: Schreiben, Ordner, Charaktere.
- `dark_paper` ist bewusst Modul: „Papier" ist ein ScriptZ-Konzept,
  kein Suite-Konzept. Sollte eine zweite App es auch brauchen, gilt die
  Regel der Zwei (Abschnitt 8).

**4.5 Shell und Modul-Vertrag → `@agentz/kit/shell`**

- `AppModule`-Interface (Abschnitt 6) finalisieren.
- `SuiteShell` aus dem heutigen `AppShell.tsx` bauen:
  - Boot-Reihenfolge: Kit-Boot (`KvStore`, Basis-Settings, Sprache,
    Theme auf `<html>`) → `module.boot()` → Render. Fehler →
    `BootErrorScreen`.
  - Layout: Sidebar-Rahmen (App-Marke, Modul-Sidebar, `sidebarFooterSlot`
    für Host-Elemente wie den Update-Indikator) | Hauptbereich mit
    Routen des Moduls.
  - Globale Dialoge: Settings, Confirm, Toasts.
  - Shortcut-Registry (`handleGlobalShortcut` heute in
    `Shell/shortcuts.ts`): Kit kennt ⌘, (Einstellungen) und ⌘K
    (Palette), Modul registriert den Rest.
  - Befehlspalette: Rahmen und Suche ins Kit, Einträge liefert das Modul.
  - Onboarding: Kit stellt den Mechanismus (einmal anzeigen, Flag in
    `app_state`), Modul liefert den Inhalt.
- **Navigation:** `stores/nav.ts` ist heute ScriptZ-Routen + Verlauf +
  „Zuletzt". Ins Kit kommt eine generische Fabrik
  (`createNavStore<Route>()` mit Zurück/Vor und Persistenz in
  `app_state`). Routen-Typen und „Zuletzt geöffnete Skripte" bleiben
  im Modul.
- `stores/ui.ts`: Grundzustand (offene Dialoge, Sidebar ein/aus) ins
  Kit, Panels wie Inspector/Fokus ins Modul.

**4.6 ScriptZ als Modul**

- `modules/scriptz/index.ts` exportiert `scriptzModule: AppModule`.
- `AppShell.tsx` verschwindet. Was ScriptZ-spezifisch war (Willkommens-
  inhalte, `migrateLegacyBlocksOnce`, `backfillRuntimeStats`,
  `startCharacterAutoPrune`, `QuickCapture`, `StageUndoToast`,
  `ExportDialog`) wandert in `scriptzModule.boot`, die Routen oder die
  Modul-Overlays.
- Die ScriptZ-Tokens (`styles/tokens.css`: Charakter-Palette,
  A4-Geometrie) und die Papier-Schrift (iA Writer Quattro) bleiben im Modul.

**4.7 Design-Altlasten**

- `@agentz/design/legacy.css` (Alias-Schicht für alte Token-Namen):
  Verbleibende Nutzungen im ScriptZ-Modul auflisten. Neue Apps und das
  Kit dürfen `legacy.css` **nicht** importieren (Lint- oder Grep-Check).
  Ob ScriptZ die Aliasse im Fundament schon ganz loswird, ist optional.
- Prüfen, dass nichts in `kit` eine ScriptZ-spezifische Variable
  (`--char-*`, Papier-Geometrie) liest.

**Abnahme Phase 4:**

- `grep -rE "script|Script|character|folder" packages/kit` findet nur
  noch Treffer, bei denen es nicht um ScriptZ-Fachlichkeit geht (z. B.
  `<script>`, `description`).
- ScriptZ verhält sich unverändert. Alle bisherigen Tests laufen,
  verteilt auf Kit und Modul.
- Kit hat eigene Tests für Shell-Boot, Settings-Registry, i18n-Merge
  und Shortcut-Registry.
- **Mini-Testmodul** in `packages/kit/__tests__/fixtures/` (ein Modul
  mit einer Route, einer Settings-Sektion, zwei Übersetzungen), mit dem
  die Shell in Vitest gerendert wird. Das beweist, dass die Shell ohne
  ScriptZ funktioniert.

### Phase 5: `@agentz/desktop` und Rust-Crate

**5.1 `packages/desktop` (`@agentz/desktop`):**

Wandert aus `apps/scriptz/src` (heute `apps/desktop/src`):

- `lib/platform.ts` → Tauri-`PlatformAdapter`. DB-Name kommt als
  Parameter (`sqlite:${module.id}.db`), nicht fest verdrahtet.
- `lib/tauri.ts`
- `stores/updates.ts` → Updater-Store (Polling, Download, Neustart)
- `components/Common/UpdateIndicator.tsx` + `.css`
- Close-Flush aus `App.tsx` (`onCloseRequested` → `module.flushPending`)
- Neue Funktion `bootDesktopApp(module, options?)`:
  1. Adapter + Updater registrieren (bevor Kit/Modul-Code läuft)
  2. CSS-Reihenfolge laden (Design-Fonts → Tokens → Komponenten → Kit)
  3. `<SuiteShell module={...} sidebarFooterSlot={<UpdateIndicator/>} />`
     rendern
  4. Close-Flush und Update-Polling verdrahten

Danach besteht `apps/scriptz/src` nur noch aus `index.tsx` (Abschnitt 6)
und `vite-env.d.ts`.

**5.2 Geteilte Vite-Konfiguration:**

`@agentz/desktop/vite` exportiert `defineDesktopViteConfig({ port })`
(Solid-Plugin, Tauri-Dev-Host, HMR, `envPrefix`, Build-Target).
Jede App bekommt einen **eigenen Dev-Port** (ScriptZ bleibt 1420, die
nächste App 1430 usw.), damit mehrere Apps parallel laufen können.
Die Port-Tabelle steht in `suite-architecture.md`.

**5.3 `crates/agentz-desktop`:**

Heute steht in `lib.rs` die Plugin-Liste fest verdrahtet. Ziel:

```rust
pub fn run() {
    agentz_desktop::builder(agentz_desktop::Config {
        db_url: "sqlite:scriptz.db",
        migrations: migrations(),
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
```

- Das Crate registriert die Standard-Plugins aller Apps: window-state,
  clipboard-manager, os, updater, process, opener, dialog,
  global-shortcut, fs, sql.
- Migrationen bleiben **pro App** (sie gehören zum Modul). Das Crate
  exportiert zusätzlich `KIT_BASELINE_SQL` (Tabellen `settings`,
  `app_state`), die neue Apps als Migration 1 eintragen. ScriptZ hat
  beide Tabellen schon in `001_baseline.sql` und bleibt unverändert.
- **Capabilities** (`src-tauri/capabilities/default.json`): Die
  Standardrechte als Vorlage im Generator (Phase 8) ablegen. Jede App
  behält ihre eigene Datei, weil Tauri sie pro App liest.
- **CSP** in `tauri.conf.json`: Standard-CSP als Vorlage. Nach PR #19
  noch prüfen, ob `connect-src` noch `api.github.com`/`github.com`
  braucht. Der Updater läuft über Rust, nicht über die Webview.

**Abnahme Phase 5:** `apps/scriptz` enthält nur `index.tsx`,
`vite.config.ts` (Einzeiler), `package.json`, `src-tauri/` mit
`tauri.conf.json`, Icons, Capabilities, Migrationen, `main.rs` und
einem kurzen `lib.rs`. ScriptZ läuft unverändert, Daten sind da.

### Phase 6: Release-Pipeline für mehrere Apps

**6.1 Das Problem:**

- Tags heißen heute `v0.8.4`. Bei mehreren Apps ist unklar, welche App
  gemeint ist.
- Der Updater fragt `releases/latest/download/latest.json` ab.
  „Latest" ist bei GitHub **eine** Release pro Repo. Sobald App B
  released, bekäme ScriptZ das `latest.json` von App B.

**6.2 Tag-Schema:**

- `<app-id>-v<semver>`, z. B. `scriptz-v0.9.0`, `notes-v0.1.0`
- Workflow-Trigger: `tags: ['*-v*.*.*']`
- Erster Job parst den Tag → `app_id`, `version` und prüft:
  - `apps/<app_id>/` existiert
  - Version in `apps/<app_id>/package.json`, `tauri.conf.json` und
    `src-tauri/Cargo.toml` stimmt mit dem Tag überein (bricht sonst ab)
  - `docs/release-notes/<app_id>/v<version>.md` existiert
- `releaseName`: Produktname aus `tauri.conf.json` + Version
  („ScriptZ 0.9.0")
- `projectPath: apps/${{ app_id }}`
- Alte Tags `v0.6.0` bis `v0.8.4` bleiben als Historie unangetastet.

**6.3 Updater pro App: Zeiger-Release**

Jede App bekommt ein festes Release mit dem Tag **`<app-id>-latest`**
(als *Pre-Release* markiert, damit es nie GitHubs „Latest" wird).
Der Release-Workflow lädt am Ende per `gh release upload --clobber`
hoch:

- `latest.json` (Kopie aus dem versionierten Release, die Download-URLs
  darin zeigen auf das versionierte Release)
- Installer mit **stabilem Dateinamen**: `ScriptZ_macOS_arm64.dmg`,
  `ScriptZ_Windows_x64_setup.exe`

Damit gilt pro App:

- Updater-Endpoint: `https://github.com/AgentZ-Media/AgentZ-Suite/releases/download/scriptz-latest/latest.json`
- Download-Links für die Website: `.../releases/download/scriptz-latest/ScriptZ_macOS_arm64.dmg`

Vorteile: Die Website braucht keinen Build-Zeit-Abruf der GitHub-API
und keinen Deploy-Hook. Sie verlinkt feste URLs. Releases verschiedener
Apps stören sich nicht.

- Versionierte Releases werden mit `--latest=false` bzw.
  `make_latest: false` erstellt. „Latest" wird im Repo einfach nicht
  genutzt.
- Das Zeiger-Release hat einen kurzen Body („Immer die aktuelle Version
  von ScriptZ, Release-Notes siehe <Link>"), der bei jedem Release
  aktualisiert wird.
- Alternative, falls die Zeiger-Releases stören: `latest.json` und
  Installer-Links per statischer Datei auf agentz-suite.de
  (`/updates/<app>/latest.json`). Wird hier bewusst **nicht** gewählt,
  weil dann ein kaputter Website-Deploy die Updates stoppt.

**6.4 Weitere Punkte:**

- **Reihenfolge der Builds:** macOS → Windows sequenziell (wie heute),
  weil `tauri-action` `latest.json` zusammenführt. Danach Job
  `publish-pointer`.
- **Install-Footer:** `docs/release-notes/_install_footer.md` hat
  „ScriptZ" fest im Text (`xattr -cr /Applications/ScriptZ.app`). Wird
  zur Vorlage mit Platzhalter `{{PRODUCT_NAME}}`, die der Workflow
  ersetzt.
- **Versions-Skript:** `pnpm release:bump <app> <version>` setzt die
  Version in allen drei Dateien und legt die Release-Notes-Datei aus
  einer Vorlage an. Heute muss man das per Hand in drei Dateien machen.
- **Signaturschlüssel:** Bleibt der bestehende
  (`TAURI_SIGNING_PRIVATE_KEY`). Neue Apps tragen denselben `pubkey` in
  ihre `tauri.conf.json` ein (E10).
- **Rust-Cache-Key** pro App + OS (`scriptz-macos`), damit sich Apps
  nicht gegenseitig den Cache verdrängen.
- **Regeln:** `.claude/rules/release.md` und `desktop-release.md` zu
  einer `release.md` für alle Apps zusammenführen (Tag-Schema,
  Checkliste, Zeiger-Release, Recovery bei fehlgeschlagenem Lauf).

**6.5 Erster Release unter neuem Schema:**

- `scriptz-v0.9.0` mit Release-Notes „Interner Umbau zur AgentZ Suite,
  keine sichtbaren Änderungen".
- Die installierte 0.8.4 fragt noch die alte URL ab und findet das
  Update nicht. **Einmal manuell installieren** (DMG von
  `scriptz-latest` laden). Da es keine weiteren Nutzer gibt, ist keine
  Brücken-Version nötig.
- Danach mit einem `scriptz-v0.9.1` prüfen, dass der Auto-Updater die
  neue Version findet, lädt und installiert.

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
  `{ id, name, tagline: {de, en}, icon, status: "available" | "soon" }`.
  Eine neue App = ein Eintrag. Download-URLs werden aus `id` und dem
  Zeiger-Release-Schema (Phase 6.3) gebaut.
- **Versionsanzeige** optional: Wenn gewünscht, Build-Zeit-Abruf von
  `<app>-latest/latest.json`. Sonst weglassen, das hält die Seite
  statisch.
- **DE/EN:** `/` Deutsch, `/en/` Englisch, Sprachwahl im Footer. Kleiner
  Katalog, gleiche i18n-Regeln wie bisher.
- **Pflichtseiten (deutsches Recht):** Impressum und Datenschutz, auf
  Deutsch. Die bestehenden Texte aus `apps/landing` vor dem Löschen in
  Phase 1 sichern und an die Suite anpassen (Anbieter, Domain, kein
  Tracking, Downloads über GitHub).
- **Kein** Blog, **kein** Tracking, **keine** Cookies (dann ist auch
  kein Cookie-Banner nötig).
- **Extern (manuell):**
  - Domain `agentz-suite.de` registrieren
  - Vercel-Projekt anlegen: Root `apps/site`, Build `pnpm build:site`,
    Ignored-Build-Step so, dass nur Änderungen an `apps/site` und
    `packages/design` einen Deploy auslösen
  - DNS auf Vercel, HTTPS
- Root-Skripte `dev:site`, `build:site`
- Neue Regel `.claude/rules/site.md` (lädt bei `apps/site/**`): Aufbau,
  App-Liste pflegen, Sprachregeln.
- Abschluss-Workflow in `CLAUDE.md`: Bei neuer App oder geändertem
  App-Namen/Icon auch `apps/site/src/apps.ts` prüfen. Das ersetzt die
  alte Landing-Konsistenz-Regel.

### Phase 8: App-Generator und Abnahmetest

**8.1 Generator `pnpm new-app <id> "<Name>"`** (`tooling/new-app/`):

Legt an:

- `modules/<id>/`: `package.json` (`@agentz/<id>`), `index.ts` mit
  minimalem `AppModule` (eine Startseite, i18n-Kataloge DE/EN mit
  Platzhaltern), `styles.css`, `tsconfig.json`, `vitest.config.ts`,
  ein Beispieltest
- `apps/<id>/`: `package.json` (`@agentz/<id>-app`, Version `0.1.0`),
  `index.html`, `src/index.tsx` (`bootDesktopApp`), `vite.config.ts`
  (nächster freier Port), `src-tauri/` mit:
  - `tauri.conf.json`: `productName`, `identifier: de.agent-z.<id>`,
    Updater-Endpoint `<id>-latest`, gemeinsamer `pubkey`, Standard-CSP,
    Fenstergrößen
  - `Cargo.toml` (Workspace-Mitglied), `main.rs`, `lib.rs`
    (`agentz_desktop::builder`), `migrations/001_baseline.sql`
    (`KIT_BASELINE_SQL`), `capabilities/default.json`
- `docs/release-notes/<id>/`
- Root-Skripte `dev:<id>`, `build:<id>`
- Eintrag in `apps/site/src/apps.ts` mit `status: "soon"`
- `apps/<id>/CLAUDE.md` aus Vorlage

**8.2 Icons pro App:**

`packages/design/scripts/build-logo.mjs` schreibt heute fest nach
`apps/desktop/...`. Umbau:

- Parameter `--app <id>`: Ziel `apps/<id>/src-tauri/icons/`
- Logo-Daten pro App (Glyphe/Farbe) in `@agentz/design/logo` als
  `LOGOS[id]`. Für eine neue App startet der Generator mit einer
  Platzhalter-Glyphe.
- Website-Icons: `apps/site/public/img/<id>.png`
- Das Suite-Logo (AgentZ-Marke für Website und Favicon) als eigener
  Eintrag.

**8.3 Abnahmetest (Definition of Done):**

1. `pnpm new-app sandbox "Sandbox"`
2. `pnpm dev:sandbox` startet eine Tauri-App mit Sidebar, Startseite,
   Einstellungen (Theme hell/dunkel, Sprache DE/EN, Updates, Über),
   Toast-Test, Confirm-Dialog. Gleichzeitig läuft `pnpm dev:scriptz`.
3. `sandbox.db` liegt in `~/Library/Application Support/de.agent-z.sandbox/`,
   ScriptZ-Daten sind unberührt.
4. `pnpm lint && pnpm typecheck && pnpm test` grün, CI grün.
5. Ein Probe-Release `sandbox-v0.1.0` (darf als Draft/Pre-Release
   laufen) erzeugt DMG, EXE, `latest.json` und aktualisiert
   `sandbox-latest`. ScriptZ' Zeiger-Release bleibt unberührt.
6. Der Website-Eintrag erscheint und die Download-Links funktionieren.
7. In ScriptZ (`modules/scriptz`, `apps/scriptz`) wurde **keine Datei**
   geändert (`git diff --stat` prüfen).
8. Danach Sandbox wieder entfernen (Ordner, Releases, Tags, Website-
   Eintrag). Optional `pnpm remove-app <id>` als Gegenstück zum Generator.

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

## 9. Was in welchem Paket landet (Übersicht)

| Heute (`packages/core`) | Ziel |
|---|---|
| `components/Common/*` außer `StageGlyph` | `kit/ui` |
| `components/Settings/DialogFrame`, `parts`, `rangeInput`, `SettingsDialog` (als Gerüst) | `kit/shell` / `kit/ui` |
| `Settings/sections/SettingsAppearance`, `SettingsShortcuts`, `SettingsUpdates`, `SettingsAbout` | `kit/shell` |
| `Settings/sections/SettingsWriting`, `SettingsFolders`, `SettingsCharacters` | Modul |
| `components/Shell/AppShell`, `Sidebar` (Rahmen), `shortcuts` (Registry) | `kit/shell` |
| `components/Shell/libraryData`, Sidebar-Inhalt | Modul |
| `components/Palette/CommandPalette` (Rahmen) | `kit/shell`, Einträge im Modul |
| `components/Onboarding` (Mechanismus) | `kit/shell`, Inhalt im Modul |
| `components/Editor`, `Script`, `Library`, `Ideas`, `Export`, `Activity` | Modul |
| `stores/toasts` | `kit/stores` |
| `stores/settings` | geteilt: Basis → Kit, Rest → Modul (Phase 4.4) |
| `stores/nav`, `stores/ui` | Fabrik/Grundzustand → Kit, Rest → Modul |
| `stores/ideas`, `dailyStats`, `saveStatus` | Modul (`saveStatus` ggf. Kit, falls generisch) |
| `lib/platform`, `updates`, `keys`, `db` | `kit/platform` |
| `lib/storage` | `KvStore` → Kit, Rest → Modul |
| `lib/serialSave`, `saveFlush`, `format` (Datums-/Zahlformat) | `kit/lib` |
| restliche `lib/*` (Skripte, Lex, Runtime, Charaktere, Snapshots, Suche, Export, `.scriptz`-Format, Busse) | Modul |
| `i18n/index.ts` (Engine) | `kit/i18n` |
| `i18n/de.ts`, `en.ts`, `parts/*` | aufgeteilt: Kit-Katalog + Modul-Katalog |
| `styles/tokens.css`, `fonts.css`, `assets/fonts` | Modul (ScriptZ-Tokens, Papier-Schrift) |
| `styles/global.css` | aufgeteilt: Reset/Basis → Kit, Rest → Modul |
| `apps/desktop/src/lib/platform.ts`, `tauri.ts`, `stores/updates.ts`, `UpdateIndicator`, Close-Flush | `@agentz/desktop` |
| `apps/desktop/src-tauri/src/lib.rs` (Plugin-Liste) | `crates/agentz-desktop` |

## 10. Doku und Regeln: Endzustand

| Datei | Inhalt |
|---|---|
| `README.md` (EN) | Suite-Übersicht, Apps, Build, Architektur |
| `CLAUDE.md` (DE) | Suite-Struktur, Abhängigkeitsrichtung, Befehle, Abschluss-Workflow, Sprachregeln |
| `apps/scriptz/CLAUDE.md` | ScriptZ-Spezifika (Datenmodell, Editor, Migrationen) |
| `.claude/rules/suite-architecture.md` | Kit vs. Modul vs. App, Modul-Vertrag, Ports, Regel der Zwei |
| `.claude/rules/scriptz-architecture.md` | heute `desktop-architecture.md`, auf Modul-Pfade umgestellt |
| `.claude/rules/i18n.md` | Kit- vs. Modul-Katalog, Website |
| `.claude/rules/release.md` | Tag-Schema, Zeiger-Release, Checkliste, Recovery |
| `.claude/rules/site.md` | Website pflegen |
| `docs/neue-app.md` | Checkliste neue App |
| `docs/agentz-suite-fundament.md` | dieser Plan, wird beim Abarbeiten aktualisiert |
| `packages/design/README.md` | Verweis auf ScriptZ als einzigen Nutzer entfernen, Logo pro App |

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
- [ ] GitHub-Repo umbenennen, Beschreibung, Homepage, Topics
- [ ] Lokalen Ordner umbenennen + Claude-Memory-Pfad umziehen
- [ ] CodeRabbit-Freigabe prüfen
- [ ] Domain `agentz-suite.de` registrieren
- [ ] Vercel-Projekt für `apps/site` anlegen, Domain verbinden
- [ ] Zeiger-Release `scriptz-latest` beim ersten Release prüfen
- [ ] ScriptZ 0.9.0 einmal manuell installieren

## 12. Risiken

| Risiko | Gegenmaßnahme |
|---|---|
| Datenverlust in `scriptz.db` | Identifier und DB-Name bleiben, Settings-Schlüssel bleiben, Backup vor jeder `src-tauri`-Phase (Abschnitt 5) |
| Phase 4 bricht den Editor unbemerkt | kleine Schritte, Tests mitverschieben, nach jedem Schritt manuell testen, Verhalten bleibt gleich |
| Riesige PRs, die niemand prüfen kann | Verschieben und Ändern trennen, PRs unter 100 Dateien (CodeRabbit-Limit) |
| Abstraktion auf Vorrat, die die zweite App gar nicht braucht | Regel der Zwei (Abschnitt 8), Mini-Testmodul statt Spekulation |
| Cargo-Workspace verschiebt Tauri-Bundle-Ausgabe | in Phase 3 lokal `tauri build` testen, in Phase 6 den CI-Lauf prüfen |
| Zeiger-Release wird versehentlich „Latest" | als Pre-Release anlegen, alle Releases mit `make_latest: false` |
| Lint-Regeln werden still umgangen | CI bricht bei Verstößen ab, `eslint-disable` nur mit Begründung |

## 13. Reihenfolge auf einen Blick

```
0  PR #19 mergen, Vercel/Convex aufräumen
1  PR: Web + Landing löschen            (Backup!)
2  GitHub umbenennen → PR: Ordner/Pakete umbenennen, README/CLAUDE neu
3  PR: tsconfig.base, ESLint + Grenzen, ci.yml, Cargo-Workspace
4  PRs: 4.1 UI → 4.2 i18n → 4.3 Plattform/KvStore → 4.4 Settings
        → 4.5 Shell + Modul-Vertrag → 4.6 ScriptZ als Modul → 4.7 Design-Altlasten
5  PR: @agentz/desktop, Vite-Helfer, crates/agentz-desktop
6  PR: Release-Pipeline (Tag-Schema, Zeiger-Release, Bump-Skript)
   → scriptz-v0.9.0 manuell installieren → scriptz-v0.9.1 Updater-Test
7  PR: apps/site + Domain/Vercel        (ab 6 parallel möglich)
8  PR: Generator, Logo pro App, docs/neue-app.md → Sandbox-Abnahmetest
```

## 14. Vorbereitung für später (nicht umsetzen, nur nicht verbauen)

Damit Konten, Sync und Web-Versionen später **für alle Apps gleichzeitig**
kommen können:

- **Kit bleibt plattformneutral.** Kein `@tauri-apps/*` in `kit` und
  Modulen (Lint-Regel). Eine spätere Web- oder Cloud-Schale ist dann
  „nur" ein weiterer Host neben `@agentz/desktop`.
- **Speicher nur über Adapter.** Module greifen nie direkt auf SQL zu,
  sondern über ihr Storage-Interface. Ein Sync- oder Cloud-Adapter kann
  sich später dazwischenschalten.
- **Datenmodell-Konventionen für neue Tabellen**, ab sofort:
  - IDs per `crypto.randomUUID()` (ScriptZ macht das schon)
  - `created_at` / `updated_at` in Millisekunden in jeder Tabelle
  - Löschen als Soft-Delete (`deleted_at`) statt sofortigem `DELETE`,
    wo es fachlich passt. Endgültiges Löschen erst später (Papierkorb
    leeren). Sync braucht Tombstones.
  - Diese Konventionen in `suite-architecture.md` festhalten.
- **Ein Platz für „Konto" in der Shell.** Kein Code, aber der
  Settings-Dialog des Kits bekommt die Sektionen so, dass später eine
  Sektion „Konto" oben dazukommen kann, ohne Module anzufassen.
- **App-übergreifende Funktionen** (z. B. Notiz → Skript) laufen später
  über definierte Schnittstellen (Deep-Links `agentz-scriptz://...` oder
  gemeinsamer Sync), **nie** über direkte Modul-Importe.
