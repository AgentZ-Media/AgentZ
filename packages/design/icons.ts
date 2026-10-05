/**
 * @agentz/design - icon set.
 *
 * One stroke icon set for the whole suite (24x24 viewBox). Values are the
 * inner SVG markup only; render them inside
 * `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
 *   stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">`
 * (or `<svg class="i">` with components.css loaded).
 *
 * All icons share the same grid and stroke style.
 */

export const ICON_VIEWBOX = "0 0 24 24";
export const STAGE_VIEWBOX = "0 0 14 14";

export type IconName =
  | "search"
  | "plus"
  | "stack"
  | "folder"
  | "doc"
  | "gear"
  | "down"
  | "up"
  | "right"
  | "left"
  | "sidebar"
  | "inspector"
  | "export"
  | "check"
  | "bulb"
  | "history"
  | "spark"
  | "dots"
  | "bolt"
  | "marker"
  | "sun"
  | "pen"
  | "users"
  | "keyboard"
  | "refresh"
  | "info"
  | "return"
  | "x"
  | "trash"
  | "import"
  | "select"
  | "play"
  | "undo"
  | "inbox"
  | "list"
  | "board"
  | "expand"
  | "scissors"
  | "timer"
  | "moon"
  | "shield";

export const ICONS: Record<IconName, string> = {
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  stack: '<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/>',
  folder: '<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
  doc: '<path d="M6.5 3.5h7l4 4v13h-11z"/><path d="M13.5 3.5v4h4"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  up: '<path d="M6 15l6-6 6 6"/>',
  right: '<path d="M9 6l6 6-6 6"/>',
  left: '<path d="M15 6l-6 6 6 6"/>',
  sidebar: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M9.5 4.5v15"/>',
  inspector: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M14.5 4.5v15"/>',
  export: '<path d="M12 15V4M7.5 8.5L12 4l4.5 4.5"/><path d="M5 14v4.5a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5V14"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  bulb: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.4.9 1 .9 1.7V16h5.2v-.4c0-.7.4-1.3.9-1.7A6 6 0 0 0 12 3z"/>',
  history: '<path d="M3.5 12a8.5 8.5 0 1 0 2.5-6"/><path d="M3.5 4.5V9H8"/><path d="M12 8v4.5l3 1.5"/>',
  spark: '<path d="M12 3c.8 4.6 2.4 6.2 7 7-4.6.8-6.2 2.4-7 7-.8-4.6-2.4-6.2-7-7 4.6-.8 6.2-2.4 7-7z"/>',
  dots: '<circle cx="6" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="18" cy="12" r="1"/>',
  bolt: '<path d="M13 3L5 13.5h6L10 21l8-10.5h-6z"/>',
  marker: '<path d="M14.5 4.5l5 5L11 18H6v-5z"/><path d="M4 21h16"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/>',
  pen: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M3 20a6 6 0 0 1 12 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M21 20a6 6 0 0 0-4-5.7"/>',
  keyboard: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10h.01M11 10h.01M15 10h.01M8 14h8"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.5-4.5L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.5 4.5L20 16"/><path d="M20 20v-4h-4"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>',
  "return": '<path d="M19 5v6.5a2 2 0 0 1-2 2H6"/><path d="M9.5 10L6 13.5 9.5 17"/>',
  x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  trash: '<path d="M4.5 7h15"/><path d="M9.5 7V4.5h5V7"/><path d="M6.5 7l.9 12a1.5 1.5 0 0 0 1.5 1.4h6.2a1.5 1.5 0 0 0 1.5-1.4l.9-12"/><path d="M10 11v5.5M14 11v5.5"/>',
  "import": '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5"/><path d="M5 14v4.5a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5V14"/>',
  select: '<rect x="4" y="4" width="16" height="16" rx="3.5"/><path d="M8.5 12.2l2.4 2.4 4.6-5"/>',
  play: '<path d="M8 5.5v13l10.5-6.5z"/>',
  undo: '<path d="M9 14L4.5 9.5 9 5"/><path d="M4.5 9.5H15a4.5 4.5 0 0 1 0 9h-3"/>',
  inbox: '<path d="M4 13.5l2.1-7a2 2 0 0 1 1.9-1.5h8a2 2 0 0 1 1.9 1.5l2.1 7"/><path d="M4 13.5V18a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4.5h-4.5L14 16h-4l-1.5-2.5z"/>',
  list: '<path d="M9 6.5h11M9 12h11M9 17.5h11"/><path d="M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01"/>',
  board: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M9.2 4.5v15M14.8 4.5v15"/>',
  expand: '<path d="M14 4.5h5.5V10M10 19.5H4.5V14"/><path d="M19.5 4.5L13.5 10.5M4.5 19.5l6-6"/>',
  scissors: '<circle cx="6" cy="6" r="2.6"/><circle cx="6" cy="18" r="2.6"/><path d="M8.2 7.6L20 18M8.2 16.4L20 6"/>',
  timer: '<circle cx="12" cy="13.5" r="7"/><path d="M12 13.5V10M10 3.5h4M18.5 6.5l-1.5 1.5"/>',
  moon: '<path d="M19.5 14.5A7.5 7.5 0 0 1 9.5 4.5a7.5 7.5 0 1 0 10 10z"/>',
  shield: '<path d="M12 3.5l7 3v5.5c0 4.2-2.9 7.3-7 8.5-4.1-1.2-7-4.3-7-8.5V6.5z"/><path d="M9 12l2.2 2.2L15.5 10"/>',
};

/** Every icon name, e.g. for a component sheet or tests. */
export const ICON_NAMES = Object.keys(ICONS) as IconName[];

export type StageGlyphName = "idea" | "writing" | "ready" | "shot" | "online";

/**
 * Stage glyphs (14x14 viewBox): a ring that fills in quarters, so the
 * shape encodes the order without five new colours. Coloured via
 * `currentColor`; only "online" is filled with the accent. Inner markup
 * carries its own fill/stroke, so render it in a plain
 * `<svg viewBox="0 0 14 14">` (class `st`).
 */
export const STAGE_GLYPHS: Record<StageGlyphName, string> = {
  idea: '<circle cx="7" cy="7" r="5.6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="2.2 1.8"/>',
  writing:
    '<circle cx="7" cy="7" r="5.6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M7 7V3.4A3.6 3.6 0 0 1 10.6 7z" fill="currentColor"/>',
  ready:
    '<circle cx="7" cy="7" r="5.6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M7 3.4a3.6 3.6 0 0 1 0 7.2z" fill="currentColor"/>',
  shot: '<circle cx="7" cy="7" r="5.6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M7 7V3.4A3.6 3.6 0 1 1 3.4 7z" fill="currentColor"/>',
  online:
    '<circle cx="7" cy="7" r="6.1" stroke-width="1" style="fill:var(--accent);stroke:currentColor"/><path d="M4.6 7.2l1.7 1.7 3.2-3.4" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="stroke:var(--accent-fg)"/>',
};

const STAGE_RING =
  '<circle cx="7" cy="7" r="5.6" fill="none" stroke="currentColor" stroke-width="1.5"/>';

function glyphNum(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}

/**
 * Stage glyph for `step` (1-based) of a pipeline with `total` steps, in the
 * same 14x14 grid as `STAGE_GLYPHS`: the wedge fills clockwise by
 * step/total, the last step is the filled "done" glyph and step 0 is the
 * dashed idea ring. With four steps it reproduces writing/ready/shot/online.
 */
export function stageGlyph(step: number, total: number): string {
  if (!Number.isFinite(step) || !Number.isFinite(total) || step <= 0 || total <= 0) return STAGE_GLYPHS.idea;
  if (step >= total) return STAGE_GLYPHS.online;
  const angle = (2 * Math.PI * step) / total;
  const x = glyphNum(7 + 3.6 * Math.sin(angle));
  const y = glyphNum(7 - 3.6 * Math.cos(angle));
  const large = step / total > 0.5 ? 1 : 0;
  return `${STAGE_RING}<path d="M7 7V3.4A3.6 3.6 0 ${large} 1 ${x} ${y}z" fill="currentColor"/>`;
}
