import { createSignal } from "solid-js";

/** Version signal for the ideas list. Bumped as soon as any
 *  idea mutation (create / update / convert / delete) is done. */
const [version, setVersion] = createSignal(0);

export const ideasBus = {
  version,
  bump() {
    // Functional updater - see dailyStatsBus.ts.
    setVersion((v) => v + 1);
  },
};
