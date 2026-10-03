/* @refresh reload */
import { bootDesktopApp } from "@agentz/desktop";

const app = bootDesktopApp({
  id: "scriptz",
  async loadModule() {
    await import("@agentz/scriptz/styles.css");
    const { registerSqlStorageAdapter } = await import("@agentz/scriptz/storage");
    registerSqlStorageAdapter();
    const { scriptzModule } = await import("@agentz/scriptz");
    return scriptzModule;
  },
});

if (import.meta.hot) import.meta.hot.dispose(() => app.dispose());
