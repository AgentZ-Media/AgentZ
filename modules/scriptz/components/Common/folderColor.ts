// Stable colour dot per folder (sidebar, filter chips, idea rows, settings).
//
// Folders carry no colour in storage, so the colour is derived from the
// folder id: FNV-1a hash -> slot in the character palette. The same id
// always maps to the same colour on every surface and across restarts,
// and renaming a folder never changes its colour. Every surface imports it
// from here instead of re-implementing it.

import { CHARACTER_PALETTE } from "../../lib/colors";

/** FNV-1a 32-bit hash of a string (unsigned). */
function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Hex colour ("#rrggbb") for a folder id. Content colour (data), not a UI
 *  token - render it via an inline style / CSS custom property. */
export function folderColor(folderId: string): string {
  return CHARACTER_PALETTE[fnv1a(folderId) % CHARACTER_PALETTE.length];
}
