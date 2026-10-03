import type { LexicalEditor } from "lexical";
import { api } from "../../lib/api";
import { scriptsBus } from "../../lib/scriptsBus";
import { registerFlusher } from "../../lib/saveFlush";
import { saveStatusStore } from "../../stores/saveStatus";
import type { ScriptCharacter } from "../../lib/types";

const SAVE_DEBOUNCE_MS = 250;
const AUTO_SNAPSHOT_MS = 5 * 60 * 1000;

/** Heuristic: is `contentJson` an "empty" Lexical doc? Used by the
 *  teardown-race guard below. */
function isContentEffectivelyEmpty(json: string): boolean {
  try {
    const root = (JSON.parse(json) as { root?: { children?: unknown[] } })
      ?.root;
    if (!root || !Array.isArray(root.children) || root.children.length === 0)
      return true;
    let totalText = 0;
    const walk = (n: unknown): void => {
      if (typeof n !== "object" || n === null) return;
      const o = n as { type?: string; text?: string; children?: unknown[] };
      if (o.type === "text" && typeof o.text === "string")
        totalText += o.text.length;
      if (Array.isArray(o.children)) o.children.forEach(walk);
    };
    walk(root);
    return totalText === 0;
  } catch {
    return true;
  }
}

export interface PersistenceOptions {
  editor: LexicalEditor;
  scriptId: string;
  initialContentJson: string | null | undefined;
  /** Hook to update the live character list AFTER a successful save —
   *  delegates to `characterReconcile.mergeAfterSave`. */
  mergeAfterSave: (summary: { characters: ScriptCharacter[] }) => void;
  /** Cache of the app-wide character colors (name.toUpperCase() → color).
   *  Updated in place after every save so a name retyped in a later script
   *  immediately gets the canonical color. */
  knownColors: Map<string, string>;
  onSavingChange?: (saving: boolean) => void;
}

export interface PersistenceHandle {
  /** (Re)arms the debounced save. Called from the editor's update listener
   *  for every content-changing tick; the save itself is skipped when the
   *  serialized state equals the last persisted one. */
  scheduleSave: () => void;
  /** Tears down the save timer, auto-snapshot interval and global
   *  flusher registration. Also fires a final teardown-flagged
   *  `persist()` if a save was buffered. */
  teardown: () => void;
}

/** Owns the entire save lifecycle of an editor instance: debounced save,
 *  CAS-style "don't overwrite real content with empty during teardown"
 *  guard, server-assigned color merge, auto-snapshot interval, and the
 *  `registerFlusher` hook for window-close. The Editor.tsx onMount only
 *  needs to call `scheduleSave()` from its update listener and dispose
 *  via the returned `teardown`. */
export function createPersistence(opts: PersistenceOptions): PersistenceHandle {
  const {
    editor,
    scriptId,
    initialContentJson,
    mergeAfterSave,
    knownColors,
    onSavingChange,
  } = opts;

  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let dirtySinceSnapshot = false;
  // Last content we successfully wrote to the DB. The teardown-race guard
  // compares against this when an unmount/flush sees an empty editor state.
  let lastPersistedContent = initialContentJson ?? "";

  const persist = async (fromTeardown = false): Promise<void> => {
    let contentJson = "";
    editor.getEditorState().read(() => {
      const state = editor.getEditorState();
      contentJson = JSON.stringify(state.toJSON());
    });
    // Nothing changed since the last write - typically the update right
    // after loading the script, which re-serializes the stored state
    // byte-for-byte. Writing anyway would bump updated_at, so merely
    // opening a script would reorder "Geändert" and show "Gerade eben".
    if (contentJson === lastPersistedContent) return;

    // Safety net: if the editor state is empty NOW and the last
    // successfully saved state had content, on a teardown that's a
    // clear race symptom (editor torn down while a debounced /
    // onCleanup persist() was in flight). We block this only on
    // teardown — a legitimate "clear the script" via the user would
    // otherwise be unfixable.
    if (
      fromTeardown &&
      isContentEffectivelyEmpty(contentJson) &&
      lastPersistedContent &&
      !isContentEffectivelyEmpty(lastPersistedContent)
    ) {
      console.warn(
        "[scriptz] persist() abgebrochen: Teardown-Flush mit leerem " +
          "Editor-State, letzter gespeicherter Stand war nicht leer - " +
          "vermutlich Unmount-Race. Keine Überschreibung.",
      );
      return;
    }

    onSavingChange?.(true);
    saveStatusStore.startSaving();
    try {
      const summary = await api.updateScript({ id: scriptId, contentJson });
      lastPersistedContent = contentJson;
      // Only real writes make an auto snapshot worthwhile.
      dirtySinceSnapshot = true;
      saveStatusStore.markSaved();
      scriptsBus.bump();

      // Update the cache so a name retyped in a later script
      // immediately gets the canonical color.
      for (const c of summary.characters) {
        knownColors.set(c.name.toUpperCase(), c.color);
      }
      mergeAfterSave(summary);
    } catch (err) {
      console.error("[scriptz] auto-save failed", err);
      saveStatusStore.markError(err);
    } finally {
      onSavingChange?.(false);
    }
  };

  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      void persist();
    }, SAVE_DEBOUNCE_MS);
  };

  // Window-close / unmount / hot-reload: persist immediately instead of
  // dropping the buffered 250 ms of typing.
  const flushPending = async (): Promise<void> => {
    if (!saveTimer) return;
    clearTimeout(saveTimer);
    saveTimer = null;
    try {
      await persist(true);
    } catch (err) {
      console.warn("[scriptz] flushPending failed", err);
    }
  };
  const unregisterFlusher = registerFlusher(flushPending);

  const snapshotTimer = setInterval(() => {
    if (!dirtySinceSnapshot) return;
    // Only clear the dirty flag AFTER a successful snapshot. If we
    // cleared it up-front, a failed call would silently swallow the
    // dirtiness — the next tick would see "not dirty" and skip, leaving
    // a gap in the version history. Now a failed call keeps the flag
    // set and the next 5 min tick tries again.
    void api.createSnapshot(scriptId, "auto").then(
      () => {
        dirtySinceSnapshot = false;
      },
      (err) => {
        console.warn("[scriptz] snapshot failed", err);
      },
    );
  }, AUTO_SNAPSHOT_MS);

  const teardown = () => {
    // Critical: flush any debounced save before tearing down so the
    // last 250 ms of typing isn't lost when switching scripts, closing
    // a tab, or unmounting on hot-reload. Fire-and-forget — the IPC
    // continues independently of the editor instance.
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
      void persist(true);
    }
    unregisterFlusher();
    clearInterval(snapshotTimer);
  };

  return { scheduleSave, teardown };
}
