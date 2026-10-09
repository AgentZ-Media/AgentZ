// Demo profile modeled on the AgentZ channel: Timo and Axel, workplace,
// authority and service satire, almost pure dialog. The scripts are written
// for the benchmark; several carry a deliberate weak spot for a task (slow
// opening with a legal claim, too long, weak ending, flat voice, a new
// character to learn).

import type { Profile } from "./types";

export const agentz: Profile = {
  id: "agentz",
  name: "AgentZ",
  about: {
    de: "Timo und Axel drehen Comedy-Sketche über Chefs, Ämter und Kundenservice. Der Agent heißt Paul.",
    en: "Timo and Axel shoot comedy sketches about bosses, offices and customer service. The agent is called Paul.",
  },
  language: "de",
  settings: {
    "agent.enabled": "1",
    "agent.onboarded": "1",
    "agent.provider": "agentz",
    "agent.name": "Paul",
    "agent.user_name": "Timo",
    "agent.traits": JSON.stringify(["direct", "dry", "critical"]),
    "agent.instructions": "Duz mich und denk menschlich, nicht wie ein Wikipedia-Artikel oder eine Reportage.",
    "agent.effort": "medium",
    "agent.learn_stage": "ready",
    "dialog_wpm": "180",
    "script_stages": JSON.stringify([{ id: "writing" }, { id: "ready" }, { id: "online", label: "Fertig" }]),
  },
  folders: [
    { key: "agentz", name: "AgentZ", minSec: 20, maxSec: 90 },
    { key: "werbung", name: "Werbung", minSec: 10, maxSec: 30 },
  ],
  memory: [
    { kind: "folder", folder: "agentz", content: "Arbeitsplatzsketche starten direkt im Konflikt: kurze Rückfragen, Spiegelungen und abgebrochene Chef-Einwände takten den Dialog. Timo dreht Axels Logik gegen ihn, bis Axel sich selbst widerspricht." },
    { kind: "folder", folder: "agentz", content: "Behördensatire: ein alltägliches Anliegen wird zum ausweglosen Regelkreis. Jede sachliche Lösung erzeugt eine neue Hürde, die Schlusspointe schließt den Kreis." },
    { kind: "folder", folder: "agentz", content: "Dienstleistungssatire: ein kleiner Kundenwunsch eskaliert durch Axels eigenmächtige Hilfe. Wiederholtes Notieren oder Tippen taktet den Dialog, Axel übersetzt Timos Einwände in absurde Akteneinträge." },
    { kind: "folder", folder: "agentz", content: "Politische Entscheidungen werden als Büroregeln im Kleinen gespiegelt: Axel übernimmt Schlagwörter der Regierung für eigene Vorteile, Timo legt die Parallele offen." },
    { kind: "folder", folder: "agentz", content: "Fast nur Dialog, kaum ACTION-Zeilen. Regie steht in kurzen Klammern, Lautstärke in GROSSBUCHSTABEN, Unterbrechungen mit „...“." },
    { kind: "character", folder: "agentz", subject: "AXEL", content: "Satirischer Chef: geizig, selbstgerecht, misstrauisch; verharmlost Mehrarbeit und verrät Luxusinteressen (Leasing, Urlaub). Bei Gegenwehr hilflos oder autoritär." },
    { kind: "character", folder: "agentz", subject: "AXEL", content: "Als Behördenmitarbeiter genervt und herablassend, berlinert („dit“, „ick“, „wa“, „se“). Verweist auf Zuständigkeiten und neue Termine, beendet Einwände mit „DER NÄCHSTE BITTE“." },
    { kind: "character", folder: "agentz", subject: "AXEL", content: "Als Dienstleister oder Vermieter freundlich-dreist: verkauft Probleme als Hilfe und wiederholt Standardantworten trotz Gegenbeweisen." },
    { kind: "character", folder: "agentz", subject: "AXEL", content: "In Chefsketchen kann Axels Gestammel die Schlusspointe tragen: Er findet keine Ausrede mehr und verliert sichtbar. Diesen Schluss nicht wegkürzen." },
    { kind: "character", folder: "agentz", subject: "TIMO", content: "In Arbeitsplatzsketchen schlagfertig und gelassen respektlos: dreht Cheflogik um, verteidigt Freizeit und Bezahlung, entlarvt Axel mit Gegenfragen." },
    { kind: "character", folder: "agentz", subject: "TIMO", content: "In Behördensketchen der höfliche Bürger, der logisch nachfragt und zunehmend genervt ist; ein resigniertes „Fuck my life“ ist ein wiederkehrender Schluss." },
    { kind: "relation", folder: "agentz", subject: "AXEL|TIMO", content: "Außerhalb der Sketche ziehen beide an einem Strang: Timo stichelt gegen Axel als Chef, Axel spielt mit." },
    { kind: "folder", folder: "werbung", content: "Eigenwerbung: kurze, abwechselnde Kameraansprache mit direktem Aufruf, endet mit „Weiter mit dem Video“. Chef-Mitarbeiter-Spitzen sind erlaubt." },
  ],
  ideas: [
    { title: "Die Online-Terminvergabe", notes: "Termine gibt es nur noch online. Das Portal schaltet man aber nur mit einem Termin frei.", folder: "agentz" },
    { title: "Homeoffice-Beweisfoto", notes: "Axel will alle zehn Minuten ein Foto, dass Timo im Homeoffice arbeitet. Timo schickt Fotos von Axel, der im Büro nichts tut.", folder: "agentz" },
    { title: "Kundennummer bitte", notes: "Hotline fragt bei jeder Weiterleitung erneut nach der Kundennummer, am Ende landet Timo wieder bei der ersten Stimme.", folder: "agentz" },
  ],
  scripts: [
    {
      key: "vier-tage",
      title: "Vier-Tage-Woche",
      folder: "agentz",
      stage: "online",
      body: `AXEL: Timo! Gute Nachricht. Wir führen die Vier-Tage-Woche ein.
TIMO: Echt jetzt?
AXEL: Echt jetzt. Montag bis Donnerstag.
TIMO: Und wie viele Stunden?
AXEL: Vierzig. Wie immer.
TIMO: Also zehn Stunden am Tag.
AXEL: Zehn Stunden Arbeit, dafür drei Tage FREI.
TIMO: Und Freitag?
AXEL: Freitag ist frei. Freiwillig.
TIMO: Freiwillig frei oder freiwillig da?
AXEL (räuspert sich): Freiwillig da. Aber frei im Kopf.
TIMO: Und Samstag?
AXEL: Samstag kommen nur die, die das Team lieben.
TIMO: Axel, das ist eine Sechs-Tage-Woche mit mehr Stunden.
AXEL: Das ist eine Vier-Tage-Woche mit ZUSATZANGEBOT.
TIMO: Dann nehme ich das Angebot nicht an.
AXEL: Dann bist du kein Teamplayer.
TIMO: Ich bin Vier-Tage-Player.
AXEL: Das... das gibt es nicht.
TIMO: Hast du doch gerade eingeführt.
AXEL: Ja, aber... für die anderen!
TIMO: Schönes Wochenende, Axel. Ab Donnerstag.`,
    },
    {
      key: "meldebescheinigung",
      title: "Die Meldebescheinigung",
      folder: "agentz",
      stage: "online",
      body: `TIMO: Guten Tag, ich bräuchte eine Meldebescheinigung.
AXEL (ohne aufzusehen): Haben se nen Termin?
TIMO: Ja, hier. 9:40 Uhr.
AXEL: Dit is 9:41.
TIMO: Ich stand seit 9:20 vor Ihrer Tür.
AXEL: Vor der Tür is nich im Termin.
TIMO: Ich brauche wirklich nur einen Ausdruck.
AXEL: Dafür brauchen se ne Meldebescheinigung.
TIMO: Genau die will ich ja.
AXEL: Nee, ick meine ne ALTE. Damit wa sehen, dass se gemeldet sind.
TIMO: Wenn ich die hätte, wäre ich nicht hier.
AXEL: Wat soll ick denn machen? Dit is Vorschrift.
TIMO: Können Sie nicht einfach in den Computer gucken?
AXEL: Kann ick. Darf ick aber nich ohne Antrag.
TIMO: Dann stelle ich einen Antrag.
AXEL: Jerne. Dafür brauchen se nen Termin.
TIMO: Ich HABE einen Termin.
AXEL: Ja. Für die Meldebescheinigung. Nich für den Antrag.
TIMO (atmet durch): Wann ist der nächste Termin für den Antrag?
AXEL: Ick gucke. In sechs Wochen. Mit Meldebescheinigung.
TIMO: Fuck my life.
AXEL: DER NÄCHSTE BITTE.`,
    },
    {
      key: "handwerker",
      title: "Der Handwerkertermin",
      folder: "agentz",
      stage: "online",
      body: `AXEL: Kundenservice Heizwerk, Sie sprechen mit Axel, wie kann ick... wie kann ich helfen?
TIMO: Meine Heizung ist seit drei Tagen aus.
AXEL (tippt): Kunde friert. Seit wann genau?
TIMO: Seit drei Tagen. Hab ich doch gesagt.
AXEL (tippt): Kunde wiederholt sich.
TIMO: Wann kann ein Techniker kommen?
AXEL: Der nächste Termin wäre Donnerstag zwischen sieben und neunzehn Uhr.
TIMO: Zwölf Stunden? Ich muss arbeiten.
AXEL (tippt): Kunde nicht verfügbar.
TIMO: Doch! Nur nicht zwölf Stunden am Stück!
AXEL: Dann empfehle ich unser Premium-Zeitfenster. Zwei Stunden, 89 Euro.
TIMO: Ich bezahle schon für die Wartung.
AXEL: Die Wartung deckt die Heizung ab. Nicht die Uhrzeit.
TIMO: Und wenn ich einfach Donnerstag frei nehme?
AXEL (tippt): Kunde nimmt Urlaub für Heizung. Sehr gut. Dann haben Sie jetzt Zeit für unsere Kundenzufriedenheitsumfrage?
TIMO: Nein.
AXEL (tippt): Kunde... sehr zufrieden.`,
    },
    {
      key: "inflationsausgleich",
      title: "Inflationsausgleich",
      folder: "agentz",
      stage: "online",
      body: `TIMO: Axel, kriege ich die Inflationsausgleichsprämie?
AXEL: Selbstverständlich. Wir gleichen die Inflation aus.
TIMO: Super. Wie viel?
AXEL: Ich habe die Preise in der Kaffeeküche erhöht.
TIMO: Das ist doch keine Prämie!
AXEL: Doch. Jetzt passt der Kaffee wieder zur Inflation.
TIMO: Und mein Gehalt?
AXEL: Das ist zu klein für Inflation.
TIMO: Die Regierung sagt, Arbeitgeber sollen entlasten.
AXEL: Mache ich. Mich.
TIMO: Und wer entlastet mich?
AXEL (zeigt auf die Kaffeemaschine): Dafür gibt es jetzt Kaffee mit Hafermilch.
TIMO: Für 3,50.
AXEL: Ausgeglichen.`,
    },
    {
      key: "krankmeldung",
      title: "Krankmeldung per Sprachnachricht",
      folder: "agentz",
      stage: "writing",
      body: `ACTION: Büro, Montagmorgen. AXEL sitzt am Schreibtisch, TIMO kommt mit Jacke rein.
AXEL: Moin Timo.
TIMO: Moin Axel.
AXEL: Na, wie war dein Wochenende?
TIMO: Ganz okay. Und deins?
AXEL: Auch okay. Hab das Auto waschen lassen.
TIMO: Schön.
AXEL: Sag mal, du hast mir Freitag eine Sprachnachricht geschickt.
TIMO: Ja, ich war krank.
AXEL: Eine SPRACHNACHRICHT. Hustend.
TIMO: Ich war ja auch krank.
AXEL: Und nur damit das klar ist: Laut Gesetz brauchst du ab dem ersten Tag eine Krankschreibung vom Arzt.
TIMO: Ich war beim Arzt. Der hat mich krankgeschrieben.
AXEL: Und warum hab ich die nicht?
TIMO: Kommt digital. Von der Krankenkasse.
AXEL: Ich will aber Papier.
TIMO: Dann druck sie aus.
AXEL: Mit MEINEM Drucker? Weißt du, was Toner kostet?
TIMO: Ungefähr so viel wie deine Autowäsche.
AXEL (empört): Das war eine PREMIUMwäsche!
TIMO: Dann bin ich jetzt Premium-krank.`,
    },
    {
      key: "mitarbeitergespraech",
      title: "Das Mitarbeitergespräch",
      folder: "agentz",
      stage: "writing",
      body: `AXEL: Timo, setz dich. Jährliches Mitarbeitergespräch.
TIMO: Okay. Ich hätte da auch ein paar Punkte.
AXEL: Später. Erst mal das Positive. Du bist pünktlich.
TIMO: Danke.
AXEL: Fast zu pünktlich. Du gehst auch pünktlich.
TIMO: Das gehört zu pünktlich dazu.
AXEL: Ein Mitarbeiter, der wirklich brennt, der geht nicht pünktlich. Der bleibt einfach. Der merkt gar nicht, wie spät es ist, weil er so in seiner Arbeit aufgeht, weißt du, so wie ich früher, als ich noch selbst gearbeitet habe.
TIMO: Du hast selbst gearbeitet?
AXEL: Das tut jetzt nichts zur Sache. Zweiter Punkt: Engagement. Ich habe gesehen, dass du in der Mittagspause Mittag machst.
TIMO: Deswegen heißt sie so.
AXEL: Andere nutzen die Pause, um noch schnell Mails zu beantworten. Oder um mir einen Kaffee mitzubringen. Das sind so kleine Gesten, die zeigen, dass jemand mitdenkt, dass jemand das große Ganze im Blick hat und nicht nur sich selbst.
TIMO: Willst du einen Kaffee?
AXEL: Jetzt ist es zu spät, jetzt ist es nicht mehr von Herzen. Dritter Punkt: Weiterentwicklung. Wo siehst du dich in fünf Jahren?
TIMO: Mit mehr Gehalt.
AXEL: Interessant, dass du das Thema Gehalt ansprichst. Das wollte ich nämlich auch ansprechen. Die wirtschaftliche Lage ist angespannt, die Kosten steigen überall, Energie, Miete, Leasing, und da müssen wir alle ein bisschen zusammenrücken und zeigen, dass wir ein Team sind.
TIMO: Welches Leasing?
AXEL: Das Firmenleasing. Für den Firmenwagen.
TIMO: Den fährst du doch privat.
AXEL: Ich fahre ihn auch privat. Das ist ein Unterschied. Vierter Punkt: Deine Punkte. Du hattest Punkte?
TIMO: Ja. Erstens eine Gehaltserhöhung, zweitens Homeoffice am Freitag, drittens die Überstunden vom letzten Jahr.
AXEL: Erstens nein, zweitens nein, drittens welche Überstunden?
TIMO: Die achtzig Stunden, die du mir auszahlen wolltest.
AXEL: Das war doch ein Witz. Das war Teambuilding.
TIMO: Dann bin ich ab Freitag im Teambuilding. Von zu Hause.
AXEL: Das... das geht so nicht. Das ist... das ist nicht...
TIMO: Lass dir Zeit. Ich bin ja pünktlich.
AXEL: Das Gespräch ist beendet!
TIMO: Ich weiß. Ist ja auch schon fünf.`,
    },
    {
      key: "teambuilding",
      title: "Das Teambuilding",
      folder: "agentz",
      stage: "ready",
      body: `AXEL: Timo, am Samstag ist Teambuilding.
TIMO: Samstag ist mein freier Tag.
AXEL: Genau. Deshalb ist es ja Teambuilding und nicht Arbeit.
TIMO: Was machen wir denn?
AXEL: Wir streichen gemeinsam das Büro.
TIMO: Das ist Renovieren.
AXEL: Mit Pizza.
TIMO: Wer bezahlt die Pizza?
AXEL: Jeder seine eigene. Das stärkt die Eigenverantwortung.
TIMO: Und was machst du?
AXEL: Ich koordiniere. Vom Liegestuhl.
TIMO: Und wenn ich nicht komme?
AXEL: Dann bist du nicht im Team.
TIMO: Und wenn ich komme?
AXEL: Dann bist du im Team und streichst.
TIMO: Also Arbeit ohne Geld.
AXEL: Nein, Teambuilding.
TIMO: Axel, das ist einfach unbezahlte Arbeit am Wochenende, die du Teambuilding nennst, damit du keine Handwerker bezahlen musst.
AXEL: Ja. Genau. So kann man das auch sehen.`,
    },
    {
      key: "personalausweis",
      title: "Der Personalausweis",
      folder: "agentz",
      stage: "writing",
      body: `TIMO: Hallo, ich möchte meinen Personalausweis abholen.
AXEL: Guten Tag. Haben Sie den Abholschein dabei?
TIMO: Den habe ich nie bekommen.
AXEL: Ohne Abholschein kann ich Ihnen den Ausweis leider nicht aushändigen.
TIMO: Er liegt doch da hinten. Ich sehe mein Foto.
AXEL: Das mag sein, aber die Vorschriften sind da eindeutig.
TIMO: Wie bekomme ich den Abholschein?
AXEL: Der Abholschein wird Ihnen per Post zugeschickt, sobald der Ausweis da ist.
TIMO: Der Ausweis ist da.
AXEL: Dann sollte der Abholschein bald kommen.
TIMO: Kann ich mich nicht einfach ausweisen?
AXEL: Womit denn?
TIMO: Mit dem Ausweis.
AXEL: Den haben Sie ja noch nicht.
TIMO: Fuck my life.`,
    },
    {
      key: "fitnessstudio",
      title: "Die Fitnessstudio-Kündigung",
      folder: "agentz",
      stage: "ready",
      body: `TIMO: Hallo, ich möchte meinen Vertrag kündigen.
AXEL: Kündigen? Sie meinen pausieren.
TIMO: Nein. Kündigen.
AXEL: PAMPOWSKI, der Herr möchte pausieren.
PAMPOWSKI (nickt): Pausieren. Sehr vernünftig.
TIMO: Ich möchte nicht pausieren. Ich war seit einem Jahr nicht hier.
AXEL: Dann sind Sie ja schon in der Pause. Die verlängern wir einfach.
PAMPOWSKI (nickt): Verlängern. Sehr vernünftig.
TIMO: Ich will raus aus dem Vertrag!
AXEL: Das geht nur schriftlich. Per Fax.
TIMO: Wer hat denn noch ein Fax?
AXEL: Wir. Steht im Keller.
PAMPOWSKI: Ist kaputt.
AXEL: Seit wann?
PAMPOWSKI: Seit es Kündigungen gibt.
AXEL (zu Timo): Dann bleibt nur die Online-Kündigung.
TIMO: Super. Wo ist der Button?
AXEL: Im Mitgliederbereich. Unter Training, dann Motivation, dann Ehrlich jetzt?
TIMO: Ehrlich jetzt.
AXEL: Und dann bestätigen Sie mit Ihrem Trainingsplan.
TIMO: Ich habe keinen Trainingsplan.
AXEL: Dann sind Sie nicht aktiv genug zum Kündigen.
PAMPOWSKI (nickt): Sehr vernünftig.`,
    },
    {
      key: "kanalmitglied",
      title: "Kanalmitglied werden",
      folder: "werbung",
      stage: "online",
      body: `TIMO: Dieses Video gibt es nur, weil du uns unterstützt.
AXEL: Genauer gesagt die Kanalmitglieder.
TIMO: Für 4,99 im Monat siehst du jedes Video eine Woche früher.
AXEL: Und du finanzierst meinen Firmenwagen.
TIMO: Ne Gehaltserhöhung wäre zu viel verlangt, oder?
AXEL: Ganz genau.
TIMO: Link ist in der Beschreibung.
AXEL: Oder der Mitglied-werden-Button.
TIMO: Danke dir. Weiter mit dem Video.`,
    },
  ],
};
