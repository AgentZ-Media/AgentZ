// Legacy block normalizer.
//
// The editor knows four block types: Action, Character, Dialog and
// Parenthetical. Stored content (database rows, snapshots, .scriptz files)
// may contain the three retired types Camera, Caption and SFX. They have
// no node class, so Lexical would refuse to parse such a state - every
// place that parses content runs it through this module first.
//
// Conversion rule: the node's `type` (and the serialized `blockType`, if
// present) becomes "scriptz-action". Children, text, inline formats and
// all other node fields stay untouched, so the word count does not change.
//
// Parenthetical is a regular block type - "scriptz-parenthetical" passes
// through as is.
//
// Pure module without imports so it can be used from lex.ts and every
// storage adapter without import cycles.

/** The retired block types that get converted into action blocks. */
export const LEGACY_BLOCK_TYPES = [
  "scriptz-camera",
  "scriptz-caption",
  "scriptz-sfx",
] as const;

export type LegacyBlockType = (typeof LEGACY_BLOCK_TYPES)[number];

const LEGACY_SET: ReadonlySet<string> = new Set<string>(LEGACY_BLOCK_TYPES);
const TARGET_TYPE = "scriptz-action";

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
