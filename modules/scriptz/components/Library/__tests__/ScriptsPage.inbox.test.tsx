import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, waitFor } from "@solidjs/testing-library";
import { getTestStorage, setTestStorage, type TestStorage } from "../../../test/storage";
import "../../../lib/api";
import {
  FINAL_SCRIPT_STATUS,
  SCRIPT_STATUSES,
  isInProgress,
  type Idea,
  type ScriptStatus,
  type ScriptSummary,
} from "../../../lib/types";
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
  scripts = SCRIPT_STATUSES.map((st) => script(st, `Script ${st}`, st));
  ideas = [idea("i1", "Fresh idea"), idea("i2", "Used idea", 5)];
  scriptsBus.bump();
  ideasBus.bump();
  await navStore.openInbox();
});
afterEach(cleanup);
afterAll(() => {
  stopNav();
  stopLibrary();
  stopIdeas();
  setTestStorage(originalAdapter);
});

describe("inbox", () => {
  it("treats only the last pipeline stage as done", () => {
    expect(FINAL_SCRIPT_STATUS).toBe(SCRIPT_STATUSES[SCRIPT_STATUSES.length - 1]);
    for (const st of SCRIPT_STATUSES) expect(isInProgress(st)).toBe(st !== FINAL_SCRIPT_STATUS);
  });

  it("lists open ideas and every script before the last stage", async () => {
    const view = render(() => <ScriptsPage />);
    await view.findByRole("button", { name: "Fresh idea" });
    for (const st of SCRIPT_STATUSES) {
      if (st === FINAL_SCRIPT_STATUS) continue;
      expect(view.getByRole("button", { name: `Script ${st}` })).toBeTruthy();
    }
    expect(view.queryByRole("button", { name: `Script ${FINAL_SCRIPT_STATUS}` })).toBeNull();
    expect(view.queryByRole("button", { name: "Used idea" })).toBeNull();
    expect(view.getByRole("heading", { level: 1 }).textContent).toBe(t("shell.nav.inbox"));
  });

  it("shows the empty state once everything reached the last stage", async () => {
    scripts = [script("done", "Done", FINAL_SCRIPT_STATUS)];
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
    await waitFor(() => expect(library.inboxCount()).toBe(SCRIPT_STATUSES.length - 1 + 1));
    expect(entry()).toBeTruthy();

    scripts = [script("done", "Done", FINAL_SCRIPT_STATUS)];
    ideas = [idea("i2", "Used idea", 5)];
    scriptsBus.bump();
    ideasBus.bump();
    await waitFor(() => expect(entry()).toBeNull());
  });
});
