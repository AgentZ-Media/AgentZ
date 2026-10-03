# Feature: Längenziel als Zielbereich (mit Zeitleiste)

> Interne Doku. Stand: 2026-10-03. Status: **umgesetzt** im Redesign „Werkbank" (Branch `redesign-werkbank`).
> Entstanden im Redesign-Konzept „Werkbank". Visuelle Referenz:
> [`docs/redesign/concept.html`](redesign/concept.html) (Screens
> Übersicht, Editor, Zeitleiste offen, Fokus, Einstellungen, Dunkel,
> Bausteine).

## Idee in einem Satz

Ein Skript bekommt einen **Zielbereich** für die Laufzeit (z. B.
0:45 bis 1:05). ScriptZ zeigt beim Schreiben ruhig und überall gleich,
ob das Skript darunter, im Bereich oder darüber liegt - und eine
ausklappbare Zeitleiste zeigt, wer wann redet und wo gekürzt werden kann.

## Warum ein Bereich und kein einzelner Wert

Short-Form-Skripte werden in Sekunden gemessen, nicht in Seiten. Die
Laufzeit-Schätzung gibt es schon (`modules/scriptz/lib/runtime.ts`), aber
ohne Bezugspunkt weiß man nicht, ob 1:15 gut oder zu lang ist.

Ein einzelner Zielwert wäre aber zu streng: Wer „1:00" als Ziel hat,
macht mit 1:01 keinen Fehler. Deshalb gibt es **Minimum und Maximum**.
Alles dazwischen ist in Ordnung und wird neutral dargestellt.

Das Längenziel ist ein **Produkt-Ziel** (wie lang soll das Video
werden), **kein Leistungsziel** - es baut keinen Druck auf, sondern
beantwortet eine Frage, die sich Creator beim Schreiben ohnehin stellen.

## Die drei Zustände

| Zustand | Bedingung | Darstellung |
|---|---|---|
| **Unter dem Bereich** | Laufzeit < Minimum | Leiser Hinweis in gedämpfter Farbe („7 s unter dem Bereich"). **Nie Rot.** Ein Skript im Entstehen ist meistens zu kurz - das ist kein Problem. |
| **Im Bereich** | Minimum ≤ Laufzeit ≤ Maximum | Neutral, keine Farbe, kein Lob. Optional leiser Hinweis „im Bereich". |
| **Über dem Bereich** | Laufzeit > Maximum | Rotstift (`--warn`), überall gleichzeitig, mit Differenz zur **Obergrenze** („10 s zu lang"). |

Beide Grenzen sind optional:

- **Nur Maximum** gesetzt = reine Obergrenze (der häufigste Fall:
  „nicht länger als 1:00").
- **Nur Minimum** gesetzt = nur der leise Hinweis nach unten, nie Rot.
- **Beides leer** = kein Zielbereich. Keine Linie, keine Farbe;
  Laufzeit und Zeitleiste bleiben trotzdem.

## Wo der Bereich herkommt

Reihenfolge der Auflösung:

1. **Ordner-Bereich** - optionale Eigenschaft des Ordners
   (z. B. „Büro-Sketche: 0:45-1:05", „Gesellschaft: 1:00-1:30",
   „Kunde Brandt: 0:40-1:00").
2. **Standard-Zielbereich** - globale Einstellung (z. B. 0:30-1:00).
3. **Kein Bereich** - wenn beides leer ist.

Ein Bereich pro Skript gibt es bewusst nicht - Skripte im selben Format
haben dieselbe Ziellänge, das gehört zum Ordner.

## Berechnung

- Laufzeit kommt unverändert aus `runtime.ts`: Dialog-Wörter / WPM +
  2 s pro Action-Block, Minimum 5 s. WPM ist die bestehende Einstellung
  „Sprechtempo" (Default 210).
- Vergleich in ganzen Sekunden. Differenz wird immer zur **nächsten
  Grenze** angegeben (über dem Bereich: zur Obergrenze, darunter: zur
  Untergrenze).
- Für die Zeitleiste wird die Formel pro Block angewendet: jeder
  Dialog-Block bekommt Start und Dauer (Wörter / WPM), jeder
  Action-Block 2 s. Die Summe muss exakt der Gesamt-Laufzeit
  entsprechen, die überall sonst angezeigt wird.

## Darstellung - genau wie im Konzept

Beispiel im Konzept: Ordner „Büro-Sketche" mit Bereich 0:45-1:05, Skript
mit 1:15 Laufzeit, also 10 s zu lang. Ein anderes Skript im selben
Ordner mit 1:02 liegt im Bereich und ist neutral.

### 1. Skript-Liste (Übersicht)

- Laufzeit-Spalte rechtsbündig, tabellarische Ziffern.
- Über dem Bereich: Zahl in Rotstift, fett. Tooltip: „10 s über dem
  Zielbereich 0:45-1:05".
- Im Bereich: neutral, Tooltip „Im Zielbereich 0:45-1:05".
- Gruppe „Drehbereit" zeigt in der Kopfzeile die Summe als Material
  („0:55 Material").

### 2. Inspector, Abschnitt „Länge"

- Große Zahl (26 px, 800) `1:15`, daneben leise `/ 0:45-1:05`.
- Über dem Bereich: Zahl in Rotstift plus Pill „10 s zu lang"
  (Rotstift auf `--warn-soft`).
- Unter dem Bereich: gedämpfte Pill „7 s unter dem Bereich".
- Darunter Fakten: Wörter, davon im Dialog, Sprecherwechsel.
- Nur Information, keine Einstellung im Inspector.

### 3. Zeitleiste, eingeklappt (Standard)

Eine 40 px hohe Leiste unter der Schreibfläche, nie leer:

- links „Zeitleiste ⌘J" zum Aufklappen,
- Mitte eine 10 px hohe Spur mit allen Sprecher-Abschnitten in
  Charakter-Farbe, Action-Abschnitte grau,
- Hook-Zone (erste 3 s) in Textmarker-Gelb,
- **Zielbereich als leicht getönte Fläche** (`--range-fill`) mit
  gestrichelter Linie am Minimum,
- **rote Linie an der Obergrenze** und schraffierte Zone dahinter bis
  zum Ende des Skripts,
- Abspielkopf an der Cursor-Position,
- rechts `1:15 / Ziel 0:45-1:05` (Laufzeit in Rotstift, wenn drüber).

### 4. Zeitleiste, ausgeklappt (⌘J)

- Eine Spur pro Sprecher (Name in iA Writer Quattro, Charakter-Farbe)
  plus eine Spur „Action".
- Zeitachse mit 10-s-Schritten; Fenster = max(Laufzeit, Obergrenze)
  plus etwas Luft. Die Grenzen sind auf der Achse beschriftet:
  Minimum fett in Textfarbe, Obergrenze fett in Rotstift, dazwischen
  ein dünner Balken, der den Bereich markiert.
- Hook-Zone, Zielbereich, Obergrenze, schraffierte „darüber"-Zone und
  Abspielkopf mit Zeit-Label (z. B. `0:20`) laufen über alle Spuren.
- Kopfzeile rechts: `1:15 / Ziel 0:45-1:05 aus „Büro-Sketche"` plus
  „10 s zu lang" - man sieht, woher der Bereich kommt.
- Legende: Hook · erste 3 s / Zielbereich / Obergrenze / darüber.
- **Hover** auf einen Abschnitt: Tooltip mit Sprecher, Zeitspanne,
  Dauer und Textanfang (z. B. „AXEL 0:12 - 0:17 · 5,1 s"); die Zeile im
  Papier bekommt gleichzeitig einen Rahmen in der Charakter-Farbe.
- **Klick** auf einen Abschnitt springt zur Zeile.
- Der Abspielkopf folgt dem Cursor.

### 5. Fokus-Modus

Pille unten mittig: `Länge 1:15 / 0:45-1:05 · Diese Sitzung +214 Wörter
· ⌘⇧F beenden`. Laufzeit in Rotstift, wenn über der Obergrenze.
Zeitleiste ist im Fokus ausgeblendet.

### 6. Einstellungen → Schreiben

- **Sprechtempo** (bestehend): Zahlenfeld mit Einheit „WPM", Hilfetext
  „Grundlage für Länge und Zeitleiste. Sketch-Tempo liegt um 210,
  ruhige Erklärvideos um 150."
- **Standard-Zielbereich**: zwei Felder `0:30` bis `1:00`, Hilfetext
  „Gilt, wenn ein Ordner keinen eigenen Bereich hat. Nur „bis"
  ausfüllen = reine Obergrenze. Beides leer = keine Linie."
- **Zielbereich je Ordner**: Liste der Ordner mit Farbpunkt und
  Bereich, Hilfetext „Überschreibt den Standard." (Bearbeitbar auch
  direkt am Ordner, z. B. im Kontextmenü.)

### 7. Bausteine

Die drei Zustände als Komponente: `0:38 · 7 s unter dem Bereich`
(gedämpft), `0:52 · im Bereich` (neutral), `1:15 · 10 s zu lang`
(Rotstift) - hell und dunkel.

### 8. Dunkles Theme

Gleiche Logik, Rotstift-Ton `#FF7A66`, Zielbereich als
`rgba(255,255,255,0.07)`, Hook-Zone als Gelb mit geringerer Deckkraft,
Spuren auf `--fill`.

## Historische technische Skizze

Die folgende Skizze dokumentiert die ursprüngliche Umsetzung. Die
Web-App samt IndexedDB-Adapter wurde in Phase 1 des Suite-Umbaus entfernt;
heute nutzt ScriptZ nur den SQLite-Adapter. Pfade sind auf den aktuellen
Stand gebracht.

- **Schema (additiv):** `folders.length_min_sec INTEGER NULL` und
  `folders.length_max_sec INTEGER NULL`. Standard-Bereich als zwei
  Settings, z. B. `length_min_default_sec` / `length_max_default_sec`
  (NULL/leer = aus). Validierung: Minimum < Maximum, wenn beide gesetzt.
- **Beide Storage-Adapter** (SQLite + IndexedDB) erweitern,
  `StorageAdapter`-Interface in `modules/scriptz/lib/storage.ts` zuerst.
- **`.scriptz`-Datei:** enthält keine Ordner, also keine Änderung nötig.
- **Zeitleiste:** braucht pro Block Start/Dauer. Kann live aus dem
  Lexical-State berechnet werden (gleiche Funktion wie `runtime.ts`,
  nur pro Block statt als Summe), keine Persistenz nötig.
- **Token:** neues `--range-fill` im Designsystem (hell
  `rgba(20,22,27,0.07)`, dunkel `rgba(255,255,255,0.07)`).
- **i18n:** alle Texte in `de.ts` / `en.ts`.

## Abgrenzung

- Kein Wochenziel, kein Streak, kein „noch X Sekunden" als Countdown.
  Das Längenziel bewertet das Skript, nicht den Menschen.
- Unter dem Bereich ist nie ein Fehler, nur eine Information.
- Keine automatischen Kürzungsvorschläge, keine KI. Höchstens eine
  sachliche Liste „Längste Zeilen" (im Konzept als Idee, nicht Teil
  des Kern-Features).

## Offene Fragen

- Hook-Zone fest 3 s oder einstellbar?
- Soll die Zeitleiste auch ohne Zielbereich erscheinen? (Konzept: ja,
  nur ohne Bereich und Obergrenze.)
- Soll „im Bereich" überhaupt sichtbar markiert werden oder komplett
  still bleiben?
