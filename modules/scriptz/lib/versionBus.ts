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
