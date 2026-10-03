// One-time boot migration: rewrite stored scripts that still contain the
// retired block types (parenthetical, camera, caption, sfx) as action
// blocks (see ./legacyBlocks.ts).
//
// Runs through the `api` facade, so it works for every storage adapter
// (SQLite on desktop, Dexie on web). Content is only rewritten when the
// normalizer actually changed something. The rewrite uses
// `internalRewrite: true`, which
//  - books NO words into the daily word log (the writing counter must not
//    jump because of a format conversion), and
//  - keeps `updated_at`, so "recently edited" ordering stays as it was.
//
// Idempotent and safe to call on every boot: the app_state flag
// `migration.legacy_blocks_v1` short-circuits after the first complete
// run. If a single script fails, the flag is NOT set and the next boot
// retries (already converted scripts no longer report `changed`).
// Content that is never migrated still works: every read path normalizes
// on the fly.
//
// Snapshots are intentionally left as they are - they are normalized when
// restored (lib/snapshots.ts and the web adapter).
//
// Called once at boot by the shell (components/Shell/AppShell.tsx), after
// the storage adapter is registered and before the first script opens:
//
//   await migrateLegacyBlocksOnce();

import { api } from "./api";
import { normalizeLegacyContent } from "./legacyBlocks";
import { scriptsBus } from "./scriptsBus";

export const LEGACY_BLOCKS_MIGRATION_FLAG = "migration.legacy_blocks_v1";

let running: Promise<void> | null = null;

export function migrateLegacyBlocksOnce(): Promise<void> {
  // Coalesce concurrent callers (e.g. two boot paths) onto one run.
  if (!running) {
    running = run().finally(() => {
      running = null;
    });
  }
  return running;
}

async function run(): Promise<void> {
  let done: string | null;
  try {
    done = await api.getAppState(LEGACY_BLOCKS_MIGRATION_FLAG);
  } catch (err) {
    console.warn("[scriptz] legacy-block migration: cannot read flag", err);
    return;
  }
  if (done) return;

  let ids: string[];
  try {
    // includeArchived: trashed scripts can be restored later and must be
    // in the new format too.
    const all = await api.listScripts({ includeArchived: true });
    ids = all.map((s) => s.id);
  } catch (err) {
    // E.g. the Studio adapter has no listScripts - nothing to migrate
    // there; the editor normalizes on load.
    console.warn("[scriptz] legacy-block migration skipped", err);
    return;
  }

  let failures = 0;
  let converted = 0;
  for (const id of ids) {
    try {
      const script = await api.getScript(id);
      const { json, changed } = normalizeLegacyContent(script.content_json);
      if (!changed) continue;
      await api.updateScript({ id, contentJson: json, internalRewrite: true });
      converted++;
    } catch (err) {
      failures++;
      console.warn("[scriptz] legacy-block migration failed for", id, err);
    }
  }

  // Runtime stats changed (former camera/caption/sfx/parenthetical blocks
  // now count as action beats) - let open lists refresh.
  if (converted > 0) scriptsBus.bump();

  if (failures === 0) {
    await api.setAppState(LEGACY_BLOCKS_MIGRATION_FLAG, String(Date.now()));
  }
}
