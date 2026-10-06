// Numbers for the ScriptZ demo window. The server renders the finished
// sketch with them; the browser recomputes them while the sketch is typed.
import type { DemoBlock } from "../i18n";

export interface DemoStats {
  seconds: number;
  words: number;
  dialogWords: number;
  switches: number;
  cast: { name: string; color: number; share: number }[];
  /** Timeline segments: `color` 0 is action, otherwise the character colour. */
  segments: { color: number; weight: number }[];
}

const count = (text: string) => text.split(/\s+/).filter(Boolean).length;

/** Same speed the app assumes for short-form dialogue, close enough for a demo. */
const SECONDS_PER_WORD = 0.32;

export function demoStats(blocks: readonly DemoBlock[]): DemoStats {
  const colors = new Map<string, number>();
  const spoken = new Map<string, number>();
  const segments: DemoStats["segments"] = [];
  let words = 0;
  let dialogWords = 0;
  let switches = 0;
  let speaker = "";
  let lastSpeaker = "";
  for (const [kind, text] of blocks) {
    const n = count(text);
    if (kind === "c") {
      speaker = text;
      if (!colors.has(text)) colors.set(text, colors.size + 1);
      continue;
    }
    words += n;
    if (kind === "d") {
      dialogWords += n;
      spoken.set(speaker, (spoken.get(speaker) ?? 0) + n);
      if (lastSpeaker && lastSpeaker !== speaker && n > 0) switches += 1;
      if (n > 0) lastSpeaker = speaker;
    }
    if (kind !== "p" && n > 0) segments.push({ color: kind === "a" ? 0 : colors.get(speaker) ?? 0, weight: n });
  }
  const cast = [...colors].map(([name, color]) => ({
    name,
    color,
    share: dialogWords ? Math.round(((spoken.get(name) ?? 0) / dialogWords) * 100) : 0,
  }));
  return { seconds: Math.round(words * SECONDS_PER_WORD), words, dialogWords, switches, cast, segments };
}

export const formatTime = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
