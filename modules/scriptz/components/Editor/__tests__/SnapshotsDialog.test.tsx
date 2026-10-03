// The version dialog previews a snapshot with the real editor in read-only
// mode (same Lexical nodes, same CSS classes as the script screen) instead
// of a plain-text dump.

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@solidjs/testing-library";
import { getStorageAdapter, setStorageAdapter, type ScriptzApiStorage } from "../../../lib/storage";
import "../../../lib/api";
import type { Snapshot, SnapshotMeta } from "../../../lib/types";
import { SnapshotsDialog } from "../SnapshotsDialog";

const originalAdapter = getStorageAdapter();

const DOC = JSON.stringify({
  root: {
    type: "root",
    version: 1,
    direction: null,
    format: "",
    indent: 0,
    children: [
      block("scriptz-character", "anna", { characterName: "ANNA" }),
      block("scriptz-dialog", "Hallo Welt."),
      // Retired block type: must render as action, like in the editor.
      block("scriptz-camera", "Totale."),
    ],
  },
});

function block(type: string, text: string, extra: Record<string, unknown> = {}) {
  return {
    type,
    version: 1,
    direction: null,
    format: "",
    indent: 0,
    ...extra,
    children: [
      { type: "text", version: 1, text, detail: 0, format: 0, mode: "normal", style: "" },
    ],
  };
}

const metas: SnapshotMeta[] = [
  { id: "snap-ok", script_id: "s1", trigger: "manual", created_at: 2 },
  { id: "snap-broken", script_id: "s1", trigger: "auto", created_at: 1 },
];
const contents: Record<string, string> = { "snap-ok": DOC, "snap-broken": "{not json" };

beforeAll(() => {
  setStorageAdapter(
    new Proxy({} as ScriptzApiStorage, {
      get(_, prop: string) {
        if (prop === "listSnapshots") return vi.fn(async () => metas);
        if (prop === "getSnapshot")
          return vi.fn(async (id: string): Promise<Snapshot> => ({
            ...metas.find((m) => m.id === id)!,
            content_json: contents[id],
          }));
        if (prop === "listCharacterColors") return vi.fn(async () => []);
        return vi.fn().mockResolvedValue(null);
      },
    }),
  );
});

afterAll(() => {
  setStorageAdapter(originalAdapter);
});

afterEach(() => {
  cleanup();
});

const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};

describe("SnapshotsDialog", () => {
  it("renders the selected version with the read-only editor on paper", async () => {
    render(() => (
      <SnapshotsDialog
        scriptId="s1"
        open
        onClose={() => {}}
        characters={[{ name: "ANNA", color: "#3a8ed4" }]}
        highlighting
      />
    ));
    await settle();

    const root = document.querySelector(".snap-preview .paper-sheet .editor-root") as HTMLElement;
    expect(root).not.toBeNull();
    expect(root.getAttribute("contenteditable")).toBe("false");
    expect(root.getAttribute("data-highlighting")).toBe("on");
    expect(root.querySelector(".block-scriptz-character")?.textContent).toBe("anna");
    expect(root.querySelector(".block-scriptz-dialog")?.textContent).toBe("Hallo Welt.");
    expect(root.querySelector(".block-scriptz-action")?.textContent).toBe("Totale.");
    // No typing hint in a read-only sheet.
    expect(document.querySelector(".snap-preview .editor-empty-hint")).toBeNull();
  });

  it("shows a note instead of a sheet when a version cannot be parsed", async () => {
    render(() => <SnapshotsDialog scriptId="s1" open onClose={() => {}} />);
    await settle();

    const items = document.querySelectorAll<HTMLButtonElement>(".snap-item");
    items[1].click();
    await settle();

    expect(document.querySelector(".snap-preview .editor-root")).toBeNull();
    expect(document.querySelector(".snap-preview .snap-empty")).not.toBeNull();
  });
});
