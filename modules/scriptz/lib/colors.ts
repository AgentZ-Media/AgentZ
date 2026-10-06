/** Same palette as `DEFAULT_PALETTE` in ./characterColors.ts. The
 * popover renders these as quick-pick swatches; the writer can also paste
 * a freeform "#rrggbb" into the hex field. */
export const CHARACTER_PALETTE: string[] = [
  "#e0791f", "#3a8ed4", "#7a4ad4", "#2fa56b", "#d04141",
  "#c87b00", "#1a9aa0", "#a855f7", "#d946ef", "#0ea5e9",
];

/** "#rrggbb" - case-insensitive, optional leading "#". Anything else is
 * rejected so the popover never persists a malformed value the renderer
 * would silently fall back to grey on. */
export function isValidHexColor(value: string): boolean {
  const s = value.trim().replace(/^#/, "");
  return /^[0-9a-f]{6}$/i.test(s);
}

export function normalizeHexColor(value: string): string {
  const s = value.trim().replace(/^#/, "");
  return `#${s.toLowerCase()}`;
}
