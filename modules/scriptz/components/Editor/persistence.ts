import type { LexicalEditor } from "lexical";
import { api } from "../../lib/api";
import { scriptsBus } from "../../lib/scriptsBus";
import { registerFlusher } from "@agentz/kit/lib";
import { createSerialSaver, type SaveResult } from "@agentz/kit/lib";
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
}

export interface PersistenceHandle {
  /** (Re)arms the debounced save. Called from the editor's update listener
   *  for every content-changing tick; the save itself is skipped when the
   *  serialized state equals the last ACKNOWLEDGED write. */
  scheduleSave: () => void;
  /** Persists buffered edits now and resolves once every queued or
   *  in-flight save has finished. */
  flush: () => Promise<SaveResult>;
  /** Tears down the save timer and auto-snapshot interval and fires a
   *  final teardown-flagged save if anything is buffered. The global
   *  flusher stays registered until that save settled, so a window close
   *  right after a script switch still awaits it. */
  teardown: () => void;
}

/** Owns the entire save lifecycle of an editor instance: debounced save,
 *  CAS-style "don't overwrite real content with empty during teardown"
 *  guard, persisted color merge, auto-snapshot interval, and the
 *  `registerFlusher` hook for window-close / navigation. The Editor.tsx
 *  onMount only needs to call `scheduleSave()` from its update listener
 *  and dispose via the returned `teardown`.
 *
 *  Saves are serialized through `createSerialSaver`: the editor state is
 *  read when a queued save actually runs and compared against the content
 *  of the last acknowledged write. That way an undo back to the stored
 *  state while a newer save is still in flight is written after it
 *  instead of being skipped. */
export function createPersistence(opts: PersistenceOptions): PersistenceHandle {
  const {
    editor,
    scriptId,
    initialContentJson,
    mergeAfterSave,
    knownColors,
  } = opts;

  let dirtySinceSnapshot = false;

  let teardownSnapshot: { content: string } | { error: unknown } | undefined;
  const readContent = (): string => {
    if (teardownSnapshot) {
      if ("error" in teardownSnapshot) throw teardownSnapshot.error;
      return teardownSnapshot.content;
    }
    let contentJson = "";
    editor.getEditorState().read(() => {
      contentJson = JSON.stringify(editor.getEditorState().toJSON());
    });
    return contentJson;
  };

  const saver = createSerialSaver<string>({
    initial: initialContentJson ?? "",
    read: readContent,
    // Nothing changed since the last acknowledged write - typically the
    // update right after loading the script, which re-serializes the
    // stored state byte-for-byte. Writing anyway would bump updated_at, so
    // merely opening a script would reorder "Geändert" and show "Gerade
    // eben".
    isClean: (draft, baseline) => draft === baseline,
    delayMs: SAVE_DEBOUNCE_MS,
    async write(contentJson, baseline, reason) {
      // Safety net: if the editor state is empty NOW and the last
      // successfully saved state had content, on a teardown that's a
      // clear race symptom (editor torn down while a debounced save was
      // in flight). We block this only on teardown - a legitimate "clear
      // the script" via the user would otherwise be unfixable.
      if (
        reason === "teardown" &&
        isContentEffectivelyEmpty(contentJson) &&
        baseline &&
        !isContentEffectivelyEmpty(baseline)
      ) {
        console.warn(
          "[scriptz] persist() skipped: teardown flush with an empty editor " +
            "state while the last saved content was not empty - likely an " +
            "unmount race. Not overwriting.",
        );
        return baseline;
      }

      saveStatusStore.startSaving();
      try {
        const summary = await api.updateScript({ id: scriptId, contentJson });
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
        return contentJson;
      } catch (err) {
        saveStatusStore.markError(err);
        throw err;
      }
    },
    onError: (err) => console.error("[scriptz] auto-save failed", err),
  });

  const scheduleSave = () => saver.schedule();

  // Window-close / navigation / export: persist immediately instead of
  // dropping the buffered 250 ms of typing, and wait for saves already in
  // flight.
  let disposed = false;
  const flush = async () => {
    const result = await saver.flush(disposed ? "teardown" : "flush");
    if (disposed && result.ok) unregisterFlusher();
    return result;
  };
  const unregisterFlusher = registerFlusher(flush, `editor:${scriptId}`);

  const snapshotTimer = setInterval(() => {
    if (!dirtySinceSnapshot) return;
    // Only clear the dirty flag AFTER a successful snapshot. If we
    // cleared it up-front, a failed call would silently swallow the
    // dirtiness - the next tick would see "not dirty" and skip, leaving
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
    // last 250 ms of typing isn't lost when switching scripts or
    // unmounting on hot-reload. The queue continues independently of the
    // editor instance; the flusher is unregistered once it drained.
    // Lexical may clear its document after teardown; retries must keep the
    // final live draft rather than read an already disposed editor.
    if (!teardownSnapshot) {
      try { teardownSnapshot = { content: readContent() }; }
      catch (error) { teardownSnapshot = { error }; }
    }
    clearInterval(snapshotTimer);
    disposed = true;
    void flush();
  };

  return { scheduleSave, flush, teardown };
}
