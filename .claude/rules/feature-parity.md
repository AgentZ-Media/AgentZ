---
paths:
  - "apps/desktop/**"
  - "apps/web/**"
  - "packages/core/**"
  - "packages/design/**"
---

# Feature-Parity Desktop ↔ Web

**Grundregel:** Was ein User merkt, soll in beiden Apps identisch
funktionieren. Wenn es nicht geht, muss die Differenz dokumentiert und
ehrlich kommuniziert sein (Web-Disclaimer, Settings-Hinweis).

## Was zwingend in `packages/core/` lebt

Alles, was auf beiden Plattformen identisch sein muss:

- Editor-Engine, die drei Lexical-Nodes (Action, Charakter, Dialog),
  alle Plugins (Hotkeys, Block-Picker, Smart-Enter, Inline-Format,
  Character-Autocomplete, Farb-Picker, Highlight)
- **Die komplette App-Schale**: [`components/Shell/AppShell.tsx`](packages/core/components/Shell/AppShell.tsx)
  (Boot, Layout, Routen, globale Shortcuts, alle Dialoge) samt
  `Sidebar`. Die Apps rendern nur `<AppShell platform=... />` und
  hängen ihr Plattform-Chrome über `topSlot` (Web: Disclaimer) bzw. `sidebarFooterSlot` (Desktop:
  Update-Indikator, Web: Storage-Badge) an.
- UI-Komponenten nach Bereich: `Shell/`, `Library/` (Skript-Liste,
  Papierkorb, Auswahl, Handoff), `Palette/` (⌘K), `Script/`
  (Editor-Screen, Kopfleiste, Inspector, Zeitleiste, Stufen-Chip),
  `Editor/`, `Ideas/`, `Export/`, `Settings/`, `Onboarding/`,
  `Activity/` (Schreib-Zähler, Heatmap), `Common/`
- Stores: `nav` (Routen, Verlauf, Zuletzt), `ui` (Panels, Fokus, offene
  Dialoge), `settings`, `ideas`, `dailyStats`, `saveStatus`, `toasts`
  (alles außer dem desktop-only `updates`-Store, der über den Slot in
  `lib/updates.ts` eingehängt wird)
- Business-Logik: `scripts.ts`, `folders.ts`, `ideas.ts`,
  `snapshots.ts`, `search.ts`/`fts.ts`, `format.ts`, `lex.ts`,
  `runtime.ts`, `timing.ts`, `lengthGoal.ts`, `writingCounter.ts`,
  `legacyBlocks.ts` + `legacyBlocksMigration.ts`,
  `characterColors.ts`, `dailyWords.ts`, `scriptzFile.ts`,
  `handoff.ts`, ...
- App-spezifische Tokens (Charakter-Palette, A4-Geometrie,
  Trafficlight-Spacer) und die Papier-Schrift (iA Writer Quattro) in
  `packages/core/styles/`
- PDF-Generator und Plain-Text-Export (Pure-Function, schreibt Bytes;
  das *Speichern* ist plattform-spezifisch, siehe unten)
- Plattform-Detection (`isModKey`, `K()` / `formatHotkey`,
  `data-platform`-Attribut auf `<html>`)

`packages/core/` darf **nie** `@tauri-apps/*` importieren - ESLint-Rule
blockt das. Browser-only-Annahmen (`window`-Zugriffe) nur hinter
Feature-Detection.

## Designsystem `@agentz/design` (`packages/design/`)

Farben, Typo-Skala, Spacing, Radien, Motion, Hell/Dunkel/Dunkles-Papier,
Komponenten-Primitive (`.btn`, `.chip`, `.menu`, `.dlg`, `.seg`, ...),
UI-Schrift (Schibsted Grotesk), Icons und Logo leben in
[`packages/design/`](packages/design/README.md). Desktop, Web und Studio
importieren dieselben vier CSS-Schichten in derselben Reihenfolge
(`fonts.css` -> `tokens.css` -> `legacy.css` -> `components.css`, danach
`@scriptz/core/styles/global.css`). Keine Hex-/rgb-Werte außerhalb des
Pakets - nur `var(--token)`. Ausnahmen: Inhaltsfarben, die Daten sind
(Charakter-Palette), und OS-Chrome-Nachbauten. `legacy.css` ist eine
Übergangsschicht für alte Token-Namen; neuer Code nutzt sie nicht.

## Was bewusst pro App getrennt bleibt (Adapter-Pattern)

| Bereich | Desktop (`apps/desktop/`) | Web (`apps/web/`) |
|---|---|---|
| `StorageAdapter` | SQL-Default-Adapter aus [`packages/core/lib/api.ts`](packages/core/lib/api.ts) gegen SQLite + FTS5; die Verbindung (`@tauri-apps/plugin-sql`) liefert `PlatformAdapter.getDb()` in [`lib/platform.ts`](apps/desktop/src/lib/platform.ts) | [`adapters/indexeddb.ts`](apps/web/src/adapters/indexeddb.ts) → Dexie + MiniSearch, überschreibt den SQL-Default beim Import |
| `PlatformAdapter.saveAs/openFile` | Native Tauri-Dialoge + `plugin-fs` | Blob-Download via `<a download>` / verstecktes `<input type="file">` |
| `PlatformAdapter.openUrl` / `revealInFolder` | Tauri-Shell / `plugin-opener` | `window.open` / No-op |
| Auto-Updater | [`stores/updates.ts`](apps/desktop/src/stores/updates.ts) + `UpdateIndicator` im `sidebarFooterSlot` | Entfällt - SettingsDialog blendet "Updates" aus, wenn Slot leer |
| Save-Flush beim Schließen | Tauri `onCloseRequested` → `flushAll()` | `beforeunload` + `pagehide` → `flushAll(2000)` |
| Window-Chrome | macOS-Trafficlight-Spacer (CSS-Property `--titlebar-traffic-width`) | `data-shell="web"` deaktiviert den Mac-Spacer im Browser |
| Web-only Chrome | - | [`WebDisclaimerBanner`](apps/web/src/components/) im `topSlot`, `StoragePersistedBadge` im `sidebarFooterSlot`, [`DesktopOnlyGate`](apps/web/src/components/) (< 1024 px) um `<App>` in `main.tsx` |
| Code-Signing / Release | macOS-Signing, GitHub-Release mit `latest.json` | Vercel-Deploy auf Push zu `main` |

## Wenn du ein neues Feature baust

1. **Default**: Code in `packages/core/`. Keine `@tauri-apps/*`-Imports
   (ESLint blockt das ohnehin), keine Browser-only-Annahmen
   (`window`-Zugriffe nur hinter Feature-Detection).
2. **Wenn das Feature einen neuen Storage-Zugriff braucht**:
   `StorageAdapter`-Interface in
   [`packages/core/lib/storage.ts`](packages/core/lib/storage.ts)
   erweitern. TypeScript meckert dann in **allen** Adapter-Impls -
   SQL-Default (`packages/core/lib/api.ts` + die Module in `lib/`),
   IndexedDB-Adapter (Web) UND Convex-Adapter (Studio,
   [`apps/studio/src/adapters/convex.ts`](apps/studio/src/adapters/convex.ts))
   mit aktualisieren, sonst bricht die jeweils andere App
   stillschweigend. Studio darf Methoden, die es fachlich nicht
   anbietet, als `notSupported("...")` implementieren - so geschehen
   bei den Werkbank-Methoden `setScriptStatus` und
   `setFolderLengthRange` (Studio hat einen eigenen Freigabe-Workflow
   und bildet nur lesend ab: approved -> `ready`, filmed -> `shot`,
   alles andere -> `writing`). Kein Convex-Schema-Change für
   Desktop/Web-Features (Production-only Deployment).
   Neue Felder auf bestehenden Tabellen: Desktop per additiver
   SQL-Migration (`apps/desktop/src-tauri/migrations/00X_*.sql`, in
   `src-tauri/src/lib.rs` registrieren), Web per optional gelesenem
   Feld mit Default im Dexie-Adapter (Version nur bumpen, wenn ein Index
   nötig ist). Vorbild: Migration `007_werkbank.sql` (Stufe +
   Zielbereich).
3. **Wenn das Feature einen neuen Platform-Zugriff braucht** (Dialoge,
   OS-Info, externes Öffnen): `PlatformAdapter` in
   [`packages/core/lib/platform.ts`](packages/core/lib/platform.ts)
   erweitern. Beide Apps müssen die neue Methode implementieren -
   Desktop via Tauri, Web via Browser-API oder No-op + ehrliche
   Fehlermeldung.
4. **Wenn das Feature .scriptz-Daten betrifft**:
   [`scriptzFile.ts`](packages/core/lib/scriptzFile.ts) mit anpassen,
   sonst überleben die neuen Felder den Import/Export-Roundtrip nicht.
   Format-Version hochziehen, wenn die Änderung nicht additiv ist.
5. **Verifikation**: `pnpm dev:desktop` UND `pnpm dev:web` mindestens
   einmal anwerfen und das Feature in beiden Welten ausprobieren.
   Type-Check (`pnpm typecheck`) deckt die Adapter-Vollständigkeit ab,
   aber nicht die Laufzeit-Wirkung.

## Wann eine Differenz OK ist

Wenn die Plattform-Limits es erzwingen - z.B.:

- **Auto-Update gibt's nur auf Desktop**, weil Browser keinen
  installierten Binary haben. Settings blendet die Sektion im Web aus.
- **MiniSearch (Web) vs. SQLite-FTS5 (Desktop)**: gleiche User-UX,
  unterschiedliche Tech. Wenn die Suchqualität spürbar
  auseinanderläuft, später auf sql.js (WASM) wechseln.
- **Datei-Zugriff**: native Save-Dialoge geben einen Pfad zurück (mit
  Reveal-in-Finder), Blob-Downloads nicht. Toast-Wording adaptiv
  ("Export gespeichert" mit Reveal vs. "Datei heruntergeladen").
- **Daten-Persistenz**: SQLite ist hart persistent, IndexedDB kann der
  Browser unter Speicherdruck räumen. Web-Disclaimer macht das ehrlich.

Solche Differenzen müssen für den User sichtbar/spürbar konsistent
sein - "tut dasselbe, sieht gleich aus, sagt das Gleiche, wo nötig
ehrlich anders". Nie eine App-Variante haben, die ein Feature *still*
weglässt.
