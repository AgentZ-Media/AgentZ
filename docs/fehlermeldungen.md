# Problem melden

Jede App der Suite hat „Problem melden“: Nutzer beschreiben in einem Satz, was
schiefging, die App hängt an, was sie über sich weiß, und schickt beides an
das Konto-Backend. Das geht angemeldet und ohne Konto.

## Bausteine

| Teil | Ort | Aufgabe |
|---|---|---|
| Pille, Dialog, Sammeln, Senden | `packages/kit/feedback/` | Schwebender Knopf unten rechts, Dialog, `collectInfo`, `sendReport`, Fehlerprotokoll (`startErrorLog`) |
| Einstellungen | `SettingsAppearance.tsx`, `SettingsAbout.tsx` | Schalter „Knopf ‚Problem melden‘“ (Setting `report_button`), Zeile „Problem melden“ unter „Über“ |
| Systemangaben | `PlatformAdapter.systemInfo()`, Desktop über `@tauri-apps/plugin-os` | Betriebssystem-Version, Architektur, Systemsprache |
| Backend | `apps/site/convex/bugs.ts`, `bugReports.ts`, Tabelle `bug_reports` | `POST /bugs/report`, Prüfung, Grenzen, fortlaufende Nummer |

Die Shell zeigt Pille und Dialog nur, wenn der Host eine `CloudConfig`
übergibt. `shell.openReport()` öffnet den Dialog von überall (ScriptZ: Befehl
in der Suche). Bildschirme mit eigenen Bedienelementen unten rechts schieben
die Pille mit `shell.setReportPillPlacement({ right, bottom, hidden })` zur
Seite und setzen beim Verlassen `null` (ScriptZ: Skript-Ansicht mit Zeitleiste
und Chat).

## Was mitgeht

- Der Text des Nutzers und auf Wunsch eine E-Mail-Adresse (nur ohne Anmeldung
  gefragt; angemeldet verknüpft das Backend die Meldung mit dem Konto).
- App, Version, Kanal (`stable`, `nightly`, `dev`), Betriebssystem.
- `details`: Commit und Build-Zeit (Nightly), OS-Version, Architektur,
  System- und App-Sprache, Theme, aktuelle Ansicht (Routen-ID), Seitenleiste,
  Fokusmodus, Fenster- und Bildschirmgröße, Pixeldichte, Zeitzone, online,
  Minuten seit dem Start, Anmeldung, Sync-Zustand, Update-Kanal und -Status,
  WebView-Kennung.
- `errors`: die letzten 20 Fehler und Warnungen des Fensters (`console.error`,
  `console.warn`, unbehandelte Fehler), je höchstens 1000 Zeichen. Sie liegen nur
  im Speicher, bis jemand eine Meldung schickt.
- Eine zufällige Installations-ID (`app_state` `feedback.install`) für die
  Grenzen und um mehrere Meldungen eines Geräts zusammenzusehen.

Nie Inhalte (Skripte, Titel, Chats). Der Dialog zeigt unter „Was wird
mitgeschickt?“ genau das, was gesendet wird. Neue Angaben sind additiv: Das
Backend nimmt beliebige `details`-Schlüssel (Buchstaben und Ziffern), schneidet
zu lange Werte ab und verwirft Kaputtes, statt die Meldung abzulehnen. Neue
Angaben in der Datenschutzerklärung nachziehen.

## Grenzen

Pro Installation 10 Meldungen pro Stunde, insgesamt 500 pro Stunde
(`bugReports.ts`). Darüber antwortet das Backend mit 429, der Dialog bittet um
Geduld. Text höchstens 5000 Zeichen.

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
