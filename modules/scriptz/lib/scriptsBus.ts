import type { ScriptSummary } from "./types";
import { createEventBus, createVersionBus } from "./versionBus";

/**
 * Global "scripts changed" version. Anything that changes the script list
 * (create / archive / restore / duplicate / purge / rename / stage / folder)
 * bumps the version. The library data (components/Shell/libraryData.ts)
 * reads it as a reload trigger so the list refetches no matter which view
 * triggered the change.
 */
export const scriptsBus = createVersionBus();

/**
 * One script's content was saved (autosave). Carries the fresh summary, so
 * caches patch that one row instead of reloading every script: at 10,000
 * scripts a full reload per 250 ms autosave dominated typing. Readers that
 * follow content (the open script, learning, the export preview) listen
 * here in addition to `scriptsBus`.
 */
export const scriptSavedBus = createEventBus<ScriptSummary>();
