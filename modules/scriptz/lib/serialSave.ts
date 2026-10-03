// Serialized "latest draft wins" saver.
//
// Every autosaving surface (editor content, idea title/notes, inline
// titles, settings fields) has the same shape: a draft that changes
// locally, an async write, and a baseline that says what is already
// stored. Doing this ad hoc led to two classes of bugs:
//
//   1. Overlapping writes. Save B is in flight, the user reverts to A
//      (undo, retyping) - an equality check against a baseline that only
//      updates after B finishes skips A, then B lands and stays stored.
//   2. Stale baselines. Comparing against asynchronously refreshed props
//      instead of what the last acknowledged write stored.
//
// This helper fixes both at the root:
//   - All writes run through a single promise queue (never in parallel).
//   - The draft is read and compared when a queued save actually RUNS,
//     against the baseline of the last ACKNOWLEDGED write.
//   - `flush()` resolves only after the whole queue drained, so callers
//     (navigation, window close, export) see every edit persisted.

export type SaveReason = "debounce" | "flush" | "teardown";

const REASON_RANK: Record<SaveReason, number> = { debounce: 0, flush: 1, teardown: 2 };

export interface SerialSaverOptions<D, B> {
  /** Baseline of what is stored right now (e.g. the loaded content). */
  initial: B;
  /** Reads the current draft. Called when a queued save starts, never
   *  earlier, so a save always writes the newest state. */
  read(): D;
  /** True when `draft` needs no write relative to the acknowledged
   *  baseline. Optional: without it every dirty run calls `write`. */
  isClean?(draft: D, baseline: B): boolean;
  /** Persists `draft`. Resolves with the new acknowledged baseline (return
   *  `baseline` unchanged to skip deliberately). A rejection keeps the old
   *  baseline and leaves the saver dirty, so the next flush retries. */
  write(draft: D, baseline: B, reason: SaveReason): Promise<B>;
  /** Called with errors thrown by `write`. */
  onError?(err: unknown): void;
  /** Debounce for `schedule()`. Default 0 (next macrotask). */
  delayMs?: number;
}

export interface SerialSaver<B> {
  /** Marks the draft dirty and (re)arms the debounced save. */
  schedule(): void;
  /** Marks the draft dirty without arming a timer (blur/Enter commits). */
  markDirty(): void;
  /** Cancels the debounce, queues a save if anything is dirty and resolves
   *  once every queued write (including earlier in-flight ones) settled. */
  flush(reason?: SaveReason): Promise<void>;
  /** Baseline of the last acknowledged write. */
  baseline(): B;
  /** Replaces the baseline after an out-of-band change (external rename,
   *  reload). Only meaningful while `idle()`. */
  resetBaseline(next: B): void;
  /** No timer armed, nothing dirty, nothing queued or in flight. */
  idle(): boolean;
  /** True while a write is queued or running. */
  busy(): boolean;
  /** Drops the debounce timer without saving. */
  cancel(): void;
}

export function createSerialSaver<D, B = D>(opts: SerialSaverOptions<D, B>): SerialSaver<B> {
  let base = opts.initial;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let dirty = false;
  let tail: Promise<void> = Promise.resolve();
  let active = 0;
  // A queued run that hasn't started yet reads the newest draft anyway, so
  // further requests coalesce into it (only the reason may escalate).
  let pending: { reason: SaveReason } | null = null;

  const run = async (reason: SaveReason): Promise<void> => {
    dirty = false;
    let draft: D;
    try {
      draft = opts.read();
    } catch (err) {
      dirty = true;
      opts.onError?.(err);
      return;
    }
    if (opts.isClean?.(draft, base)) return;
    try {
      base = await opts.write(draft, base, reason);
    } catch (err) {
      dirty = true;
      opts.onError?.(err);
    }
  };

  const enqueue = (reason: SaveReason): Promise<void> => {
    if (pending) {
      if (REASON_RANK[reason] > REASON_RANK[pending.reason]) pending.reason = reason;
      return tail;
    }
    const slot = { reason };
    pending = slot;
    active++;
    const next = tail.then(() => {
      pending = null;
      return run(slot.reason);
    });
    tail = next.finally(() => {
      active--;
    });
    return tail;
  };

  const clearTimer = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return {
    schedule() {
      dirty = true;
      clearTimer();
      timer = setTimeout(() => {
        timer = null;
        if (dirty) void enqueue("debounce");
      }, opts.delayMs ?? 0);
    },
    markDirty() {
      dirty = true;
    },
    flush(reason: SaveReason = "flush") {
      clearTimer();
      if (dirty) return enqueue(reason);
      return tail;
    },
    baseline: () => base,
    resetBaseline(next: B) {
      base = next;
    },
    idle: () => !timer && !dirty && active === 0,
    busy: () => active > 0,
    cancel: clearTimer,
  };
}
