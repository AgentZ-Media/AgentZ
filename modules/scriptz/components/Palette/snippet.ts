// Full-text snippets from `api.globalSearch` carry the user's raw
// content with `<mark>` tags
// interleaved and no entity escaping. Escape everything, then re-enable the
// two tags the search produced, before the string reaches `innerHTML`.

/** FTS centres the match in its token window; with a one-line layout the
 *  `<mark>` itself often lands in the ellipsis. Keep one word before it. */
function trimBeforeMark(s: string): string {
  const idx = s.indexOf("<mark>");
  if (idx <= 0) return s;
  const before = s.slice(0, idx).replace(/^…\s*/, "");
  const words = before.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 1) return s;
  return "… " + words[words.length - 1] + " " + s.slice(idx);
}

export function safeSnippet(s: string): string {
  return trimBeforeMark(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/&lt;mark&gt;/g, "<mark>")
    .replace(/&lt;\/mark&gt;/g, "</mark>");
}
