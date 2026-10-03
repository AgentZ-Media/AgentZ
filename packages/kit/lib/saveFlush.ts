import type { SaveResult } from "./serialSave";

export interface FlushResult {
  ok: boolean;
  /** Names of failed or timed-out registrations, in registration order. */
  failed: string[];
  /** Subset of `failed` that holds user content (see `FlushKind`). */
  contentFailed: string[];
}

/** `content` holds user work (editor text, titles, ideas) and gates
 *  navigation and data-reading operations. `state` is UI state or a
 *  setting whose failure is reported but never blocks the user. Window
 *  close and quit always wait for both kinds. */
export type FlushKind = "content" | "state";

export type Flusher = (timeoutMs: number) => void | SaveResult | PromiseLike<void | SaveResult>;

/** Coordinates independent buffered writes without owning their lifecycle. */
export class FlushCoordinator {
  private readonly flushers = new Map<symbol, { fn: Flusher; name: string; kind: FlushKind }>();
  private nextId = 0;

  register(fn: Flusher, name = `save-${++this.nextId}`, kind: FlushKind = "content"): () => void {
    const id = Symbol(name);
    this.flushers.set(id, { fn, name, kind });
    return () => { this.flushers.delete(id); };
  }

  async flush(timeoutMs = 2000): Promise<FlushResult> {
    // Each call takes a fresh snapshot so later edits cannot accidentally
    // share an older flush pass. Individual savers serialize their writes.
    const entries = [...this.flushers.values()];
    if (!entries.length) return { ok: true, failed: [], contentFailed: [] };
    const states: Array<"pending" | "ok" | "failed"> = entries.map(() => "pending");
    const tasks = entries.map(({ fn }, index) => Promise.resolve().then(() => fn(timeoutMs)).then(
      (result) => { states[index] = result?.ok === false ? "failed" : "ok"; },
      () => { states[index] = "failed"; },
    ));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
    });
    try {
      await Promise.race([Promise.all(tasks), timeout]);
    } finally {
      clearTimeout(timer);
    }
    // Timed-out writes keep their rejection handlers and may finish later;
    // the result is an immutable snapshot of this pass, not a cancellation.
    const failedEntries = entries.filter((_, index) => states[index] !== "ok");
    const failed = failedEntries.map(({ name }) => name);
    const contentFailed = failedEntries.filter(({ kind }) => kind === "content").map(({ name }) => name);
    return { ok: failed.length === 0, failed, contentFailed };
  }
}

export const flushCoordinator = new FlushCoordinator();
export const registerFlusher = (fn: Flusher, name?: string, kind?: FlushKind): (() => void) =>
  flushCoordinator.register(fn, name, kind);
export const flushAll = (timeoutMs = 2000): Promise<FlushResult> => flushCoordinator.flush(timeoutMs);
