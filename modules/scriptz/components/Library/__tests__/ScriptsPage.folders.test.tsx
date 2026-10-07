import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, waitFor, within } from "@solidjs/testing-library";
import { getTestStorage, setTestStorage, type TestStorage } from "../../../test/storage";
import "../../../lib/api";
import type { Folder, Idea, ScriptStatus, ScriptSummary } from "../../../lib/types";
import { INBOX_FOLDER_ID } from "../../../lib/folders";
import { finalStageId, resetScriptStages, stageIds } from "../../../lib/stages";
import { scriptsBus } from "../../../lib/scriptsBus";
import { ideasBus } from "../../../lib/ideasBus";
import { foldersBus } from "../../../lib/foldersBus";
import { navStore, startNavRuntime } from "../../../stores/nav";
import { startIdeasStore } from "../../../stores/ideas";
import { t } from "../../../i18n";
import { library, startLibraryData } from "../../Shell/libraryData";
import { ScriptsPage } from "../ScriptsPage";

const originalAdapter = getTestStorage();
let stopNav: () => void;
let stopIdeas: () => void;
let stopLibrary: () => void;
let scripts: ScriptSummary[] = [];
let ideas: Idea[] = [];
let folders: Folder[] = [];

function script(id: string, status: ScriptStatus, folderId: string | null): ScriptSummary {
  return {
    id, title: `Script ${id}`, highlighting_enabled: 0, created_at: 1, updated_at: 1,
    archived_at: null, page_count: 1, word_count: 0, dialog_word_count: 0,
    direction_block_count: 0, characters: [], folder_id: folderId,
    status, status_changed_at: null,
  };
}

function folder(id: string, name: string): Folder {
  return { id, name, created_at: 1, updated_at: 1, script_count: 0, length_min_sec: null, length_max_sec: null };
}

const chips = (view: ReturnType<typeof render>) =>
  within(view.getByRole("group", { name: t("folder.chips.aria") }));
const chip = (view: ReturnType<typeof render>, label: string) =>
  chips(view).getByRole("button", { name: new RegExp(`^${label}`) });
const rows = (view: ReturnType<typeof render>) =>
  view.queryAllByRole("button", { name: /^Script / }).map((b) => b.getAttribute("aria-label") ?? b.textContent);

beforeAll(() => {
  const fake: Partial<TestStorage> = {
    listScripts: async () => scripts.map((s) => ({ ...s })),
    listIdeas: async () => ideas.map((i) => ({ ...i })),
    listFolders: async () => folders.map((f) => ({ ...f })),
    globalSearch: async () => [],
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
  const [first, second] = stageIds();
  folders = [folder("tt", "TikTok"), folder("yt", "YouTube"), folder("empty", "Leer")];
  scripts = [
    script("a", first, "tt"),
    script("b", first, "yt"),
    script("c", second, "tt"),
    script("d", first, null),
    script("e", finalStageId(), "yt"),
  ];
  ideas = [{ id: "i1", title: "Fresh idea", notes: "", created_at: 1, used_at: null, script_id: null, folder_id: "tt" }];
  foldersBus.bump();
  scriptsBus.bump();
  ideasBus.bump();
  await waitFor(() => expect(library.folders().length).toBe(3));
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

describe("folder chips", () => {
  it("filter the inbox and count its scripts and ideas per folder", async () => {
    await navStore.openInbox();
    const view = render(() => <ScriptsPage />);
    await view.findByRole("button", { name: "Fresh idea" });

    expect(chip(view, t("folder.chips.all")).textContent).toContain("5");
    expect(chip(view, "TikTok").textContent).toContain("3");
    expect(chip(view, "YouTube").textContent).toContain("1");
    expect(chip(view, t("folder.inbox")).textContent).toContain("1");
    // Folders without anything on this page get no chip.
    expect(chips(view).queryByRole("button", { name: /^Leer/ })).toBeNull();

    fireEvent.click(chip(view, "TikTok"));
    await waitFor(() => expect(navStore.route()).toEqual({ kind: "inbox", folderId: "tt" }));
    await waitFor(() => expect(view.queryByRole("button", { name: "Script b" })).toBeNull());
    expect(view.getByRole("button", { name: "Script a" })).toBeTruthy();
    expect(view.getByRole("button", { name: "Script c" })).toBeTruthy();
    expect(view.getByRole("button", { name: "Fresh idea" })).toBeTruthy();
    expect(chip(view, "TikTok").getAttribute("aria-pressed")).toBe("true");
    expect(view.getByRole("heading", { level: 1 }).textContent).toBe(t("shell.nav.inbox"));

    fireEvent.click(chip(view, t("folder.inbox")));
    await waitFor(() => expect(navStore.route()).toEqual({ kind: "inbox", folderId: INBOX_FOLDER_ID }));
    await waitFor(() => expect(view.queryByRole("button", { name: "Fresh idea" })).toBeNull());
    expect(view.getByRole("button", { name: "Script d" })).toBeTruthy();

    fireEvent.click(chip(view, t("folder.chips.all")));
    await waitFor(() => expect(navStore.route()).toEqual({ kind: "inbox" }));
  });

  it("narrow a stage page and keep the stage", async () => {
    const first = stageIds()[0];
    await navStore.openScripts({ status: first });
    const view = render(() => <ScriptsPage />);
    await view.findByRole("button", { name: "Script a" });
    expect(chip(view, t("folder.chips.all")).textContent).toContain("3");

    fireEvent.click(chip(view, "YouTube"));
    await waitFor(() => expect(navStore.route()).toEqual({ kind: "scripts", status: first, folderId: "yt" }));
    await waitFor(() => expect(view.queryByRole("button", { name: "Script a" })).toBeNull());
    expect(view.getByRole("button", { name: "Script b" })).toBeTruthy();
    expect(rows(view)).toHaveLength(1);
  });

  it("switch between folders on all scripts", async () => {
    await navStore.openScripts();
    const view = render(() => <ScriptsPage />);
    await view.findByRole("button", { name: "Script a" });
    expect(chip(view, t("folder.chips.all")).textContent).toContain("5");
    expect(chip(view, "YouTube").textContent).toContain("2");

    fireEvent.click(chip(view, "YouTube"));
    await waitFor(() => expect(navStore.route()).toEqual({ kind: "scripts", folderId: "yt" }));
    await waitFor(() => expect(view.queryByRole("button", { name: "Script a" })).toBeNull());
    expect(view.getByRole("button", { name: "Script b" })).toBeTruthy();

    fireEvent.click(chip(view, t("folder.chips.all")));
    await waitFor(() => expect(navStore.route()).toEqual({ kind: "scripts" }));
  });

  it("stay hidden without folders", async () => {
    folders = [];
    foldersBus.bump();
    await waitFor(() => expect(library.folders().length).toBe(0));
    await navStore.openScripts();
    const view = render(() => <ScriptsPage />);
    await view.findByRole("button", { name: "Script a" });
    expect(view.queryByRole("group", { name: t("folder.chips.aria") })).toBeNull();
  });
});
