import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@solidjs/testing-library";
import { getTestStorage, setTestStorage, type TestStorage } from "../../../test/storage";
import "../../../lib/api";
import type { Idea, ScriptStatus, ScriptSummary } from "../../../lib/types";
import { resetScriptStages, stageIds, stageLabel } from "../../../lib/stages";
import { scriptsBus } from "../../../lib/scriptsBus";
import { ideasBus } from "../../../lib/ideasBus";
import { navStore, startNavRuntime } from "../../../stores/nav";
import { peekStore } from "../../../stores/peek";
import { openStore, startOpenStore } from "../../../stores/open";
import { startIdeasStore } from "../../../stores/ideas";
import { t } from "../../../i18n";
import { startLibraryData } from "../../Shell/libraryData";
import { Sidebar } from "../../Shell/Sidebar";
import { libraryPrefs, startLibraryPrefs } from "../prefs";
import { ScriptsPage } from "../ScriptsPage";

const originalAdapter = getTestStorage();
const stops: Array<() => void> = [];
let scripts: ScriptSummary[] = [];
let ideas: Idea[] = [];

function script(id: string, title: string, status: ScriptStatus): ScriptSummary {
  return {
    id, title, highlighting_enabled: 0, created_at: 1, updated_at: 1,
    archived_at: null, page_count: 1, word_count: 0, dialog_word_count: 0,
    direction_block_count: 0, characters: [], folder_id: null,
    status, status_changed_at: null,
  };
}

beforeAll(() => {
  const fake: Partial<TestStorage> = {
    listScripts: async () => scripts.map((s) => ({ ...s })),
    listIdeas: async () => ideas.map((i) => ({ ...i })),
    listFolders: async () => [], globalSearch: async () => [],
    getAppState: async () => null,
  };
  setTestStorage(new Proxy(fake as TestStorage, {
    get: (target, prop) => Reflect.get(target, prop) ?? (async () => null),
  }));
  stops.push(startNavRuntime(), startIdeasStore(), startLibraryData(), startLibraryPrefs(), startOpenStore());
});
beforeEach(async () => {
  resetScriptStages();
  scripts = stageIds().map((st) => script(st, `Script ${st}`, st));
  ideas = [{ id: "i1", title: "Fresh idea", notes: "", created_at: 1, used_at: null, script_id: null, folder_id: null }];
  scriptsBus.bump();
  ideasBus.bump();
  libraryPrefs.setViewMode("all", "list");
  peekStore.close();
  await navStore.openScripts();
});
afterEach(() => cleanup());
afterAll(() => {
  for (const stop of stops.reverse()) stop();
  setTestStorage(originalAdapter);
});

describe("scripts page workspace", () => {
  it("has no page bar title: the tools sit above the list", async () => {
    const view = render(() => <ScriptsPage />);
    await view.findByRole("button", { name: `Script ${stageIds()[0]}` });
    expect(view.container.querySelector(".pbar")?.textContent).toBe("");
    expect(view.container.querySelector(".lib-tools input")).toBeTruthy();
  });

  it("switches to a board with the ideas and every stage in pipeline order", async () => {
    const view = render(() => <ScriptsPage />);
    await view.findByRole("button", { name: `Script ${stageIds()[0]}` });
    fireEvent.click(view.getByRole("button", { name: t("shell.view.board") }));
    expect(libraryPrefs.viewMode("all")).toBe("board");
    const columns = () => [...view.container.querySelectorAll(".bcol .bcol-t")].map((el) => el.textContent);
    await waitFor(() => expect(columns()).toEqual([t("shell.nav.ideas"), ...stageIds().map((st) => stageLabel(st))]));
    expect(view.getByRole("button", { name: "Fresh idea" })).toBeTruthy();
    for (const st of stageIds()) expect(view.getByRole("button", { name: `Script ${st}` })).toBeTruthy();
  });

  it("opens a clicked script in the side panel, Alt-click in the full view", async () => {
    const view = render(() => <ScriptsPage />);
    const first = stageIds()[0];
    fireEvent.click(await view.findByRole("button", { name: `Script ${first}` }));
    expect(peekStore.scriptId()).toBe(first);
    await waitFor(() => expect(view.container.querySelector(".peek")).toBeTruthy());
    expect(navStore.route().kind).toBe("scripts");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(peekStore.scriptId()).toBeNull();

    fireEvent.click(view.getByRole("button", { name: `Script ${first}` }), { altKey: true });
    await waitFor(() => expect(navStore.activeScriptId()).toBe(first));
  });

  it("lists open scripts in the sidebar and closes them", async () => {
    openStore.add("writing");
    openStore.add("ready");
    const view = render(() => <Sidebar />);
    await view.findByText("Script writing");
    expect(view.getByText(t("shell.section.open"))).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: t("shell.open.closeAria", { title: "Script writing" }) }));
    await waitFor(() => expect(openStore.ids()).toEqual(["ready"]));
  });
});
