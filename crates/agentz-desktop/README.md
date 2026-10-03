# Gemeinsamer nativer Desktop-Host

`builder(Config { db_url, migrations })` liefert einen normalen
`tauri::Builder<Wry>`. Apps ergänzen eigene Plugins/Commands und rufen
`.run(tauri::generate_context!())` auf. Fensterkonfiguration, Identifier,
Updater-Schlüssel und Produktmigrationen bleiben in der App.

Neue Apps verwenden `KIT_BASELINE_SQL` als erste Migration für `settings`
und `app_state`. Bestehende Migrationen werden nicht ersetzt.

Die Standard-Plugins werden zentral registriert; Single-Instance steht
zuerst. Alle Plugins bleiben zusätzlich direkte App-Abhängigkeiten,
weil Tauri ihre Capability-Metadaten über Cargo-`links` liest. Die App
benötigt außerdem die Capability `agentz-desktop:default` für den
Lebenszyklus-Vertrag. Systemweite Tastenkürzel gehören nicht zur Basis.

## Frontend-Vertrag

Die Implementierung in `@agentz/desktop` installiert Listener und meldet
anschließend `plugin:agentz-desktop|ready`. Ein vorher angefordertes
Beenden bleibt bis dahin ausstehend.

- `agentz:exit-requested` liefert `{ requestId }`. Das Frontend sperrt
  Bearbeitung, flusht und quittiert mit
  `plugin:agentz-desktop|finish_exit({ requestId, ok })`. Nur die aktuelle,
  erfolgreiche Quittierung erlaubt genau einen Exit. Fehler lassen die
  App geöffnet; ein neuer Versuch erhält eine neue ID.
- `agentz:menu-action` liefert `settings` oder `about`. Bei geschlossenem
  Fenster wird das konfigurierte Hauptfenster neu erstellt. Aktionen
  warten bis zur Bereitschaft des Frontends.
- `plugin:agentz-desktop|set_menu_language({ language })` übernimmt `de`
  oder `en` aus den Kit-Einstellungen. Rust liest dafür keine Datenbank.

Fensterschließen wird im Frontend vor dem Flush verhindert; erst Erfolg
zerstört das Fenster. Auf macOS bleibt der Prozess im Dock und stellt
beim erneuten Öffnen das Fenster aus der App-Konfiguration wieder her.
Ein zweiter App-Start fokussiert dieses Fenster.

**Updates:** Tauri-Neustart lässt sich nicht durch `prevent_exit()`
aufhalten, und der Windows-Installer beendet den Prozess direkt. Deshalb
muss der gemeinsame Updater bereits **vor** `install()` und `relaunch()`
die Bearbeitung sperren und erfolgreich flushen.
