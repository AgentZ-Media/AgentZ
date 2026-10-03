// Parenthetical block behaviour in a headless Lexical editor: live "(" / ")"
// (plugins/parentheticalLive.ts), smart Enter (plugins/smartEnter.ts) and
// the ⌘4 hotkey (plugins/blockHotkeys.ts).

import { describe, expect, it } from "vitest";
import {
  $createTextNode,
  $getRoot,
  $getSelection,
  createEditor,
  KEY_DOWN_COMMAND,
  KEY_ENTER_COMMAND,
  type CreateEditorArgs,
  type LexicalEditor,
} from "lexical";
import {
  $createScriptzCharacterNode,
  $createScriptzDialogNode,
  $createScriptzParentheticalNode,
  BLOCK_HOTKEYS,
  BLOCK_TYPES,
  SCRIPTZ_NODES,
} from "../nodes";
import { installParentheticalLive } from "../plugins/parentheticalLive";
import { installSmartEnter } from "../plugins/smartEnter";
import { installBlockHotkeys } from "../plugins/blockHotkeys";

type Seed = "dialog-empty" | "dialog-text" | "paren-open" | "paren-text-empty-after";

function setup(seed: Seed): LexicalEditor {
  const editor = createEditor({
    namespace: "parenthetical-test",
    nodes: SCRIPTZ_NODES as unknown as CreateEditorArgs["nodes"],
    onError: (err: Error) => {
      throw err;
    },
  });
  editor.update(
    () => {
      const root = $getRoot();
      const character = $createScriptzCharacterNode();
      character.append($createTextNode("MAX"));
      root.append(character);
      if (seed === "dialog-empty") {
        const dialog = $createScriptzDialogNode();
        root.append(dialog);
        dialog.select(0, 0);
      } else if (seed === "dialog-text") {
        const dialog = $createScriptzDialogNode();
        dialog.append($createTextNode("Hallo Welt"));
        root.append(dialog);
        // Caret between "Hallo " and "Welt".
        dialog.getFirstChildOrThrow<ReturnType<typeof $createTextNode>>().select(6, 6);
      } else if (seed === "paren-open") {
        const paren = $createScriptzParentheticalNode();
        paren.append($createTextNode("(leise"));
        root.append(paren);
        paren.selectEnd();
      } else {
        const paren = $createScriptzParentheticalNode();
        paren.append($createTextNode("(leise)"));
        root.append(paren);
        paren.selectEnd();
      }
    },
    { discrete: true },
  );
  installParentheticalLive(editor);
  installSmartEnter(editor);
  installBlockHotkeys(editor);
  return editor;
}

function blocks(editor: LexicalEditor): Array<[string, string]> {
  return editor
    .getEditorState()
    .read(() => $getRoot().getChildren().map((c) => [c.getType(), c.getTextContent()]));
}

function caretBlockType(editor: LexicalEditor): string | null {
  return editor.getEditorState().read(() => {
    const sel = $getSelection();
    if (!sel) return null;
    const node = sel.getNodes()[0];
    return node ? (node.getTopLevelElement()?.getType() ?? null) : null;
  });
}

function key(k: string, mods: { meta?: boolean } = {}): KeyboardEvent {
  return new KeyboardEvent("keydown", { key: k, metaKey: !!mods.meta, cancelable: true, bubbles: true });
}

function dispatch(editor: LexicalEditor, run: () => boolean): boolean {
  let handled = false;
  editor.update(
    () => {
      handled = run();
    },
    { discrete: true },
  );
  return handled;
}

describe("block type registry", () => {
  it("has four block types, parenthetical on ⌘4", () => {
    expect(BLOCK_TYPES).toEqual([
      "scriptz-action",
      "scriptz-character",
      "scriptz-dialog",
      "scriptz-parenthetical",
    ]);
    expect(BLOCK_HOTKEYS["scriptz-parenthetical"]).toBe("Mod+4");
  });
});

describe("parentheticalLive", () => {
  it('turns an empty dialog into a parenthetical on "("', () => {
    const editor = setup("dialog-empty");
    const ev = key("(");
    expect(dispatch(editor, () => editor.dispatchCommand(KEY_DOWN_COMMAND, ev))).toBe(true);
    expect(ev.defaultPrevented).toBe(true);
    expect(blocks(editor)).toEqual([
      ["scriptz-character", "MAX"],
      ["scriptz-parenthetical", "("],
    ]);
    expect(caretBlockType(editor)).toBe("scriptz-parenthetical");
  });

  it('splits a dialog at the caret on "(", moving the rest into a new dialog', () => {
    const editor = setup("dialog-text");
    dispatch(editor, () => editor.dispatchCommand(KEY_DOWN_COMMAND, key("(")));
    expect(blocks(editor)).toEqual([
      ["scriptz-character", "MAX"],
      ["scriptz-dialog", "Hallo "],
      ["scriptz-parenthetical", "("],
      ["scriptz-dialog", "Welt"],
    ]);
  });

  it('closes with ")" and jumps into a new dialog', () => {
    const editor = setup("paren-open");
    const ev = key(")");
    expect(dispatch(editor, () => editor.dispatchCommand(KEY_DOWN_COMMAND, ev))).toBe(true);
    expect(blocks(editor)).toEqual([
      ["scriptz-character", "MAX"],
      ["scriptz-parenthetical", "(leise)"],
      ["scriptz-dialog", ""],
    ]);
    expect(caretBlockType(editor)).toBe("scriptz-dialog");
  });

  it('ignores "(" with a modifier', () => {
    const editor = setup("dialog-empty");
    const ev = key("(", { meta: true });
    dispatch(editor, () => editor.dispatchCommand(KEY_DOWN_COMMAND, ev));
    expect(ev.defaultPrevented).toBe(false);
    expect(blocks(editor)).toEqual([
      ["scriptz-character", "MAX"],
      ["scriptz-dialog", ""],
    ]);
  });
});

describe("smart Enter on a parenthetical", () => {
  it("inserts a dialog below a filled parenthetical", () => {
    const editor = setup("paren-text-empty-after");
    dispatch(editor, () => editor.dispatchCommand(KEY_ENTER_COMMAND, null));
    expect(blocks(editor)).toEqual([
      ["scriptz-character", "MAX"],
      ["scriptz-parenthetical", "(leise)"],
      ["scriptz-dialog", ""],
    ]);
    expect(caretBlockType(editor)).toBe("scriptz-dialog");
  });
});

describe("⌘4", () => {
  it("switches the caret block to parenthetical, keeping the text", () => {
    const editor = setup("dialog-text");
    const ev = key("4", { meta: true });
    expect(dispatch(editor, () => editor.dispatchCommand(KEY_DOWN_COMMAND, ev))).toBe(true);
    expect(ev.defaultPrevented).toBe(true);
    expect(blocks(editor)[1]).toEqual(["scriptz-parenthetical", "Hallo Welt"]);
  });
});
