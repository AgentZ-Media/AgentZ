import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@solidjs/testing-library";
import { getTestStorage, setTestStorage, type TestStorage } from "../../../test/storage";
import "../../../lib/api";
import type { ScriptSummary } from "../../../lib/types";
import { scriptsBus } from "../../../lib/scriptsBus";
import { navStore, startNavRuntime } from "../../../stores/nav";
import { t } from "../../../i18n";
import { startLibraryData } from "../../Shell/libraryData";
import { ScriptsPage } from "../ScriptsPage";
import { startSettingsRuntime } from "../../../stores/settings";
import { uiStore } from "../../../stores/ui";

const originalAdapter = getTestStorage();
let stopNav: () => void;
let scripts: ScriptSummary[] = [];
let stopLibrary: () => void;
let stopSettings: () => void;

function script(id: string, title: string): ScriptSummary {
  return {
    id, title, highlighting_enabled: 0, created_at: 1, updated_at: 1,
    archived_at: null, page_count: 1, word_count: 0, dialog_word_count: 0,
    direction_block_count: 0, characters: [], folder_id: null,
    status: "writing", status_changed_at: null,
  };
}

beforeAll(() => {
  const fake: Partial<TestStorage> = {
    listScripts: async () => scripts.map((s) => ({ ...s })),
    listFolders: async () => [], listIdeas: async () => [], globalSearch: async () => [],
    getAppState: async () => null,
  };
  setTestStorage(new Proxy(fake as TestStorage, {
    get: (target, prop) => Reflect.get(target, prop) ?? (async () => null),
  }));
  stopNav = startNavRuntime();
  stopLibrary = startLibraryData();
  stopSettings = startSettingsRuntime();
});
beforeEach(async () => {
  scripts = [script("a", "Alpha"), script("b", "Beta")];
  scriptsBus.bump();
  await navStore.go({ kind: "scripts", status: "writing" });
});
afterEach(() => {
  uiStore.closeExport();
  cleanup();
});
afterAll(() => {
  stopNav();
  stopLibrary();
  stopSettings();
  setTestStorage(originalAdapter);
});

async function selectAll() {
  const view = render(() => <ScriptsPage />);
  await view.findByRole("button", { name: "Alpha" });
  fireEvent.click(view.getByRole("button", { name: t("select.enter") }));
  fireEvent.click(view.getByRole("checkbox", { name: t("select.all") }));
  return view;
}
const count = () => document.querySelector(".lib-selbar-count")?.textContent;

describe("ScriptsPage selection scope", () => {
  it("opens the export dialog for the selected scripts", async () => {
    const view = await selectAll();
    fireEvent.click(view.getByRole("button", { name: t("select.action.pdf") }));
    expect(uiStore.exportScriptIds()).toEqual(["a", "b"]);
  });

  it("clears the selection when the filter changes", async () => {
    const view = await selectAll();
    expect(count()).toBe(t("select.count", { count: 2 }));
    const input = view.getByRole("textbox") as HTMLInputElement;
    input.value = "Alpha";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await waitFor(() => expect(view.queryByRole("button", { name: "Beta" })).toBeNull());
    expect(count()).toBe(t("select.count", { count: 0 }));
    expect(view.getByRole("button", { name: t("shell.select.trash") }).hasAttribute("disabled")).toBe(true);
  });

  it("drops a selected script after it leaves the current stage", async () => {
    const view = await selectAll();
    scripts = scripts.map((s) => s.id === "a" ? { ...s, status: "ready" } : s);
    scriptsBus.bump();
    await waitFor(() => expect(view.queryByRole("button", { name: "Alpha" })).toBeNull());
    expect(count()).toBe(t("select.count", { count: 1 }));
  });
});
