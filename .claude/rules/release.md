---
paths:
  - "apps/desktop/package.json"
  - "apps/desktop/src-tauri/tauri.conf.json"
  - "apps/desktop/src-tauri/Cargo.toml"
  - "apps/desktop/src-tauri/Cargo.lock"
  - "apps/landing/src/data/site.ts"
  - "docs/release-notes/**"
  - ".github/workflows/release.yml"
---

# Release / Deploy

## Deploy-Targets

- **Desktop**: GitHub Actions ([`.github/workflows/release.yml`](.github/workflows/release.yml))
  baut beim Pushen eines `vX.Y.Z`-Tags **zwei** Bundles sequenziell:
  zuerst auf `macos-26` (aarch64-apple-darwin → `.dmg` + Updater-
  `.app.tar.gz`), danach auf `windows-latest` (x86_64-pc-windows-msvc
  → NSIS-`.exe` + Updater-`.nsis.zip`). Beide landen am selben
  GitHub-Release; `latest.json` wird vom zweiten Job in das vom ersten
  hochgeladene Manifest gemerged (`windows-x86_64` ergänzt sich neben
  dem bestehenden `darwin-aarch64`-Eintrag). Auto-Updater im laufenden
  Client poll't `latest.json` plattform-spezifisch.
- **Web**: Vercel-Project mit `Root Directory` = `apps/web`. Deploy auf
  jeden Push zu `main`. Domain `app.write-scriptz.com`. **Keine
  Tag-Releases nötig** - die Version wird zur Build-Zeit aus
  `apps/desktop/package.json` injectet, damit Settings die Desktop-
  Version spiegelt.
- **Landing**: Vercel-Project mit `Root Directory` = `apps/landing`.
  Deploy auf jeden Push zu `main`. Eigene Domain write-scriptz.com.

## Release-Checkliste (jedes Mal!)

Bei einem neuen Release `vX.Y.Z` müssen **vier** Stellen synchron
gehalten werden, sonst bleibt entweder die Landing oder der
Auto-Updater auf der alten Version hängen:

1. [`apps/desktop/package.json`](apps/desktop/package.json) - `version`
2. [`apps/desktop/src-tauri/tauri.conf.json`](apps/desktop/src-tauri/tauri.conf.json) - `version`
3. [`apps/desktop/src-tauri/Cargo.toml`](apps/desktop/src-tauri/Cargo.toml) +
   [`Cargo.lock`](apps/desktop/src-tauri/Cargo.lock) (Lock-Eintrag
   `name = "scriptz"` mitziehen, sonst bricht der CI-Build mit
   `--frozen-lockfile`)
4. [`apps/landing/src/data/site.ts`](apps/landing/src/data/site.ts) -
   `fallbackVersion`. Die Landing fetcht zwar zur Build-Zeit aus der
   GitHub-Releases-API, aber `fallbackVersion` greift, falls die API
   beim Build down ist - und sollte daher zum aktuellen Tag passen.
5. [`docs/release-notes/vX.Y.Z.md`](docs/release-notes/) **neu anlegen**
   mit dem Changelog seit dem letzten Tag (siehe nächster Abschnitt).
   Der Release-Workflow liest diese Datei und bricht ab, wenn sie
   fehlt - kein Release geht mit der vorherigen Beschreibung raus.

Danach: commit, `git tag vX.Y.Z`, `git push origin main vX.Y.Z`. Der
Release-Workflow triggert nach erfolgreichem Build (beide Plattformen!)
automatisch einen Vercel-Rebuild via Deploy-Hook (Secret
`VERCEL_DEPLOY_HOOK_URL`), damit die Landing die frisch publizierte
Version aus der GitHub-Releases-API zieht. Ohne diesen Hook würde die
Landing auf der vorherigen Version hängenbleiben, weil Vercel nur auf
Git-Push reagiert - und der Push passiert *vor* dem Release-Publish.

## Release-Asset-Naming

Pro Release publiziert der Workflow folgende Assets am GitHub-Release-
Objekt. Wer die URLs irgendwo verlinken will, muss sich auf das
Schema verlassen - die Landing zieht sie zur Build-Zeit aus der
GitHub-Releases-API per Suffix-Match (`.dmg` → macOS, `.exe` → Windows
NSIS-Installer; siehe [`apps/landing/src/data/site.ts`](apps/landing/src/data/site.ts)):

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
Repo-Root ist auf Englisch und bleibt es. Die App-i18n und die
Landing-Texte bleiben davon unberührt (siehe `.claude/rules/i18n.md`).

Pro Release **eine** Markdown-Datei unter
[`docs/release-notes/vX.Y.Z.md`](docs/release-notes/) anlegen. Inhalt
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
Datei kopieren. Die kommt aus
[`.github/workflows/release.yml`](.github/workflows/release.yml) und
ist ebenfalls auf Englisch.

**Die Landing hat in den Release-Notes nichts zu suchen.** Die Notes
beschreiben die App, nicht die Marketing-Site. Änderungen an
`write-scriptz.com` wandern nicht ins Release.

Als Vorlage: [`docs/release-notes/v0.6.0.md`](docs/release-notes/v0.6.0.md).

Workflow-Verhalten: ist die Datei vor dem Tag-Push commited, baut der
Release-Workflow Body = Datei-Inhalt + Install-Footer. Vergisst man
sie, **bricht der Workflow mit klarem Error ab** statt mit der
vorherigen Beschreibung weiterzumachen.

Wer einen bereits publizierten Release retroaktiv mit den richtigen
Notes nachziehen will: Body-Datei manuell zusammensetzen
(per-Version-Notes + Install-Footer aus dem Workflow-YAML einmalig
copy/pasten) und mit `gh release edit vX.Y.Z --notes-file <datei>`
überschreiben.

## Was bei einem Release alles automatisch passiert

Sobald der Tag-Push erfolgreich gebaut hat, läuft alles weitere ohne
manuelle Schritte:

1. **Job `prepare-notes`** (ubuntu): liest
   `docs/release-notes/vX.Y.Z.md` + `_install_footer.md` und gibt den
   Body als Output weiter. Bricht ab, wenn die Notes-Datei fehlt.
2. **Job `build-macos`** (macos-26): baut `.dmg` + signiertes
   `.app.tar.gz`. Legt das GitHub-Release-Objekt an, lädt Assets hoch
   inkl. erstem `latest.json` (Eintrag `darwin-aarch64`).
3. **Job `build-windows`** (windows-latest, needs build-macos): baut
   NSIS-`.exe` + signiertes `.nsis.zip`. Findet den existierenden
   Release per Tag, appended Windows-Assets, mergt `windows-x86_64`
   ins `latest.json`. Sequenziell **nach** macOS, sonst race condition
   auf das `latest.json`-Asset.
4. **Job `trigger-landing`** (ubuntu, needs beide Builds): Triggert
   den Vercel-Deploy-Hook (`VERCEL_DEPLOY_HOOK_URL`).
5. Vercel rebuildet die Landing, fetcht die neue Version aus der
   GitHub-Releases-API (`.dmg` + `.exe` Asset-URLs), deployed
   write-scriptz.com.
6. Bestehende User sehen innerhalb von ~60 Min die grüne Update-Pille
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
