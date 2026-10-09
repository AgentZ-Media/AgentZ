# Problem melden

Jede App der Suite hat „Problem melden“: Angemeldete Nutzer beschreiben in
einem Satz, was schiefging, die App hängt an, was sie über sich weiß (welche
App, Version, System, ...), und schickt beides mit der Sitzung des Kontos an
das Konto-Backend. Ohne Anmeldung ist davon nichts zu sehen, auch nicht in den
Einstellungen.

## Bausteine

| Teil | Ort | Aufgabe |
|---|---|---|
| Pille, Dialog, Sammeln, Senden | `packages/kit/feedback/` | Schwebender Knopf unten rechts, Dialog, `collectInfo`, `sendReport`, Fehlerprotokoll (`startErrorLog`) |
| Einstellungen | `SettingsAppearance.tsx`, `SettingsAbout.tsx` | Schalter „Knopf ‚Problem melden‘“ (Setting `report_button`), Zeile „Problem melden“ unter „Über“ |
| Systemangaben | `PlatformAdapter.systemInfo()`, Desktop über `@tauri-apps/plugin-os` | Betriebssystem-Version, Architektur, Systemsprache |
| Backend | `apps/site/convex/bugs.ts`, `bugReports.ts`, Tabelle `bug_reports` | `POST /bugs/report`, Prüfung, Grenzen, fortlaufende Nummer |

Die Funktion liegt komplett im Kit: Jede App, deren Host eine `CloudConfig`
übergibt, bekommt sie automatisch, sobald jemand angemeldet ist. App-ID und
Name kommen aus dem `AppModule`; das Backend prüft die ID nur auf ihre Form,
eine neue App braucht dort also keine Änderung. `shell.openReport()` öffnet
den Dialog von überall (ScriptZ: Befehl in der Suche). Bildschirme mit eigenen
Bedienelementen unten rechts schieben die Pille mit
`shell.setReportPillPlacement({ right, bottom, hidden })` zur Seite und setzen
beim Verlassen `null` (ScriptZ: Skript-Ansicht mit Zeitleiste und Chat).

## Was mitgeht

- Der Text des Nutzers. Das Backend verknüpft die Meldung mit dem Konto
  (`userId`); über das Konto ist der Nutzer erreichbar.
- App-ID und App-Name (`app`, `appName`), Version, Kanal (`stable`, `nightly`,
  `dev`), Betriebssystem.
- `details`: Commit und Build-Zeit (Nightly), OS-Version, Architektur,
  System- und App-Sprache, Theme, aktuelle Ansicht (Routen-ID), Seitenleiste,
  Fokusmodus, Fenster- und Bildschirmgröße, Pixeldichte, Zeitzone, online,
  Minuten seit dem Start, Anmeldung, Sync-Zustand, Update-Kanal und -Status,
  WebView-Kennung.
- `errors`: die letzten 20 Fehler und Warnungen des Fensters (`console.error`,
  `console.warn`, unbehandelte Fehler), je höchstens 1000 Zeichen. Sie liegen nur
  im Speicher, bis jemand eine Meldung schickt.
- Eine zufällige Installations-ID (`app_state` `feedback.install`), um mehrere
  Geräte eines Kontos auseinanderzuhalten.

Nie Inhalte (Skripte, Titel, Chats). Der Dialog zeigt unter „Was wird
mitgeschickt?“ genau das, was gesendet wird. Neue Angaben sind additiv: Das
Backend nimmt beliebige `details`-Schlüssel (Buchstaben und Ziffern), schneidet
zu lange Werte ab und verwirft Kaputtes, statt die Meldung abzulehnen. Neue
Angaben in der Datenschutzerklärung nachziehen.

## Spamschutz

- Ohne gültige Sitzung antwortet `POST /bugs/report` mit 401, bevor der Inhalt
  gelesen wird; Anfragen über 64 000 Zeichen mit 413. Der Inhalt wird als
  Stream gelesen und bricht an der Grenze ab, auch ohne `content-length`.
- Pro Konto höchstens 10 Meldungen pro Stunde und 30 pro Tag, mindestens 15
  Sekunden Abstand; über alle Konten höchstens 500 pro Stunde
  (`checkLimits` in `bugReports.ts`). Darüber antwortet das Backend mit 429,
  der Dialog bittet um Geduld.
- Derselbe Text desselben Kontos innerhalb einer Stunde wird nicht noch einmal
  gespeichert; das Backend antwortet mit der Nummer der ersten Meldung
  (Doppelklick, erneutes Senden).
- Text höchstens 5000 Zeichen, gesammelte Angaben werden gekürzt.

## Lesen

Im Convex-Dashboard (Projekt `agentz-suite`, Tabelle `bug_reports`) oder auf
der Kommandozeile im Ordner `apps/site`:

```bash
npx convex run bugs:recent '{"limit": 20}' --prod
npx convex run bugs:recent '{"app": "scriptz"}' --prod
```

Jede Meldung hat `status: "new"`; das Feld ist zum späteren Sortieren gedacht.
Wird ein Konto gelöscht, verlieren seine Meldungen die Verknüpfung
(`bugs.forgetUser` aus `sync.purge`).
