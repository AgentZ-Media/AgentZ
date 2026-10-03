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
- Blocktypen **Parenthetical, Kamera, Caption, SFX** → werden zu **Action**
  (Text bleibt; Parenthetical-Text wird in `( … )` gesetzt, falls nicht schon).
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
| `lib/timing.ts` | `computeTimeline(blocks: TimingBlock[], wpm: number): TimelineSegment[]`, `type TimingBlock = { key?: string; kind: "action" \| "character" \| "dialog"; text: string }`, `type TimelineSegment = { key?: string; kind: "action" \| "dialog"; speaker: string \| null; startSec: number; durSec: number; text: string }` | Sprecher-Spuren. Summe == `runtime.ts`-Laufzeit (gleiche Formel). |
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
Editor: `⌘1` Action, `⌘2` Charakter, `⌘3` Dialog, `Tab` Picker, `⏎` Smart-Enter,
`⌘B`/`⌘U`.

## 8. Phasen

1. **A Design** ‖ **B Daten & Editor-Logik**
2. Orchestrator: `stores/nav.ts`, `stores/ui.ts`
3. **C Shell** ‖ **D Script** ‖ **E Dialoge & Ideen**
4. Integration, Typecheck, Tests, Build, Sichtprüfung gegen Konzept
5. **F Landing/README/Rules** (Konsistenz)
6. Codex-Review (`gpt-6-astra`, high) → Fixes → PR → CodeRabbit-Schleife
