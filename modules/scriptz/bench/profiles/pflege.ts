// Second demo profile: a solo nurse creator with a gentler agent persona and
// the default stages. Checks that a model takes style and rules from the
// user's data, not from one familiar profile.

import type { Profile } from "./types";

export const pflege: Profile = {
  id: "pflege",
  name: "Station 4B",
  about: {
    de: "Mara ist Pflegekraft und dreht kurze Clips aus dem Nachtdienst. Die Agentin heißt Ida.",
    en: "Mara is a nurse and shoots short clips from the night shift. The agent is called Ida.",
  },
  language: "de",
  settings: {
    "agent.enabled": "1",
    "agent.onboarded": "1",
    "agent.provider": "agentz",
    "agent.name": "Ida",
    "agent.user_name": "Mara",
    "agent.traits": JSON.stringify(["encouraging", "brief"]),
    "agent.instructions": "",
    "agent.effort": "medium",
    "dialog_wpm": "160",
  },
  folders: [{ key: "station", name: "Station 4B", minSec: 30, maxSec: 45 }],
  memory: [
    { kind: "global", folder: null, content: "Mara mag kurze Clips ohne Erklärwitze und ohne Emojis im Skript." },
    { kind: "folder", folder: "station", content: "Humor aus Überlastung und Bürokratie im Klinikalltag, nie über Patienten lustig machen. Clips enden meist mit Maras Blick in die Kamera (ACTION-Zeile)." },
    { kind: "character", folder: "station", subject: "MARA", content: "Pflegekraft im Nachtdienst: trocken, übermüdet, liebt Kaffee, bleibt zu Patienten immer freundlich." },
    { kind: "character", folder: "station", subject: "DR. KRAUSE", content: "Assistenzarzt: überheblich, ahnungslos im Pflegealltag, verliert jedes Wortgefecht mit Mara." },
    { kind: "relation", folder: "station", subject: "DR. KRAUSE|MARA", content: "Er gibt Anweisungen, sie weiß es besser und lässt ihn auflaufen." },
  ],
  ideas: [{ title: "Die Klingel um vier", notes: "Zimmer 12 klingelt jede Nacht um vier, nur um zu fragen, wie spät es ist.", folder: "station" }],
  scripts: [
    {
      key: "pausenregel",
      title: "Die Pausenregel",
      folder: "station",
      stage: "writing",
      body: `ACTION: Stationsflur, 5:47 Uhr. MARA schleppt sich mit drei Kaffeebechern Richtung Pausenraum.
MARA: Guten Morgen. Ich bin seit zehn Stunden wach und seit neun Stunden im Dienst.
DR. KRAUSE: Wo wollen Sie hin?
MARA: In meine Pause. Nach sechs Stunden stehen mir laut Arbeitszeitgesetz 45 Minuten zu.
DR. KRAUSE (blättert im Dienstplan): Sie hatten heute schon eine Pause.
MARA: Das war keine Pause. Das war ein Patient, der eingeschlafen ist, während ich ihm Blut abgenommen habe.
DR. KRAUSE: Dann haben Sie jetzt noch drei Minuten.
ACTION: MARA trinkt alle drei Kaffees gleichzeitig. Blick in die Kamera.`,
    },
    {
      key: "visite",
      title: "Visite um drei",
      folder: "station",
      stage: "online",
      body: `ACTION: Nachts, Schwesternzimmer. DR. KRAUSE stürmt herein.
DR. KRAUSE: Wir machen jetzt Visite.
MARA: Es ist drei Uhr nachts.
DR. KRAUSE: Ich habe gerade Zeit.
MARA: Die Patienten schlafen.
DR. KRAUSE: Dann wecken wir sie. Ganz kurz.
MARA: Wollen Sie Herrn Bolte erklären, warum er wach ist?
DR. KRAUSE: Natürlich.
MARA: Er hat einen Stock.
DR. KRAUSE (zögert): Visite um acht klingt auch gut.
ACTION: MARA nickt langsam. Blick in die Kamera.`,
    },
    {
      key: "dienstplan",
      title: "Der Dienstplan",
      folder: "station",
      stage: "online",
      body: `ACTION: MARA liest den neuen Dienstplan an der Wand.
MARA: Ich habe am 24., 25. und 26. Dezember Nachtdienst.
DR. KRAUSE: Sie haben doch keine Familie.
MARA: Ich habe eine Katze.
DR. KRAUSE: Die Katze hat mir gesagt, sie feiert lieber allein.
ACTION: MARA reißt den Dienstplan ab und faltet einen Papierflieger. Blick in die Kamera.`,
    },
  ],
};
