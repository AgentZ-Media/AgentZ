import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppModule } from "@agentz/kit/shell";
import type { DesktopApp } from "../boot";
const mocks = vi.hoisted(() => ({
  invoke: vi.fn(async () => {}),
  listen: vi.fn(async (_name: string, _handler: (event: { payload: unknown }) => void) => vi.fn()),
  close: vi.fn(async () => vi.fn()),
  createPlatform: vi.fn(() => ({ platform: "macos", getDb: vi.fn() })),
  updater: { store: { startBackgroundPolling: vi.fn(), stopBackgroundPolling: vi.fn() }, dispose: vi.fn() },
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ onCloseRequested: mocks.close, destroy: vi.fn() }) }));
vi.mock("../lib/platform", () => ({ createDesktopPlatform: mocks.createPlatform }));
vi.mock("../stores/updates", () => ({ createDesktopUpdates: () => mocks.updater }));
vi.mock("../components/Common/UpdateIndicator", () => ({ UpdateIndicator: () => null }));
vi.mock("@agentz/kit/shell", async () => {
  const { shellUi } = await import("@agentz/kit/stores");
  return { SuiteShell: () => { shellUi.reset(); return <div data-testid="shell" />; } };
});
import { shellUi } from "@agentz/kit/stores";
import { bootDesktopApp } from "../boot";
const module = { id: "fixture" } as AppModule;
const apps: DesktopApp[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.dispose();
  document.body.replaceChildren(); vi.clearAllMocks(); shellUi.reset();
});
function root() { const element = document.createElement("div"); element.id = "root"; document.body.append(element); }
function boot(loadModule: () => Promise<AppModule>) { const app = bootDesktopApp({ id: "fixture", loadModule }); apps.push(app); return app; }

describe("desktop bootstrap", () => {
  it("keeps native imports inert until explicit boot", () => {
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.listen).not.toHaveBeenCalled();
    expect(mocks.createPlatform).not.toHaveBeenCalled();
  });
  it("registers lifecycle before loading a product and replays queued native About after Shell reset", async () => {
    root();
    const app = boot(async () => {
      expect(mocks.invoke).toHaveBeenCalledWith("plugin:agentz-desktop|ready");
      const menu = mocks.listen.mock.calls.find(([name]) => name === "agentz:menu-action")![1];
      menu({ payload: "about" });
      return module;
    });
    await app.ready;
    expect(document.querySelector('[data-testid="shell"]')).not.toBeNull();
    expect(shellUi.settingsOpen()).toBe(true);
    expect(shellUi.settingsSection()).toBe("about");
  });
  it("never mounts a product whose import completes after disposal", async () => {
    root();
    let resolve!: (value: AppModule) => void;
    let started!: () => void;
    const loaded = new Promise<void>((done) => { started = done; });
    const app = boot(() => { started(); return new Promise((done) => { resolve = done; }); });
    await loaded; await app.dispose(); resolve(module); await app.ready;
    expect(document.querySelector('[data-testid="shell"]')).toBeNull();
  });
  it("waits for old HMR imports before replacing the native service slots", async () => {
    root();
    let resolve!: (value: AppModule) => void;
    let started!: () => void;
    const loaded = new Promise<void>((done) => { started = done; });
    const previous = boot(() => { started(); return new Promise((done) => { resolve = done; }); });
    await loaded;
    const nextLoad = vi.fn(async () => module);
    const next = boot(nextLoad);
    await Promise.resolve(); expect(nextLoad).not.toHaveBeenCalled();
    resolve(module); await previous.ready; await next.ready;
    expect(nextLoad).toHaveBeenCalledOnce();
    expect(document.querySelectorAll('[data-testid="shell"]')).toHaveLength(1);
  });
});
