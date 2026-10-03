import { bootDesktopApp } from "@agentz/desktop";

// Build-only fixture: exercise the same public named import as every app.
bootDesktopApp({
  id: "fixture",
  loadModule: async () => { throw new Error("Build-only fixture"); },
});
