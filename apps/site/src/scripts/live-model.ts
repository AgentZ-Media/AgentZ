// Timeline lanes for the live ScriptZ rebuild. The server renders them for
// the finished sketch; the browser recomputes them on every edit.
import type { DemoBlock } from "../i18n";
import { demoStats } from "./demo-model";

export interface Lane { name: string; color: number; items: { start: number; length: number }[] }
export interface Timeline { seconds: number; scale: number; hook: number | null; lanes: Lane[] }

const SECONDS_PER_WORD = 0.32;
const words = (text: string) => text.split(/\s+/).filter(Boolean).length;

export function timeline(blocks: readonly DemoBlock[]): Timeline {
  const stats = demoStats(blocks);
  const colorOf = new Map(stats.cast.map((c) => [c.name, c.color]));
  const lanes = new Map<string, Lane>(stats.cast.map((c) => [c.name, { name: c.name, color: c.color, items: [] }]));
  const action: Lane = { name: "", color: 0, items: [] };
  let at = 0;
  let hook: number | null = null;
  let speaker = "";
  for (const [kind, text] of blocks) {
    if (kind === "c") { speaker = text.trim().toUpperCase(); continue; }
    if (kind === "p") continue;
    const length = words(text) * SECONDS_PER_WORD;
    if (!length) continue;
    const lane = kind === "a" ? action : lanes.get(speaker);
    if (kind === "d" && hook === null && colorOf.has(speaker)) hook = at;
    lane?.items.push({ start: at, length });
    at += length;
  }
  return { seconds: stats.seconds, scale: Math.max(30, Math.ceil(at / 10) * 10), hook, lanes: [...lanes.values(), action] };
}

/** Character colour by order of first appearance, as in ScriptZ. */
export function castColors(blocks: readonly DemoBlock[]): Map<string, number> {
  return new Map(demoStats(blocks).cast.map((c) => [c.name, c.color]));
}
