# Eine neue AgentZ-App

Der Generator liefert einen lauffähigen Desktop-Host und ein eigenständiges Produktmodul. ScriptZ und seine Daten bleiben dabei unverändert.

## 1. App anlegen

Voraussetzungen: die Werkzeuge aus `README.md` (Node, pnpm, Rust und Tauri-Systemabhängigkeiten). Im Repository-Root:

```sh
pnpm new-app mein-tool "Mein Tool"
pnpm dev:mein-tool
```

Die ID besteht aus Kleinbuchstaben, Ziffern und Bindestrichen, beginnt mit einem Buchstaben und hat höchstens 50 Zeichen. Infrastruktur-Namen und ScriptZ sind reserviert. Vorhandene App-, Modul-, Release-Notes- oder Icon-Pfade werden nie überschrieben.

Der Generator erstellt:

- `apps/mein-tool`: dünner Tauri-Host, eigene Bundle-ID `de.agent-z.mein-tool`, eigene Datenbank `mein-tool.db`, Icons und App-Anleitung.
- `modules/mein-tool`: Startseite, DE/EN-Texte, Toast-/Bestätigungsbeispiel und ein Interaktionstest.
- Release-Notes-Verzeichnis, `dev:mein-tool`/`build:mein-tool`, Logo- und Website-Eintrag mit Status `soon`.

Vite-Port, HMR-Port und Tauri-`devUrl` werden gemeinsam vergeben: ScriptZ bleibt bei 1420/1421, die nächste App verwendet 1430/1431. Daten und Fensterpositionen liegen durch die eigene Bundle-ID getrennt.

Anschließend laufen `pnpm install --no-frozen-lockfile`, der Icon-Build und `cargo check --workspace`. Beide Lockfiles gehören zum Commit. Fehlt Chrome, nimmt der Icon-Build automatisch das mitgelieferte Platzhalterset. Scheitert ein Schritt, stellt der Generator die vorherigen Quellen, Registry-Einträge und beide Lockfiles wieder her. Nach Beheben der Ursache kann der vollständige Befehl erneut laufen. Der Paketmanager-Cache und lokale `node_modules` können bereits aktualisiert sein; bei Bedarf `pnpm install --frozen-lockfile` ausführen.

## 2. Produkt ausarbeiten

- Name und Beschreibung in Modul, Tauri-Konfiguration und Website pflegen. Eine einmal veröffentlichte Bundle-ID nicht ändern.
- `AppModule` in `modules/mein-tool/module.tsx` ergänzen: Routen, Sidebar, Befehle, Produkt-Einstellungen, optionale Overlays und Aufräumen in `dispose`/`context.onDispose`.
- Produkttexte in beiden Katalogen ergänzen. Gemeinsame Oberflächen kommen aus dem Kit, CSS verwendet semantische Design-Tokens. Keine Imports aus anderen Produkten und kein `legacy.css`.
- Für persistente Änderungen die Kit-Speicher- und Flush-Verträge verwenden; keine unregistrierten Hintergrundschreibvorgänge. Asynchrone Initialisierung beachtet `context.signal`; reaktive Ressourcen nach `await` entstehen über `context.runOwned`.
- Eigene Tabellen als nächste Migration in `apps/mein-tool/src-tauri/migrations` anlegen und in `src/lib.rs` registrieren. Migration 1 ist eine beim Generieren eingefrorene Kopie von `KIT_BASELINE_SQL`; ausgelieferte Migrationen nicht nachträglich ändern.
- Zusätzliche native Plugins direkt im App-`Cargo.toml` deklarieren und ihre Berechtigungen ausdrücklich ergänzen. Systemweite Tastenkürzel sind keine Basisfunktion.
- `apps/mein-tool/CLAUDE.md` um produktspezifische Regeln ergänzen.

## 3. Logo und Vorschau

In `packages/design/logo.ts` den generierten `LOGOS["mein-tool"]`-Eintrag gestalten. Die Markierungen um den Eintrag erhalten, damit `remove-app` ihn gezielt entfernen kann.

```sh
node packages/design/scripts/build-logo.mjs --app mein-tool
pnpm build:mein-tool
pnpm lint
pnpm typecheck
pnpm test
```

Der Icon-Build schreibt das native Icon-Set und `apps/site/public/img/mein-tool.png`. Für einen bewusst neutralen Platzhalter gibt es `--fallback`. Vor Veröffentlichung ein eigenes Icon erstellen und beide Desktop-Themes sowie DE/EN prüfen. Zusätzlich die App parallel mit ScriptZ starten, Schließen/Neustart und getrennte Datenverzeichnisse prüfen.

## 4. Erster Release

1. App-Version in `package.json`, `src-tauri/Cargo.toml` und `tauri.conf.json` gemeinsam setzen; `Cargo.lock` aktualisieren.
2. `docs/release-notes/mein-tool/v0.1.0.md` schreiben und Änderungen über einen geprüften PR mergen.
3. Den vorgesehenen Release-Probelauf der Workflow-Datei ohne Veröffentlichung ausführen; macOS- und Windows-Artefakte prüfen.
4. App-spezifischen Tag `mein-tool-v0.1.0` veröffentlichen. Die Pipeline baut und signiert mit dem gemeinsamen Updater-Schlüssel. Keine Schlüssel ins Repository kopieren.
5. DMG/EXE, `latest.json` und den Zeiger `mein-tool-latest` prüfen. Downloads müssen ohne GitHub-Anmeldung erreichbar sein. Für öffentliche Updater-Abnahmen ein veröffentlichtes Pre-Release verwenden; ein Draft ist nicht erreichbar.
6. Auf einem zweiten Release den echten Updatepfad einer installierten alten Version prüfen.
7. In `apps/site/src/apps.ts` den Status auf `available` setzen und Download-Links prüfen. Alle Apps verwenden ihre eigenen Zeiger. Die neue Pipeline setzt keinen App-Release als globalen GitHub-„Latest“-Release; ein dort noch sichtbarer historischer ScriptZ-Release ist kein aktueller Updatekanal.

## 5. Eine generierte App wieder entfernen

```sh
pnpm remove-app mein-tool
```

Das entfernt die generierten App-/Modul-/Release-Notes-Verzeichnisse, die generierten Design-Assets, das Website-Bild und die markierten Einträge in Logo, Website und Root-Skripten; danach werden beide Lockfiles aktualisiert. Scheitert das, werden die entfernten Dateien und die bisherigen Lockfiles wiederhergestellt. Der Eigentumsnachweis `apps/mein-tool/.agentz-generated.json` und die Registry-Markierungen müssen erhalten sein. Veränderte Root-Skriptbefehle oder widersprüchliche Nachweise führen zu einem Abbruch zur manuellen Prüfung. Auch später ergänzte Dateien innerhalb dieser App-/Modul-Verzeichnisse werden entfernt: gewünschte Arbeit vorher committen.

Lokale Nutzerdaten, installierte Apps, Git-Tags und GitHub-Releases bleiben erhalten. Veröffentlichte Test-Releases und Tags werden separat und nur ausdrücklich gezielt entfernt. Produktive Datenbanken werden niemals vom Generator gelöscht.
