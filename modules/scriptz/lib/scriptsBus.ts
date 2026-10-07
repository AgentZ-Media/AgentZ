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

/**
 * `row` with the fields an autosave owns: everything derived from the
 * content. Title, folder and stage come from their own writes, which bump
 * `scriptsBus`; a summary read before such a write must not roll them back.
 */
export function withSavedContent<T extends ScriptSummary>(row: T, saved: ScriptSummary): T {
  return {
    ...row,
    updated_at: Math.max(row.updated_at, saved.updated_at),
    page_count: saved.page_count,
    word_count: saved.word_count,
    dialog_word_count: saved.dialog_word_count,
    direction_block_count: saved.direction_block_count,
    characters: saved.characters,
  };
}

/** A script's stored content was replaced from outside the editor (cloud
 *  sync). An open editor showing it reloads; the value is the script ID. */
export const remoteScriptBus = createEventBus<string>();
