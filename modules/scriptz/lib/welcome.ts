import { getKvStore, type KvStore } from "@agentz/kit/platform";
import { getStorageAdapter, type ScriptzStorage } from "./storage";
import { scriptsBus } from "./scriptsBus";
import { language } from "@agentz/kit/i18n";
import { getWelcomeContent } from "../i18n/welcomeContent";

const SEED_KEY = "welcome_seeded_v3";
const WELCOME_ID_KEY = "welcome_script_id_v1";

export interface WelcomeOptions {
  kv?: KvStore;
  storage?: ScriptzStorage;
  signal?: AbortSignal;
}

const pendingSeeds = new WeakMap<KvStore, WeakMap<ScriptzStorage, Promise<void>>>();

/** Bind both adapters before the first await. A remount may replace host slots
 * while a previous boot still has an in-flight read or mutation. */
export function ensureWelcomeContent(options: WelcomeOptions = {}): Promise<void> {
  const kv = options.kv ?? getKvStore();
  const storage = options.storage ?? getStorageAdapter();
  const signal = options.signal;
  let pending = pendingSeeds.get(kv);
  if (!pending) pendingSeeds.set(kv, pending = new WeakMap());
  const previous = pending.get(storage);
  const current = (previous ? previous.catch(() => {}) : Promise.resolve())
    .then(() => seed(kv, storage, signal));
  pending.set(storage, current);
  void current.finally(() => {
    if (pending.get(storage) === current) pending.delete(storage);
  }).catch(() => {});
  return current;
}

async function seed(kv: KvStore, storage: ScriptzStorage, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return;
  const seeded = await kv.getAppState(SEED_KEY);
  if (seeded || signal?.aborted) return;
  const existing = await storage.listScripts({ includeArchived: true, limit: 1 });
  if (signal?.aborted) return;
  if (existing.length === 0) {
    // Language at seed time: settings.load() has already resolved the
    // preference (auto -> navigator.language) before we land here.
    // On later language switch, the tutorial script stays as it is -
    // it's user content that the user can edit.
    const content = getWelcomeContent(language());
    const created = await storage.createScript({
      title: content.title,
      initialContentJson: content.json,
    });
    if (signal?.aborted) return;
    // Remember the welcome script id so the onboarding CTA can open
    // it directly. If the user deletes the script later, the id stays
    // but `getWelcomeScript` rechecks existence before returning it.
    await kv.setAppState(WELCOME_ID_KEY, created.id);
    if (signal?.aborted) return;
    scriptsBus.bump();
  }
  if (signal?.aborted) return;
  await kv.setAppState(SEED_KEY, "1");
}

/**
 * Resolves the welcome/tutorial script if it still exists in the
 * database. Returns null if the script was deleted, never seeded, or
 * the seed predates this id-tracking (legacy installs).
 */
export async function getWelcomeScript(): Promise<{ id: string; title: string } | null> {
  const kv = getKvStore();
  const storage = getStorageAdapter();
  const id = await kv.getAppState(WELCOME_ID_KEY);
  if (!id) return null;
  try {
    const script = await storage.getScript(id);
    return { id: script.id, title: script.title };
  } catch {
    // Script no longer exists (user purged it from trash, or the
    // record was wiped). Don't keep pointing at a ghost.
    return null;
  }
}
