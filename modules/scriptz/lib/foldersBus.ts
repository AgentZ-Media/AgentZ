import { createSignal } from "solid-js";

const [version, setVersion] = createSignal(0);

export const foldersBus = {
  version,
  bump() {
    // Functional updater - see dailyStatsBus.ts.
    setVersion((v) => v + 1);
  },
};
