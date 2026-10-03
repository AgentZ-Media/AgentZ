// Title + notes drafts of the inline idea editor, kept per idea id.
//
// The editor mounts while its row is open and unmounts on collapse. If it
// owned its drafts, collapsing A, opening B and reopening A while A's save
// is still in flight would remount A from the cached ideas list, which only
// refreshes after the save AND the refetch landed - the editor would show
// the old notes, never resync, and the next keystroke would overwrite the
// earlier addition.
//
// So the drafts and their serial saver live here, outside the component,
// and survive remounts. An entry is dropped once nothing is pending, no
// editor shows it and the store reflects what was acknowledged; the next
// mount then starts from the (now current) store again.

import { createEffect, createRoot, createSignal, on, type Accessor } from "solid-js";
import { registerFlusher } from "@agentz/kit/lib";
import { createSerialSaver, type SerialSaver } from "@agentz/kit/lib";
import { ideasStore } from "../../../stores/ideas";
import { pushToast } from "@agentz/kit/stores";
import { t } from "../../../i18n";
import type { Idea } from "../../../lib/types";

export const IDEA_SAVE_DELAY_MS = 600;

export interface IdeaDraftValue {
  title: string;
  notes: string;
}

export interface IdeaDraft {
  readonly id: string;
  title: Accessor<string>;
  setTitle(v: string): void;
  notes: Accessor<string>;
  setNotes(v: string): void;
  saver: SerialSaver<IdeaDraftValue>;
}

interface Entry extends IdeaDraft {
  mounts: number;
  dispose(): void;
}

const entries = new Map<string, Entry>();

function storedIdea(id: string): Idea | undefined {
  return (ideasStore.ideas() ?? []).find((i) => i.id === id);
}

function draftClean(e: Entry): boolean {
  const b = e.saver.baseline();
  const title = e.title().trim();
  return (title === "" || title === b.title) && e.notes() === b.notes;
}

/** Store and acknowledged baseline agree. */
function inSync(e: Entry, cur: Idea): boolean {
  const b = e.saver.baseline();
  return cur.title === b.title && cur.notes === b.notes;
}

function drop(e: Entry) {
  entries.delete(e.id);
  e.dispose();
}

/** Drops an unmounted entry once nothing is pending and the store shows
 *  what was acknowledged (or the idea is gone / converted, so there is
 *  nothing left to write). */
function maybeDrop(e: Entry) {
  if (entries.get(e.id) !== e || e.mounts > 0 || !e.saver.idle()) return;
  const cur = storedIdea(e.id);
  if (!cur || cur.used_at || (draftClean(e) && inSync(e, cur))) drop(e);
}

/** The ideas list was refetched. */
function onStoreChange(e: Entry) {
  if (entries.get(e.id) !== e || !e.saver.idle()) return;
  const cur = storedIdea(e.id);
  if (!cur || cur.used_at || inSync(e, cur)) {
    maybeDrop(e);
    return;
  }
  if (!draftClean(e)) return;
  // Nothing pending, the fields hold what was stored, but the store now
  // says otherwise: changed elsewhere. Values arriving here are never older
  // than our last write - every write bumps the ideas bus, and the refetch
  // it starts supersedes any fetch that began before it.
  if (e.mounts === 0) {
    drop(e);
    return;
  }
  e.saver.resetBaseline({ title: cur.title, notes: cur.notes });
  e.setTitle(cur.title);
  e.setNotes(cur.notes);
}

function createEntry(idea: Idea): Entry {
  return createRoot((dispose) => {
    const [title, setTitle] = createSignal(idea.title);
    const [notes, setNotes] = createSignal(idea.notes);
    const saver = createSerialSaver<IdeaDraftValue>({
      initial: { title: idea.title, notes: idea.notes },
      read: () => ({ title: title().trim(), notes: notes() }),
      isClean: (d, b) => (!d.title || d.title === b.title) && d.notes === b.notes,
      delayMs: IDEA_SAVE_DELAY_MS,
      async write(d, b) {
        // Deleted or converted (read-only) ideas: nothing to write.
        const cur = storedIdea(idea.id);
        if (!cur || cur.used_at) return b;
        const patch: { id: string; title?: string; notes?: string } = { id: idea.id };
        if (d.title && d.title !== b.title) patch.title = d.title;
        if (d.notes !== b.notes) patch.notes = d.notes;
        await ideasStore.updateIdea(patch);
        return { title: patch.title ?? b.title, notes: patch.notes ?? b.notes };
      },
      onError: (err) =>
        pushToast(t("common.errorPrefix", { message: (err as Error)?.message ?? String(err) }), "error"),
    });
    // Window close / navigation drain this entry even after its panel is gone.
    const unregister = registerFlusher(async () => {
      const result = await saver.flush();
      maybeDrop(entry);
      return result;
    }, `idea:${idea.id}`);
    const entry: Entry = {
      id: idea.id,
      title,
      setTitle: (v) => setTitle(v),
      notes,
      setNotes: (v) => setNotes(v),
      saver,
      mounts: 0,
      dispose() {
        unregister();
        dispose();
      },
    };
    // Every store refresh (e.g. the refetch after our own write) is a
    // chance to resync or drop the entry.
    createEffect(
      on(
        () => ideasStore.ideas(),
        () => onStoreChange(entry),
        { defer: true },
      ),
    );
    return entry;
  });
}

/** Drafts for `idea`, reusing pending ones from an earlier mount. Call
 *  `releaseIdeaDraft` on unmount. */
export function acquireIdeaDraft(idea: Idea): IdeaDraft {
  let e = entries.get(idea.id);
  if (!e) {
    e = createEntry(idea);
    entries.set(idea.id, e);
  }
  e.mounts++;
  return e;
}

/** Unmount: writes what's left; the entry goes once it is in sync. */
export function releaseIdeaDraft(draft: IdeaDraft): void {
  const e = entries.get(draft.id);
  if (!e || e !== draft) return;
  e.mounts = Math.max(0, e.mounts - 1);
  void e.saver.flush("teardown").finally(() => maybeDrop(e));
}

/** Test hook: number of live draft entries. */
export function ideaDraftCount(): number {
  return entries.size;
}
