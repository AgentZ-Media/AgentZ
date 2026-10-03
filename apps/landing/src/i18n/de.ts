/**
 * German strings for the landing.
 *
 * Key convention: area.context.what (flat, dot-separated, lowercase).
 * Whoever changes a key here must update the same key in `en.ts` -
 * TypeScript enforces that via `Record<keyof typeof de, string>` in en.ts.
 *
 * Platform-specific strings carry a `.mac` / `.win` suffix. The
 * landing renders both variants and hides the non-matching one via
 * CSS (see `[data-platform="windows"] .mac-only { display: none }`
 * in landing.css). The default render is macOS look for SEO and JS-off.
 */
export const de = {
  // ===================== Hero =====================
  "hero.eyebrow": "SCRIPTZ // FÜR CONTENT CREATOR",
  "hero.h1.keyword": "Skripteditor für Content Creator.",
  "hero.h1.line1": "Schreiben,",
  "hero.h1.line2": "statt formatieren.",
  "hero.lead":
    "Der Skripteditor für Content Creator. Eine Idee → ein fertiges Skript in wenigen Minuten. Kein Drehbuch-Korsett, keine KI, kein Abo. Nur du, deine Idee und ein Cursor, der dir aus dem Weg geht.",
  "hero.cta.download.mac": "Kostenlos für macOS",
  "hero.cta.download.win": "Kostenlos für Windows",
  "hero.cta.github": "Auf GitHub",
  "hero.cta.allplatforms": "Andere Plattform? Alle Downloads auf GitHub →",
  "hero.meta.os.mac": "macOS 13+",
  "hero.meta.os.win": "Windows 10+",
  "hero.meta.zero": "0 Tracker · 0 Konten · 0 KI",
  "hero.web.intro": "Lieber erst ausprobieren?",
  "hero.web.link": "Direkt im Browser testen →",
  "hero.web.hint": "Test-Editor, lokal in deinem Browser. Daten bleiben dort.",

  // ===================== Page hero per route =====================
  // Each route has a unified page-hero on top (keyword eyebrow + H1
  // + subline + download CTA). Only the home variant (`/`) uses the
  // historical `hero.h1.*` / `hero.lead` keys because the brand
  // statement stays bigger there. Sub-routes pull from the
  // `hero.{route}.*` keys below.
  "hero.warum.keyword": "WARUM SCRIPTZ",
  "hero.warum.title": "Skripte schreiben, ohne dass die App im Weg steht.",
  "hero.warum.subline":
    "Für Content Creator, die Skripte für TikTok, Reels und YouTube Shorts schneller fertigbekommen wollen - ohne Drehbuch-Korsett, ohne KI, ohne Abo.",

  "hero.quickmodus.keyword": "DAS DETAIL, DAS NIEMAND SONST KANN",
  "hero.quickmodus.title": "Quickmodus: der Two-Hander-Workflow für Reels und Shorts.",
  "hero.quickmodus.subline":
    "Zwei Sprecher, ein Enter. Der Cursor springt automatisch in den nächsten Charakter - ohne Tab, ohne Sprechernamen tippen. Spart pro Skript eine Minute.",

  "hero.noai.keyword": "DAS NO-AI-MANIFEST",
  "hero.noai.title": "Skripteditor ohne KI. Deine Stimme bleibt deine.",
  "hero.noai.subline":
    "Keine Chatbox, keine Vorschläge, kein „Verbessern\"-Button. Deine Skripte liegen lokal in einer SQLite-Datei, nicht in der Cloud.",

  "hero.vergleich.keyword": "DER EHRLICHE VERGLEICH",
  "hero.vergleich.title": "ScriptZ vs. Final Draft, Notion, ChatGPT, Word.",
  "hero.vergleich.subline":
    "Was ScriptZ kann, das die anderen nicht können - und wo wir bewusst klein bleiben. Als kostenlose Final-Draft-Alternative für Short-Form gebaut.",

  "hero.download.keyword": "KOSTENLOS, LOKAL, OPEN SOURCE",
  "hero.download.title": "ScriptZ kostenlos herunterladen - macOS und Windows.",
  "hero.download.subline":
    "Ein .dmg oder .exe. Kein Konto, keine Tracker, keine KI. Updates kommen automatisch über den eingebauten Updater.",

  "hero.ideen.keyword": "DIE IDEEN-SEITE",
  "hero.ideen.title": "Sammle, was du als Nächstes schreibst.",
  "hero.ideen.subline":
    "Skript-Ideen für TikTok, Reels und Shorts an einem Ort, sortiert nach Ordnern. ⌘I erfasst sie von überall, ein Kürzel macht daraus ein Skript - offline, ohne Konto.",

  // ===================== Home section (`/`) =====================
  // Dedicated content below the page hero instead of repeating the
  // Warum tab: screenshot gallery, three feature teasers, comparison
  // hint, closing download block.
  "home.gallery.h2": "Drei Ansichten, eine App.",
  "home.gallery.sub":
    "Übersicht, Ideen, Editor. Links die Seitenleiste mit der Pipeline, in der Mitte das Blatt, rechts der Inspector. Mehr braucht ein Skript-Tool nicht.",

  "home.features.h2": "Vier Dinge, für die ScriptZ gebaut ist.",
  "home.feature.quick.title": "Quickmodus für zwei Sprecher",
  "home.feature.quick.body":
    "Two-Hander-Dialog wie von selbst: Enter springt zum nächsten Charakter, kein Tab, kein Sprechername tippen. Spart pro 60-Sekunden-Reel eine Minute.",
  "home.feature.quick.link": "Quickmodus erklärt →",
  "home.feature.length.title": "Zielbereich und Zeitleiste",
  "home.feature.length.body":
    "Gib einem Ordner eine Ziellänge wie 0:45-1:05. Darunter gibt es nur einen leisen Hinweis, erst über der Obergrenze wird die Laufzeit rot. ⌘J zeigt unter dem Blatt, wer wann redet.",
  "home.feature.length.link": "So sieht das aus →",
  "home.feature.pipeline.title": "Pipeline von der Idee bis online",
  "home.feature.pipeline.body":
    "Ideen, Schreiben, Drehbereit, Gedreht, Online: Jedes Skript hat eine Stufe, die Seitenleiste zeigt, was wo steht. Ordner bleiben für Themen, Kunden und Serien.",
  "home.feature.pipeline.link": "Zur Ideen-Seite →",
  "home.feature.noai.title": "Bewusst ohne KI",
  "home.feature.noai.body":
    "Keine Vorschläge, kein „Verbessern\"-Button, kein Cloud-Upload. Deine Stimme bleibt deine, dein Skript bleibt lokal in einer SQLite-Datei.",
  "home.feature.noai.link": "Das Kein-KI-Manifest →",

  "home.compare.h2": "Im Vergleich.",
  "home.compare.body":
    "Final Draft kann Spielfilm-Drehbücher. Notion kann Wikis. ChatGPT kann Brainstorming. ScriptZ kann: Skripte für Reels schnell. Das ist alles - und das wars uns wert.",
  "home.compare.cta": "Den ganzen Vergleich sehen →",

  "home.closing.eyebrow": "BEREIT?",
  "home.closing.h2": "Kostenlos. Lokal. Ohne Konto.",
  "home.closing.body":
    "macOS 13+ oder Windows 10+. Ein Klick, ein Installer, fertig. Kein Sign-in, keine Mail-Liste, keine Abos.",

  // macOS install hint
  "install.mac.summary": "Beim ersten Öffnen blockiert macOS die App?",
  "install.mac.body":
    "Das ist normal - ScriptZ ist Open Source und nicht bei Apple registriert. Einmal diesen Befehl im Terminal ausführen, danach läuft alles wie gewohnt:",
  "install.mac.why":
    "Apple verlangt eine kostenpflichtige Signatur, die diesen Schritt überflüssig machen würde. Bis sich das lohnt, ist der kurze Befehl der Preis dafür, dass ScriptZ kostenlos und ohne Konto bleibt.",
  "install.mac.whyShort.label": "Warum?",
  "install.mac.whyShort.body":
    "Apple verlangt eine kostenpflichtige Signatur, die diesen Schritt überflüssig machen würde. Bis sich das lohnt, ist der kurze Befehl der Preis dafür, dass ScriptZ kostenlos und ohne Konto bleibt.",

  // Windows install hint
  "install.win.summary": "Beim ersten Start meldet sich SmartScreen?",
  "install.win.body":
    "Das ist normal - ScriptZ ist Open Source und hat (noch) kein EV-Code-Signing-Zertifikat. Mit zwei Klicks ist es gelöst:",
  "install.win.step1": "1. Im SmartScreen-Dialog auf „Weitere Informationen\" klicken.",
  "install.win.step2": "2. Den dann erscheinenden Button „Trotzdem ausführen\" anklicken.",
  "install.win.why":
    "Microsoft verlangt für sofortige Akzeptanz ein kostenpflichtiges EV-Code-Signing-Zertifikat. Bis sich das lohnt, sind die zwei zusätzlichen Klicks der Preis dafür, dass ScriptZ kostenlos und ohne Konto bleibt.",
  "install.win.whyShort.label": "Warum?",
  "install.win.whyShort.body":
    "Microsoft verlangt ein EV-Code-Signing-Zertifikat. Bis sich das lohnt, sind zwei Klicks der Preis dafür, dass ScriptZ kostenlos und ohne Konto bleibt.",

  // Copy button (macOS only, but strings are shared)
  "install.copy": "Kopieren",
  "install.copied": "Kopiert ✓",
  "install.copyManual": "Bitte manuell kopieren",

  // ===================== App chrome: sidebar + header bar =====================
  // `tab.*` keys are the route labels (sidebar, mobile nav). The name
  // is historical - the app itself no longer has tabs.
  "tab.home.title": "Übersicht",
  "tab.home.long": "Skripteditor für TikTok, Reels und YouTube Shorts",
  "tab.home.aria": "Übersicht (zurück nach oben)",
  "tab.ideas.title": "Ideen",
  "tab.warum.short": "Warum?",
  "tab.warum.long": "Skripte schreiben, ohne dass die App im Weg steht",
  "tab.quickmodus.short": "Der Quickmodus",
  "tab.quickmodus.long": "Quickmodus - der Trick, den niemand anders kann",
  "tab.noai.short": "Keine KI",
  "tab.noai.long": "Kein-KI-Manifest",
  "tab.compare.short": "Vergleich",
  "tab.compare.long": "Im Vergleich zu allem anderen",
  "tab.download.short": "Download",
  "tab.download.long.mac": "Download - macOS, kostenlos",
  "tab.download.long.win": "Download - Windows, kostenlos",

  "status.opensource": "Open Source",
  "status.saved": "Gespeichert",

  "toolbar.back.aria": "Zurück zur Übersicht",
  "toolbar.stage": "Online",
  "toolbar.stage.title":
    "Stufe dieser Seite. In der App wandert jedes Skript von der Idee bis Online.",
  "toolbar.download": "Download",
  "side.aria": "Seitenleiste",
  "side.section.scripts": "Skripte",
  "side.counter.unit": "Wörter",
  "side.counter.sub": "auf dieser Seite",
  "side.counter.title":
    "In der App steht hier ein ruhiger Schreib-Zähler, zum Beispiel „1.240 Wörter diese Woche\". Kein Ziel, kein Streak.",

  // ===================== Tab: WARUM =====================
  "warum.caption": "INT. SCRIPTZ - SKRIPTEDITOR FÜR TIKTOK, REELS UND YOUTUBE SHORTS",
  "warum.action1":
    "Eine leere Seite. Cursor blinkt. Du tippst und das Format passiert von allein. Drei Blocktypen, mehr nicht: Action, Charakter, Dialog. Charakter-Name? Automatisch zentriert und in Versalien. Tab? Block-Picker. Enter? Nächste Zeile - meistens schon im richtigen Block.",
  "warum.action2":
    "ScriptZ ist für Content Creator gebaut, nicht für Drehbuchautoren. Du willst kein 90-Minuten-Spielfilm-Layout. Du willst ein TikTok-Skript um halb drei fertig haben, bevor das gute Licht weg ist.",
  "warum.timo1.dialog":
    "(direkt) Du tippst, der Editor formatiert. Charaktere werden automatisch erkannt, kriegen eine Farbe und ihren Anteil an der Sprechzeit. Du musst nichts anlegen. Du musst nichts klicken. Du musst nur schreiben.",
  "warum.axel1.dialog": "Das klingt nach jedem Tool seit 2015.",
  "warum.timo2.dialog":
    "Probier's. Mach ein Skript, schreib zwei Sprecher. Dann drück Enter. Du wirst sehen, dass der Cursor schon im richtigen Block landet, mit dem richtigen Sprecher davor. Das ist der Quickmodus. Genau das spart dir pro Wechsel zwei Tastendrücke - und bei einem 60-Sekunden-Reel mit 12 Wechseln spart das eine Minute.",
  "warum.axel2.dialog": "(neugierig) Und KI? Macht sie mir vor, was ich sagen soll?",
  "warum.timo3.dialog":
    "Nein. Bewusst nicht. Kreativität ist dein Job. Wenn du wolltest, dass ein Modell für dich schreibt, hättest du ChatGPT auf.",
  "warum.axel3.dialog": "Und woher weiß ich, ob mein Reel zu lang wird?",
  "warum.timo4.dialog":
    "Du gibst dem Ordner einen Zielbereich, zum Beispiel 0:45 bis 1:05. Liegst du darunter, gibt es nur einen leisen Hinweis. Erst über der Obergrenze wird die Laufzeit rot. Und mit ⌘J klappt unter dem Blatt die Zeitleiste auf: wer wann redet, wo der Hook sitzt, wo du kürzen kannst.",
  "warum.axel4.dialog": "Und wenn es fertig ist?",
  "warum.timo5.dialog":
    "Dann wandert es weiter: Idee, Schreiben, Drehbereit, Gedreht, Online. Die Seitenleiste zeigt, was wo steht. Ordner bleiben für Themen, Kunden und Serien.",
  "warum.action3": "Drei Ansichten der App: Übersicht, Ideen, Editor. Klick dich durch.",

  "shot.tab.overview": "Übersicht",
  "shot.tab.ideas": "Ideen",
  "shot.tab.editor": "Editor",
  "shot.alt.overview":
    "ScriptZ Übersicht: Seitenleiste mit Pipeline, Skripte nach Stufe gruppiert",
  "shot.alt.ideas": "ScriptZ Ideen-Seite mit Ordner-Chips und Detail-Panel",
  "shot.alt.editor": "ScriptZ Editor mit Charakter-Farben, Inspector und Zeitleiste",

  "jump.label.long": "Weiter im Programm:",
  "jump.label.short": "Weiter:",
  "jump.btn.quickmodus": "→ Quickmodus erklärt",
  "jump.btn.noai": "→ Warum kein KI",
  "jump.btn.noaiAlt": "→ Warum keine KI",
  "jump.btn.compare": "→ Vergleich mit anderen",
  "jump.btn.compareShort": "→ Vergleich",
  "jump.btn.download": "→ Download",
  "jump.btn.backToStart": "→ Zurück zum Anfang",

  // ===================== Tab: QUICKMODUS =====================
  "quick.caption": "INT. QUICKMODUS - DER TWO-HANDER-WORKFLOW FÜR REELS UND SHORTS",
  "quick.action1":
    "Der Quickmodus ist das, was ScriptZ nicht ersetzbar macht. Sobald dein Skript genau zwei Sprecher hat, übernimmt er. Nach jedem Dialog und einmal Enter springt der Cursor automatisch in den anderen Charakter und gleich rein in den nächsten Dialog. Kein Tab, kein Sprechername tippen, kein zweites Enter.",
  "quick.beat": "Tack, tack, tack. Enter.",
  "quick.action2":
    "Praktisch heißt das: pro Sprecherwechsel zwei Tastendrücke gespart. Bei einem typischen 60-Sekunden-Reel mit zehn bis zwölf Wechseln ist das fast eine Minute. Pro Tag drei Skripte? Drei Minuten. Pro Woche? Eine viertel Stunde, in der du nicht formatiert, sondern geschrieben hast.",
  "quick.timo1.dialog": "So sieht das in echt aus. Ich tippe etwas.",
  "quick.axel1.dialog": "Ich antworte. Enter.",
  "quick.timo2.dialog": "Cursor ist schon hier. Niemand hat „TIMO\" getippt.",
  "quick.axel2.dialog": "Niemand hat „AXEL\" getippt. Niemand hat Tab gedrückt.",
  "quick.timo3.dialog": "Wir schreiben einfach. Der Editor weiß, was wir wollen.",
  "quick.action3":
    "Drei Charaktere im Skript? Quickmodus pausiert automatisch - dann weiß der Editor nicht, wer als Nächster spricht. Sobald du wieder auf zwei reduzierst, ist er wieder da. Er schaltet sich von selbst ein. Der Schalter in der Kopfleiste ist nur für den Fall, dass du ihn mal nicht willst.",
  "quick.callout.eyebrow": "DAS DETAIL, DAS ZÄHLT",
  "quick.callout.body":
    "Das machen weder Word, noch Notion, noch Final Draft, noch ChatGPT, noch Apple Notes. Bei uns ist es ein Kernfeature, von Anfang an. Wer schon mal zwei Sprecher gleichzeitig getippt hat, weiß, was das pro Tag spart.",

  // ===================== Tab: NO-AI =====================
  "noai.caption": "INT. KEIN-KI-MANIFEST - SKRIPTEDITOR OHNE KI",
  "noai.action1":
    "ScriptZ hat keine KI eingebaut. Kein Chatfenster, kein „schreib mir ein Skript\", kein automatisches Umformulieren, keine Vorschläge, keine Auto-Vervollständigung jenseits der Charakter-Namen aus deinem eigenen Skript. Bewusst nicht.",
  "noai.axel1.dialog":
    "(skeptisch) Alle anderen Tools haben KI. Du verkaufst „keine KI\" als Feature?",
  "noai.timo1.dialog":
    "Ja. Weil deine Stimme dein Produkt ist. Wenn ein Modell dir die Hälfte des Skripts schreibt, ist die Hälfte der Stimme das Modell.",
  "noai.axel2.dialog": "Manchmal hängt man halt fest.",
  "noai.timo2.dialog":
    "Dann ist die Lösung nicht „lass das Modell ran\", sondern „mach drei Minuten Pause\". Dafür gibt es ⌘I für den schnellen Gedanken und den Fokus-Modus, der alles außer dem Blatt ausblendet. Beides offline, beides ohne fremde Stimme.",
  "noai.beat": "Axel nickt. Lange Pause.",
  "noai.card1.title": "Kein API-Key",
  "noai.card1.body": "Keine Cloud-Schlüssel, keine Tokens, keine Abrechnung pro Wort.",
  "noai.card2.title": "Kein Trainingsdaten-Beitrag",
  "noai.card2.body": "Dein Skript wird nicht hochgeladen. Es liegt lokal in einer SQLite-Datei.",
  "noai.card3.title": "Kein „verbessern\"-Button",
  "noai.card3.body": "Dein Skript ist nicht kaputt. Es braucht keine Verbesserung von außen.",
  "noai.card4.title": "Stattdessen: schneller Editor",
  "noai.card4.body":
    "Quickmodus, Charakter-Auto-Erkennung, drei Block-Hotkeys, Zeitleiste. Tools, die deine Idee aus deinem Kopf auf die Seite tragen - ohne sie umzuschreiben.",

  // ===================== Tab: VERGLEICH =====================
  "cmp.caption": "EXT. VERGLEICH - SCRIPTZ VS. FINAL DRAFT, NOTION, CHATGPT",
  "cmp.action1":
    "ScriptZ als Final-Draft-Alternative für Short-Form: andere Tools können vieles, was wir nicht können. Hier ist die Liste, was wir können, was sie nicht können:",
  "cmp.head.crit": "Was du brauchst",
  "cmp.row.format": "Format passiert ohne dich",
  "cmp.row.quick": "Quickmodus für 2 Sprecher",
  "cmp.row.chars": "Charaktere automatisch erkannt",
  "cmp.row.short": "Auf Short-Form ausgelegt",
  "cmp.row.length": "Zielbereich + Sprecher-Zeitleiste",
  "cmp.row.pipeline": "Pipeline von der Idee bis online",
  "cmp.row.noai": "Bewusst ohne KI",
  "cmp.row.local": "Kostenlos & lokal",
  "cmp.row.fast": "Auf in < 1 s",
  "cmp.mark.yes": "JA",
  "cmp.mark.no": "NEIN",
  "cmp.mark.feature": "Spielfilm",
  "cmp.mark.featureNo": "NEIN, Spielfilm",
  "cmp.mark.copilot": "Copilot",
  "cmp.mark.notionai": "Notion AI",
  "cmp.mark.isai": "Ist KI",
  "cmp.mark.beatai": "Beat AI",
  "cmp.mark.appleint": "Apple Int.",
  "cmp.mark.cloud": "Cloud",
  "cmp.mark.paid": "Bezahl",
  "cmp.mark.appleonly": "Apple-only",
  "cmp.mark.meh": "Naja",
  "cmp.mark.pages": "Seiten",
  "cmp.mark.diy": "Selbst bauen",
  "cmp.action2":
    "Wir können nichts davon ersetzen. Final Draft kann eine Spielfilm-Drehbuchabgabe an die WGA. Notion kann ein Wiki. ChatGPT kann dir ein Brainstorming generieren. Wir können: Skripte für Reels schnell. Das ist alles - und das wars uns wert.",

  // ===================== Tab: DOWNLOAD =====================
  "dl.caption": "INT. DOWNLOAD - SCRIPTZ KOSTENLOS FÜR MACOS UND WINDOWS",
  "dl.action1.mac":
    "macOS 13 oder neuer. Kostenlos. Open Source. Beim ersten Start: Rechtsklick aufs App-Icon → „Öffnen\". Apple verlangt das für unsignierte Apps. Updates kommen danach automatisch.",
  "dl.action1.win":
    "Windows 10 oder neuer. Kostenlos. Open Source. Beim ersten Start meldet sich SmartScreen - einmal „Weitere Informationen\" → „Trotzdem ausführen\", danach läuft alles automatisch. Updates kommen ohne Hürde.",
  "dl.eyebrow.os.mac": "macOS 13+",
  "dl.eyebrow.os.win": "Windows 10+",
  "dl.h": "Kostenlos. Lokal. Ohne Konto.",
  "dl.sub.mac":
    "Ein .dmg, keine Tracker, kein Sign-in, kein „Updates per E-Mail\". Du lädst die App runter, ziehst sie in den Programme-Ordner, und das wars.",
  "dl.sub.win":
    "Ein .exe-Installer, keine Tracker, kein Sign-in, kein „Updates per E-Mail\". Doppelklick, fertig.",
  "dl.cta.dmg": ".dmg herunterladen",
  "dl.cta.exe": ".exe herunterladen",
  "dl.cta.code": "Quellcode auf GitHub",
  "dl.fallback.label": "Andere Plattform? Alle Downloads auf GitHub →",
  "dl.stat.version": "aktuelle Version",
  "dl.stat.tracker": "Tracker",
  "dl.stat.accounts": "Konten",
  "dl.stat.ai": "KI",
  "dl.stat.dmg": ".dmg",
  "dl.stat.exe": ".exe",
  "dl.web.intro": "Lieber erst ausprobieren?",
  "dl.web.link": "Direkt im Browser testen →",
  "dl.web.sub": "Test-Editor, kein Konto, alles lokal in deinem Browser.",
  "dl.firstRun": "ERSTER START",
  "dl.action2.mac":
    "Beim ersten Öffnen meldet macOS, dass die App nicht überprüft werden kann. Das ist normal - ScriptZ ist Open Source und nicht bei Apple registriert. Einmal den Befehl unten im Terminal ausführen, danach läuft alles wie gewohnt.",
  "dl.action2.win":
    "Beim ersten Start meldet sich der Windows SmartScreen, dass die App nicht überprüft werden kann. Das ist normal - ScriptZ ist Open Source und hat (noch) kein EV-Code-Signing-Zertifikat. Mit zwei Klicks ist es gelöst.",
  "dl.fadeOut": "FADE OUT.",
  "dl.end": "ENDE",

  // ===================== Route: IDEEN =====================
  "ideas.h": "Ideen",
  "ideas.sub":
    "Sammle, was du als Nächstes schreiben willst - und mach daraus ein Skript, sobald die Idee Beine bekommt.",
  "ideas.meta": "{open} offen · {fresh} neu diese Woche",
  "ideas.input.placeholder": "Was willst du als Nächstes schreiben?",
  "ideas.input.hint": "⌘I geht von überall",
  "ideas.filter.placeholder": "Filtern",
  "ideas.chip.all": "Alle",
  "ideas.chip.none": "Ohne Ordner",
  "ideas.folder.tutorials": "Tutorials",
  "ideas.folder.compare": "Vergleiche",
  "ideas.folder.reels": "Reels",
  "ideas.group.week": "Diese Woche",
  "ideas.group.older": "Älter",
  "ideas.detail.top": "Idee · vor 2 Std.",
  "ideas.detail.folder": "Ordner",
  "ideas.detail.created": "Erstellt",
  "ideas.detail.createdValue": "heute, 06:14",
  "ideas.detail.move": "In Ordner …",
  "ideas.detail.delete": "Löschen",
  "ideas.keys.select": "wählen",
  "ideas.keys.edit": "bearbeiten",
  "ideas.keys.start": "als Skript anfangen",
  "ideas.detail.start": "Als Skript anfangen",
  "ideas.hint.before":
    "erfasst eine Idee von überall in der App, auch im Fokus-Modus. Eingeben, Enter, weiter. Die Ideen-Seite selbst ist für 50 und mehr Ideen gebaut: Ordner-Chips, Filter, Detail-Panel.",

  // Idea samples
  "ideas.sample.tutorial.title": "Tutorial: Vom leeren Cursor zum fertigen Skript in 5 Minuten",
  "ideas.sample.tutorial.body":
    "Screen-Recording mit Stoppuhr. Quickmodus aktivieren, einfach drauflos tippen, exportieren - fertig. Beweis statt Behauptung.",
  "ideas.sample.tutorial.age": "vor 2 Std.",
  "ideas.sample.fd.title": "Warum ich Final Draft für TikTok nicht mehr nutze",
  "ideas.sample.fd.body":
    "Lizenz, Drehbuch-Layout, Courier 12pt. Alles gebaut für 90 Min Film. Ich brauche 60 Sekunden.",
  "ideas.sample.fd.age": "vor 4 Std.",
  "ideas.sample.word.title": "Eine Schweigeminute für Word-Power-User",
  "ideas.sample.word.body":
    "Klick, klick, klick, klick. Einrückung manuell. Charakter-Name fett, neue Zeile, zentriert. Tab, tab, tab.",
  "ideas.sample.word.age": "vor 6 Std.",
  "ideas.sample.noai.title": "ScriptZ ohne KI - bewusst entschieden",
  "ideas.sample.noai.body":
    "Andere Tools schreiben dir das Skript. Wir schreiben dir gar nichts. Du bist der Creator, nicht das Modell.",
  "ideas.sample.noai.age": "vor 9 Std.",
  "ideas.sample.reel.title": "Reel: Quickmodus erklärt in 30 Sekunden",
  "ideas.sample.reel.body":
    "Two-hander Dialog. Enter drücken. Sprecher wechselt automatisch. Das wars.",
  "ideas.sample.reel.age": "vor 14 Std.",
  "ideas.sample.length.title": "Wie lang darf ein Reel sein?",
  "ideas.sample.length.body":
    "Zielbereich statt Bauchgefühl: 0:45 bis 1:05. Darunter ein leiser Hinweis, darüber Rotstift. Die Zeitleiste zeigt, wo gekürzt wird.",
  "ideas.sample.length.age": "vor 9 Tagen",

  // ===================== Footer =====================
  "footer.col.project": "Projekt",
  "footer.col.legal": "Recht",
  "footer.col.contact": "Kontakt",
  "footer.link.github": "GitHub",
  "footer.link.releases": "Releases",
  "footer.link.imprint": "Impressum",
  "footer.link.privacy": "Datenschutz",
  "footer.link.email": "E-Mail",
  "footer.about.eyebrow": "ÜBER SCRIPTZ",
  "footer.about.body":
    "Ein Skripteditor für Content Creator, der dir aus dem Weg geht. Format passiert beim Tippen, Charaktere werden automatisch erkannt, der Quickmodus spart pro Sprecherwechsel zwei Tastendrücke. Alles lokal, alles in einer SQLite-Datei auf deinem Computer. Keine Cloud, kein Konto, keine KI.",
  "footer.about.os.mac": "macOS 13+ · Open Source",
  "footer.about.os.win": "Windows 10+ · Open Source",

  // ===================== Runtime pill =====================

  "runpill.label": "Laufzeit",
  "runpill.title":
    "So lange dauert diese Seite gesprochen, bei 210 Wörtern pro Minute - so schätzt ScriptZ die Länge eines Skripts.",

  // ===================== Language toggle =====================
  "lang.toggle.aria": "Sprache wechseln",
  "lang.toggle.de": "DE",
  "lang.toggle.en": "EN",

  // ===================== Mobile navigation =====================
  // Dedicated top bar + full-screen drawer, visible only below 768 px.
  // Replaces the app-chrome tabs on mobile because the fake app frame
  // is hidden there.
  "mobilenav.brand": "ScriptZ",
  "mobilenav.open.aria": "Menü öffnen",
  "mobilenav.close.aria": "Menü schließen",
  "mobilenav.close.label": "Schließen",
  "mobilenav.section.pages": "Seiten",
  "mobilenav.section.legal": "Rechtliches",
  "mobilenav.section.language": "Sprache",
  "mobilenav.section.project": "Projekt",

  // ===================== Page meta =====================
  // Home (`/`) - stays the dominant brand entry.
  "meta.title": "ScriptZ - der Skripteditor für Content Creator",
  "meta.description":
    "Schreiben statt formatieren. Eine Idee → ein fertiges Skript in wenigen Minuten. Lokal, kostenlos, Open Source. Für TikTok, Reels und YouTube Shorts.",
  // Why route (`/warum-scriptz`)
  "meta.warum.title": "Warum ScriptZ - Skripteditor ohne Drehbuch-Korsett | für Reels und Shorts",
  "meta.warum.description":
    "ScriptZ ist für Content Creator gebaut, nicht für Drehbuchautoren. Format passiert beim Tippen, Charaktere werden erkannt, ein Zielbereich zeigt, ob das Skript zu lang wird. Für TikTok, Reels und YouTube Shorts.",
  // Quick-mode route (`/quickmodus`)
  "meta.quickmodus.title": "Quickmodus - Two-Hander-Workflow für Reels und Shorts | ScriptZ",
  "meta.quickmodus.description":
    "Der Quickmodus von ScriptZ schreibt Two-Hander-Dialoge automatisch: Enter springt zum nächsten Sprecher. Spart pro Skript eine Minute, ohne Tab und ohne Sprechernamen tippen.",
  // No-AI route (`/keine-ki`)
  "meta.noai.title": "Skripteditor ohne KI - das No-AI-Manifest | ScriptZ",
  "meta.noai.description":
    "ScriptZ hat bewusst keine KI eingebaut. Keine Vorschläge, kein „Verbessern\"-Button, kein Cloud-Upload. Deine Stimme bleibt deine, dein Skript bleibt lokal.",
  // Compare route (`/vergleich`)
  "meta.compare.title": "ScriptZ vs. Final Draft, Notion, ChatGPT - der ehrliche Vergleich",
  "meta.compare.description":
    "ScriptZ als kostenlose Final-Draft-Alternative für TikTok, Reels und Shorts. Was wir können, was Word, Notion, Final Draft, ChatGPT und Apple Notes nicht können - und umgekehrt.",
  // Download route (`/download`)
  "meta.download.title": "ScriptZ kostenlos herunterladen - macOS und Windows | Open Source",
  "meta.download.description":
    "Skripteditor für Content Creator. Kostenlos, lokal, Open Source. macOS 13+ (.dmg) oder Windows 10+ (.exe). Kein Konto, keine Tracker, keine KI.",
  // Ideas route (`/ideen`)
  "meta.ideas.title": "Ideen - was du als Nächstes schreibst | ScriptZ",
  "meta.ideas.description":
    "Sammle Skript-Ideen für TikTok, Reels und YouTube Shorts, sortiert nach Ordnern und mit ⌘I von überall erfasst. Ein Kürzel macht daraus ein Skript. Offline, ohne Konto, in der App und im Browser.",
  "meta.ogLocale": "de_DE",

  // ===================== Blog =====================
  // Footer entry (footer only, no top-nav tab).
  "footer.link.blog": "Blog",
  "footer.link.rss": "RSS-Feed",

  // Blog toolbar in AppShell.
  "blog.toolbar.title.index": "Blog - Notizen aus dem Skript-Editor",
  "blog.toolbar.title.post": "Blog",

  // Blog index.
  "blog.index.eyebrow": "BLOG // SCRIPTZ",
  "blog.index.h1": "Notizen aus dem Skript-Editor.",
  "blog.index.lead":
    "Gedanken, Release-Geschichten und der eine oder andere Trick aus dem Alltag mit ScriptZ. Im Format eines Skripts gesetzt - so wie der Editor selbst.",
  "blog.index.empty": "Noch keine Beiträge. Bald wird hier geschrieben.",
  "blog.index.rss.label": "RSS-Feed abonnieren",

  // Reading time and date.
  "blog.readingTime_one": "{n} Min Lesezeit",
  "blog.readingTime_other": "{n} Min Lesezeit",
  "blog.publishedOn": "Veröffentlicht am {date}",
  "blog.updatedOn": "Aktualisiert am {date}",
  "blog.author.by": "von {name}",

  // Post footer / navigation.
  "blog.back": "← Zurück zur Blog-Übersicht",
  "blog.share.h": "Teilen",

  // RSS feed meta.
  "blog.rss.title": "ScriptZ Blog",
  "blog.rss.description":
    "Notizen aus dem Skript-Editor für Content Creator. Releases, Workflow-Tricks und kleine Geschichten.",

  // Blog meta (page title + description for the blog index).
  "meta.blog.title": "Blog - Notizen aus dem Skript-Editor | ScriptZ",
  "meta.blog.description":
    "Der ScriptZ-Blog: Release-Geschichten, Workflow-Tipps für Reels und Shorts, und Notizen aus dem Alltag eines Skript-Editors für Content Creator.",
} as const;
