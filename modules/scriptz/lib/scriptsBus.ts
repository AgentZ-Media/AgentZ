import { createVersionBus } from "./versionBus";

/**
 * Global "scripts changed" version. Anything that mutates the script
 * list (create / archive / restore / duplicate / purge / rename) bumps
 * the version. The library data (components/Shell/libraryData.ts) reads it as a reload trigger so the
 * list refetches no matter which view triggered the change.
 */
export const scriptsBus = createVersionBus();
