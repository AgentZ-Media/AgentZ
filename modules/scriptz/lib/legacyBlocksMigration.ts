import { getKvStore, type KvStore } from "@agentz/kit/platform";
// One-time boot migration: rewrite stored scripts that still contain the
// retired block types (camera, caption, sfx) as action blocks (see
// ./legacyBlocks.ts). Parenthetical is a live block type and stays as is.
//
// Runs against the captured product adapter, so it works for every backend.
// Content is only rewritten when the normalizer actually changed
// something. The rewrite uses
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
// restored (lib/snapshots.ts).
//
// Called once by module setup, after
// the storage adapter is registered and before the first script opens:
//
//   await migrateLegacyBlocksOnce();

import { getStorageAdapter, type ScriptzStorage } from "./storage";
import { normalizeLegacyContent } from "./legacyBlocks";
import { scriptsBus } from "./scriptsBus";

export const LEGACY_BLOCKS_MIGRATION_FLAG = "migration.legacy_blocks_v1";

export interface MigrationOptions {
  kv?: KvStore;
  storage?: ScriptzStorage;
  signal?: AbortSignal;
}

const pendingRuns = new WeakMap<KvStore, WeakMap<ScriptzStorage, Promise<void>>>();

export function migrateLegacyBlocksOnce(options: MigrationOptions = {}): Promise<void> {
  const kv = options.kv ?? getKvStore();
  const storage = options.storage ?? getStorageAdapter();
  const signal = options.signal;
  let pending = pendingRuns.get(kv);
  if (!pending) pendingRuns.set(kv, pending = new WeakMap());
  const previous = pending.get(storage);
  // Serialize only this adapter pair. A replacement boot gets its own signal
  // and rechecks the flag after the old run finishes (or was cancelled).
  const current = (previous ? previous.catch(() => {}) : Promise.resolve())
    .then(() => run(kv, storage, signal));
  pending.set(storage, current);
  void current.finally(() => {
    if (pending.get(storage) === current) pending.delete(storage);
  }).catch(() => {});
  return current;
}

async function run(kv: KvStore, storage: ScriptzStorage, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return;
  let done: string | null;
  try {
    done = await kv.getAppState(LEGACY_BLOCKS_MIGRATION_FLAG);
  } catch (err) {
    console.warn("[scriptz] legacy-block migration: cannot read flag", err);
    return;
  }
  if (done || signal?.aborted) return;

  let ids: string[];
  try {
    // includeArchived: trashed scripts can be restored later and must be
    // in the new format too.
    const all = await storage.listScripts({ includeArchived: true });
    ids = all.map((s) => s.id);
  } catch (err) {
    // Retry on the next boot if the script list is unavailable.
    // The editor also normalizes content on load.
    console.warn("[scriptz] legacy-block migration skipped", err);
    return;
  }

  let failures = 0;
  let converted = 0;
  for (const id of ids) {
    if (signal?.aborted) return;
    try {
      const script = await storage.getScript(id);
      if (signal?.aborted) return;
      const { json, changed } = normalizeLegacyContent(script.content_json);
      if (!changed) continue;
      await storage.updateScript({ id, contentJson: json, internalRewrite: true });
      converted++;
    } catch (err) {
      failures++;
      console.warn("[scriptz] legacy-block migration failed for", id, err);
    }
  }

  if (signal?.aborted) return;

  // Runtime stats changed (former camera/caption/sfx blocks now count as
  // action beats) - let open lists refresh.
  if (converted > 0) scriptsBus.bump();

  if (failures === 0 && !signal?.aborted) {
    await kv.setAppState(LEGACY_BLOCKS_MIGRATION_FLAG, String(Date.now()));
  }
}
