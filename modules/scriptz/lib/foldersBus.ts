import { createSignal } from "solid-js";

const [version, setVersion] = createSignal(0);

export const foldersBus = {
  version,
  bump() {
    // Funktionaler Updater - siehe dailyStatsBus.ts.
    setVersion((v) => v + 1);
  },
};
