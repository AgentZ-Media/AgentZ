---
paths:
  - "apps/*/package.json"
  - "apps/*/src-tauri/**"
  - "Cargo.toml"
  - "Cargo.lock"
  - "package.json"
  - "docs/release-notes/**"
  - "tooling/release/**"
  - ".github/workflows/release.yml"
---

# Releases

Jede App hat Tags `<app-id>-v<semver>` und einen eigenen Update-Kanal, den
Zeiger-Release `<app-id>-latest`. Kein App-Release wird GitHubs „Latest"
(dort steht historisch noch `v0.8.4`). Alle Apps teilen den Updater-Schlüssel
(GitHub-Secrets `TAURI_SIGNING_PRIVATE_KEY`, optional `..._PASSWORD`); nie
ausgeben oder committen, außerhalb des Repos gesichert halten.

## Checkliste

1. Bei Speicher- oder Migrationsänderungen vorher die DB sichern (siehe
   `apps/<app>/CLAUDE.md`).
2. `pnpm release:bump <app> <version>`: setzt App-`package.json`,
   `tauri.conf.json`, `Cargo.toml` und Root-`Cargo.lock` (Offline-Cargo-Update,
   bei Fehler alles zurück) und legt `docs/release-notes/<app>/v<version>.md`
   als Vorlage an. Für den allerersten Release (Version unverändert `0.1.0`)
   nur die Notes-Datei anlegen.
3. Notes auf Englisch ausfüllen, Platzhalterzeile ersetzen (der Workflow
   bricht sonst ab). Den Install-Footer nicht kopieren, der Workflow hängt
   `_install_footer.md` mit dem Produktnamen an.
4. Prüfungen, PR, Merge. Dann den gemergten Commit taggen:
   `git tag -a scriptz-v0.9.2 -m 'ScriptZ v0.9.2' && git push origin scriptz-v0.9.2`.
5. Danach prüfen: beide Plattformen im versionierten Release, Signaturen,
   die drei Zeiger-URLs ohne Login, ein echtes Update einer installierten
   Vorversion.

## Workflow

- `prepare` validiert ID, SemVer, die vier Versionsangaben und die Notes,
  legt den Release mit `--latest=false` an und reicht die numerische
  `releaseId` an `tauri-action` weiter. SemVer-Pre-Releases
  (`1.0.0-rc.1`) werden als GitHub-Pre-Release veröffentlicht und bewegen
  den Zeiger **nicht**; Nutzer und Website bleiben auf der stabilen Version.
- macOS baut vor Windows, weil `tauri-action` `latest.json` zusammenführt.
  Jeder Plattform-Job überspringt bereits vollständige Plattformen, damit
  ein Rerun keine signierten Dateien ersetzt. Cargo läuft mit `--locked`,
  Bundles liegen unter `target/<triple>/release/bundle/`.
- `publish-pointer` (Concurrency-Gruppe `pointer-<app>`) kopiert
  `<app>-macos-arm64.dmg`, `<app>-windows-x64-setup.exe` und zuletzt
  `latest.json` in `<app>-latest` (veröffentlichter Pre-Release, nie
  „Latest"). Er geht nur auf neuere Versionen, repariert bei identischem
  Manifest abgebrochene Uploads und reserviert die Version per Marker im
  Release-Text. Den Marker nie entfernen.
- Laufen mehrere Releases derselben App kurz nacheinander, kann GitHub einen
  wartenden Zeiger-Job abbrechen. Dann den Job der **neuesten** Version erneut
  starten.
- Fehler beheben und Jobs erneut ausführen. Nie Tags löschen oder neu setzen,
  nie veröffentlichte Versions-Assets ersetzen, nie Release-Immutability
  aktivieren (der Zeiger muss veränderbar bleiben).

`gh workflow run release.yml --ref main -f app=<app>` ist immer ein
Probelauf: baut beide Installer ohne Signatur und veröffentlicht nichts.

## Installation

Updater-Endpoint: `https://github.com/AgentZ-Media/AgentZ/releases/download/<app>-latest/latest.json`.
Die Apps sind nicht notarisiert bzw. codesigniert: macOS braucht beim ersten
Start `xattr -cr "/Applications/<Produkt>.app"`, Windows zeigt SmartScreen.
Der Install-Footer erklärt beides. ScriptZ 0.8.4 und älter nutzen noch den
alten Kanal und brauchen einmal den aktuellen Installer aus `scriptz-latest`.

Neuer Windows-Rechner: Node 24, pnpm laut `packageManager`, Rust Stable MSVC,
Visual Studio Build Tools (Desktop-C++, Windows SDK), WebView2.
