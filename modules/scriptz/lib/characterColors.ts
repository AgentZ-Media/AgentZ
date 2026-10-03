// App-wide character-colour records.
//
// TS port of src-tauri/src/commands/character_colors.rs (Migration Phase 3).
// Schema is unchanged: `character_colors(name, default_color, override_color,
// updated_at)`. Updates here also propagate the new colour into every
// script's `scripts.characters_meta` so the colour swap is visible without a
// reconcile pass.
//
// One known gap vs. the Rust version: Rust wrapped the multi-row update in a
// single transaction. tauri-plugin-sql does not expose explicit transactions
// in JS, so updates here happen as separate auto-committed statements. A
// concurrent script save can interleave with a colour swap; the worst case
// is one or two scripts saving with the previous colour, which the next
// reconcile fixes anyway. Setters are user-triggered (color picker), so the
// race window is small in practice.
//
// `parseCharsMeta`, `serializeCharsMeta`, `DEFAULT_PALETTE`, and
// `upsertDefaultColor` mirror helpers that still live in
// commands/scripts.rs. They are duplicated there on purpose while
// update_script remains in Rust; Phase 7 retires the rest of the
// duplicates and this module becomes the single source of truth.

import { isValidHexColor, normalizeHexColor } from "./colors";
import { getDb } from "./db";
import type { CharacterColorRecord, ScriptCharacter } from "./types";

export const DEFAULT_PALETTE = [
  "#e0791f",
  "#3a8ed4",
  "#7a4ad4",
  "#2fa56b",
  "#d04141",
  "#c87b00",
  "#1a9aa0",
  "#a855f7",
  "#d946ef",
  "#0ea5e9",
] as const;

export function parseCharsMeta(raw: string): ScriptCharacter[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as ScriptCharacter[]) : [];
  } catch {
    return [];
  }
}

export function serializeCharsMeta(list: ScriptCharacter[]): string {
  // Force `{name, color, share?}` key order so the on-disk bytes are
  // stable. The LIKE prefilter in `affectedScripts` searches for
  // `%"NAME"%`, which still matches no matter how many trailing fields
  // we add. `share` is omitted when undefined to keep older rows
  // bit-identical until the next save reconciles them.
  return JSON.stringify(
    list.map((c) =>
      c.share === undefined
        ? { name: c.name, color: c.color }
        : { name: c.name, color: c.color, share: c.share },
    ),
  );
}

export async function listCharacterColors(): Promise<CharacterColorRecord[]> {
  const db = await getDb();
  return db.select<CharacterColorRecord[]>(
    `SELECT name, default_color, override_color, updated_at
     FROM character_colors ORDER BY name`,
  );
}

/** Per-name resolution input for the reconcile pass: which colour is
 *  forced (override) and which one was first auto-assigned (default). */
export interface ColorRecord {
  default_color: string | null;
  override_color: string | null;
}

/** Load every per-name colour record into a map keyed by uppercase name.
 *  Used by the Phase-7 script create/update paths to avoid re-querying
 *  per character on every save. */
export async function loadColorRecords(): Promise<Map<string, ColorRecord>> {
  const db = await getDb();
  const rows = await db.select<
    { name: string; default_color: string | null; override_color: string | null }[]
  >("SELECT name, default_color, override_color FROM character_colors");
  const m = new Map<string, ColorRecord>();
  for (const r of rows) {
    m.set(r.name.toUpperCase(), {
      default_color: r.default_color,
      override_color: r.override_color,
    });
  }
  return m;
}

/** Upsert a `default_color` for `name`. Existing default is preserved
 *  (the very first auto-assigned colour wins forever); override is left
 *  alone. Mirrors the SQL Rust uses in commands/scripts.rs.
 *
 *  Validates the color shape - same rationale as `setCharacterColor`:
 *  the persistence layer should never store a value that the renderer
 *  pastes into an inline `style` attribute. */
export async function upsertDefaultColor(
  name: string,
  defaultColor: string,
  now: number,
): Promise<void> {
  if (!isValidHexColor(defaultColor)) {
    throw new Error(`invalid default color: ${defaultColor}`);
  }
  const normalized = normalizeHexColor(defaultColor);
  const db = await getDb();
  await db.execute(
    `INSERT INTO character_colors (name, default_color, updated_at)
     VALUES ($1, $2, $3)
     ON CONFLICT(name) DO UPDATE SET
       default_color = COALESCE(character_colors.default_color, excluded.default_color),
       updated_at = CASE
         WHEN character_colors.default_color IS NULL THEN excluded.updated_at
         ELSE character_colors.updated_at
       END`,
    [name, normalized, now],
  );
}

/** ASCII case-insensitive equality. Unicode-aware comparisons aren't
 *  needed here - character names are uppercased Latin by reconcile. */
export function eqIgnoreAsciiCase(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    let ca = a.charCodeAt(i);
    let cb = b.charCodeAt(i);
    if (ca >= 65 && ca <= 90) ca += 32;
    if (cb >= 65 && cb <= 90) cb += 32;
    if (ca !== cb) return false;
  }
  return true;
}

/** Set the manual override and propagate it into every script that already
 *  references the name. Returns the IDs of scripts that actually changed.
 *
 *  Rejects malformed hex strings - the value lands in inline CSS template
 *  literals (`background:${color}`) on multiple render paths, so this is
 *  the persistence-layer line of defense in case a future caller forgets
 *  the UI-side `isValidHexColor` check. */
export async function setCharacterColor(
  name: string,
  color: string,
): Promise<string[]> {
  const trimmed = name.trim().toUpperCase();
  if (trimmed.length === 0) return [];
  if (!isValidHexColor(color)) {
    throw new Error(`invalid color: ${color}`);
  }
  const normalized = normalizeHexColor(color);
  const now = Date.now();
  const db = await getDb();

  await db.execute(
    `INSERT INTO character_colors (name, override_color, updated_at)
     VALUES ($1, $2, $3)
     ON CONFLICT(name) DO UPDATE SET
       override_color = excluded.override_color,
       updated_at = excluded.updated_at`,
    [trimmed, normalized, now],
  );

  const affected = await affectedScripts(trimmed);
  const changedIds: string[] = [];
  for (const row of affected) {
    const chars = parseCharsMeta(row.characters_meta);
    let touched = false;
    for (const c of chars) {
      if (eqIgnoreAsciiCase(c.name, trimmed) && c.color !== normalized) {
        c.color = normalized;
        touched = true;
      }
    }
    if (!touched) continue;
    await db.execute(
      "UPDATE scripts SET characters_meta = $1 WHERE id = $2",
      [serializeCharsMeta(chars), row.id],
    );
    changedIds.push(row.id);
  }
  return changedIds;
}

/** Drop the manual override and fall back to the recorded default. If no
 *  default has been recorded yet, pick a palette colour in the active
 *  script's context, register it as the new default, and propagate. */
export async function clearCharacterColor(
  name: string,
  activeScriptId: string | null,
): Promise<string[]> {
  const trimmed = name.trim().toUpperCase();
  if (trimmed.length === 0) return [];
  const now = Date.now();
  const db = await getDb();

  // Read the current default before mutating, so we know whether to backfill.
  const existing = await db.select<{ default_color: string | null }[]>(
    "SELECT default_color FROM character_colors WHERE name = $1 COLLATE NOCASE",
    [trimmed],
  );
  const existingDefault: string | null =
    existing.length > 0 ? existing[0].default_color : null;

  // Clear override but keep default. UPDATE is a no-op if no row exists -
  // that's fine, we still proceed in case characters_meta entries need
  // the default propagated.
  await db.execute(
    `UPDATE character_colors SET override_color = NULL, updated_at = $1
     WHERE name = $2 COLLATE NOCASE`,
    [now, trimmed],
  );

  const affected = await affectedScripts(trimmed);

  let targetColor: string;
  if (existingDefault !== null) {
    targetColor = existingDefault;
  } else {
    // Pick a palette colour. Prefer the active script's context, fall
    // back to the first affected script, fall back to palette[0] if no
    // script holds the name at all (no-op anyway).
    const contextRow = activeScriptId
      ? (affected.find((r) => r.id === activeScriptId) ?? affected[0])
      : affected[0];
    if (contextRow) {
      const existingChars = parseCharsMeta(contextRow.characters_meta);
      targetColor = pickPaletteInScript(existingChars, trimmed);
    } else {
      targetColor = DEFAULT_PALETTE[0];
    }
    // Register so future scripts (and future resets) use it too.
    await upsertDefaultColor(trimmed, targetColor, now);
  }

  const changedIds: string[] = [];
  for (const row of affected) {
    const chars = parseCharsMeta(row.characters_meta);
    let touched = false;
    for (const c of chars) {
      if (eqIgnoreAsciiCase(c.name, trimmed) && c.color !== targetColor) {
        c.color = targetColor;
        touched = true;
      }
    }
    if (!touched) continue;
    await db.execute(
      "UPDATE scripts SET characters_meta = $1 WHERE id = $2",
      [serializeCharsMeta(chars), row.id],
    );
    changedIds.push(row.id);
  }
  return changedIds;
}

// ---------- internal helpers ----------

interface AffectedRow {
  id: string;
  content_json: string;
  characters_meta: string;
}

/** Find every script whose `characters_meta` references the given name.
 *  Coarse LIKE prefilter on the JSON-quoted name skips most rows without
 *  deserialising them. The case-insensitive collation matches the same
 *  rows the post-filter `eqIgnoreAsciiCase` would have kept anyway. */
async function affectedScripts(nameUpper: string): Promise<AffectedRow[]> {
  // Doubling `"` matches Rust's defensive escape; character names are
  // uppercase Latin in practice so this is effectively a no-op, but
  // mirrors the on-disk LIKE pattern byte-for-byte either way.
  const like = `%"${nameUpper.replaceAll('"', '""')}"%`;
  const db = await getDb();
  return db.select<AffectedRow[]>(
    `SELECT id, content_json, characters_meta FROM scripts
     WHERE characters_meta LIKE $1 COLLATE NOCASE`,
    [like],
  );
}

function pickPaletteInScript(
  existing: ScriptCharacter[],
  skipName: string,
): string {
  const used = new Set<string>();
  for (const c of existing) {
    if (!eqIgnoreAsciiCase(c.name, skipName)) used.add(c.color);
  }
  for (const p of DEFAULT_PALETTE) {
    if (!used.has(p)) return p;
  }
  return DEFAULT_PALETTE[0];
}

