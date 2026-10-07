// The suite's 5 x 7 dot alphabet as grid cells. Letters come from the logo
// package, digits and signs live here because only the website needs them.
import { createLogo } from "@agentz/design/logo";

export interface Cells { width: number; height: number; cells: [col: number, row: number][] }

const SIGNS: Record<string, readonly string[]> = {
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11111", "00010", "00100", "00010", "00001", "10001", "01110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
  ":": ["0", "0", "1", "0", "1", "0", "0"],
  "?": ["01110", "10001", "00001", "00010", "00100", "00000", "00100"],
  "↓": ["00100", "00100", "00100", "00100", "10101", "01110", "00100"],
};

function glyph(char: string): Cells {
  const sign = SIGNS[char];
  if (sign) {
    const cells: Cells["cells"] = [];
    sign.forEach((row, y) => [...row].forEach((on, x) => { if (on === "1") cells.push([x, y]); }));
    return { width: sign[0]!.length, height: 7, cells };
  }
  const logo = createLogo(char);
  return { width: 5, height: 7, cells: logo.dots.map((dot) => [(dot.cx - 5) / 10, (dot.cy - 5) / 10]) };
}

/** Lays a word out on one grid; a space is three empty columns. */
export function textCells(text: string, gap = 1): Cells {
  const cells: Cells["cells"] = [];
  let x = 0;
  for (const char of text.toUpperCase()) {
    if (char === " ") { x += 3; continue; }
    const g = glyph(char);
    for (const [col, row] of g.cells) cells.push([x + col, row]);
    x += g.width + gap;
  }
  return { width: Math.max(0, x - gap), height: 7, cells };
}
