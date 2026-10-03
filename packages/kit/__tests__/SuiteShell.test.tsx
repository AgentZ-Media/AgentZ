import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SuiteShell, type ModuleContext, type ModuleRuntime } from "../shell";
import { t } from "../i18n";
import { createFixtureKv, createFixtureModule, fixtureCatalogs, fixturePlatform } from "./fixtures/module";

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("independent module in the real Kit shell", () => {
  it("boots with only Kit KV and host capabilities, translates both catalogs, and persists appearance", async () => {
    const { kv, settings } = createFixtureKv();
    const getDb = vi.spyOn(fixturePlatform, "getDb");
    let context: ModuleContext | undefined;
    const fixture = createFixtureModule({ onSetup: (value) => { context = value; } });
    const page = render(() => <SuiteShell module={fixture} platform={fixturePlatform} kv={kv} />);
    await waitFor(() => expect(page.getByRole("heading", { name: "Ein eigenständiges Modul" })).toBeTruthy());
    expect(getDb).not.toHaveBeenCalled();
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.lang).toBe("de");

    fireEvent.click(page.getByRole("button", { name: "Einstellungen öffnen" }));
    await waitFor(() => expect(screen.getByRole("switch", { name: "Zusätzliche Hinweise" })).toBeTruthy());
    fireEvent.click(screen.getByRole("switch", { name: "Zusätzliche Hinweise" }));
    await waitFor(() => expect(settings.get("fixture.hints")).toBe("1"));
    context!.shell.closeSettings();
    expect(page.getByTestId("fixture-hint").textContent).toBe("Zusätzliche Hinweise");

    context!.shell.openSettings("appearance");
    fireEvent.click(screen.getByRole("radio", { name: "Dunkel" }));
    fireEvent.click(screen.getByRole("radio", { name: "English" }));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("dark"));
    await waitFor(() => expect(settings.get("theme")).toBe("dark"));
    await waitFor(() => expect(settings.get("language")).toBe("en"));
    expect(page.getByRole("heading", { name: "An independent module" })).toBeTruthy();
    expect(document.documentElement.lang).toBe("en");
    expect(t("common.close")).toBe("Close");
    expect(Object.keys(fixtureCatalogs.en).sort()).toEqual(Object.keys(fixtureCatalogs.de).sort());
  });

  it("offers a way back to a hidden sidebar when the module has no own control", async () => {
    const { kv } = createFixtureKv();
    let context: ModuleContext | undefined;
    const fixture = createFixtureModule({ onSetup: (value) => { context = value; } });
    const page = render(() => <SuiteShell module={fixture} platform={fixturePlatform} kv={kv} />);
    await waitFor(() => expect(page.getByRole("heading", { name: "Ein eigenständiges Modul" })).toBeTruthy());
    expect(document.querySelector(".shell-reveal")).toBeNull();
    context!.shell.toggleSidebar();
    await waitFor(() => expect(document.querySelector("aside.side")).toBeNull());
    fireEvent.click(document.querySelector(".shell-reveal")!);
    await waitFor(() => expect(document.querySelector("aside.side")).toBeTruthy());
    expect(document.querySelector(".shell-reveal")).toBeNull();
  });

  it("dispatches module shortcuts, honors prevented/composing events and dialog context, and disposes", async () => {
    const { kv } = createFixtureKv();
    const dispose = vi.fn();
    const registeredCleanup = vi.fn();
    let context: ModuleContext | undefined;
    const fixture = createFixtureModule({
      onSetup: (value) => { context = value; },
      onDispose: dispose,
      onRegisteredCleanup: registeredCleanup,
    });
    const page = render(() => <SuiteShell module={fixture} platform={fixturePlatform} kv={kv} />);
    await waitFor(() => expect(page.getByRole("heading", { name: "Ein eigenständiges Modul" })).toBeTruthy());
    const shortcut = { key: "y", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true };
    const prevented = new KeyboardEvent("keydown", shortcut);
    prevented.preventDefault();
    document.dispatchEvent(prevented);
    fireEvent.keyDown(document, { ...shortcut, isComposing: true });
    expect(screen.queryByText("Ein Modul-Overlay")).toBeNull();
    context!.shell.openSettings("fixture");
    fireEvent.keyDown(document, shortcut);
    expect(screen.queryByText("Ein Modul-Overlay")).toBeNull();
    context!.shell.closeSettings();
    fireEvent.keyDown(document, shortcut);
    await waitFor(() => expect(screen.getByText("Ein Modul-Overlay")).toBeTruthy());

    page.unmount();
    expect(dispose).toHaveBeenCalledOnce();
    expect(registeredCleanup).toHaveBeenCalledOnce();
    expect(context!.signal.aborted).toBe(true);
    expect(() => context!.runOwned(() => null)).toThrow();
    const registeredLate = vi.fn();
    context!.onDispose(registeredLate);
    expect(registeredLate).toHaveBeenCalledOnce();
    fireEvent.keyDown(document, shortcut);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("cleans up a runtime that resolves after unmount without rendering it", async () => {
    const { kv } = createFixtureKv();
    const dispose = vi.fn();
    const registeredCleanup = vi.fn();
    let context: ModuleContext | undefined;
    let resolve!: (runtime: ModuleRuntime) => void;
    const pending = new Promise<ModuleRuntime>((done) => { resolve = done; });
    const fixture = createFixtureModule();
    fixture.setup = async (value) => {
      context = value;
      value.onDispose(registeredCleanup);
      return pending;
    };
    const page = render(() => <SuiteShell module={fixture} platform={fixturePlatform} kv={kv} />);
    await waitFor(() => expect(context).toBeDefined());
    page.unmount();
    resolve({ routes: [], sidebar: () => <span>Late content</span>, dispose });
    await waitFor(() => expect(dispose).toHaveBeenCalledOnce());
    expect(registeredCleanup).toHaveBeenCalledOnce();
    expect(document.body.textContent).not.toContain("Late content");
  });

  it("shows a boot failure instead of mounting a partially initialized module", async () => {
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    const { kv } = createFixtureKv();
    const fixture = createFixtureModule();
    fixture.setup = async () => { throw new Error("fixture setup failed"); };
    const page = render(() => <SuiteShell module={fixture} platform={fixturePlatform} kv={kv} />);
    await waitFor(() => expect(page.getByRole("alert").textContent).toContain("fixture setup failed"));
    expect(page.queryByRole("heading", { name: "Ein eigenständiges Modul" })).toBeNull();
    expect(report).toHaveBeenCalledWith("[kit] boot failed", expect.any(Error));
  });
});
