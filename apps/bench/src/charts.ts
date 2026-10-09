// Charts: a price-performance scatter as SVG and a heatmap as an HTML
// table. Both scale to many models: every model carries its rank number
// (the same as in the ranking), so identity never depends on colour alone.

import { esc } from "./format";

// Series colors are data colors (one per model, in order of appearance),
// validated for color vision deficiencies on the suite's light and dark
// surfaces. Beyond eight models the rest share a neutral slot and rely on
// their rank number and name.
const SERIES_LIGHT = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"];
const SERIES_DARK = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];
const OVERFLOW = "#8c8f96";

export function seriesColor(index: number, dark: boolean): string {
  return (dark ? SERIES_DARK : SERIES_LIGHT)[index] ?? OVERFLOW;
}

export interface Series { id: string; name: string; color: string; rank: number }
export interface Point { id: string; x: number; y: number; label: string; rank: number; color: string; tip: string }

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const exp = 10 ** Math.floor(Math.log10(value));
  return ([1, 2, 2.5, 5, 10].find((s) => s * exp >= value) ?? 10) * exp;
}

/** Cost (x) against rating (y); top left is best. The rating axis starts
 *  just below the weakest model, so close models stay apart. */
export function scatter(points: Point[], xLabel: string, yLabel: string, format: (v: number) => string): string {
  const W = 520;
  const H = 300;
  const left = 44;
  const bottom = 42;
  const right = 20;
  const top = 14;
  const xMax = niceMax(Math.max(0.01, ...points.map((p) => p.x)) * 1.12);
  const yMin = Math.max(0, Math.floor(Math.min(10, ...points.map((p) => p.y)) - 1));
  const x = (v: number) => left + (v / xMax) * (W - left - right);
  const y = (v: number) => top + (1 - (v - yMin) / (10 - yMin)) * (H - bottom - top);
  const parts: string[] = [];
  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    parts.push(`<line class="grid" x1="${x(t * xMax)}" x2="${x(t * xMax)}" y1="${top}" y2="${H - bottom}"/>`);
    parts.push(`<text class="tick" x="${x(t * xMax)}" y="${H - bottom + 18}" text-anchor="middle">${esc(format(t * xMax))}</text>`);
  }
  for (let v = yMin; v <= 10; v++) {
    parts.push(`<line class="grid" x1="${left}" x2="${W - right}" y1="${y(v)}" y2="${y(v)}"/>`);
    parts.push(`<text class="tick" x="${left - 10}" y="${y(v) + 4}" text-anchor="end">${v}</text>`);
  }
  parts.push(`<text class="axis" x="${(left + W - right) / 2}" y="${H - 6}" text-anchor="middle">${esc(xLabel)}</text>`);
  parts.push(`<text class="axis" x="12" y="${(H - bottom + top) / 2}" text-anchor="middle" transform="rotate(-90 12 ${(H - bottom + top) / 2})">${esc(yLabel)}</text>`);
  // Names only while they fit; with many models the rank number carries it.
  const named = points.length <= 6;
  for (const p of [...points].sort((a, b) => b.rank - a.rank)) {
    const cx = x(p.x);
    const cy = y(p.y);
    const anchor = cx > W - 150 ? "end" : "start";
    parts.push(`<g class="mark" data-tip="${esc(p.tip)}"><circle class="hit" cx="${cx}" cy="${cy}" r="18"/>`);
    parts.push(`<circle class="dot" cx="${cx}" cy="${cy}" r="11" fill="${p.color}"/><text class="dot-n" x="${cx}" y="${cy + 4}" text-anchor="middle">${p.rank}</text>`);
    if (named) parts.push(`<text class="value strong" x="${cx + (anchor === "end" ? -16 : 16)}" y="${cy + 4}" text-anchor="${anchor}">${esc(p.label)}</text>`);
    parts.push("</g>");
  }
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`${xLabel} / ${yLabel}`)}">${parts.join("")}</svg>`;
}

export interface HeatCell { value: number | null; text: string; tip: string; href: string }
export interface HeatColumn { id: string; label: string; group: string }

/** Sequential hue of the heatmap (one hue, surface to full), per theme. */
export const heatColor = (dark: boolean) => (dark ? "#3987e5" : "#256abf");

/** Models as rows, tasks as columns, both may grow. `good` maps a value to
 *  0..1 where 1 is the best; a stronger colour means better for every
 *  measure. */
export function heatmap(rows: Series[], columns: HeatColumn[], cell: (row: string, column: string) => HeatCell, good: (value: number) => number, color: string): string {
  const groups: { name: string; span: number }[] = [];
  for (const c of columns) {
    const last = groups.at(-1);
    if (last && last.name === c.group) last.span++;
    else groups.push({ name: c.group, span: 1 });
  }
  const head = `<tr><th></th>${groups.map((g) => `<th class="hm-group" colspan="${g.span}"><span>${esc(g.name)}</span></th>`).join("")}</tr>
    <tr><th></th>${columns.map((c) => `<th class="hm-col" title="${esc(c.label)}"><span>${esc(c.label)}</span></th>`).join("")}</tr>`;
  const body = rows.map((r) => `<tr>
      <th class="hm-row"><span class="rank" style="--c:${r.color}">${r.rank}</span><span class="nm">${esc(r.name)}</span></th>
      ${columns.map((c) => {
        const v = cell(r.id, c.id);
        if (v.value === null) return `<td class="hm-empty">–</td>`;
        const share = Math.round(8 + 80 * Math.max(0, Math.min(1, good(v.value))));
        return `<td><a href="${esc(v.href)}" class="hm-cell${share > 52 ? " ink" : ""}" style="--p:${share}%" data-tip="${esc(v.tip)}">${esc(v.text)}</a></td>`;
      }).join("")}
    </tr>`).join("");
  return `<div class="hm-wrap"><table class="heatmap" style="--heat:${color}"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}
