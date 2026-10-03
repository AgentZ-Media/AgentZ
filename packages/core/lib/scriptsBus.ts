import { createSignal } from "solid-js";

/**
 * Global "scripts changed" version. Anything that mutates the script
 * list (create / archive / restore / duplicate / purge / rename) bumps
 * the version. The library data (components/Shell/libraryData.ts) reads it as a reload trigger so the
 * list refetches no matter which view triggered the change.
 */
const [version, setVersion] = createSignal(0);

export const scriptsBus = {
  version,
  bump() {
    // Functional updater - see dailyStatsBus.ts for details. Reading `version()`
    // here would subscribe the caller (if inside an effect)
    // to the version signal itself and trigger an infinite recursion with
    // the immediately following write.
    setVersion((v) => v + 1);
  },
};
