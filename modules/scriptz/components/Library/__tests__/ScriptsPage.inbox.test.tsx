import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, waitFor } from "@solidjs/testing-library";
import { getTestStorage, setTestStorage, type TestStorage } from "../../../test/storage";
import "../../../lib/api";
import type { Idea, ScriptStatus, ScriptSummary } from "../../../lib/types";
import { finalStageId, isFinalStage, resetScriptStages, setScriptStages, stageIds } from "../../../lib/stages";
import { scriptsBus } from "../../../lib/scriptsBus";
import { ideasBus } from "../../../lib/ideasBus";
import { navStore, startNavRuntime } from "../../../stores/nav";
import { startIdeasStore } from "../../../stores/ideas";
import { t } from "../../../i18n";
import { library, startLibraryData } from "../../Shell/libraryData";
import { Sidebar } from "../../Shell/Sidebar";
import { ScriptsPage } from "../ScriptsPage";

const originalAdapter = getTestStorage();
let stopNav: () => void;
let stopIdeas: () => void;
let stopLibrary: () => void;
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

function idea(id: string, title: string, usedAt: number | null = null): Idea {
  return { id, title, notes: "", created_at: 1, used_at: usedAt, script_id: null, folder_id: null };
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
  stopNav = startNavRuntime();
  stopIdeas = startIdeasStore();
  stopLibrary = startLibraryData();
});
beforeEach(async () => {
  resetScriptStages();
  scripts = stageIds().map((st) => script(st, `Script ${st}`, st));
  ideas = [idea("i1", "Fresh idea"), idea("i2", "Used idea", 5)];
  scriptsBus.bump();
  ideasBus.bump();
  await navStore.openInbox();
});
afterEach(() => {
  cleanup();
  resetScriptStages();
});
afterAll(() => {
  stopNav();
  stopLibrary();
  stopIdeas();
  setTestStorage(originalAdapter);
});

describe("inbox", () => {
  it("treats only the last pipeline stage as done", () => {
    expect(finalStageId()).toBe("online");
    for (const st of stageIds()) expect(isFinalStage(st)).toBe(st === "online");
    setScriptStages([{ id: "writing" }, { id: "edit", label: "Schnitt" }]);
    expect(isFinalStage("edit")).toBe(true);
    expect(isFinalStage("writing")).toBe(false);
  });

  it("lists open ideas and every script before the last stage", async () => {
    const view = render(() => <ScriptsPage />);
    await view.findByRole("button", { name: "Fresh idea" });
    for (const st of stageIds()) {
      if (isFinalStage(st)) continue;
      expect(view.getByRole("button", { name: `Script ${st}` })).toBeTruthy();
    }
    expect(view.queryByRole("button", { name: `Script ${finalStageId()}` })).toBeNull();
    expect(view.queryByRole("button", { name: "Used idea" })).toBeNull();
    expect(view.getByRole("heading", { level: 1 }).textContent).toBe(t("shell.nav.inbox"));
  });

  it("shows the empty state once everything reached the last stage", async () => {
    scripts = [script("done", "Done", finalStageId())];
    ideas = [];
    scriptsBus.bump();
    ideasBus.bump();
    const view = render(() => <ScriptsPage />);
    await view.findByText(t("shell.empty.inbox.title"));
    expect(view.queryByRole("button", { name: "Done" })).toBeNull();
  });

  it("shows the sidebar entry only while something is in progress", async () => {
    await navStore.openScripts();
    const view = render(() => <Sidebar />);
    const entry = () => view.queryByRole("button", { name: new RegExp(`^${t("shell.nav.inbox")}`) });
    await waitFor(() => expect(library.inboxCount()).toBe(stageIds().length - 1 + 1));
    expect(entry()).toBeTruthy();

    scripts = [script("done", "Done", finalStageId())];
    ideas = [idea("i2", "Used idea", 5)];
    scriptsBus.bump();
    ideasBus.bump();
    await waitFor(() => expect(entry()).toBeNull());
  });
});
