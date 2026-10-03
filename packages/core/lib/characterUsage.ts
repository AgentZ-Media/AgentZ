// Which registered character names are still used by any stored script?
//
// The app-wide registry (`character_colors`) only ever grows: every save
// back-fills a default colour for each new name, including half-typed
// intermediate names ("B", "BO", "BOB") and names the writer later deleted.
// This module holds the shared, adapter-agnostic pieces of the cleanup:
//
//  - pure helpers that read the per-script `characters_meta` (reconciled
//    from the content on every save, so it is the cheap source of truth -
//    no Lexical JSON has to be parsed),
//  - `scanUsedCharacterNames`, a paged scan that yields to the UI between
//    pages so 10,000 scripts never freeze the app,
//  - `characterUsageBus`, which adapters ping whenever a write may have
//    dropped a name (content save, snapshot restore, purge) and which the
//    settings list watches to reload after a cleanup,
//  - the SQL implementation of find/prune using the same helpers.
//
// "Used" means referenced by any script row - trashed scripts included,
// because restoring one from the trash should keep its colours. Snapshots
// are history, not stored scripts, and don't count.

import { createSignal } from "solid-js";
import { parseCharsMeta } from "./characterColors";
import { getDb } from "./db";
import type { ScriptCharacter } from "./types";

/** Rows per page for the usage scan. Small enough that one page never
 *  blocks a frame noticeably, large enough to keep IPC roundtrips low. */
export const USAGE_SCAN_PAGE_SIZE = 250;

/** Uppercased names referenced by one `characters_meta` blob. */
export function namesInCharsMeta(raw: string): string[] {
  const out: string[] = [];
  for (const c of parseCharsMeta(raw)) {
    const name = typeof c?.name === "string" ? c.name.trim().toUpperCase() : "";
    if (name) out.push(name);
  }
  return out;
}

/** True when `next` lacks at least one name that `prev` had - i.e. a write
 *  may have orphaned a registry entry. Case-insensitive. */
export function dropsCharacterNames(prev: ScriptCharacter[], next: ScriptCharacter[]): boolean {
  if (prev.length === 0) return false;
  const kept = new Set(next.map((c) => c.name.trim().toUpperCase()));
  return prev.some((c) => {
    const name = c.name.trim().toUpperCase();
    return name.length > 0 && !kept.has(name);
  });
}

/** Lets the browser paint and handle input between scan pages. */
export function yieldToUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Pages through every script's `characters_meta` and collects the
 *  uppercased names in use. `loadPage(after)` returns the next page of
 *  rows ordered by id, starting strictly after the id `after` (null = from
 *  the start); a page shorter than `pageSize` ends the scan. */
export async function scanUsedCharacterNames(
  loadPage: (after: string | null, pageSize: number) => Promise<{ id: string; characters_meta: string }[]>,
  pageSize = USAGE_SCAN_PAGE_SIZE,
): Promise<Set<string>> {
  const used = new Set<string>();
  let after: string | null = null;
  for (;;) {
    const rows = await loadPage(after, pageSize);
    for (const r of rows) {
      for (const n of namesInCharsMeta(r.characters_meta)) used.add(n);
    }
    if (rows.length < pageSize) break;
    after = rows[rows.length - 1].id;
    await yieldToUi();
  }
  return used;
}

/** Registry names (original spelling) that no script uses, optionally
 *  restricted to `only`. Sorted for a stable display order. */
export function unusedRegistryNames(
  registry: string[],
  used: Set<string>,
  only?: string[],
): string[] {
  const allowed = only ? new Set(only.map((n) => n.trim().toUpperCase())) : null;
  return registry
    .filter((name) => {
      const upper = name.trim().toUpperCase();
      if (allowed && !allowed.has(upper)) return false;
      return !used.has(upper);
    })
    .sort();
}

/** LIKE pattern matching a `characters_meta` blob that contains `name` as
 *  an entry name. `serializeCharsMeta` always writes `{"name":...}` first
 *  with no whitespace, so this is exact for every row this app wrote;
 *  `%`, `_` and `\` are escaped for `ESCAPE '\'`. Used only as a guard
 *  against a concurrent save re-adding a name between scan and delete -
 *  the scan above is the authoritative check. */
export function metaNameLikePattern(name: string): string {
  const needle = `"name":${JSON.stringify(name.trim().toUpperCase())}`;
  return `%${needle.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

type Listener = () => void;
const shrinkListeners = new Set<Listener>();
const [registryVersion, setRegistryVersion] = createSignal(0);

export const characterUsageBus = {
  /** Adapters call this after a write that may have removed a name from a
   *  script. Cheap: listeners only (re)arm a debounce timer. */
  notifyNamesDropped(): void {
    for (const fn of shrinkListeners) {
      try {
        fn();
      } catch (err) {
        console.warn("[scriptz] character usage listener failed", err);
      }
    }
  },
  onNamesDropped(fn: Listener): () => void {
    shrinkListeners.add(fn);
    return () => {
      shrinkListeners.delete(fn);
    };
  },
  /** Bumped after registry entries were deleted (settings list reloads). */
  registryVersion,
  bumpRegistry(): void {
    // Functional updater, see scriptsBus.ts.
    setRegistryVersion((v) => v + 1);
  },
};

// ---------- SQL (desktop) ----------

async function loadSqlPage(
  after: string | null,
  pageSize: number,
): Promise<{ id: string; characters_meta: string }[]> {
  const db = await getDb();
  return after === null
    ? db.select<{ id: string; characters_meta: string }[]>(
        "SELECT id, characters_meta FROM scripts ORDER BY id LIMIT $1",
        [pageSize],
      )
    : db.select<{ id: string; characters_meta: string }[]>(
        "SELECT id, characters_meta FROM scripts WHERE id > $1 ORDER BY id LIMIT $2",
        [after, pageSize],
      );
}

async function unusedSql(only?: string[]): Promise<string[]> {
  if (only && only.length === 0) return [];
  const db = await getDb();
  const registry = await db.select<{ name: string }[]>("SELECT name FROM character_colors");
  if (registry.length === 0) return [];
  const used = await scanUsedCharacterNames(loadSqlPage);
  return unusedRegistryNames(
    registry.map((r) => r.name),
    used,
    only,
  );
}

/** Registry names no stored script uses (desktop / SQL). */
export function findUnusedCharacterNames(): Promise<string[]> {
  return unusedSql();
}

/** Deletes every registry entry no stored script uses - restricted to
 *  `only` when given - and returns the deleted names. Re-scans instead of
 *  trusting an earlier `findUnusedCharacterNames` result, and each DELETE
 *  re-checks the scripts table, so a name typed in the meantime survives. */
export async function pruneUnusedCharacterNames(only?: string[]): Promise<string[]> {
  const candidates = await unusedSql(only);
  if (candidates.length === 0) return [];
  const db = await getDb();
  const removed: string[] = [];
  for (const name of candidates) {
    const res = await db.execute(
      `DELETE FROM character_colors
       WHERE name = $1
         AND NOT EXISTS (SELECT 1 FROM scripts WHERE characters_meta LIKE $2 ESCAPE '\\')`,
      [name, metaNameLikePattern(name)],
    );
    if (res.rowsAffected > 0) removed.push(name);
  }
  if (removed.length > 0) characterUsageBus.bumpRegistry();
  return removed;
}
