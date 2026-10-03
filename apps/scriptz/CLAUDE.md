# ScriptZ

Lokaler Skript-Editor für Kurzvideos (TikTok, Reels, YouTube Shorts).
`apps/scriptz` ist die dünne Tauri-Schale (`src/index.tsx` ruft
`bootDesktopApp` auf), das Produkt liegt in `modules/scriptz`
(`@agentz/scriptz`). Tauri 2, Solid, Lexical (vanilla), SQLite über
`@tauri-apps/plugin-sql`. macOS Apple Silicon und Windows x64.
Architektur und Datenfluss: [`scriptz-architecture.md`](../../.claude/rules/scriptz-architecture.md).

## Daten schützen

Identifier `de.agent-z.scriptz`, `scriptz.db`, die Migrationen `001` bis
`007` sowie alle Settings- und `app_state`-Schlüssel sind fix. Neue
Schemaänderungen nur als neue Migration in `src-tauri/migrations/`, registriert
in `src-tauri/src/lib.rs`, und im `.scriptz`-Import/Export mitdenken.

`pnpm dev:scriptz` nutzt dieselbe Datenbank wie die installierte App. Vor
Arbeit an Speicher, Migrationen oder Boot sichern (App vorher beenden):

```bash
DB=~/Library/Application\ Support/de.agent-z.scriptz/scriptz.db
OUT=~/Backups/scriptz/scriptz-$(date +%Y%m%d-%H%M%S).db
mkdir -p ~/Backups/scriptz && sqlite3 "$DB" ".backup '$OUT'"
sqlite3 "$OUT" "PRAGMA integrity_check;"   # muss "ok" liefern
```

Kein `cp` der laufenden DB (WAL). Wiederherstellen bei beendeter App:
`scriptz.db-wal`/`-shm` löschen, Sicherung als `scriptz.db` zurückkopieren.

## Konventionen

- **Persistenz in TypeScript.** Produkt-SQL in `modules/scriptz/lib/`, keine
  Tauri-Commands für Daten, kein `localStorage` für Inhalte. IDs sind UUIDv4,
  Zeitstempel `Date.now()`. Kein `any`.
- **Lexical vanilla**, kein `@lexical/react`. Nach `setRootElement` immer
  `registerRichText(editor)` aufrufen, sonst bricht das Tippen still ab.
- **Leere Blöcke ohne Kinder** an Lexical geben; kein `$createTextNode("")`,
  sonst findet WebKit keinen Caret.
- **ALLCAPS im Charakter-Block nur per CSS.** Textknoten nie in einem
  Node-Transform pro Tastendruck ändern, das friert die Eingabe ein. Nur das
  `characterName`-Attribut wird per Transform synchronisiert.
- **Genau vier Blocktypen:** Action (⌘1), Charakter (⌘2), Dialog (⌘3),
  Parenthetical (⌘4). Kamera, Caption, SFX sind abgeschafft und werden beim
  Lesen sowie einmal beim Boot zu Action. Jeder neue Lesepfad für
  `content_json` läuft über `normalizeLegacyContent`/`normalizeLegacyTree`.
- **Charaktere existieren nur im Skript** (keine globale Charakter-Tabelle);
  Farben sind beim Speichern „klebrig".
- **Längenziel ist ein Bereich.** „Darunter" ist Information, nur „darüber"
  nutzt `--warn`. Spec: [`docs/feature-laengenziel.md`](../../docs/feature-laengenziel.md).
- **Inspector zeigt nur Informationen**, Einstellungen gehören in den
  Einstellungsdialog. **⌘I ist Ideen-Schnellerfassung**, es gibt kein Kursiv.
- Einzige Netzwerkanfrage: der Updater
  (`releases/download/scriptz-latest/latest.json`). Keine Telemetrie.

## Nicht wieder einführen

Ohne Rücksprache mit dem User nicht zurückholen: Tabs, globale Charaktere,
Projekte, Tags, Aliase, Serien, Vibrancy, KI-Funktionen, Wochenziel, Streak,
Sprint-Timer, Begrüßungen, Kamera/Caption/SFX-Blöcke, Cloud-Sync, Konten.

## Fehlerbilder

- **Tippen stirbt nach wenigen Zeichen:** `registerRichText` fehlt oder ein
  Transform verändert Textknoten.
- **Leerer Charakter-Block nimmt keine Eingabe:** leerer Textknoten
  vorangestellt; Block kinderlos lassen und `select(0, 0)` nutzen.
- **„type not found" beim Öffnen:** ein Lesepfad hat `normalizeLegacyContent`
  umgangen; Lesepfad reparieren, keine alten Node-Klassen registrieren.
- **Gelöschter Charakter taucht wieder auf:** Name steht noch in einem
  Charakter-Block; Cast und Autocomplete spiegeln `content_json`.

## Befehle

Vom Repo-Root: `pnpm dev:scriptz`, `pnpm build:scriptz`. Ports: Vite 1420,
HMR 1421, `devUrl` `http://localhost:1420` (immer zusammen ändern). Native
Bundles landen im Root unter `target/release/bundle/`.
