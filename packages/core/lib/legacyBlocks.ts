// Legacy block normalizer (Werkbank redesign).
//
// The editor knows three block types since the redesign: Action, Character
// and Dialog. Older content (database rows, snapshots, .scriptz files,
// handoff bundles) may still contain the four retired types
// Parenthetical, Camera, Caption and SFX. Their node classes no longer
// exist, so Lexical would refuse to parse such a state - every place that
// parses content runs it through this module first.
//
// Conversion rules:
//  - The node's `type` (and the serialized `blockType`, if present)
//    becomes "scriptz-action". Children, text, inline formats and all
//    other node fields stay untouched.
//  - Parenthetical text is wrapped in "( … )": "(" is added unless the
//    trimmed text already starts with "(", ")" is added unless it already
//    ends with ")". The parentheses are glued to the words, so the
//    whitespace-based word count does not change. Empty parentheticals
//    stay empty (no "()").
//
// Pure module without imports so it can be used from lex.ts and every
// storage adapter without import cycles.

/** The retired block types that get converted into action blocks. */
export const LEGACY_BLOCK_TYPES = [
  "scriptz-parenthetical",
  "scriptz-camera",
  "scriptz-caption",
  "scriptz-sfx",
] as const;

export type LegacyBlockType = (typeof LEGACY_BLOCK_TYPES)[number];

const LEGACY_SET: ReadonlySet<string> = new Set<string>(LEGACY_BLOCK_TYPES);
const TARGET_TYPE = "scriptz-action";
const PARENTHETICAL = "scriptz-parenthetical";

type JsonObject = Record<string, unknown>;

function isObject(v: unknown): v is JsonObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Cheap pre-check on the raw string: true when the JSON might contain a
 *  retired block type. Lets hot paths (every save, every extraction) skip
 *  the parse/stringify round-trip for already-normal content. */
export function mayContainLegacyBlocks(json: string): boolean {
  for (const t of LEGACY_BLOCK_TYPES) {
    if (json.includes(t)) return true;
  }
  return false;
}

/** Collects the text nodes of a block in document order. */
function collectTextNodes(node: JsonObject, out: JsonObject[]): void {
  const children = node.children;
  if (!Array.isArray(children)) return;
  for (const child of children) {
    if (!isObject(child)) continue;
    if (child.type === "text" && typeof child.text === "string") {
      out.push(child);
    } else {
      collectTextNodes(child, out);
    }
  }
}

/** Wraps the block's text in parentheses (see module header). Mutates the
 *  first / last text node in place. */
function wrapParenthetical(block: JsonObject): void {
  const texts: JsonObject[] = [];
  collectTextNodes(block, texts);
  if (texts.length === 0) return;
  const full = texts.map((n) => n.text as string).join("");
  const trimmed = full.trim();
  if (trimmed.length === 0) return;

  if (!trimmed.startsWith("(")) {
    // Insert after the leading whitespace of the first non-blank node.
    const first = texts.find((n) => (n.text as string).trim().length > 0);
    if (first) {
      const s = first.text as string;
      const lead = s.length - s.trimStart().length;
      first.text = s.slice(0, lead) + "(" + s.slice(lead);
    }
  }
  if (!trimmed.endsWith(")")) {
    // Insert before the trailing whitespace of the last non-blank node.
    let last: JsonObject | undefined;
    for (let i = texts.length - 1; i >= 0; i--) {
      if ((texts[i].text as string).trim().length > 0) {
        last = texts[i];
        break;
      }
    }
    if (last) {
      const s = last.text as string;
      const end = s.trimEnd().length;
      last.text = s.slice(0, end) + ")" + s.slice(end);
    }
  }
}

/** Converts retired block types IN PLACE anywhere below `node`. Returns
 *  true when at least one node was converted. Accepts any parsed JSON
 *  value (the full `{ root: … }` state or a single node). */
export function normalizeLegacyTree(node: unknown): boolean {
  if (Array.isArray(node)) {
    let changed = false;
    for (const child of node) {
      if (normalizeLegacyTree(child)) changed = true;
    }
    return changed;
  }
  if (!isObject(node)) return false;

  let changed = false;
  const type = node.type;
  if (typeof type === "string" && LEGACY_SET.has(type)) {
    if (type === PARENTHETICAL) wrapParenthetical(node);
    node.type = TARGET_TYPE;
    if ("blockType" in node) node.blockType = TARGET_TYPE;
    changed = true;
  }
  if ("root" in node && normalizeLegacyTree(node.root)) changed = true;
  if (Array.isArray(node.children) && normalizeLegacyTree(node.children)) {
    changed = true;
  }
  return changed;
}

/** Converts all retired block types in a serialized Lexical state to
 *  action blocks. Returns the input string unchanged (and
 *  `changed: false`) when there is nothing to convert or when the JSON is
 *  malformed - callers keep their own error handling for broken content. */
export function normalizeLegacyContent(json: string): {
  json: string;
  changed: boolean;
} {
  if (typeof json !== "string" || !mayContainLegacyBlocks(json)) {
    return { json, changed: false };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { json, changed: false };
  }
  if (!normalizeLegacyTree(parsed)) return { json, changed: false };
  return { json: JSON.stringify(parsed), changed: true };
}
