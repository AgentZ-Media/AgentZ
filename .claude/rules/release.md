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

# Desktop-Releases der AgentZ Suite

Jede Desktop-App hat eigene Tags `<app-id>-v<semver>` und einen eigenen
Update-Kanal. Historische `v0.x.y`-Tags bleiben unverändert. Kein App-Release
wird zum repositoryweiten GitHub-„Latest“. Der bestehende Updater-Schlüssel
wird gemeinsam verwendet; niemals ausgeben oder committen. Den privaten
Schlüssel unabhängig vom Repository sichern.

## Checkliste

1. App-Datenbank über die SQLite-Backup-API sichern; vor Speichermigrationen
   wichtige Dokumente exportieren. Wiederherstellung und Migration lokal prüfen.
2. `pnpm release:bump <app> <version>` aktualisiert App-`package.json`,
   `src-tauri/tauri.conf.json`, `[package].version` in `Cargo.toml` und das
   Root-`Cargo.lock`. Das Skript führt ein gezieltes Offline-Cargo-Update aus
   und stellt bei Fehler alle vier Originaldateien wieder her. Abhängigkeiten
   müssen bereits im Cargo-Cache liegen; bei Bedarf zuerst nachladen und dann
   erneut starten. Diff prüfen.
3. `docs/release-notes/<app>/v<version>.md` auf Englisch vervollständigen.
   Sichtbare Änderungen, Fehlerbehebungen und Update-Hinweise beschreiben.
   Den Install-Footer nicht kopieren: Der Workflow hängt ihn an und ersetzt
   `{{PRODUCT_NAME}}` durch den Produktnamen aus den Tauri-Metadaten.
4. Pflichtprüfungen und Desktop-Abnahme ausführen, Versions-/Notes-PR prüfen
   und mergen.
5. Den gemergten Commit taggen, zum Beispiel
   `git tag -a scriptz-v0.9.0 -m 'ScriptZ v0.9.0'`, dann den Tag pushen.
6. Beide Plattform-Builds, Updater-Signaturen, versionierte Release-Artefakte
   und die drei ohne Anmeldung erreichbaren Zeiger-URLs prüfen. Ein echtes
   Update durchführen.

`pnpm install --frozen-lockfile` schützt nur das JavaScript-Lockfile.
Release-Cargo-Builds verwenden `--locked`. Alle Apps teilen Root-`target/`;
explizite Targets erzeugen `target/<target>/release/bundle/`. Nicht unter
App-`src-tauri/target` suchen. Tauri-JS- und Rust-Versionen gemeinsam ändern.

## Workflow und Wiederaufnahme

`prepare` prüft App-ID, striktes SemVer, alle vier Versionsangaben und
nicht leere Release-Notes. Es veröffentlicht einen Release mit
`--latest=false` und übergibt dessen numerische REST-`releaseId` an
`tauri-action@v0`. Sandbox- und SemVer-Pre-Release-Tags erzeugen veröffentlichte
Pre-Releases. Vorhandene Releases werden bei Wiederholung weiterverwendet.

macOS (`macos-26`, `aarch64-apple-darwin`) baut zuerst, danach Windows
(`windows-latest`, `x86_64-pc-windows-msvc`, NSIS). Diese Reihenfolge ist
nötig, weil tauri-action `latest.json` zusammenführt. Jeder Plattform-Job
prüft seinen bisherigen Manifest-Eintrag und seine Assets **unmittelbar vor
dem Build**, auch bei „rerun failed jobs“. Vollständige Plattformen werden
übersprungen: Neue Builds und ersetzte signierte Binärdateien würden bereits
verwendete Signaturen ungültig machen.

Der serialisierte Job `pointer-<app-id>` veröffentlicht `<app-id>-latest`,
immer als veröffentlichten Pre-Release, niemals als „Latest“. Er prüft beide
Plattform-Signaturen und versionsgebundene Download-URLs. Anschließend kopiert
er Installer unter stabilen Namen:

- `<app-id>-macos-arm64.dmg`
- `<app-id>-windows-x64-setup.exe`
- `latest.json` mit unveränderten URLs zum versionierten Release

Der Zeiger steigt nur auf neuere SemVer-Versionen. Ein identisches Manifest
der gleichen Version darf zur Upload-Reparatur erneut veröffentlicht werden;
ein abweichendes Manifest derselben Version wird abgewiesen. Vor dem
Asset-Austausch wird ein Versionsmarker im Zeiger-Release-Text reserviert.
So bleibt ein Rücksprung auch dann gesperrt, wenn ein fehlgeschlagener
`--clobber`-Upload die bisherige `latest.json` vorübergehend gelöscht hat.
Diesen Marker niemals entfernen.

Installer werden zuerst hochgeladen, das Manifest zuletzt. Der GitHub-
Asset-Austausch ist nicht atomar; nach fehlgeschlagenem Upload kann ein Asset
fehlen. Fehlgeschlagene Jobs erneut ausführen. Bis zur Wiederherstellung kann
der Versionsmarker dem Manifest voraus sein; die neueste Version erneut
starten, keine ältere. Keine Tags löschen/neu erstellen, veröffentlichte
Versions-Assets ersetzen oder GitHub-Release-Immutability aktivieren: Die
Zeiger müssen veränderbar bleiben. Ein abweichendes Manifest derselben
Version untersuchen, statt die Prüfung zu umgehen.

Bei Berechtigungsfehlern `contents: write`, Repository-Actions-Einstellungen
und Organisationsregeln prüfen. Die Ursache korrigieren und erneut starten;
keinen veröffentlichten Tag nur für einen neuen Versuch löschen. Während der
Builds kann ein versionierter Release zeitweise nur eine Plattform enthalten;
der Zeiger bleibt unverändert.

## Build-Probelauf ohne Veröffentlichung

`gh workflow run release.yml --ref main -f app=scriptz` ausführen
(oder Actions → Release → Run workflow). **Jeder `workflow_dispatch` ist
ein Probelauf ohne Veröffentlichung.** Er prüft Versionen und baut macOS-
und Windows-Installer mit deaktivierten Updater-Artefakten. Er nutzt keine
Signing-Secrets, erstellt keine Tags/Releases, veröffentlicht keine Manifeste
und ändert keine Versionsdateien. Bundles bleiben sieben Tage als
Workflow-Artefakte erhalten. Dies prüft die Paketierung, nicht Signierung
oder den echten Update-Zyklus.

## Installation und Updates

Updater-Endpoint:
`https://github.com/AgentZ-Media/AgentZ/releases/download/<app-id>-latest/latest.json`.
Der Desktop-Host prüft und lädt Updates, sichert ausstehende Änderungen vor
der Installation und startet über Tauri-Plugins neu. Die Laufzeitversion
kommt aus Tauri-`getVersion()`, nicht aus einer zweiten Frontend-Konstante.
Der öffentliche Prüfschlüssel steht in der Tauri-Konfiguration jeder App;
`TAURI_SIGNING_PRIVATE_KEY` und optional
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` bleiben ausschließlich GitHub-Secrets
beziehungsweise lokal geschütztes Signiermaterial.

Bei der ersten unsignierten macOS-Installation gilt der dokumentierte
Gatekeeper-Schritt `xattr -cr "/Applications/<Produkt>.app"`. Windows kann
SmartScreen anzeigen; der Install-Footer erklärt „Weitere Informationen“ →
„Trotzdem ausführen“. Die Updater-Artefakte sind signiert, die Apps jedoch
nicht Apple-notarisiert oder mit Windows-Codesign signiert.

ScriptZ 0.8.4 nutzt weiterhin den alten repositoryweiten Kanal. Einmal 0.9.0
manuell aus `scriptz-latest` installieren, danach den echten Update-Zyklus
0.9.0 → 0.9.1 prüfen. ScriptZ-Bundle-Identifier, Datenbankname und öffentlichen
Updater-Schlüssel nicht ändern.

Auf einem neuen Windows-Rechner: Node 24, pnpm passend zum Root-
`packageManager`, Rust Stable MSVC, Visual Studio Build Tools mit Desktop-C++,
Windows SDK und WebView2. Installation im normalen Benutzerterminal ausführen.
Das NSIS-Paket enthält den WebView2-Download-Bootstrapper als Fallback.
