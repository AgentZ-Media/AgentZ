import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@solidjs/testing-library";
import { getTestStorage, setTestStorage, type TestStorage } from "../../../test/storage";
import "../../../lib/api";
import type { Idea, ScriptStatus, ScriptSummary } from "../../../lib/types";
import { finalStageId, isFinalStage, resetScriptStages, setScriptStages, stageIds } from "../../../lib/stages";
import { scriptsBus } from "../../../lib/scriptsBus";
import { ideasBus } from "../../../lib/ideasBus";
import { navStore, startNavRuntime } from "../../../stores/nav";
import { startIdeasStore } from "../../../stores/ideas";
import { t, tPlural } from "../../../i18n";
import { library, startLibraryData } from "../../Shell/libraryData";
import { Sidebar } from "../../Shell/Sidebar";
import { ScriptsPage } from "../ScriptsPage";
import { libraryPrefs } from "../prefs";

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

function idea(id: string, title: string, usedAt: number | null = null, createdAt = 1): Idea {
  return { id, title, notes: "", created_at: createdAt, used_at: usedAt, script_id: null, folder_id: null };
}

/** `count` open ideas, "Idea 1" the newest. */
function manyIdeas(count: number): Idea[] {
  return Array.from({ length: count }, (_, i) => idea(`n${i + 1}`, `Idea ${i + 1}`, null, 1000 - i));
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
  libraryPrefs.setIdeaColumns(1);
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

  it("leaves the stage glyph to the group head when grouped by stage", async () => {
    const view = render(() => <ScriptsPage />);
    const row = await view.findByRole("button", { name: `Script ${stageIds()[0]}` });
    expect(row.classList.contains("no-glyph")).toBe(true);
    expect(row.querySelector(".lrow-glyph")).toBeNull();
  });

  it("lists the ten newest ideas and the rest behind show more", async () => {
    ideas = manyIdeas(13);
    ideasBus.bump();
    const view = render(() => <ScriptsPage />);
    await view.findByRole("button", { name: "Idea 1" });
    const rows = () => [...view.container.querySelectorAll<HTMLElement>(".lrow.is-idea")];
    expect(rows().map((r) => r.getAttribute("aria-label"))).toEqual(
      Array.from({ length: 10 }, (_, i) => `Idea ${i + 1}`),
    );

    fireEvent.click(view.getByRole("button", { name: tPlural("shell.inbox.moreIdeas", 3) }));
    expect(rows()).toHaveLength(13);
    fireEvent.click(view.getByRole("button", { name: t("shell.inbox.fewerIdeas") }));
    expect(rows()).toHaveLength(10);
  });

  it("shows up to twenty ideas in two columns, filled row by row", async () => {
    ideas = manyIdeas(25);
    ideasBus.bump();
    const view = render(() => <ScriptsPage />);
    await view.findByRole("button", { name: "Idea 1" });
    const toggle = view.getByRole("button", { name: t("shell.inbox.twoColumns") });
    fireEvent.click(toggle);

    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(libraryPrefs.ideaColumns()).toBe(2);
    const list = view.container.querySelector(".irows")!;
    expect(list.classList.contains("is-two")).toBe(true);
    // One grid in reading order: the CSS grid puts Idea 1 left, Idea 2 right.
    const rows = [...list.querySelectorAll(".lrow.is-idea")].map((r) => r.getAttribute("aria-label"));
    expect(rows).toEqual(Array.from({ length: 20 }, (_, i) => `Idea ${i + 1}`));
    expect(view.getByRole("button", { name: tPlural("shell.inbox.moreIdeas", 5) })).toBeTruthy();
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
