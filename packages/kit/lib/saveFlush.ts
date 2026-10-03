import type { SaveResult } from "./serialSave";

export interface FlushResult {
  ok: boolean;
  /** Names of failed or timed-out registrations, in registration order. */
  failed: string[];
}

export type Flusher = () => void | SaveResult | PromiseLike<void | SaveResult>;

/** Coordinates independent buffered writes without owning their lifecycle. */
export class FlushCoordinator {
  private readonly flushers = new Map<symbol, { fn: Flusher; name: string }>();
  private nextId = 0;

  register(fn: Flusher, name = `save-${++this.nextId}`): () => void {
    const id = Symbol(name);
    this.flushers.set(id, { fn, name });
    return () => { this.flushers.delete(id); };
  }

  async flush(timeoutMs = 2000): Promise<FlushResult> {
    // Each call takes a fresh snapshot so later edits cannot accidentally
    // share an older flush pass. Individual savers serialize their writes.
    const entries = [...this.flushers.values()];
    if (!entries.length) return { ok: true, failed: [] };
    const states: Array<"pending" | "ok" | "failed"> = entries.map(() => "pending");
    const tasks = entries.map(({ fn }, index) => Promise.resolve().then(fn).then(
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
    const failed = entries.filter((_, index) => states[index] !== "ok").map(({ name }) => name);
    return { ok: failed.length === 0, failed };
  }
}

export const flushCoordinator = new FlushCoordinator();
export const registerFlusher = (fn: Flusher, name?: string): (() => void) => flushCoordinator.register(fn, name);
export const flushAll = (timeoutMs = 2000): Promise<FlushResult> => flushCoordinator.flush(timeoutMs);
