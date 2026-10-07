# Konto und Cloud-Synchronisierung

Apps der Suite funktionieren vollständig ohne Konto. Mit einem Konto gleichen
sie ihre Daten Ende-zu-Ende verschlüsselt zwischen den Geräten ab. Die lokale
SQLite-Datenbank bleibt die Arbeitskopie; sobald jemand angemeldet ist, ist die
Cloud die Wahrheit.

## Bausteine

| Teil | Ort | Aufgabe |
|---|---|---|
| Konto, Krypto, Engine, UI | `packages/kit/account/` (`@agentz/kit/account`) | Anmeldung, Sitzung, Datenschlüssel, Sync-Engine, Avatar, Konto-Button, Dialoge, Einstellungsseite „Konto“ |
| Adapter je App | z. B. `modules/scriptz/lib/sync/adapter.ts` | Welche Tabellen, in welcher Reihenfolge, wie eingehende Datensätze geschrieben werden, Konfliktkopien |
| Desktop-Host | `packages/desktop/lib/platform.ts`, `crates/agentz-desktop/src/secrets.rs` | Schlüsselbund (`PlatformAdapter.secrets`), URL-Schema `agentz-<id>://` (`onOpenUrl`) |
| Backend | `apps/site/convex/` | `sync.ts`, `keys.ts`, `appLink.ts`, `schema.ts`, `syncApps.ts` |
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

## Verschlüsselung

- Pro Konto ein zufälliger 256-Bit-Datenschlüssel. Er verlässt die Geräte nur
  verschlüsselt: `sync_keys.wrapped` ist AES-256-GCM mit einem per HKDF aus dem
  Wiederherstellungsschlüssel abgeleiteten Schlüssel.
- Der Wiederherstellungsschlüssel (32 Zufallsbytes, 52 Zeichen Crockford-Base32)
  wird beim Einrichten einmal gezeigt und nie gespeichert. Ein neues Gerät
  braucht ihn einmal; danach liegt der Datenschlüssel im Schlüsselbund
  (`sync.key`). „Neuer Schlüssel“ verpackt denselben Datenschlüssel neu.
  „Schlüssel verloren“ erzeugt einen neuen Datenschlüssel und löscht die
  Cloud-Daten (`keys.reset`, `sync.purge`), andere Geräte laden danach erneut hoch.
- Je App leitet HKDF einen Inhaltsschlüssel (AES-256-GCM) und einen ID-Schlüssel
  (HMAC-SHA-256) ab. Die Record-ID ist der HMAC von Entität und lokaler ID; die
  Datensätze sind an App und Record-ID gebunden (Additional Authenticated Data).
  Inhalte über 512 Byte werden vor dem Verschlüsseln mit gzip komprimiert.
- Der Server sieht pro Datensatz nur Record-ID, Revision, Größe, Löschmarke,
  Schlüssel-ID, zufällige Geräte-ID und Zeitpunkt.

## Datenmodell in Convex

- **Eine Record-Tabelle pro App** (`scriptz_records`, später `<app>_records`),
  Indizes `by_user_rev` (Abholen ab Revision) und `by_user_record` (Schreiben).
  Pro lokaler Zeile gibt es genau ein Dokument mit der letzten Fassung; Seiten
  sind auf 100 Datensätze und 4 MB begrenzt, damit auch zehntausende Skripte
  nur in Änderungen übertragen werden.
- Verschlüsselte Inhalte bis 96 KiB liegen im Dokument, größere im File
  Storage.
- `sync_heads`: Revisionszähler pro Nutzer und App. `sync_keys`: verpackter
  Datenschlüssel pro Konto (für alle Apps). `app_links`: kurzlebige Codes der
  App-Anmeldung (stündlicher Cron räumt auf).
- Kontolöschung (`deleteUser.afterDelete`) löscht alle Sync-Daten in Batches.
- Neue App mit Sync: Tabelle in `schema.ts`, Eintrag in `syncApps.ts`
  (`SYNC_APPS`, `appArg`) und ein `SyncAdapter` im Modul. Ohne Eintrag in
  `SYNC_APPS` kann sich die App auch nicht anmelden.

## Abgleich und Konflikte

Lokal führt die Tabelle `sync_records` (Migration der App, `baseline.sql` für
neue Apps) pro Datensatz Record-ID, Cloud-Revision und Inhalts-Hash;
`app_state.sync.state` hält Konto, Schlüssel-ID, Geräte-ID und beide Cursor.

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

## ScriptZ

Synchronisiert werden alle Inhaltstabellen des Änderungsfeeds
([`local-storage.md`](local-storage.md)) und die Einstellungen in
`SYNCED_SETTINGS` (`lib/sync/adapter.ts`); Darstellung, Modelle und die
Codex-Installation bleiben pro Gerät. Gerätebezogen bleiben außerdem:

- Codex-Thread-IDs (`agent_chats.thread_id`); ändert sich ein Chat auf einem
  anderen Gerät, beginnt der lokale Thread neu.
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

- `packages/kit/account/__tests__/`: Krypto (Schlüssel, Verpackung, Bindung,
  Kompression) und Engine mit einer Cloud-Attrappe (Echo, Konfliktkopie,
  Bearbeiten gegen Löschen, Eltern-Reihenfolge, File Storage, fremde Schlüssel).
- `modules/scriptz/lib/sync/__tests__/adapter.test.ts`: zwei echte
  SQLite-Datenbanken mit allen Migrationen.
- Backend gegen das Dev-Deployment testen (`pnpm dev:site:backend`).
