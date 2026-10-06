/* @refresh reload */
import { bootDesktopApp, createCodexHost } from "@agentz/desktop";

const app = bootDesktopApp({
  id: "scriptz",
  async loadModule() {
    // The chunks load side by side; none of them does I/O on import.
    const [, { registerSqlStorageAdapter }, { scriptzModule }] = await Promise.all([
      import("@agentz/scriptz/styles.css"),
      import("@agentz/scriptz/storage"),
      import("@agentz/scriptz"),
    ]);
    registerSqlStorageAdapter();
    return scriptzModule;
  },
  // Inert until the module calls it; creating the host performs no I/O.
  services: { codexHost: createCodexHost() },
});

if (import.meta.hot) import.meta.hot.dispose(() => app.dispose());
