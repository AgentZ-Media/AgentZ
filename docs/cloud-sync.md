# Konto und Cloud-Synchronisierung

Apps der Suite funktionieren vollständig ohne Konto. Mit einem Konto gleichen
sie ihre Daten zwischen den Geräten ab: anmelden, fertig, ohne weitere
Schritte für den Nutzer. Die lokale
SQLite-Datenbank bleibt die Arbeitskopie; sobald jemand angemeldet ist, ist die
Cloud die Wahrheit.

## Bausteine

| Teil | Ort | Aufgabe |
|---|---|---|
| Konto, Engine, UI | `packages/kit/account/` (`@agentz/kit/account`) | Anmeldung, Sitzung, Datensatzformat, Sync-Engine, Avatar, Konto-Button, Dialoge, Einstellungsseite „Konto“ |
| Adapter je App | z. B. `modules/scriptz/lib/sync/adapter.ts` | Welche Tabellen, in welcher Reihenfolge, wie eingehende Datensätze geschrieben werden, Konfliktkopien |
| Desktop-Host | `packages/desktop/lib/platform.ts`, `crates/agentz-desktop/src/secrets.rs` | Schlüsselbund (`PlatformAdapter.secrets`), URL-Schema `agentz-<id>://` (`onOpenUrl`) |
| Backend | `apps/site/convex/` | `sync.ts`, `appLink.ts`, `schema.ts`, `syncApps.ts`, `compat.ts`, `syncPolicy.ts`, `stats.ts`, `releases.ts`, KI-Proxy `ai.ts`, Fehlermeldungen `bugs.ts` ([`fehlermeldungen.md`](fehlermeldungen.md)) |
| Anmeldeseite | `apps/site/src/components/AppSignIn.astro` (`/konto/app/`, `/en/account/app/`) | Vollbild-Anmeldung für Apps |

Die Shell startet das Konto (`startAccountRuntime`), wenn der Host eine
`CloudConfig` übergibt; der Desktop-Host liest sie über `readCloudConfig`
(Produktion als Standard, `VITE_AGENTZ_CONVEX_URL`, `VITE_AGENTZ_CONVEX_SITE_URL`,
`VITE_AGENTZ_WEB_URL` zum Umleiten, `VITE_AGENTZ_CLOUD=off` schaltet Konten ab).
Ein Modul liefert seine Daten über `ModuleRuntime.sync` (`SyncAdapter`). Ohne
Adapter meldet sich die App nur an. Der Convex-Client wird erst nach der
Anmeldung geladen (eigener Chunk).

## Anmeldung aus der App

OAuth für native Apps (RFC 8252) mit PKCE (RFC 7636), ohne Secrets in der App:

1. Die App erzeugt einen zufälligen Verifier und öffnet
   `/konto/app/?app=<id>&challenge=<SHA-256 des Verifiers>` im Browser.
2. Auf der Seite meldet man sich an oder registriert sich. „App öffnen“ ruft
   `POST /app-link/approve` (Sitzung der Website) und bekommt einen
   einmaligen Code (fünf Minuten gültig), der per `agentz-<id>://auth?code=…`
   an die App geht. Für Fälle ohne Deep-Link (Dev-Modus auf macOS) zeigt die
   Seite den Code zum Einfügen im Anmeldedialog der App.
3. Die App tauscht Code und Verifier über `POST /app-link/claim` gegen eine
   eigene Better-Auth-Sitzung (60 Tage, verlängert sich bei Nutzung). Der Code
   ist nach einem Versuch verbraucht, ein falscher Verifier macht ihn wertlos.

Die Sitzung liegt im Schlüsselbund des Systems (`account.session`), Anfragen
laufen mit `Authorization: Bearer`. Convex-Funktionen bekommen ein kurzlebiges
JWT über `/api/auth/convex/token`. Erlaubte Origins der Apps stehen in
`APP_ORIGINS` (`convex/auth.ts`): `tauri://localhost`, `http://tauri.localhost`
und die Dev-Ports 1420, 1430, … .

Weitere Dienste des Backends erreicht ein Modul über
`account.backendFetch(path, init)` mit derselben Sitzung; eine abgelaufene
Sitzung meldet die App ab. So spricht der KI-Agent mit dem KI-Proxy
(`convex/ai.ts`, `GET /ai/status`, `POST /ai/chat`): Der Proxy prüft die
Sitzung, setzt das Modell (`OPENROUTER_MODEL`) und den Key
(`OPENROUTER_API_KEY`, beide nur als Convex-Umgebungsvariablen) und reicht
den Stream von OpenRouter unverändert durch. Diese Anfragen sind kein Sync:
Der Agent braucht Klartext, der Proxy speichert nichts davon.

Den Proxy dürfen nur freigeschaltete Konten nutzen, alle anderen bekommen
`403 not_enabled` und sehen in der App „Bald verfügbar“. Die Liste steht in
der Convex-Umgebungsvariable `AI_ACCESS` (je Deployment, kommagetrennt):
E-Mail-Adressen (nur bestätigte Konten, die Registrierung verlangt keine
Bestätigung) oder Konto-IDs, `*` öffnet den Proxy für alle. Ohne Variable
ist er für niemanden offen. Ändern ohne Deploy, z. B.
`npx convex env set AI_ACCESS "a@example.com,b@example.com"` (mit `--prod`
für Produktion) oder im Convex-Dashboard.

Mit demselben Key und derselben Freischaltung beantwortet der Proxy
Entscheidungsfragen (`POST /ai/decide`, Prüfung in `convex/decisions.ts`):
Eine App schickt einen Text (`state`) und typisierte Fragen (`noul` für
Ja/Nein, `choice`, `score`) und bekommt nur Wahrscheinlichkeiten zurück, keinen
Text. Das Modell legt der Server fest (`DECISION_MODEL`, sonst
`typesafe/jev-1.13`, Jev über die Decisions-API von OpenRouter). Die Anfrage
ist produktneutral; Apps nutzen sie über `decide()` aus
`@agentz/kit/account` (Fehlercodes `signed-out`, `not-enabled`,
`rate-limited`, `network`, `unavailable`, `invalid`). Auch hier speichert der
Proxy nichts.

## Datensätze und Schutz

- Ein Datensatz ist das JSON `{ entity, id, record }` einer lokalen Zeile,
  ab 512 Byte mit gzip komprimiert, wenn das kleiner ist
  (`packages/kit/account/records.ts`). Die Record-ID ist `<entity>/<lokale ID>`.
- Übertragung per TLS, Convex speichert verschlüsselt (at rest) in der EU.
  Es gibt bewusst keine Ende-zu-Ende-Verschlüsselung: Ein Schlüssel, den
  Nutzer aufbewahren oder auf neuen Geräten eingeben müssen, passt nicht zur
  Zielgruppe, und Funktionen wie Web-Version oder Support brauchen lesbare
  Daten auf dem Server.
- `SyncState.keyId` (`app_state.sync.state`) hält das Datensatzschema
  (`RECORD_SCHEME`), nur für die lokale Buchführung. Weicht es ab, weil eine
  ältere Version Ende-zu-Ende verschlüsselt synchronisiert hat (dort stand die
  Schlüssel-ID), migriert das Gerät (`book.startMigration`): Die Buchführung
  verliert ihre Record-IDs, behält aber alte Revision und Hash jedes
  Datensatzes. Alles geht erneut hoch, auch Extras, geparkte Datensätze und
  Einträge außerhalb des Änderungsfeeds (etwa Tageswerte anderer Geräte), je
  mit Rang `legacyRank` = 2 × alte Revision, +1 bei lokaler Änderung seitdem.
  Der Server lässt einen höheren Rang einen niedrigeren ersetzen; so gewinnt
  die zuletzt synchronisierte Fassung, egal welches Gerät zuerst migriert.
  Eine unveränderte ältere Fassung weicht ohne Konfliktkopie, eine lokale
  Änderung auf älterem Stand wird wie sonst zur Konfliktkopie. Jeder normale
  Schreibvorgang löscht den Rang, danach gilt die neue Fassung. Ein alter
  Datenschlüssel im Schlüsselbund (`sync.key`) wird gelöscht. Ob eine
  Version die Daten lesen kann, entscheidet allein das Datenformat (siehe
  „Versionen und Kompatibilität“).
- Ende-zu-Ende verschlüsselte Datensätze älterer Versionen (ScriptZ-Format 1)
  tragen in Convex ein `keyId`; Geräte überspringen sie. Der erste Upload einer
  aktuellen App löscht den alten Schlüssel (`sync_keys`) und plant
  `sync.dropEncrypted`, das diese Datensätze seitenweise entfernt.
- Dazu meldet die App pro Konto Summen für die Zähler der Website
  (`SyncAdapter.stats`, in ScriptZ die Anzahl der Skripte ohne das
  unveränderte Willkommens-Skript). Nur Zahlen; erlaubte Schlüssel stehen in
  `STAT_KEYS` (`syncApps.ts`). Der Server wertet Datensatzinhalte nie aus.

## Datenmodell in Convex

- **Eine Record-Tabelle pro App** (`scriptz_records`, später `<app>_records`),
  Indizes `by_user_rev` (Abholen ab Revision) und `by_user_record` (Schreiben).
  Pro lokaler Zeile gibt es genau ein Dokument mit der letzten Fassung; Seiten
  sind auf 100 Datensätze und 4 MB begrenzt, damit auch zehntausende Skripte
  nur in Änderungen übertragen werden.
- Datensätze bis 96 KiB liegen im Dokument, größere im File Storage. Ein
  Upload darf nur eine Datei referenzieren, die existiert, die angegebene
  Größe hat und noch zu keinem Datensatz gehört (Index `by_blob`).
- `sync_stats`: zuletzt gemeldete Summen pro Nutzer und App; ein stündlicher
  Cron (`stats.ts`) addiert sie zu `site_stats`, `GET /stats` liefert das
  Ergebnis an die Website.
- `sync_heads`: Revisionszähler pro Nutzer und App, dazu das höchste je
  geschriebene Datenformat (`format`, `formatBy`). `app_links`: kurzlebige
  Codes der App-Anmeldung (stündlicher Cron räumt auf). `sync_policy`:
  Notbremse pro App (siehe unten). `sync_keys` hält alte
  Datenschlüssel Ende-zu-Ende verschlüsselter Versionen, bis ihr Konto
  wieder synchronisiert.
- Kontolöschung (`deleteUser.afterDelete`) löscht alle Sync-Daten in Batches.
- Neue App mit Sync: Tabelle in `schema.ts`, Eintrag in `syncApps.ts`
  (`SYNC_APPS`, `appArg`, `STAT_KEYS`, `MIN_FORMAT` 1), ein `SyncAdapter` im Modul und
  `lib/sync/format.json` (Format 1, siehe „Versionen und Kompatibilität“).
  Ohne Eintrag in `SYNC_APPS` kann sich die App auch nicht anmelden.

## Abgleich und Konflikte

Lokal führt die Tabelle `sync_records` (Migration der App, `baseline.sql` für
neue Apps) pro Datensatz Record-ID, Cloud-Revision, Inhalts-Hash und die
Felder, die diese Version nicht kennt (`extra`); `sync_parked` hält ganze
Datensätze unbekannter Art (siehe unten). `app_state.sync.state` hält Konto,
Datensatzschema, Geräte-ID und beide Cursor.

Ein Durchlauf schreibt zuerst ungespeichertes Tippen (`flushAll` mit `content`),
lädt dann lokale Änderungen hoch und holt danach die Cloud-Änderungen:

- Jeder Upload nennt die Revision, auf der er beruht. Hat sich die Cloud
  inzwischen geändert, gilt die Cloud-Fassung; die lokale Fassung bleibt als
  Kopie (`keepLocalCopy`, in ScriptZ für Skripte und Ideen, Titel mit
  „(Konfliktkopie)“). Zeitstempel entscheiden nie.
- Bearbeiten gewinnt gegen Löschen auf einem anderen Gerät.
- Inhalte mit gleichem Hash werden nie erneut hochgeladen. Das verhindert auch
  das Zurückspiegeln eingehender Datensätze.
- Eingehende Datensätze werden in Abhängigkeitsreihenfolge geschrieben; ein Kind
  ohne Eltern wartet bis zum Ende des Abholens, der Cursor bleibt davor stehen.
- Auslöser: lokale Änderungen (Abfrage des Änderungscursors alle 3 s, Upload nach
  einer ruhigen Phase, spätestens nach 15 s), die live abonnierte Cloud-Revision,
  wieder verfügbares Netz, „Jetzt synchronisieren“. Beim Schließen wird bis zu
  1,5 s hochgeladen, ohne das Beenden zu blockieren.
- Abmelden lässt alle Daten auf dem Gerät; bei erneuter Anmeldung mit demselben
  Konto geht alles Neue hoch. Ein anderes Konto fragt einmal, ob die lokalen
  Daten übernommen werden sollen.

## Versionen und Kompatibilität

Auf den Geräten eines Kontos laufen oft verschiedene Versionen einer App:
Stable und Nightly, ein Gerät ist schon aktualisiert, das andere nicht. Der
Server wertet die Inhalte nicht aus, deshalb sichern drei Stufen ab, dass eine
ältere Version neuere Daten weder verliert noch falsch liest.

**1. Vorwärtskompatibel (Normalfall, keine Update-Pflicht).** Jede Version
kennt ihre Felder pro Entität (`SyncAdapter.fields`). Die Engine
(`packages/kit/account/engine.ts`) behandelt Neues so:

- Unbekannte Felder eines Datensatzes landen in `sync_records.extra` und gehen
  bei jedem Upload dieses Datensatzes unverändert mit. Eine ältere Version
  kann einen Datensatz also bearbeiten, ohne neuere Felder zu löschen.
- Datensätze einer unbekannten Entität und unbekannte Einstellungen werden
  geparkt (`sync_parked`), weder angewendet noch gebucht. Eine neuere Fassung
  ersetzt sie, eine Löschung in der Cloud entfernt sie.
- Eine Konfliktkopie behält die unbekannten Felder ihres Originals.
- Ersetzt ein anderes Konto die Cloud-Kopie oder wechselt eine Installation
  vom Ende-zu-Ende verschlüsselten Format (`resetForNewCloud`), bleiben Extras
  und geparkte Datensätze erhalten und gehen mit allem anderen erneut hoch,
  auch wenn kein neueres Gerät mehr existiert.
- Nach einem Update übernimmt der erste Durchlauf, noch vor dem ersten Upload,
  alles, was die neue Version kennt: geparkte Datensätze werden angewendet
  (wartet einer auf seine Eltern, erst am Ende des nächsten vollständigen
  Abholens), bekannte Extras in die lokalen Zeilen geschrieben. Erst danach
  wird hochgeladen, damit eine neue, noch leere Spalte nie den Cloud-Wert
  überschreibt. Hat der Nutzer ein solches Feld seit dem Update schon selbst
  gesetzt, gewinnt sein Wert; „noch leer“ heißt `NULL`. Neue synchronisierte
  Spalten deshalb ohne Standardwert (also `NULL`) anlegen.
- Fehlt einem eingehenden Datensatz eine Spalte (geschrieben von einer älteren
  Version), behält die lokale Zeile ihren Wert; ein neuer Datensatz bekommt
  den Standardwert.

Neue Spalten, Entitäten und Einstellungen brauchen deshalb kein neues Format.

**2. Datenformat (bei echten Brüchen).** Jede Version meldet bei jedem Aufruf
Version, Kanal (`stable`, `nightly`, `dev`) und ihr Format: welches sie
schreibt (`writes`) und bis zu welchem sie liest (`reads`, immer inklusive
aller älteren). Der Server merkt sich pro Konto und App das höchste je
geschriebene Format. Kann ein Gerät es nicht lesen, bekommt es
`CLIENT_OUTDATED` und pausiert seinen Sync, bis es aktualisiert ist. Der
Schalter fällt also nicht beim Deploy, sondern erst, wenn ein Gerät dieses
Kontos wirklich Daten im neuen Format schreibt, und nur für dieses Konto.

Ein Bruch (Umbenennen, geänderte Bedeutung oder Typ, Aufteilen) läuft in zwei
Releases:

1. Release N hebt `reads` an und versteht beide Formen, schreibt aber weiter
   das alte Format.
2. Ein späteres Release hebt `writes` an.

`pnpm check:sync-format` (CI) erzwingt die Reihenfolge: `main` darf nur
schreiben, was das letzte Stable-Release lesen kann, und muss lesen, was es
schreibt. Weil Nightlies aus `main` gebaut werden, sperrt ein Nightly so nie
die Stable-Geräte desselben Kontos. Das Format steht pro App in
`modules/<app>/lib/sync/format.json` zusammen mit allen synchronisierten
Entitäten, Feldern und Einstellungen; ein Test im Modul schlägt bei jeder
Änderung fehl, bis sie dort eingetragen und als additiv oder Bruch
eingeordnet ist. Ein Stable-Release ganz ohne Sync schützt nichts und zählt
für die Prüfung nicht.

Zusätzlich nimmt der Server pro App nur Formate ab `MIN_FORMAT`
(`syncApps.ts`) an; eine Version, die ein älteres schreibt, bekommt
`CLIENT_OUTDATED` wie unter einer `minVersion`. Formate von ScriptZ:

| Format | Inhalt | Versionen |
|---|---|---|
| 1 | Ende-zu-Ende verschlüsselt, Record-ID als HMAC, Schlüssel in `sync_keys` | nur Nightlies; der Server nimmt es nicht an |
| 2 | JSON (`records.ts`), Record-ID `<entity>/<lokale ID>` | ab dem ersten Stable-Release mit Sync |

Der erste Upload in Format 2 hebt die Marke des Kontos an und plant das
Löschen der Format-1-Datensätze; aktualisierte Format-1-Installationen laden
dabei alles neu hoch (siehe „Datensätze und Schutz“). Lokal geht nichts
verloren, die verschlüsselte Cloud-Kopie entfällt.

**3. Notbremse.** `sync_policy` sperrt pro App Versionen unter `minVersion`
und einzelne `blockedVersions`, etwa eine Version, die fehlerhafte Daten
schreibt. Gesetzt wird sie nur per Terminal, Geräte merken die Änderung live:

```bash
npx convex run --prod syncPolicy:set '{"app":"scriptz","blockedVersions":["0.12.1"]}'
npx convex run --prod syncPolicy:set '{"app":"scriptz"}'   # alle Grenzen aufheben
```

`minVersion` nie über die neueste veröffentlichte Version setzen, sonst gibt
es kein Update, das hilft. Nightlies einer Version liegen unter ihr
(`0.12.1-nightly.…` < `0.12.1`).

**Pause in der App.** Während der Pause bleibt die App voll benutzbar,
lokale Änderungen sammeln sich und gehen nach dem Update hoch. Einmal pro
App-Start erscheint ein Dialog, dauerhaft ein Band über dem Inhalt (nicht im
Fokusmodus) und der Status „Update nötig“ am Konto-Button. Beide bieten den
nächsten Schritt: Update suchen, laden, neu starten oder, wenn die neuere
Version bisher nur als Nightly existiert, den Weg in die Update-Einstellungen.
Das Live-Abo auf `sync:head` hebt die Pause auf, sobald der Server sie nicht
mehr verlangt (Policy geändert).

**Entwicklung.** `pnpm dev:<app>` spricht standardmäßig mit Production und
dem echten Konto. Ein Dev-Build darf ein Konto mit Daten nie auf ein neueres
Format heben (`DEV_FORMAT_RAISE`); Formatänderungen gegen das Dev-Deployment
testen (`VITE_AGENTZ_CONVEX_URL`, `VITE_AGENTZ_CONVEX_SITE_URL`), dort ist
`ALLOW_DEV_FORMAT_RAISE=1` gesetzt.

**Versionen ohne Angabe.** Wer weder Version noch Format meldet (Nightlies
von vor dieser Prüfung), bekommt `CLIENT_OUTDATED`. Bewusst ohne Übergang:
Diese Versionen kennen weder `extra` noch `sync_parked` und würden Felder
neuerer Versionen löschen.

**Neue Releases live.** Nach `latest.json` melden Release- und
Nightly-Workflow die Version an `POST /releases/announce`
(`tooling/release/announce.mjs`, Bearer-Secret `RELEASE_ANNOUNCE_TOKEN` in
GitHub und Convex). `app_releases` hält pro App und Kanal nur die neueste
Version, ältere Meldungen ändern nichts. Angemeldete Apps abonnieren
`releases:latest` und prüfen dann mit einer Zufallsverzögerung (bis 5 min,
während einer Sync-Pause bis 15 s) über den normalen Updater; Download,
Signatur und Entscheidung bleiben bei GitHub und dem Updater. Fehlt das
Secret oder ist der Server nicht erreichbar, warnt der Workflow nur, die
stündliche Prüfung findet das Update trotzdem.

**Convex-API.** Production deployt beim Merge auf `main`, also vor jedem
Release. Funktionen und Schema deshalb nur erweitern (neue Funktionen,
optionale Argumente und Felder). Entfernen oder verschärfen erst, wenn
`minVersion` oder `MIN_FORMAT` alle Versionen ausschließt, die das Alte noch
nutzen (so entfiel `keys.ts` mit Format 1; `push` nimmt `keyId` nur
optional an, damit Format-1-Versionen `CLIENT_OUTDATED` statt eines
Validierungsfehlers bekommen, und `purge` versteht `keepKey` alter
Schlüssel-Resets als Löschen der verschlüsselten Datensätze).

## ScriptZ

Synchronisiert werden alle Inhaltstabellen des Änderungsfeeds
([`local-storage.md`](local-storage.md)) und die Einstellungen in
`SYNCED_SETTINGS` (`lib/sync/adapter.ts`); Darstellung, Modelle und die
Codex-Installation bleiben pro Gerät. Gerätebezogen bleiben außerdem:

- Provider-Thread-IDs (`agent_chats.thread_id`) und die Transkripte des
  OpenRouter-Harness (`agent_threads`); ändert sich ein Chat auf einem
  anderen Gerät, beginnt der lokale Thread neu. Die Agent-Anbindung
  (`agent.provider`) und der eigene OpenRouter-Key (Schlüsselbund) gelten pro
  Gerät.
- das unveränderte Willkommens-Skript jeder Installation;
- die Schreibstatistik: jedes Gerät lädt seine Tageswerte als `daily_words`
  (`<Geräte-ID>:<Datum>`) hoch, fremde Geräte landen in
  `daily_word_log_remote` (Migration 014), Statistiken zählen beides.

Der Papierkorb leert sich selbst: Skripte, die seit 30 Tagen darin liegen,
löscht jedes Gerät endgültig (`lib/trashAutoPurge.ts`, kurz nach dem Start und
stündlich). Die Löschung läuft wie ein manuelles Löschen über den
Änderungsfeed; das erste Gerät, das sie hochlädt, entfernt damit auch den
verschlüsselten Inhalt in der Cloud. Der Server kennt den Papierkorb nicht.

Eingehende Skripte aktualisieren Suchindex und Listen, ein offenes Skript lädt
neu (`remoteScriptBus`), geladene Chats werden entladen, sofern sie nicht
benutzt werden. Chats synchronisieren als Ganzes: Wird derselbe Chat auf zwei
Geräten gleichzeitig benutzt, gewinnt die letzte Fassung.

## Prüfung

- `packages/kit/account/__tests__/`: Datensatzformat (JSON, Kompression,
  Record-IDs) und Engine mit einer Cloud-Attrappe (Echo, Konfliktkopie,
  Bearbeiten gegen Löschen, Eltern-Reihenfolge, File Storage, verschlüsselte
  Altdatensätze, Daten neuerer Versionen, Formatsperre, Zähler).
- `modules/scriptz/lib/sync/__tests__/adapter.test.ts`: zwei echte
  SQLite-Datenbanken mit allen Migrationen; `format.test.ts` hält
  `format.json` aktuell.
- `apps/site/tests/compat.test.mjs`: Versionsvergleich, Formatsperre, Policy.
- Backend gegen das Dev-Deployment testen (`pnpm dev:site:backend`).
