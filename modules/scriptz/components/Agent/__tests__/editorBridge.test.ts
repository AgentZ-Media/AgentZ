// Applying agent proposals to a headless Lexical editor: replace, insert,
// append, live block reading and undo through the regular history.

import { afterEach, describe, expect, it } from "vitest";
import { $createTextNode, $getRoot, createEditor, UNDO_COMMAND, type CreateEditorArgs, type LexicalEditor } from "lexical";
import { createEmptyHistoryState, registerHistory } from "@lexical/history";
import {
  $createScriptzActionNode,
  $createScriptzCharacterNode,
  $createScriptzDialogNode,
  SCRIPTZ_NODES,
} from "../../Editor/nodes";
import { applyBlocks, liveBlocks, registerAgentEditor } from "../editorBridge";

const SCRIPT = "script-1";
let cleanup: Array<() => void> = [];

afterEach(() => {
  for (const fn of cleanup.splice(0)) fn();
});

function setup(): LexicalEditor {
  const editor = createEditor({
    namespace: "agent-bridge-test",
    nodes: SCRIPTZ_NODES as unknown as CreateEditorArgs["nodes"],
    onError: (err: Error) => { throw err; },
  });
  cleanup.push(registerHistory(editor, createEmptyHistoryState(), 0));
  editor.update(() => {
    const root = $getRoot();
    const action = $createScriptzActionNode();
    action.append($createTextNode("Timo klappt den Laptop zu."));
    const character = $createScriptzCharacterNode();
    character.append($createTextNode("TIMO"));
    const dialog = $createScriptzDialogNode();
    dialog.append($createTextNode("Feierabend."));
    root.append(action, character, dialog);
  }, { discrete: true });
  cleanup.push(registerAgentEditor(SCRIPT, editor));
  return editor;
}

const texts = () => (liveBlocks(SCRIPT) ?? []).map((b) => `${b.type}:${b.text}`);
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("agent editor bridge", () => {
  it("reads live blocks as typed lines", () => {
    setup();
    expect(texts()).toEqual(["action:Timo klappt den Laptop zu.", "character:TIMO", "dialog:Feierabend."]);
  });

  it("replaces a block range and undo restores it", async () => {
    const editor = setup();
    const ok = applyBlocks(SCRIPT, [
      { type: "character", text: "AXEL" },
      { type: "dialog", text: "Nix da." },
    ], { mode: "replace", from: 1, to: 2 });
    expect(ok).toEqual({ mode: "replace", from: 1, to: 2 });
    await flush();
    expect(texts()).toEqual(["action:Timo klappt den Laptop zu.", "character:AXEL", "dialog:Nix da."]);
    editor.dispatchCommand(UNDO_COMMAND, undefined);
    await flush();
    expect(texts()).toEqual(["action:Timo klappt den Laptop zu.", "character:TIMO", "dialog:Feierabend."]);
  });

  it("inserts after a block and appends at the end", async () => {
    setup();
    applyBlocks(SCRIPT, [{ type: "action", text: "Pause." }], { mode: "insertAfter", block: 0 });
    await flush();
    expect(texts()[1]).toBe("action:Pause.");
    applyBlocks(SCRIPT, [{ type: "action", text: "Ende." }], { mode: "append" });
    await flush();
    expect(texts().at(-1)).toBe("action:Ende.");
    expect(texts()).toHaveLength(5);
  });

  it("refuses a replace range that no longer exists", async () => {
    setup();
    expect(applyBlocks(SCRIPT, [{ type: "action", text: "X" }], { mode: "replace", from: 5, to: 9 })).toBeNull();
    await flush();
    expect(texts()).toHaveLength(3);
  });

  it("follows anchored lines that moved and refuses changed ones", async () => {
    setup();
    const anchored = { mode: "replace" as const, from: 1, to: 2, anchor: ["TIMO", "Feierabend."] };
    // The user adds a line above the target after the proposal was made.
    applyBlocks(SCRIPT, [{ type: "action", text: "Neu oben." }], { mode: "insertAfter", block: 0 });
    await flush();
    expect(applyBlocks(SCRIPT, [{ type: "dialog", text: "Jetzt." }], anchored)).toEqual({ ...anchored, from: 2, to: 3 });
    await flush();
    expect(texts()).toEqual(["action:Timo klappt den Laptop zu.", "action:Neu oben.", "dialog:Jetzt."]);
    // The same anchor no longer exists: nothing is replaced.
    expect(applyBlocks(SCRIPT, [{ type: "action", text: "X" }], anchored)).toBeNull();
    await flush();
    expect(texts()).toHaveLength(3);
  });
});
