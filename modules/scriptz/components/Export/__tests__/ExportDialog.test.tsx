// Regression tests for the export dialog (components/Export/
// ExportDialog.tsx): the preview must load only after pending saves were
// flushed, and follow later saves while the dialog is open.

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@solidjs/testing-library";
import { getStorageAdapter, setStorageAdapter, type StorageAdapter } from "../../../lib/storage";
import "../../../lib/api";
import { registerFlusher } from "../../../lib/saveFlush";
import { scriptsBus } from "../../../lib/scriptsBus";
import type { Script } from "../../../lib/types";
import { uiStore } from "../../../stores/ui";
import { ExportDialog } from "../ExportDialog";

const originalAdapter = getStorageAdapter();
let stored = "first";
const getScript = vi.fn(async (id: string): Promise<Script> => script(id, stored));

function script(id: string, text: string): Script {
  return {
    id,
    title: "Export me",
    content_json: JSON.stringify({
      root: { children: [{ type: "scriptz-action", children: [{ type: "text", text }] }] },
    }),
    characters: [],
    highlighting_enabled: null,
  } as unknown as Script;
}

beforeAll(() => {
  setStorageAdapter(
    new Proxy({} as StorageAdapter, {
      get(_, prop: string) {
        if (prop === "getScript") return getScript;
        return vi.fn().mockResolvedValue(null);
      },
    }),
  );
});

afterAll(() => {
  setStorageAdapter(originalAdapter);
});

afterEach(() => {
  uiStore.closeExport();
  cleanup();
  getScript.mockClear();
});

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("ExportDialog", () => {
  it("loads the preview only after pending saves were flushed", async () => {
    // A pending editor save (⌘E right after typing, debounce not over).
    let open!: () => void;
    const unregister = registerFlusher(
      () =>
        new Promise<void>((r) => {
          open = () => {
            stored = "typed just before export";
            r();
          };
        }),
    );
    stored = "stale";
    render(() => <ExportDialog />);
    uiStore.openExport("s1");
    await tick();
    expect(getScript).not.toHaveBeenCalled();
    open();
    unregister();
    await tick();
    expect(getScript).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain("typed just before export");
  });

  it("refreshes the preview when the script is saved while open", async () => {
    stored = "before";
    render(() => <ExportDialog />);
    uiStore.openExport("s1");
    await tick();
    expect(document.body.textContent).toContain("before");
    stored = "after autosave";
    scriptsBus.bump();
    await tick();
    expect(getScript).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).toContain("after autosave");
  });
});
