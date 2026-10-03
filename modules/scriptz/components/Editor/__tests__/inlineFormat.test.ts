import { describe, expect, it } from "vitest";
import {
  $createTextNode,
  $getRoot,
  createEditor,
  FORMAT_TEXT_COMMAND,
  KEY_DOWN_COMMAND,
  type CreateEditorArgs,
  type LexicalEditor,
} from "lexical";
import { $createScriptzActionNode, SCRIPTZ_NODES } from "../nodes";
import { installInlineFormat } from "../plugins/inlineFormat";

function setup(): { editor: LexicalEditor; dispose: () => void } {
  const editor = createEditor({
    namespace: "inline-format-test",
    nodes: SCRIPTZ_NODES as unknown as CreateEditorArgs["nodes"],
    onError: (err: Error) => {
      throw err;
    },
  });
  editor.update(
    () => {
      const block = $createScriptzActionNode();
      block.append($createTextNode("Timo geht."));
      $getRoot().append(block);
      block.selectEnd();
    },
    { discrete: true },
  );
  return { editor, dispose: installInlineFormat(editor) };
}

function key(k: string): KeyboardEvent {
  return new KeyboardEvent("keydown", { key: k, metaKey: true, cancelable: true, bubbles: true });
}

describe("installInlineFormat", () => {
  it("claims ⌘I for Lexical without preventing default, so the shell's quick-capture still runs", () => {
    const { editor, dispose } = setup();
    const ev = key("i");
    expect(editor.dispatchCommand(KEY_DOWN_COMMAND, ev)).toBe(true);
    // The shell shortcut handler ignores default-prevented events.
    expect(ev.defaultPrevented).toBe(false);
    dispose();
  });

  it("swallows italic from any source", () => {
    const { editor, dispose } = setup();
    expect(editor.dispatchCommand(FORMAT_TEXT_COMMAND, "italic")).toBe(true);
    dispose();
  });

  it("handles ⌘B in an action block and prevents the browser default", () => {
    const { editor, dispose } = setup();
    const ev = key("b");
    expect(editor.dispatchCommand(KEY_DOWN_COMMAND, ev)).toBe(true);
    expect(ev.defaultPrevented).toBe(true);
    dispose();
  });
});
