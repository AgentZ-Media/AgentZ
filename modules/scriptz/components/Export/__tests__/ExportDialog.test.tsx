// Regression tests for the export dialog (components/Export/
// ExportDialog.tsx): the preview must load only after pending saves were
// flushed, and follow later saves while the dialog is open.

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@solidjs/testing-library";
import { getTestStorage, setTestStorage, type TestStorage } from "../../../test/storage";
import "../../../lib/api";
import { registerFlusher } from "@agentz/kit/lib";
import { scriptsBus } from "../../../lib/scriptsBus";
import type { Script } from "../../../lib/types";
import { uiStore } from "../../../stores/ui";
import { ExportDialog } from "../ExportDialog";

const originalAdapter = getTestStorage();
let stored = "first";
const exportPdf = vi.fn().mockResolvedValue({ canceled: true });
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
  setTestStorage(
    new Proxy({} as TestStorage, {
      get(_, prop: string) {
        if (prop === "getScript") return getScript;
        if (prop === "exportPdf") return exportPdf;
        return vi.fn().mockResolvedValue(null);
      },
    }),
  );
});

afterAll(() => {
  setTestStorage(originalAdapter);
});

afterEach(() => {
  uiStore.closeExport();
  cleanup();
  getScript.mockClear();
  exportPdf.mockClear();
});

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("ExportDialog", () => {
  it("does not load a stale preview after a failed save", async () => {
    const unregister = registerFlusher(() => ({ ok: false }), "failed-draft");
    try {
      render(() => <ExportDialog />);
      uiStore.openExport("s1");
      await tick();
      expect(getScript).not.toHaveBeenCalled();
      expect(uiStore.exportScriptId()).toBeNull();
    } finally { unregister(); }
  });

  it("does not export an already loaded preview when saving fails before export", async () => {
    render(() => <ExportDialog />);
    uiStore.openExport("s1");
    await tick();
    expect(getScript).toHaveBeenCalledOnce();
    const unregister = registerFlusher(() => ({ ok: false }), "failed-draft");
    try {
      document.querySelector<HTMLButtonElement>(".exp-foot .btn.primary")!.click();
      await tick();
      expect(exportPdf).not.toHaveBeenCalled();
      expect(uiStore.exportScriptId()).toBe("s1");
    } finally { unregister(); }
  });

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
