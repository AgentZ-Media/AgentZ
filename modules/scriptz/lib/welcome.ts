import { api } from "./api";
import { scriptsBus } from "./scriptsBus";
import { language } from "../i18n";
import { getWelcomeContent } from "../i18n/welcomeContent";

const SEED_KEY = "welcome_seeded_v3";
const WELCOME_ID_KEY = "welcome_script_id_v1";

export async function ensureWelcomeContent(): Promise<void> {
  const seeded = await api.getAppState(SEED_KEY);
  if (seeded) return;
  const existing = await api.listScripts({ includeArchived: true, limit: 1 });
  if (existing.length === 0) {
    // Language at seed time: settings.load() has already resolved the
    // preference (auto -> navigator.language) before we land here.
    // On later language switch, the tutorial script stays as it is -
    // it's user content that the user can edit.
    const content = getWelcomeContent(language());
    const created = await api.createScript({
      title: content.title,
      initialContentJson: content.json,
    });
    // Remember the welcome script id so the onboarding CTA can open
    // it directly. If the user deletes the script later, the id stays
    // but `openWelcomeOrNull` rechecks existence before returning it.
    await api.setAppState(WELCOME_ID_KEY, created.id);
    scriptsBus.bump();
  }
  await api.setAppState(SEED_KEY, "1");
}

/**
 * Resolves the welcome/tutorial script if it still exists in the
 * database. Returns null if the script was deleted, never seeded, or
 * the seed predates this id-tracking (legacy installs).
 */
export async function getWelcomeScript(): Promise<{ id: string; title: string } | null> {
  const id = await api.getAppState(WELCOME_ID_KEY);
  if (!id) return null;
  try {
    const script = await api.getScript(id);
    return { id: script.id, title: script.title };
  } catch {
    // Script no longer exists (user purged it from trash, or the
    // record was wiped). Don't keep pointing at a ghost.
    return null;
  }
}
