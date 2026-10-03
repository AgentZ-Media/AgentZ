// Welcome/tutorial script per language. Persisted as script content +
// title by the welcome seeder on the first app start (see
// lib/welcome.ts). Language is chosen at seed time based on the current
// i18n language - a later language switch does not translate the
// already-existing tutorial script text retroactively, because that's
// already user content (the user can edit the text).
//
// Hotkeys run through K() / formatHotkey() from lib/keys, so
// Windows / Linux users see "Ctrl+N" instead of "Cmd+N" - otherwise
// the tutorial would give wrong instructions there.

import { K } from "../lib/keys";
import type { Language } from "./index";

interface WelcomeContent {
  title: string;
  json: string;
}

interface BlockOptions {
  characterName?: string | null;
}

function textBlock(type: string, text: string, opts: BlockOptions = {}) {
  return {
    type,
    version: 1,
    direction: null,
    format: "",
    indent: 0,
    characterName: opts.characterName ?? "",
    children: [
      {
        detail: 0,
        format: 0,
        mode: "normal",
        style: "",
        text,
        type: "text",
        version: 1,
      },
    ],
  };
}

function buildJson(blocks: ReturnType<typeof textBlock>[]): string {
  return JSON.stringify({
    root: {
      type: "root",
      version: 1,
      direction: null,
      format: "",
      indent: 0,
      children: blocks,
    },
  });
}

// Both tutorials are written as a tiny office sketch so the first thing a
// new user sees looks like what they will write: short-form, two people,
// a punchline. Only the three block types exist (Action, Character,
// Dialog); delivery cues go into an action line in parentheses.

function deWelcome(): WelcomeContent {
  const k1 = K("Mod+1");
  const k2 = K("Mod+2");
  const k3 = K("Mod+3");
  const kB = K("Mod+B");
  const kU = K("Mod+U");
  const kK = K("Mod+K");
  const kN = K("Mod+N");
  const kI = K("Mod+I");
  const kJ = K("Mod+J");
  const kStage = K("Mod+Alt+ArrowRight");
  const kFocus = K("Mod+Shift+F");
  const kE = K("Mod+E");
  const kSnap = K("Mod+Shift+S");
  const kHist = K("Mod+Shift+H");
  const kSettings = K("Mod+,");
  return {
    title: "Willkommen bei ScriptZ",
    json: buildJson([
      textBlock(
        "scriptz-action",
        "Büro, Montagmorgen. LENA steht vor der Kaffeemaschine. TOM kommt mit einem Laptop unter dem Arm rein.",
      ),
      textBlock("scriptz-character", "TOM", { characterName: "TOM" }),
      textBlock(
        "scriptz-dialog",
        "Das hier ist ein Tutorial. Du kannst alles ändern, löschen oder ausprobieren - es gehört jetzt dir.",
      ),
      textBlock("scriptz-character", "LENA", { characterName: "LENA" }),
      textBlock(
        "scriptz-dialog",
        "Es gibt genau drei Blocktypen: Action für das, was man sieht, Charakter für den Namen und Dialog für das, was gesagt wird.",
      ),
      textBlock("scriptz-character", "TOM", { characterName: "TOM" }),
      textBlock(
        "scriptz-dialog",
        "Drück am Ende eines Dialogs Enter, dann kommt der nächste Charakter. Nach dem Namen geht's mit Enter direkt in den Dialog.",
      ),
      textBlock("scriptz-character", "LENA", { characterName: "LENA" }),
      textBlock("scriptz-action", "(flüstert)"),
      textBlock(
        "scriptz-dialog",
        "Regieanweisungen schreibst du einfach als Action-Zeile in Klammern.",
      ),
      textBlock(
        "scriptz-action",
        `TOM tippt auf den Bildschirm. Tab öffnet das Blocktyp-Menü, ${k1} macht eine Action, ${k2} einen Charakter, ${k3} einen Dialog.`,
      ),
      textBlock("scriptz-character", "TOM", { characterName: "TOM" }),
      textBlock(
        "scriptz-dialog",
        "Jeder neue Name bekommt automatisch eine eigene Farbe. Die Laufzeit siehst du beim Schreiben mit.",
      ),
      textBlock("scriptz-character", "LENA", { characterName: "LENA" }),
      textBlock("scriptz-dialog", "Und die Kaffeemaschine?"),
      textBlock("scriptz-character", "TOM", { characterName: "TOM" }),
      textBlock("scriptz-dialog", "Ist auch nur ein Action-Block."),
      textBlock("scriptz-action", "Schnitt. Die wichtigsten Tasten:"),
      textBlock("scriptz-action", `${k1} / ${k2} / ${k3} - Action, Charakter, Dialog`),
      textBlock("scriptz-action", "Tab - Blocktyp wählen · Enter - nächster passender Block"),
      textBlock("scriptz-action", `${kB} / ${kU} - fett / unterstrichen`),
      textBlock("scriptz-action", `${kK} - suchen und Befehle`),
      textBlock("scriptz-action", `${kN} - neues Skript`),
      textBlock("scriptz-action", `${kI} - Idee festhalten, egal wo du gerade bist`),
      textBlock("scriptz-action", `${kJ} - Zeitleiste: wer redet wann`),
      textBlock("scriptz-action", `${kStage} - nächste Stufe: Schreiben, Drehbereit, Gedreht, Online`),
      textBlock("scriptz-action", `${kFocus} - Fokus-Modus`),
      textBlock("scriptz-action", `${kE} - als PDF oder Text exportieren`),
      textBlock("scriptz-action", `${kSnap} - Version sichern · ${kHist} - Versionen ansehen`),
      textBlock("scriptz-action", `${kSettings} - Einstellungen`),
      textBlock(
        "scriptz-action",
        "Alles bleibt lokal auf deinem Gerät. Kein Konto, keine Cloud, keine Telemetrie. Wenn du das Tutorial nicht mehr brauchst, leg es einfach in den Papierkorb.",
      ),
      textBlock("scriptz-character", "LENA", { characterName: "LENA" }),
      textBlock("scriptz-dialog", "Viel Spaß beim Schreiben."),
    ]),
  };
}

function enWelcome(): WelcomeContent {
  const k1 = K("Mod+1");
  const k2 = K("Mod+2");
  const k3 = K("Mod+3");
  const kB = K("Mod+B");
  const kU = K("Mod+U");
  const kK = K("Mod+K");
  const kN = K("Mod+N");
  const kI = K("Mod+I");
  const kJ = K("Mod+J");
  const kStage = K("Mod+Alt+ArrowRight");
  const kFocus = K("Mod+Shift+F");
  const kE = K("Mod+E");
  const kSnap = K("Mod+Shift+S");
  const kHist = K("Mod+Shift+H");
  const kSettings = K("Mod+,");
  return {
    title: "Welcome to ScriptZ",
    json: buildJson([
      textBlock(
        "scriptz-action",
        "Office, Monday morning. LENA stands at the coffee machine. TOM walks in, laptop under his arm.",
      ),
      textBlock("scriptz-character", "TOM", { characterName: "TOM" }),
      textBlock(
        "scriptz-dialog",
        "This is a tutorial. Change it, delete it, play with it - it's yours now.",
      ),
      textBlock("scriptz-character", "LENA", { characterName: "LENA" }),
      textBlock(
        "scriptz-dialog",
        "There are exactly three block types: Action for what we see, Character for the name and Dialog for what is said.",
      ),
      textBlock("scriptz-character", "TOM", { characterName: "TOM" }),
      textBlock(
        "scriptz-dialog",
        "Press Enter at the end of a line of dialog and the next character comes up. After the name, Enter takes you straight into the dialog.",
      ),
      textBlock("scriptz-character", "LENA", { characterName: "LENA" }),
      textBlock("scriptz-action", "(whispers)"),
      textBlock(
        "scriptz-dialog",
        "Delivery cues are simply an action line in parentheses.",
      ),
      textBlock(
        "scriptz-action",
        `TOM taps the screen. Tab opens the block type menu, ${k1} makes an action, ${k2} a character, ${k3} a dialog.`,
      ),
      textBlock("scriptz-character", "TOM", { characterName: "TOM" }),
      textBlock(
        "scriptz-dialog",
        "Every new name gets its own color automatically. The runtime updates as you write.",
      ),
      textBlock("scriptz-character", "LENA", { characterName: "LENA" }),
      textBlock("scriptz-dialog", "And the coffee machine?"),
      textBlock("scriptz-character", "TOM", { characterName: "TOM" }),
      textBlock("scriptz-dialog", "Just another action block."),
      textBlock("scriptz-action", "Cut. The keys that matter:"),
      textBlock("scriptz-action", `${k1} / ${k2} / ${k3} - action, character, dialog`),
      textBlock("scriptz-action", "Tab - pick a block type · Enter - next fitting block"),
      textBlock("scriptz-action", `${kB} / ${kU} - bold / underline`),
      textBlock("scriptz-action", `${kK} - search and commands`),
      textBlock("scriptz-action", `${kN} - new script`),
      textBlock("scriptz-action", `${kI} - capture an idea, wherever you are`),
      textBlock("scriptz-action", `${kJ} - timeline: who speaks when`),
      textBlock("scriptz-action", `${kStage} - next stage: Writing, Ready to shoot, Shot, Online`),
      textBlock("scriptz-action", `${kFocus} - focus mode`),
      textBlock("scriptz-action", `${kE} - export as PDF or text`),
      textBlock("scriptz-action", `${kSnap} - save a version · ${kHist} - browse versions`),
      textBlock("scriptz-action", `${kSettings} - settings`),
      textBlock(
        "scriptz-action",
        "Everything stays local on your device. No account, no cloud, no telemetry. When you no longer need this tutorial, just move it to the trash.",
      ),
      textBlock("scriptz-character", "LENA", { characterName: "LENA" }),
      textBlock("scriptz-dialog", "Happy writing."),
    ]),
  };
}

export function getWelcomeContent(lang: Language): WelcomeContent {
  return lang === "en" ? enWelcome() : deWelcome();
}
