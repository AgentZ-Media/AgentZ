import { bootDesktopApp } from "@agentz/desktop";

const app = bootDesktopApp({
  id: "sandbox",
  loadModule: async () => {
    await import("@agentz/sandbox/styles.css");
    const { appModule } = await import("@agentz/sandbox");
    return appModule;
  },
});
if (import.meta.hot) import.meta.hot.dispose(() => { void app.dispose(); });
