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
  - ".github/workflows/nightly.yml"
---

# Releases

Jede App hat Tags `<app-id>-v<semver>` und einen eigenen Update-Kanal, den
Zeiger-Release `<app-id>-latest`. Kein App-Release wird GitHubs „Latest"
(dort steht `v0.8.4` und bleibt stehen). Alle Apps teilen den Updater-Schlüssel
(GitHub-Secrets `TAURI_SIGNING_PRIVATE_KEY`, optional `..._PASSWORD`); nie
ausgeben oder committen, außerhalb des Repos gesichert halten.

## Checkliste

1. Bei Speicher- oder Migrationsänderungen vorher die DB sichern (siehe
   `apps/<app>/AGENTS.md`).
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

## Sync-Format

Apps mit Sync führen ihr Datenformat in `modules/<app>/lib/sync/format.json`
(`reads`, `writes`). `pnpm check:sync-format` (CI) vergleicht `main` mit dem
letzten Stable-Tag `<app>-vX.Y.Z`: `writes` darf dessen `reads` nicht
übersteigen, `reads` nicht unter dessen `writes` fallen. Ein Formatbruch
braucht deshalb zwei Releases, erst `reads` anheben, dann `writes`. Mit dem
Tag ändert sich der Vergleich; nach einem Release mit neuem `reads` kann der
nächste PR `writes` anheben. Details: „Versionen und Kompatibilität“ in
[`docs/cloud-sync.md`](../../docs/cloud-sync.md).

## Nightly

`.github/workflows/nightly.yml` läuft alle drei Stunden (und per
`gh workflow run nightly.yml --ref main [-f app=<app>] [-f force=true]`).

- `plan` nimmt den neuesten `main`-Commit mit grünem „CI passed" und baut nur
  Apps, deren Code sich seit dem letzten Nightly geändert hat
  (`nightlyRelevant`: `apps/<app>`, `modules/<app>`, `packages/`, `crates/`,
  Lockfiles; keine Markdown-Dateien).
- Version `<nächster Patch>-nightly.<UTC JJJJMMTTHHMM>`, bei vorbereiteter,
  noch nicht getaggter Version deren Kern. Gesetzt nur per `--config` beim
  Build, keine Datei und kein Commit. Die nächste stabile Version ist immer
  neuer und löst Nightlies automatisch ab.
- macOS und Windows bauen parallel mit demselben Signaturschlüssel;
  `VITE_AGENTZ_BUILD_*` markiert den Build (Sternenhimmel, Über-Infos), die
  Icons kommen aus `src-tauri/icons-nightly/`.
- `publish` (Concurrency `nightly-<app>`) lädt in den rollierenden
  Pre-Release `<app>-nightly` erst die versionierten Assets, dann
  `<app>-nightly-macos-arm64.dmg`/`-windows-x64-setup.exe`, zuletzt
  `latest.json`, dann den Release-Text mit Commit-/Versions-Marker. Nie
  zurück auf ältere Versionen; behalten werden die Assets der letzten drei
  Nightlies. Der Tag `<app>-nightly` benennt nur den Kanal und bleibt stehen,
  den gebauten Commit nennt der Release-Text. Den Marker nie entfernen.
- In der App wählt `update_channel` (`stable`/`nightly`) den Kanal. Der Nightly-
  Kanal prüft `<app>-nightly` **und** `<app>-latest` und nimmt die neuere
  Version. Vor jedem Update von, zu oder zwischen Nightlies legt die App per
  `VACUUM INTO` eine Sicherung in `<App-Konfigordner>/backups/` an (die
  letzten fünf bleiben).
- **Nightlies teilen die Datenbank mit der stabilen Version.** Eine Migration
  gilt deshalb ab dem Merge auf `main` als veröffentlicht, nicht erst ab dem
  Tag. Ein Zurück auf eine ältere Version gibt es nicht.
- Lokal testen: `VITE_AGENTZ_BUILD_CHANNEL=nightly pnpm dev:scriptz` zeigt
  die Nightly-Optik, Kit-Fixture mit `?nightly`.

## Installation

Updater-Endpoint: `https://github.com/AgentZ-Media/AgentZ-Suite/releases/download/<app>-latest/latest.json`,
für Nightlies zusätzlich `.../<app>-nightly/latest.json` (abgeleitet in
`crates/agentz-desktop/src/updates.rs`).

In der App: Gefundene Updates lädt sie im Hintergrund (`update_auto_install`,
Standard an) und installiert sie beim Beenden nach dem Speichern; „Jetzt neu
starten“ übernimmt sie sofort. Von sich aus startet sie nie neu. Windows
startet den Installer beim Beenden ohne `/R`, die App bleibt also zu
(`crates/agentz-desktop/README.md`).
Die Apps sind nicht notarisiert bzw. codesigniert: macOS braucht beim ersten
Start `xattr -cr "/Applications/<Produkt>.app"`, Windows zeigt SmartScreen.
Der Install-Footer erklärt beides. Installationen von ScriptZ 0.8.4 und älter
prüfen einen anderen Update-Kanal und brauchen einmal den aktuellen Installer
aus `scriptz-latest`.

Neuer Windows-Rechner: Node 24, pnpm laut `packageManager`, Rust Stable MSVC,
Visual Studio Build Tools (Desktop-C++, Windows SDK), WebView2.
