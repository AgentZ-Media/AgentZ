# Umsetzung Redesign „Werkbank" - Arbeitsplan & Schnittstellen

> Interne Doku. Stand: 2026-10-03. Branch: `redesign-werkbank`.
> Verbindliche Grundlage für alle Arbeitspakete. Visuelle Referenz ist
> **`docs/redesign/concept.html`** (CSS-Block `.A { … }` = Token-Werte,
> Markup = Soll-Layout). Feature-Spec Längenziel:
> **`docs/feature-laengenziel.md`**. Bei Abweichungen gilt: Konzept-HTML
> für Optik, dieses Dokument für Struktur/Schnittstellen.

## 0. Harte Regeln (gelten für jedes Paket)

- Lies `CLAUDE.md`, `apps/desktop/CLAUDE.md`, `.claude/rules/feature-parity.md`,
  `.claude/rules/i18n.md` bevor du anfängst.
- `packages/core` importiert **nie** `@tauri-apps/*`. Kein `any`. Solid, kein React.
- Lexical vanilla. `registerRichText` bleibt. Leere Blöcke kinderlos.
  Keine Textmutation in Node-Transforms.
- Code-Kommentare **Englisch**. Alle User-sichtbaren Strings über i18n,
  **DE + EN**, deutsche Texte mit echten Umlauten, keine Em-Dashes.
- Kein Git: kein commit/stash/checkout/reset. Der Orchestrator committet.
- Nur die Dateien anfassen, die deinem Paket gehören (siehe unten). Wenn du
  etwas außerhalb brauchst: im Abschlussbericht beschreiben, nicht ändern.
- Keine Dev-Server starten, die weiterlaufen. Verifikation:
  `pnpm --filter @scriptz/core typecheck`, `pnpm --filter @scriptz/core test`,
  `pnpm typecheck` (alle Workspaces). Fehler in Dateien anderer laufender
  Pakete ignorieren, eigene müssen sauber sein.
- Desktop und Web müssen sich identisch verhalten (Adapter-Pattern).
- Nichts aus der bestehenden Funktionalität darf verloren gehen, außer was
  hier ausdrücklich gestrichen ist.

## 1. Was gestrichen wird (bewusst)

- Tabs / TabBar / Home-Tab / Ideen-Tab → Seitenleiste + Verlauf + „Zuletzt".
- Blocktypen **Kamera, Caption, SFX** → werden zu **Action** (Text bleibt).
  Ursprünglich stand hier auch **Parenthetical** - diese Streichung ist
  per Entscheidung vom **2026-10-03** zurückgenommen (siehe §9).
- Wochenziel (`weeklyWordGoal`), Streak-Anzeige, Ideen-Badge-Setting,
  MomentumStrip, Begrüßung „Guten Morgen". Ersetzt durch adaptiven Schreib-Zähler.
- EditorToolbar (Block-Pills), EditorRail → Kopfleiste + Inspector.

## 2. Neues Datenmodell

```ts
// lib/types.ts
export type ScriptStatus = "writing" | "ready" | "shot" | "online";
export type Stage = "idea" | ScriptStatus;            // UI: Sidebar/Pipeline
ScriptSummary += { status: ScriptStatus; status_changed_at: number | null }
Folder        += { length_min_sec: number | null; length_max_sec: number | null }
```

- Desktop SQLite: Migration `apps/desktop/src-tauri/migrations/007_werkbank.sql`
  (additiv): `scripts.status TEXT NOT NULL DEFAULT 'writing'`,
  `scripts.status_changed_at INTEGER`, `folders.length_min_sec INTEGER`,
  `folders.length_max_sec INTEGER`. In `src-tauri/src/lib.rs` registrieren.
- Web Dexie (`apps/web/src/adapters/indexeddb.ts`): Felder optional lesen,
  Default `status = "writing"`, Ranges `null`. Version nur bumpen, wenn ein
  Index nötig ist.
- Studio (`apps/studio/src/adapters/convex.ts`): neue Methoden als
  `notSupported(...)` bzw. Status aus Studio-Status abbilden
  (draft/in_review/changes_requested/rejected → writing, approved → ready,
  filmed → shot). **Kein** Convex-Schema-Change (Production-only Deployment).
- `.scriptz`-Datei (`lib/scriptzFile.ts`): `status` optional additiv
  mitschreiben/lesen (Format-Version bleibt 1, Tests ergänzen).
- Settings (Key/Value): `length_min_default_sec`, `length_max_default_sec`
  (leer = aus). `showWritingStats` bleibt als Key, bedeutet jetzt
  „Schreib-Zähler anzeigen" (Default **an**). `focusModeDefault` Default
  für Neuinstallationen **aus**.

### StorageAdapter-Erweiterung (`lib/storage.ts`)

```ts
setScriptStatus(id: string, status: ScriptStatus): Promise<ScriptSummary>;
setFolderLengthRange(id: string, minSec: number | null, maxSec: number | null): Promise<Folder>;
// ListScriptsQuery += { status?: ScriptStatus }
// ConvertIdeaInput.notesAsAction: Default jetzt FALSE (Notiz bleibt an der Idee,
//   Inspector zeigt sie unter „Aus der Idee").
```

## 3. Neue Core-Bibliotheken (rein, getestet)

| Datei | Export | Zweck |
|---|---|---|
| `lib/legacyBlocks.ts` | `normalizeLegacyContent(json: string): { json: string; changed: boolean }` | Wandelt alte Blocktypen in Action. Wird überall angewendet, wo Content geparst wird (Editor-Load, lex, PDF, Plaintext, Import, Snapshot-Restore). |
| `lib/legacyBlocksMigration.ts` | `migrateLegacyBlocksOnce(): Promise<void>` | Boot-Migration über alle Skripte (inkl. Papierkorb) via `api`, Flag `app_state["migration.legacy_blocks_v1"]`. |
| `lib/timing.ts` | `computeTimeline(blocks: TimingBlock[], wpm: number): TimelineSegment[]`, `type TimingBlock = { key?: string; kind: "action" \| "character" \| "dialog" \| "paren"; text: string }`, `type TimelineSegment = { key?: string; kind: "action" \| "dialog"; speaker: string \| null; startSec: number; durSec: number; text: string }` | Sprecher-Spuren. Summe == `runtime.ts`-Laufzeit (gleiche Formel). |
| `lib/lengthGoal.ts` | `type LengthRange = { minSec: number \| null; maxSec: number \| null }`, `resolveLengthRange(folder: Folder \| null, defaults: LengthRange): LengthRange \| null`, `lengthStatus(runtimeSec, range): { state: "none" \| "under" \| "in" \| "over"; deltaSec: number }`, `formatRange(range): string` | Zielbereich laut Spec. |
| `lib/writingCounter.ts` | `pickWritingWindow(stats: DailyStatsSummary, now?: Date): { words: number; window: "week" \| "month" \| "year" \| "total" \| "none"; all: { week: number; month: number; year: number; total: number } }` | Adaptiver Zähler: kleinstes Fenster mit Wörtern > 0. |

`lib/runtime.ts`: Direction-Blocks = nur noch Action.

## 4. Design-Paket `packages/design` (`@agentz/design`)

- `tokens.css` - semantische Tokens hell/dunkel exakt aus `concept.html`
  (`.A`/`.A.dark`), auf `:root`, `[data-theme="dark"]`,
  `[data-theme="dark"][data-paper="dark"]` gemappt. Inkl. `--range-fill`,
  `--t-*`-Logik bleibt in `highlight.ts`.
- `legacy.css` - Alias-Schicht alter Namen (`--fg`, `--text*`, `--brand-*`,
  `--ink-*`, `--bg-elev-*`, `--border*`, `--hover*`, …) auf neue Tokens, damit
  unveränderte Komponenten (Snapshots, Heatmap, Handoff, ColorPicker, Trash, …)
  automatisch den neuen Look bekommen.
- `components.css` - `.btn` (+ `.primary`, `.ghost`, `.icon`, `.danger`),
  `.chip`, `kbd`, `.menu`/`.menu-it`, `.dlg`/Modal, `.scrim`, `.toast`,
  `.sw-t` (Switch), `.seg`, `.field`, `.fchip`, `.num-f`. Alte Klassen aus
  `core/styles/global.css` (`.btn-primary`, `.modal*`, `.pill`, `.cselect*`,
  `.toast*`, `.settings-toggle` …) bleiben funktionsfähig (umgestylt).
- `fonts.css` - Schibsted Grotesk (offline, `@fontsource-variable/schibsted-grotesk`).
  iA Writer Quattro bleibt in core für Papier.
- `icons.ts` - `ICONS: Record<IconName, string>` (innerer SVG-Code, 24er
  Viewbox, Stroke). Alle Icons aus `concept.html` (`#i-*`).
- `logo.ts` - Punktmatrix-Z (6×5) als Daten, aus `concept.html` `#logo-z`.
- Core-Komponenten dazu: `components/Common/Icon.tsx` (`<Icon name size? />`),
  `components/Common/StageGlyph.tsx` (`<StageGlyph stage size? />`),
  `components/Common/AppMark.tsx` (`<AppMark size? variant?="accent" />`).
- Studio: `apps/studio/src/styles/studio.css` `--s-*` auf Design-Tokens mappen
  (Orange-Akzent entfällt → Textmarker/Tinte).

## 5. Navigation & UI-State (vom Orchestrator vorgegeben)

- `stores/nav.ts` - Routen + Verlauf + Zuletzt (ersetzt `stores/tabs.ts`).
- `stores/ui.ts` - Seitenleiste/Inspector/Zeitleiste/Fokus + offene Dialoge.

Signaturen stehen in den Dateien selbst (Orchestrator legt sie vor Phase 2 an).

## 6. Komponenten-Schnitt (Phase 2)

| Paket | Besitzt | Liefert |
|---|---|---|
| **C Shell** | `components/Shell/**`, `components/Library/**`, `components/Palette/**`, `apps/desktop/src/App.tsx`, `apps/web/src/App.tsx`, `i18n/parts/shell.ts`, Löschen von `TabBar*`, `Browser/MomentumStrip*`, `stores/tabs.ts` | `AppShell` (Boot, Shortcuts, Layout, mountet D+E), `Sidebar`, `ScriptsPage` (Gruppen nach Stufe, Ideen-Hinweis, Filter, Sortierung/Gruppierung, Auswahlmodus + PDF/Studio/Verschieben/Papierkorb, Kontextmenü, Ordner-CRUD, Import), `TrashPage`, `CommandPalette` (⌘K: Skripte, Ideen, Befehle, leer = Zuletzt) |
| **D Script** | `components/Script/**`, `components/Editor/**` außer `nodes/` und Logik-Plugins aus Phase 1, `i18n/parts/script.ts` | `ScriptScreen` (`{ scriptId: string }`): Kopfleiste, Stufen-Chip+Menü, Quick/Farben-Umschalter, Export-Button, Inspector, Gutter-Label, Autocomplete-Restyle, Zeitleiste (Mini + ausgeklappt, Hover-Link, Klick springt), Fokus-Pille, Recovery, Snapshots |
| **E Dialoge & Ideen** | `components/Ideas/**`, `components/Export/**`, `components/Settings/**`, `components/Onboarding/**`, `components/Activity/**`, `i18n/parts/dialogs.ts` | `IdeasPage`, `QuickCapture` (⌘I, echtes Modal), `ExportDialog`, `SettingsDialog` (inkl. Zielbereich global + je Ordner), `Onboarding` (3 Schritte), `WritingCounter` (Sidebar-Fuß + Aktivitäts-Popover ohne Streak/Ziel) |

Exakte Exporte, die C importiert:

```ts
import { ScriptScreen } from "../Script/ScriptScreen";            // D
import { IdeasPage } from "../Ideas/IdeasPage";                   // E
import { QuickCapture } from "../Ideas/QuickCapture";             // E  (liest ui.captureOpen)
import { ExportDialog } from "../Export/ExportDialog";            // E  (liest ui.exportScriptId)
import { SettingsDialog } from "../Settings/SettingsDialog";      // E  (liest ui.settingsOpen)
import { Onboarding } from "../Onboarding/Onboarding";            // E  (liest ui.onboardingOpen)
import { WritingCounter } from "../Activity/WritingCounter";      // E  (Sidebar-Fuß)
```

Alle Dialoge sind parameterlos und steuern sich über `stores/ui.ts`.

## 7. Tastatur (Soll)

`⌘K` Suchen & Befehle · `⌘N` neues Skript (im aktuellen Ordner) ·
`⌘I` Idee erfassen (überall, auch Fokus; **nie** Kursiv) · `⌘[`/`⌘]` Verlauf ·
`⌘\` Seitenleiste · `⌘⇧\` Inspector · `⌘J` Zeitleiste · `⌘⌥→`/`⌘⌥←` Stufe ·
`⌘⇧F` Fokus · `⌘E` Export · `⌘,` Einstellungen · `⌘⇧S`/`⌘⇧H` Versionen ·
Editor: `⌘1` Action, `⌘2` Charakter, `⌘3` Dialog, `⌘4` Parenthetical
(seit 2026-10-03, siehe §9), `(`/`)` im Dialog, `Tab` Picker, `⏎` Smart-Enter,
`⌘B`/`⌘U`.
Listen (Skripte und Ideen, seit 2026-10-03): `⌘A` alle auswählen
(Auswahlmodus), `⇧`-Klick Bereich, `⌘`-Klick einzeln dazu, `Esc` beendet
die Auswahl.

## 8. Phasen

1. **A Design** ‖ **B Daten & Editor-Logik**
2. Orchestrator: `stores/nav.ts`, `stores/ui.ts`
3. **C Shell** ‖ **D Script** ‖ **E Dialoge & Ideen**
4. Integration, Typecheck, Tests, Build, Sichtprüfung gegen Konzept
5. **F Landing/README/Rules** (Konsistenz)
6. Codex-Review (`gpt-6-astra`, high) → Fixes → PR → CodeRabbit-Schleife

## 9. Stand nach Umsetzung (2026-10-03)

Phasen 1-3 sind umgesetzt und auf `redesign-werkbank` committet
(`355d888` Phase 1, `54b0b0d` Phase 2 inkl. Landing + README).
Integration/QA (Phase 4) läuft, die internen Docs und Rules (Phase 5)
sind nachgezogen. Offen: Codex-Review, PR, CodeRabbit (Phase 6).

**Wie geplant umgesetzt:** Datenmodell inkl. Migration
`007_werkbank.sql` (in `lib.rs` als Version 7 registriert), die neuen
StorageAdapter-Methoden in allen drei Adaptern, die fünf neuen
Core-Bibliotheken samt Tests, `@agentz/design` mit allen vier
CSS-Schichten plus Icons/Logo, `stores/nav.ts` + `stores/ui.ts`, alle
Komponenten aus §6, Tastatur laut §7.

**Abweichungen und Präzisierungen gegenüber dem Plan:**

- **App-Schalen**: Desktop und Web rendern nur noch
  `<AppShell platform=... />` aus `components/Shell/AppShell.tsx`.
  Plattform-Chrome kommt über Slots: Desktop `sidebarFooterSlot`
  (UpdateIndicator), Web `topSlot` (Disclaimer + Storage-Badge); das
  `DesktopOnlyGate` umschließt die Web-App in `main.tsx`.
- **Boot-Migration**: `migrateLegacyBlocksOnce()` läuft in `AppShell`
  nach den parallelen Boot-Schritten und vor `markLibraryReady()` -
  vorher fragt keine Liste den Storage ab und kein Editor öffnet ein
  Skript.
- **Web (Dexie)**: kein Versions-Bump. `status` und die Range-Felder
  werden optional gelesen und in JS gefiltert, ein Index war nicht
  nötig.
- **Studio**: `setScriptStatus` und `setFolderLengthRange` sind
  `notSupported(...)`. Der Status wird nur lesend abgebildet (approved
  -> `ready`, filmed -> `shot`, alles andere -> `writing`); der
  Freigabe-Workflow bleibt die Wahrheit. Kein Convex-Schema-Change.
- **Export-Dialog**: drei Formate (PDF, Teleprompter-Text,
  ScriptZ-Datei) mit Live-Vorschau über `Export/pdfPreview.ts` (ohne
  pdf-lib zu laden).
- **Schreib-Zähler**: das Fenster „total" entspricht den 365 Tagen, die
  `DailyStatsSummary` abdeckt (UI: „in den letzten 12 Monaten").
- **Landing**: `AppShell.astro` zeigt die Werkbank als Demo-Chrome
  (dunkle Seitenleiste, Kopfleiste mit Stufen-Chip, Laufzeit-Pille
  statt Sprint-Pille).

**Nachgezogene Doku (Phase 5):** Root-`CLAUDE.md` (Workspace
`packages/design`, Hex-Regel), `apps/desktop/CLAUDE.md`,
`apps/landing/CLAUDE.md`, `.claude/rules/desktop-architecture.md`
(komplett neu), `feature-parity.md`, `landing-consistency.md`,
`i18n.md` (Aufteilung `i18n/parts/*`), `release.md`,
`docs/studio-spec.md`.

**Entscheidung 2026-10-03: Parenthetical kommt zurück.** Der Product
Owner hat entschieden, dass Regieanweisungen fürs Sprechen („(leise)")
wieder ein eigener Blocktyp sind. Der Editor hat damit **vier**
Blocktypen: Action `⌘1`, Charakter `⌘2`, Dialog `⌘3`, Parenthetical
`⌘4`. Kamera, Caption und SFX bleiben gestrichen. Umgesetzt wie auf
`main`: `ScriptzParentheticalNode` (Typ `scriptz-parenthetical`, gleiche
Serialisierung, alter Content bleibt kompatibel), Plugin
`parentheticalLive` („(" im Dialog öffnet ein Parenthetical und teilt die
Zeile am Cursor, „)" springt in den nächsten Dialog), Smart-Enter
Parenthetical -> Dialog, 22 % eingerückt, kursiv, gedämpft, in der
Sprecherfarbe getönt. Laufzeit: Parenthetical zählt 0 s und keine
Dialogwörter, bekommt kein Zeitleisten-Segment, unterbricht aber den
Sprecher nicht (`runtime.ts`, `timing.ts`, `timelineMath.ts` bleiben
konsistent). `legacyBlocks.ts` wandelt nur noch Kamera/Caption/SFX um;
die Sonderfälle für in Action umgewandelte Klammer-Zeilen
(`isParenCueText` in `lex.ts`/`highlight.ts`) sind entfernt. Onboarding,
Tastenkürzel, Willkommens-Skript, Export-Vorschau, README, Landing und
Rules sind nachgezogen. Hinweis: Wo die Boot-Migration auf einem
Entwicklungsrechner schon gelaufen ist, sind alte Parentheticals bereits
Action-Zeilen „(…)" - die bleiben so (kein Rückweg, betrifft keine
veröffentlichte Version).

**Bekannte Rest-Punkte (nicht Teil von Phase 5):**

- `docs/feature-laengenziel.md` steht noch auf „geplant, nicht
  umgesetzt" - Statuszeile aktualisieren.
- Einige Code-Kommentare beschreiben noch die alte Welt (Tabs, Browser,
  Status-Strip, Streak): `lib/legacyBlocksMigration.ts` („Not wired
  into the apps yet"), `stores/saveStatus.ts`, `lib/scriptViewCache.ts`,
  `lib/scriptsBus.ts`, `lib/dailyWords.ts`.
- `legacy.css` ist eine Übergangsschicht; Aliase löschen, sobald keine
  Komponente sie mehr nutzt.
