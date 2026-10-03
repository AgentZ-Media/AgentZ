---
paths:
  - "apps/scriptz/package.json"
  - "apps/scriptz/src-tauri/tauri.conf.json"
  - "apps/scriptz/src-tauri/Cargo.toml"
  - "Cargo.toml"
  - "Cargo.lock"
  - "pnpm-workspace.yaml"
  - "package.json"
  - "docs/release-notes/**"
  - ".github/workflows/release.yml"
---

# Release / Deploy

Aktueller Stand: Diese Pipeline veröffentlicht nur ScriptZ aus
`apps/scriptz/` mit Tags `vX.Y.Z`. App-Präfixe und getrennte
Update-Kanäle entstehen erst in Phase 6 des Suite-Fundaments.

`pnpm install --frozen-lockfile` prüft ausschließlich `pnpm-lock.yaml`.
Es schützt **nicht** `Cargo.lock`; dafür müssen Cargo-Befehle mit
`--locked` laufen. Seit Phase 3 liegt das unverändert verschobene
Rust-Lockfile im Repo-Root. Die PR-CI führt
`cargo check --workspace --locked` aus. Gemeinsame Abhängigkeiten und
Release-Profile stehen im Root-`Cargo.toml`.

## Deploy-Targets

- **Desktop**: GitHub Actions ([`.github/workflows/release.yml`](../../.github/workflows/release.yml))
  baut beim Pushen eines `vX.Y.Z`-Tags **zwei** Bundles sequenziell:
  zuerst auf `macos-26` (aarch64-apple-darwin → `.dmg` + Updater-
  `.app.tar.gz`), danach auf `windows-latest` (x86_64-pc-windows-msvc
  → NSIS-`.exe` + Updater-`.nsis.zip`). Beide landen am selben
  GitHub-Release; `latest.json` wird vom zweiten Job in das vom ersten
  hochgeladene Manifest gemerged (`windows-x86_64` ergänzt sich neben
  dem bestehenden `darwin-aarch64`-Eintrag). Auto-Updater im laufenden
  Client poll't `latest.json` plattform-spezifisch.

## Release-Checkliste (jedes Mal!)

Bei einem neuen Release `vX.Y.Z` müssen **vier Dateien** synchron
gehalten werden:

1. `apps/scriptz/package.json` - `version`
2. `apps/scriptz/src-tauri/tauri.conf.json` - `version`
3. `apps/scriptz/src-tauri/Cargo.toml` - `[package].version`
4. `Cargo.lock` - Version des Pakets `scriptz`

Zusätzlich `docs/release-notes/scriptz/vX.Y.Z.md` mit dem Changelog seit dem
letzten Tag anlegen (siehe nächster Abschnitt). Der Release-Workflow
bricht ab, wenn diese Datei fehlt.

Nach Freigabe und Merge: `git tag vX.Y.Z`, dann
`git push origin vX.Y.Z`. Der Release-Workflow baut beide Plattformen
und veröffentlicht Installer und Updater-Manifest auf GitHub.

Cargo schreibt Build-Artefakte in das gemeinsame `target/` im
Repo-Root. Lokale Builds ohne explizites Target liegen in
`target/release/bundle/`; die Release-Jobs verwenden
`target/aarch64-apple-darwin/release/bundle/` beziehungsweise
`target/x86_64-pc-windows-msvc/release/bundle/`.

## Release-Asset-Naming

Pro Release publiziert der Workflow folgende Assets am GitHub-Release.
Direkte Download-Links müssen dieses Namensschema berücksichtigen:

- **macOS**: `ScriptZ_<version>_aarch64.dmg` (Direct-Install) +
  `ScriptZ.app.tar.gz` + `ScriptZ.app.tar.gz.sig` (Auto-Updater-Bundle)
- **Windows**: `ScriptZ_<version>_x64-setup.exe` (NSIS-Installer,
  installiert in den User-Ordner ohne Admin) +
  `ScriptZ_<version>_x64-setup.nsis.zip` +
  `ScriptZ_<version>_x64-setup.nsis.zip.sig` (Auto-Updater-Bundle)
- **Plattform-übergreifend**: `latest.json` (Auto-Updater-Manifest mit
  beiden Plattform-Einträgen)

## Release-Notes schreiben

**Release-Notes sind auf Englisch.** Sie laden im GitHub-Release-Body
und sind dort für ein internationales Publikum sichtbar - GitHub ist
die englischsprachige Schaufront des Projekts. Auch die README im
Repo-Root ist auf Englisch und bleibt es. Die App-i18n bleibt davon
unberührt (siehe `.claude/rules/i18n.md`).

Pro Release **eine** Markdown-Datei unter
[`docs/release-notes/scriptz/vX.Y.Z.md`](../../docs/release-notes/scriptz/) anlegen. Inhalt
**immer auf Englisch**:

- **Erste Zeile:** kurzes Headline-Statement, was dieses Release
  ausmacht. `ScriptZ vX.Y.Z - <one-sentence tagline>.`
- **`## What's new`** mit den User-sichtbaren Features seit dem
  vorherigen Tag. Knackig, in Bullets gruppiert nach Themen.
  Keine Refactor-Listen. Keine internen Migration-Phasen. Was würde
  ein User merken, der die App benutzt?
- **`## Bug fixes`** wenn vorhanden. Kurz beschreiben, was sich für
  den User ändert (nicht *welche Datei* gefixt wurde).
- **`## Updating`** als letzter inhaltlicher Abschnitt mit ein bis
  zwei Sätzen, wie die Auto-Update-Pille funktioniert.

Die statische **Install-Footer** ("Installation (first time only)"
mit `xattr -cr`-Hinweis und SmartScreen-Anleitung) hängt der
Release-Workflow automatisch dran - **niemals** in die per-Version-
Datei kopieren. Sie liegt in `docs/release-notes/_install_footer.md`
und ist ebenfalls auf Englisch.

Als Vorlage: [`docs/release-notes/scriptz/v0.6.0.md`](../../docs/release-notes/scriptz/v0.6.0.md).

Workflow-Verhalten: ist die Datei vor dem Tag-Push commited, baut der
Release-Workflow Body = Datei-Inhalt + Install-Footer. Vergisst man
sie, **bricht der Workflow mit klarem Error ab** statt mit der
vorherigen Beschreibung weiterzumachen.

Wer einen bereits publizierten Release retroaktiv mit den richtigen
Notes nachziehen will: Body-Datei manuell zusammensetzen
(per-Version-Notes + `docs/release-notes/_install_footer.md`) und mit `gh release edit vX.Y.Z --notes-file <datei>`
überschreiben.

## Was bei einem Release alles automatisch passiert

Sobald der Tag-Push erfolgreich gebaut hat, läuft alles weitere ohne
manuelle Schritte:

1. **Job `prepare-notes`** (ubuntu): liest
   `docs/release-notes/scriptz/vX.Y.Z.md` + `_install_footer.md` und gibt den
   Body als Output weiter. Bricht ab, wenn die Notes-Datei fehlt.
2. **Job `build-macos`** (macos-26): baut `.dmg` + signiertes
   `.app.tar.gz`. Legt das GitHub-Release-Objekt an, lädt Assets hoch
   inkl. erstem `latest.json` (Eintrag `darwin-aarch64`).
3. **Job `build-windows`** (windows-latest, needs build-macos): baut
   NSIS-`.exe` + signiertes `.nsis.zip`. Findet den existierenden
   Release per Tag, appended Windows-Assets, mergt `windows-x86_64`
   ins `latest.json`. Sequenziell **nach** macOS, sonst race condition
   auf das `latest.json`-Asset.
4. Bestehende User sehen innerhalb von ~60 Min die grüne Update-Pille
   im Fuß der Seitenleiste (stündlicher `latest.json`-Poll, plattform-
   spezifisches Bundle wird automatisch gewählt).

## Wenn der Release-Workflow fehlschlägt

**Re-Run via `gh run rerun` reicht oft nicht**, weil GitHub den
`GITHUB_TOKEN`-Kontext vom ursprünglichen Trigger cached. Wenn der
Fehler etwas mit Permissions zu tun hatte (z.B. nach einem
Org-Transfer oder einer geänderten Workflow-Permission-Setting),
muss ein **frischer** Run her:

```bash
git push --delete origin vX.Y.Z   # Remote-Tag entfernen
git tag -d vX.Y.Z                 # lokal entfernen
git tag -a vX.Y.Z -m "ScriptZ vX.Y.Z"  # neu setzen
git push origin vX.Y.Z            # frischer Workflow-Trigger
```

Das Release-Objekt selbst wird dabei nicht doppelt - der gefailte
Run hatte ja noch keins erstellt. Der historische Failed-Run bleibt
in der Actions-History stehen, das ist OK.

Bei wiederholten Permission-Fehlern: prüfen, dass auf **Org- und
Repo-Ebene** unter Settings → Actions → General → "Workflow
permissions" jeweils "Read and write permissions" aktiv ist.
