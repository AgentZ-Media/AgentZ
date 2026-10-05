import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { applyResolvedLanguage } from "@agentz/kit/i18n";
import { registerFlusher } from "@agentz/kit/lib";
import { getTestStorage, setTestStorage, type TestStorage } from "../../../test/storage";
import "../../../lib/api";
import type { Folder, ScriptSummary } from "../../../lib/types";
import { foldersBus } from "../../../lib/foldersBus";
import { navStore, startNavRuntime } from "../../../stores/nav";
import { startIdeasStore } from "../../../stores/ideas";
import { uiStore } from "../../../stores/ui";
import { library, startLibraryData } from "../../Shell/libraryData";
import { NewScriptDialog } from "../NewScriptDialog";

const originalAdapter = getTestStorage();
let stopNav: () => void;
let stopIdeas: () => void;
let stopLibrary: () => void;
let folders: Folder[] = [];
let created: { title?: string; folderId?: string | null }[] = [];
let createdFolders: string[] = [];
/** While set, script creation waits for it. */
let gate: Promise<void> | null = null;

function folder(id: string, name: string): Folder {
  return { id, name, created_at: 1, updated_at: 1, script_count: 0, length_min_sec: null, length_max_sec: null };
}

function summary(id: string, title: string, folderId: string | null): ScriptSummary {
  return {
    id, title, highlighting_enabled: 0, created_at: 1, updated_at: 1,
    archived_at: null, page_count: 1, word_count: 0, dialog_word_count: 0,
    direction_block_count: 0, characters: [], folder_id: folderId,
    status: "writing", status_changed_at: null,
  };
}

beforeAll(() => {
  const fake: Partial<TestStorage> = {
    listScripts: async () => [],
    listIdeas: async () => [],
    listFolders: async () => folders.map((f) => ({ ...f })),
    globalSearch: async () => [],
    getAppState: async () => null,
    createScript: async (input) => {
      if (gate) await gate;
      created.push({ title: input.title, folderId: input.folderId });
      return summary(`s${created.length}`, input.title ?? "", input.folderId ?? null);
    },
    createFolder: async (name) => {
      createdFolders.push(name);
      const f = folder(`new-${createdFolders.length}`, name);
      folders.push(f);
      return f;
    },
  };
  setTestStorage(new Proxy(fake as TestStorage, {
    get: (target, prop) => Reflect.get(target, prop) ?? (async () => null),
  }));
  stopNav = startNavRuntime();
  stopIdeas = startIdeasStore();
  stopLibrary = startLibraryData();
});
beforeEach(async () => {
  applyResolvedLanguage("de");
  folders = [folder("f1", "TikTok"), folder("f2", "YouTube")];
  created = [];
  createdFolders = [];
  gate = null;
  await navStore.openInbox();
  foldersBus.bump();
  await waitFor(() => expect(library.folders()).toHaveLength(2));
});
afterEach(() => {
  uiStore.closeNewScript();
  cleanup();
});
afterAll(() => {
  stopNav();
  stopLibrary();
  stopIdeas();
  setTestStorage(originalAdapter);
});

const titleField = () => screen.getByRole("textbox", { name: "Titel des Skripts" });
const createButton = () => screen.getByRole("button", { name: /Anlegen/ });

describe("new script dialog", () => {
  it("creates the script with title and preset folder and opens it", async () => {
    render(() => <NewScriptDialog />);
    uiStore.openNewScript("f2");
    await screen.findByRole("dialog", { name: "Neues Skript anlegen" });
    expect(screen.getByRole("button", { name: "Ordner des Skripts" }).textContent).toContain("YouTube");
    expect(createButton()).toHaveProperty("disabled", true);

    fireEvent.input(titleField(), { target: { value: "  Morgenroutine  " } });
    expect(createButton()).toHaveProperty("disabled", false);
    fireEvent.keyDown(titleField(), { key: "Enter" });

    await waitFor(() => expect(uiStore.newScriptOpen()).toBe(false));
    expect(created).toEqual([{ title: "Morgenroutine", folderId: "f2" }]);
    await waitFor(() => expect(navStore.activeScriptId()).toBe("s1"));
  });

  it("ignores a preset folder that no longer exists and needs a title", async () => {
    render(() => <NewScriptDialog />);
    uiStore.openNewScript("gone");
    await screen.findByRole("dialog");
    expect(screen.getByRole("button", { name: "Ordner des Skripts" }).textContent).toContain("Kein Ordner");
    fireEvent.keyDown(titleField(), { key: "Enter" });
    await Promise.resolve();
    expect(created).toEqual([]);
    expect(uiStore.newScriptOpen()).toBe(true);
  });

  it("creates a new folder only together with the script", async () => {
    render(() => <NewScriptDialog />);
    uiStore.openNewScript(null);
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Ordner des Skripts" }));
    fireEvent.mouseDown(await screen.findByRole("option", { name: /Neuer Ordner/ }));

    const name = await screen.findByRole("textbox", { name: "Name des neuen Ordners" });
    // esc leaves the name field, not the dialog.
    fireEvent.keyDown(name, { key: "Escape" });
    expect(uiStore.newScriptOpen()).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Ordner des Skripts" }));
    fireEvent.mouseDown(await screen.findByRole("option", { name: /Neuer Ordner/ }));

    const again = await screen.findByRole("textbox", { name: "Name des neuen Ordners" });
    fireEvent.input(again, { target: { value: "Instagram" } });
    fireEvent.keyDown(again, { key: "Enter" });
    expect(screen.getByRole("button", { name: "Ordner des Skripts" }).textContent).toContain("Instagram (neu)");
    expect(createdFolders).toEqual([]);

    fireEvent.input(titleField(), { target: { value: "Hook" } });
    fireEvent.click(createButton());
    await waitFor(() => expect(uiStore.newScriptOpen()).toBe(false));
    expect(createdFolders).toEqual(["Instagram"]);
    expect(created).toEqual([{ title: "Hook", folderId: "new-1" }]);
  });

  it("picks an existing folder instead of creating a duplicate", async () => {
    render(() => <NewScriptDialog />);
    uiStore.openNewScript(null);
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Ordner des Skripts" }));
    fireEvent.mouseDown(await screen.findByRole("option", { name: /Neuer Ordner/ }));
    const name = await screen.findByRole("textbox", { name: "Name des neuen Ordners" });
    fireEvent.input(name, { target: { value: "tiktok" } });
    fireEvent.keyDown(name, { key: "Enter" });
    expect(screen.getByRole("button", { name: "Ordner des Skripts" }).textContent).toContain("TikTok");
    expect(screen.getByRole("button", { name: "Ordner des Skripts" }).textContent).not.toContain("(neu)");
  });

  it("offers only a new-folder button while there are no folders", async () => {
    folders = [];
    foldersBus.bump();
    await waitFor(() => expect(library.folders()).toHaveLength(0));
    render(() => <NewScriptDialog />);
    uiStore.openNewScript(null);
    await screen.findByRole("dialog");
    expect(screen.queryByRole("button", { name: "Ordner des Skripts" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Neuer Ordner" }));
    expect(await screen.findByRole("textbox", { name: "Name des neuen Ordners" })).toBeTruthy();
  });

  it("cannot be closed while the script is being created", async () => {
    let release!: () => void;
    gate = new Promise((resolve) => { release = resolve; });
    render(() => <NewScriptDialog />);
    uiStore.openNewScript(null);
    await screen.findByRole("dialog");
    fireEvent.input(titleField(), { target: { value: "Langsam" } });
    fireEvent.keyDown(titleField(), { key: "Enter" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Abbrechen" })).toHaveProperty("disabled", true));
    fireEvent.keyDown(titleField(), { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
    expect(uiStore.newScriptOpen()).toBe(true);

    release();
    await waitFor(() => expect(uiStore.newScriptOpen()).toBe(false));
    expect(created).toEqual([{ title: "Langsam", folderId: null }]);
    await waitFor(() => expect(navStore.activeScriptId()).toBe("s1"));
  });

  it("closes without a duplicate when unsaved content blocks opening the script", async () => {
    render(() => <NewScriptDialog />);
    uiStore.openNewScript(null);
    await screen.findByRole("dialog");
    const unregister = registerFlusher(() => ({ ok: false }), "failed-draft");
    try {
      fireEvent.input(titleField(), { target: { value: "Blockiert" } });
      fireEvent.keyDown(titleField(), { key: "Enter" });
      await waitFor(() => expect(uiStore.newScriptOpen()).toBe(false));
    } finally {
      unregister();
    }
    expect(created).toEqual([{ title: "Blockiert", folderId: null }]);
    expect(navStore.activeScriptId()).toBeNull();
  });
});
