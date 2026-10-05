/* @refresh reload */
import { bootDesktopApp, createCodexHost } from "@agentz/desktop";

const app = bootDesktopApp({
  id: "scriptz",
  async loadModule() {
    await import("@agentz/scriptz/styles.css");
    const { registerSqlStorageAdapter } = await import("@agentz/scriptz/storage");
    registerSqlStorageAdapter();
    const { scriptzModule } = await import("@agentz/scriptz");
    return scriptzModule;
  },
  // Inert until the module calls it; creating the host performs no I/O.
  services: { codexHost: createCodexHost() },
});

if (import.meta.hot) import.meta.hot.dispose(() => app.dispose());
