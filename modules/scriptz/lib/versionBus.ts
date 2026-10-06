import { createSignal, type Accessor } from "solid-js";

/** Reload trigger shared by the `*Bus.ts` modules: readers track
 *  `version()`, writers call `bump()` after a mutation. */
export interface VersionBus {
  version: Accessor<number>;
  bump(): void;
}

export function createVersionBus(): VersionBus {
  const [version, setVersion] = createSignal(0);
  return {
    version,
    bump() {
      // Functional updater instead of `setVersion(version() + 1)`. Otherwise
      // `version()` would attach the caller's subscription (e.g. a
      // createEffect that calls `bump()`) to the version signal itself - and
      // the immediately following `setVersion` would trigger the same
      // subscription again → hard infinite recursion via `markDownstream`.
      setVersion((v) => v + 1);
    },
  };
}

/** A version bus whose bumps carry a value. Listeners get every value in
 *  order (a signal alone would only keep the last one); reactive readers
 *  that only need "something happened" track `version()`. */
export interface EventBus<T> {
  version: Accessor<number>;
  emit(value: T): void;
  /** Returns the unsubscribe function. */
  listen(fn: (value: T) => void): () => void;
}

export function createEventBus<T>(): EventBus<T> {
  const bus = createVersionBus();
  const listeners = new Set<(value: T) => void>();
  return {
    version: bus.version,
    emit(value) {
      for (const fn of [...listeners]) fn(value);
      bus.bump();
    },
    listen(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
