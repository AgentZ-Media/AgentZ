import type { BlockType } from "../../../lib/types";
import { t, type TranslationKey } from "../../../i18n";
import { ScriptzActionNode } from "./ScriptzActionNode";
import { ScriptzCharacterNode } from "./ScriptzCharacterNode";
import { ScriptzDialogNode } from "./ScriptzDialogNode";
import { ScriptzParentheticalNode } from "./ScriptzParentheticalNode";

// Four block types: Action, Character, Dialog, Parenthetical. The retired
// types (camera, caption, sfx) have no node class anymore - stored content
// is converted to action by lib/legacyBlocks.ts before Lexical parses it.

export {
  ScriptzActionNode,
  ScriptzCharacterNode,
  ScriptzDialogNode,
  ScriptzParentheticalNode,
};

export {
  $createScriptzActionNode,
  $isScriptzActionNode,
} from "./ScriptzActionNode";
export {
  $createScriptzCharacterNode,
  $isScriptzCharacterNode,
} from "./ScriptzCharacterNode";
export {
  $createScriptzDialogNode,
  $isScriptzDialogNode,
} from "./ScriptzDialogNode";
export {
  $createScriptzParentheticalNode,
  $isScriptzParentheticalNode,
} from "./ScriptzParentheticalNode";

export { BaseScriptzNode } from "./BaseScriptzNode";
export type { SerializedScriptzNode } from "./BaseScriptzNode";
export type { SerializedScriptzCharacterNode } from "./ScriptzCharacterNode";

export const SCRIPTZ_NODES = [
  ScriptzActionNode,
  ScriptzCharacterNode,
  ScriptzDialogNode,
  ScriptzParentheticalNode,
] as const;

/** Block types in picker / hotkey order (⌘1 Action, ⌘2 Character,
 *  ⌘3 Dialog, ⌘4 Parenthetical). */
export const BLOCK_TYPES: BlockType[] = [
  "scriptz-action",
  "scriptz-character",
  "scriptz-dialog",
  "scriptz-parenthetical",
];

const BLOCK_LABEL_KEYS: Record<BlockType, TranslationKey> = {
  "scriptz-action": "block.action",
  "scriptz-character": "block.character",
  "scriptz-dialog": "block.dialog",
  "scriptz-parenthetical": "block.parenthetical",
};

/** Localized, user-visible block type label. */
export function blockLabel(type: BlockType): string {
  return t(BLOCK_LABEL_KEYS[type]);
}

/** Hotkey (K() notation) that sets the block type directly. */
export const BLOCK_HOTKEYS: Record<BlockType, string> = {
  "scriptz-action": "Mod+1",
  "scriptz-character": "Mod+2",
  "scriptz-dialog": "Mod+3",
  "scriptz-parenthetical": "Mod+4",
};
