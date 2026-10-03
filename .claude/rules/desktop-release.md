---
paths:
  - "apps/desktop/package.json"
  - "apps/desktop/src-tauri/**"
  - "README.md"
---

# Desktop-App: Release + Auto-Update (App-Spezifika)

Ergänzt die zentrale [`release.md`](release.md) um Desktop-spezifische
Details (Signing, Plattform-Setup, In-App-Updater, Versionen in vier Dateien).

## In-App Auto-Update

Auto-update is the official `tauri-plugin-updater` flow, same shape as
NoteZ. The frontend does `check() → downloadAndInstall() → relaunch()`
in [`src/components/Common/UpdateIndicator.tsx`](src/components/Common/UpdateIndicator.tsx);
the manual "Jetzt prüfen" button in Settings goes through the same
plugin. Updates are signed with a minisign keypair - the public key is
embedded in [`src-tauri/tauri.conf.json`](src-tauri/tauri.conf.json),
the private key lives at `~/.tauri/scriptz_updater.key` (no password)
and is mirrored to the GitHub repo secret
`TAURI_SIGNING_PRIVATE_KEY`. **Lose the private key and you lose the
ability to ship updates** - back it up.

Die current-version check inside the app uses `@tauri-apps/api/app`'s
`getVersion()`, which reads from Cargo metadata at runtime - no
`VITE_APP_VERSION` constant to keep in sync.

## Release-Pipeline (Desktop-Sicht)

Triggert auf Tags `v*.*.*` (aber nicht `v*.*.*.*`). Drei Jobs
sequenziell - vollständige Beschreibung in
[`release.md`](release.md). Hier nur die App-spezifischen Punkte:

- `build-macos` läuft auf `macos-26` (SDK parity mit Tahoe), Target
  `aarch64-apple-darwin`.
- `build-windows` läuft auf `windows-latest`, Target
  `x86_64-pc-windows-msvc`. Muss NACH macOS, sonst race condition auf
  das `latest.json`-Asset.

## Versions-Bump (Desktop)

Der Desktop-Bump hält dieselben **vier Dateien** wie die zentrale
Release-Checkliste synchron:

1. `apps/desktop/package.json` → `version`
2. `apps/desktop/src-tauri/Cargo.toml` → `[package].version`
3. `apps/desktop/src-tauri/Cargo.lock` → Version des Pakets `scriptz`
4. `apps/desktop/src-tauri/tauri.conf.json` → `version`

Cargo aktualisiert den Lock-Eintrag beim nächsten Lauf; die Änderung
muss ebenfalls eingecheckt werden. Das README-Badge lädt die aktuelle
Release-Version direkt von GitHub und braucht keinen manuellen Bump.

Nach Freigabe und Merge: `git tag -a vX.Y.Z -m "ScriptZ vX.Y.Z"`,
dann `git push origin vX.Y.Z`. Release-Notes vorher gemäß
[`release.md`](release.md) anlegen. Laufende Instanzen finden die neue
Version beim nächsten stündlichen Poll oder beim App-Neustart.

## Erster manueller Install pro Plattform

Der **erste** manuelle Install auf **macOS** braucht
`xattr -cr /Applications/ScriptZ.app`, weil die App unsigniert ist
(kein Apple Developer Account). In-Place-Updates brauchen das **nicht**
- das neue Bundle erbt den Quarantine-State des laufenden Prozesses.

Der **erste** manuelle Install auf **Windows** triggert einen
SmartScreen-Dialog, weil die `.exe` unsigniert ist (kein EV-Code-Signing-
Cert). User klickt **"Weitere Informationen" / "More info"** →
**"Trotzdem ausführen" / "Run anyway"** einmal. Auto-Updates nach
dem ersten Launch triggern SmartScreen nicht mehr, weil der Installer
durch den laufenden Prozess ersetzt wird (Tauri-Updater ruft den
NSIS-Installer im Silent-Mode auf).

## Windows-Toolchain Setup

Erstmaliger Setup auf Windows (alles im echten User-Terminal, **nicht**
in der Claude-Code-Subprocess-Sandbox, sonst landen npm-Globals im
UWP-Container statt im echten `%APPDATA%\npm`):

```cmd
:: Node 24+ vorausgesetzt
npm install -g pnpm@9.0.0
winget install Rustlang.Rustup
winget install Microsoft.VisualStudio.2022.BuildTools ^
  --override "--passive --wait --add Microsoft.VisualStudio.Workload.VCTools --add Microsoft.VisualStudio.Component.Windows11SDK.22621 --includeRecommended"
```

Rustup zieht automatisch `stable-x86_64-pc-windows-msvc` als Default-
Toolchain. Webview2 ist auf Windows 10 21H2+ und Windows 11
vorinstalliert - der NSIS-Installer hat trotzdem
`webviewInstallMode: "downloadBootstrapper"` als Fallback.
