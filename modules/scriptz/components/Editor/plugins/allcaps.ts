import { mergeRegister } from "@lexical/utils";
import { ScriptzCharacterNode } from "../nodes";
import type { LexicalEditor } from "lexical";

/**
 * Visual ALL CAPS for Charakter blocks is done in CSS (`text-transform`).
 * This plugin just keeps the parent block's `characterName` attribute in sync
 * with its text content (uppercased) so the JSON state and exporters get a
 * normalised name. Mutating only the attribute (never text-node children)
 * avoids the selection drift that previously froze typing after a few keys.
 */
export function installAllCaps(editor: LexicalEditor): () => void {
  return mergeRegister(
    editor.registerNodeTransform(ScriptzCharacterNode, (node) => {
      const upper = node.getTextContent().toUpperCase();
      if (node.getCharacterName() !== upper) {
        node.setCharacterName(upper);
      }
    }),
  );
}
