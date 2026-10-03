function hexToRgb(hex: string): [number, number, number] {
  const s = hex.replace("#", "");
  if (s.length !== 6) return [128, 128, 128];
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}

export function tint(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Same palette as the Rust DEFAULT_PALETTE in commands/scripts.rs. The
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
