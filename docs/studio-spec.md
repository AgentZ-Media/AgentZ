# ScriptZ Studio - Konzept & Spezifikation

> Interne Doku (Deutsch). Stand: 2026-06-02. Status: Entwurf, in Umsetzung.

## 1. Was ist ScriptZ Studio?

Ein **eigenständiges, cloud-basiertes Agentur-Tool** im selben Monorepo,
das den **bestehenden ScriptZ-Editor unverändert wiederverwendet**, aber
darum herum einen kompletten Agentur-Kunden-Workflow legt:
Registrierung/Login, Mehrbenutzer mit Rollen, Online-Datenbank,
Freigabe-Prozess und Kunden-Portal.

ScriptZ Studio ist **getrennt** vom bestehenden Produkt:

- Die bestehenden Apps (`apps/desktop`, `apps/web`) bleiben **komplett
  unangetastet**: offline, lokal, single-user, gleiche Zielgruppe.
- Studio ist eine **dritte App-Schale** neben Desktop und Web. Sie
  importiert den Editor und die Geschäftslogik aus `@scriptz/core` -
  genau wie die anderen beiden Schalen -, registriert aber statt
  SQLite/IndexedDB einen **Convex-StorageAdapter** und bringt Auth +
  Multi-User mit.

Das Tool ist nur **für unsere Agentur**: keine offene Registrierung,
keine fremden Agenturen. Das Projekt bleibt Open Source - wer es selbst
betreiben will, self-hostet es eigenständig.

## 2. Leitprinzipien

1. **Core wird nur additiv und nicht-brechend verändert.** Jede Änderung
   an `packages/core` muss so sein, dass Desktop und Web sich danach
   byte-genau identisch verhalten (opt-in-Props, die sie schlicht nicht
   nutzen). Die Zielgruppe des bestehenden Produkts bleibt unberührt.
2. **Eine App, jetzt drei Schalen.** Studio folgt demselben
   Adapter-Pattern wie Desktop/Web (siehe
   `.claude/rules/feature-parity.md`). Logik lebt in `core`, Plattform-
   spezifisches in der Schale.
3. **Single-Writer.** Pro Skript editiert immer nur eine Agentur-Person.
   Kunden lesen/kommentieren/geben frei, schreiben nie. Damit reicht
   Last-Write-Wins, der Editor braucht keinen CRDT-/Yjs-Umbau.
4. **Realtime ist quasi geschenkt.** Convex liefert reaktive Live-Queries.
   Sie treiben dieselben Reaktivitäts-Busse, die der Core schon kennt
   (`scriptsBus.bump()` etc.).

## 3. Architektur

```
packages/core         Editor, Lexical-Nodes, Stores, Business-Logik (geteilt)
apps/desktop          Tauri + SQLite, offline (unverändert)
apps/web              Browser + IndexedDB, offline (unverändert)
apps/landing          Astro Marketing (unverändert)
apps/studio   (NEU)   Solid + Vite Frontend  +  Convex Backend
```

### 3.1 Frontend (`apps/studio/src`)

- Solid + Vite, wie `apps/web`. Eigener Dev-Port (5174), damit es parallel
  zu Web (5173) und Desktop (1420) laufen kann.
- Registriert beim Boot:
  - einen **web-artigen `PlatformAdapter`** (`src/lib/platform.ts`):
    Blob-Download für Export, `getDb()` wirft bewusst (kein SQL).
  - einen **`ConvexStorageAdapter`** (`src/adapters/convex.ts`): erfüllt
    das `StorageAdapter`-Interface aus `@scriptz/core/lib/storage.ts`
    gegen Convex-Queries/Mutations.
- Der Core-Editor (`Editor` aus `@scriptz/core/components/Editor/Editor`)
  wird unverändert importiert, Styles aus `@agentz/design` (Studio mappt
  seine `--s-*`-Variablen auf die Design-Tokens).

### 3.2 Backend (`apps/studio/convex`)

- **Convex** als reaktive Datenbank + Funktionsschicht (TypeScript
  Queries/Mutations/Actions). Deployt auf Convex Cloud, getrennt vom
  Vercel-Frontend.
- **Better Auth** für Login/Registrierung über die offizielle
  Convex-Integration `@convex-dev/better-auth`. Invite-only: Accounts
  werden von Agentur-Nutzern angelegt, keine offene Self-Registration.
- Schema in `convex/schema.ts` (siehe Abschnitt 6).

### 3.3 Deployment

- Frontend: Vercel (statische SPA, wie `apps/web`, eigene `vercel.json`).
- Backend: Convex Cloud (eigene Deployment-URL, als `VITE_CONVEX_URL`
  ins Frontend injiziert).

## 4. Wiederverwendung des Editors (additive Core-Hebel)

Beides ist opt-in; Desktop/Web nutzen es nicht und bleiben identisch.

1. **`readOnly`-Modus** am `Editor` (Prop `readOnly`): ruft
   `editor.setEditable(false)` und überspringt das Autosave-/Persistence-
   Wiring. Das ist der Kunden-View - gleicher Editor, gleiche
   Formatierung und Charakter-Farben, aber nicht editierbar.
2. **Kommentar-Overlay**: eine Kommentar-Spalte neben dem Editor (analog
   zum Inspector im Editor-Screen der Desktop-/Web-App). Auf
   Dokument-Ebene ohne jeden Editor-Eingriff. Für Block-Ebene (Phase 4b) bekommt `BaseScriptzNode`
   ein zusätzliches serialisiertes `id`-Feld - additiv, `content_json`
   bleibt rückwärtskompatibel (analog zu `characterName` in
   `ScriptzCharacterNode`).

> Das serialisierte Skript-Format (`content_json`) ist identisch zur
> bestehenden App. Ein in Studio geschriebenes Skript ließe sich damit
> auch als `.scriptz` exportieren und in die lokale App laden (und
> umgekehrt), falls später gewünscht.

## 5. Rollen & Rechte

Zwei Rollen. Innerhalb der Agentur sind **alle Nutzer gleichberechtigt**
(jeder darf Kunden + Logins anlegen). Ein Kunde ist eine **Gruppe** mit
mehreren Logins, die alle dieselben Inhalte dieses Kunden sehen.

| Aktion | Agentur | Kunde |
|---|---|---|
| Kunden + Logins anlegen | ✅ (jeder) | ❌ |
| Ideen/Skripte erstellen & editieren | ✅ | ❌ (read-only) |
| Status auf "Zur Freigabe" setzen | ✅ | ❌ |
| Freigeben / Ablehnen / Änderung erbeten | ✅ | ✅ (nur eigene) |
| Kommentieren | ✅ | ✅ (nur eigene) |
| Entwürfe (`draft`) sehen | ✅ | ❌ |
| Exportieren | ✅ | ✅ (eigene, freigegebene) |

**Scoping wird serverseitig erzwungen.** Jede Convex-Query filtert nach
`clientId` und Rolle. Ein Kunden-Login sieht nur Inhalte seiner Kunden-
Gruppe und nur ab Status `in_review` - `draft` bleibt bei der Agentur.

## 6. Datenmodell (Convex)

Siehe `apps/studio/convex/schema.ts`. Kern-Tabellen:

- **users** `{ authId, name, email, role: "agency"|"client" }` - App-Profil
  pro Login. Die eigentlichen Auth-Tabellen (Sessions/Accounts) verwaltet
  die Better-Auth-Komponente separat.
- **clients** `{ name, createdAt }` - ein Kunde (Marke/Gruppe).
- **clientMembers** `{ clientId, userId }` - mehrere Logins pro Kunde.
- **folders** `{ clientId, name, startDate?, endDate?, targetCount?, ... }` -
  "Zeitraum"/Content-Batch (siehe Abschnitt 8).
- **ideas** `{ clientId, folderId?, title, notes, status, decisionNote?,
  scriptId?, ... }`.
- **scripts** `{ clientId, folderId?, title, contentJson, charactersMeta,
  highlightingEnabled, status, decisionNote?, pageCount, wordCount, ... }`.
- **comments** `{ clientId, targetType, targetId, blockId?, authorId, body,
  resolved, createdAt }`.

Unterschied zum bestehenden Schema: jede Entity trägt eine `clientId`
(ersetzt das fehlende owner/tenant-Feld) und Ideen/Skripte tragen ein
`status`-Feld.

## 7. Freigabe-Workflow (Status-Maschine)

Gilt identisch für Ideen und Skripte. Die Agentur stellt vor, der Kunde
entscheidet.

```
   Agentur erstellt        Agentur gibt zur Sicht frei       Kunde entscheidet
   [draft] ───────────────▶ [in_review] ───────────────────▶ [approved]
                                 ▲                             [rejected]
                                 └──── [changes_requested] ◀───┘ (zurück an Agentur)
```

- `draft` - nur Agentur sichtbar.
- `in_review` - Kunde sieht es, kann entscheiden + kommentieren.
- `approved` / `rejected` - Entscheidung des Kunden (oder der Agentur).
- `changes_requested` - Kunde spielt zurück, Item geht erneut an die
  Agentur, Begründung in `decisionNote`.

Aus **freigegebenen Ideen** schreibt die Agentur Skripte. Nicht jede Idee
wird ein Skript (manche sind selbsterklärend). Die Skript-Erstellung nutzt
die bestehende `convertIdeaToScript`-Logik aus `core`.

## 8. "Zeitraum"-Ordner (Produktions-Rhythmus)

Die Agentur produziert in Blöcken (alle 1-3 Monate ca. 30-90 Videos, ein
Video pro Drehtag). Ein **Ordner** modelliert deshalb einen frei
benennbaren Content-Batch unter einem Kunden, mit:

- optionalem **Datumsbereich** (`startDate`/`endDate`, frei wählbar - nicht
  an Kalendermonate gebunden),
- optionaler **Ziel-Anzahl** (`targetCount`, z.B. "90 Videos für 3 Monate"),
- einer Fortschrittsanzeige im UI ("23 / 90 freigegeben").

Ideen und Skripte hängen an einem Ordner. Sortier-/Filteransicht nach
Datumsbereich kommt obendrauf.

## 9. Kommentare

Start auf **Dokument-Ebene** (Thread pro Idee bzw. pro Skript), ohne
Editor-Eingriff - schnell und robust. **Block-Ebene** (Kommentar an einer
Szene/Block) folgt als Phase 4b über stabile Block-IDs (additives Feld in
`BaseScriptzNode`).

## 10. Export

Der bestehende, plattformreine PDF-Generator (`core/lib/exportPdf.ts`,
gibt Bytes zurück) wird wiederverwendet; das Speichern macht der
web-artige `PlatformAdapter` (Blob-Download). Der "Monats-Export" ist eine
**Mehrfach-Auswahl** freigegebener Ideen/Skripte, gebündelt als PDF.

## 11. Suche

Convex hat Volltext-Such-Indizes. Der `ConvexStorageAdapter.globalSearch`
nutzt einen Such-Index auf Titel/Inhalt. (Desktop = FTS5, Web =
MiniSearch, Studio = Convex-Suche - gleiche UX, andere Technik.)

## 12. Bau-Phasen

- **Phase 0 - Gerüst (dieser Schritt):** `apps/studio` angelegt (Solid +
  Vite), Core eingebunden, web-artiger `PlatformAdapter`, Convex-Schema
  geschrieben, Platzhalter-UI bootet. **Stopp vor `npx convex dev`** -
  dieser CLI-Schritt wird manuell ausgeführt (siehe
  `apps/studio/convex/README.md`).
- **Phase 1 - Auth & Identität:** Better Auth via `@convex-dev/better-auth`,
  invite-only Account-Anlage, `users`/Rollen, Login-Screen.
- **Phase 2 - Kunden & Inhalte:** Kunden + Mitglieder, Ordner/Zeiträume,
  Ideen + Skripte (Agentur-Authoring mit dem echten Editor), voller
  `ConvexStorageAdapter`.
- **Phase 3 - Workflow & Kunden-Portal:** Status-Maschine, read-only
  Editor (additiver Core-Hebel), freigeben/ablehnen/Änderung.
- **Phase 4 - Kommentare:** (a) Dokument-Ebene, (b) Block-Ebene.
- **Phase 5 - Export & Suche:** PDF-Bundle, Convex-Suche, Feinschliff.

## 13. Offene Punkte

- Login-Methode: empfohlen Magic-Link per E-Mail (invite-only, kein
  Passwort-Stress für Kunden). Alternativ E-Mail+Passwort. Wird in
  Phase 1 mit Better Auth festgezurrt.
- Konfliktbehandlung beim Speichern: Single-Writer + ein
  `updatedAt`/Revisions-Check in der `updateScript`-Mutation. Kein CRDT.
