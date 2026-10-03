import type { LexicalNode, NodeKey } from "lexical";
import { BaseScriptzNode, type SerializedScriptzNode } from "./BaseScriptzNode";
import type { BlockType } from "../../../lib/types";

export class ScriptzDialogNode extends BaseScriptzNode {
  static getType(): string {
    return "scriptz-dialog";
  }
  static getBlockType(): BlockType {
    return "scriptz-dialog";
  }
  static clone(node: ScriptzDialogNode): ScriptzDialogNode {
    return new ScriptzDialogNode(node.__key);
  }
  constructor(key?: NodeKey) {
    super(key);
  }
  getType(): string {
    return ScriptzDialogNode.getType();
  }
  hasTintHost(): boolean {
    return true;
  }
  static importJSON(serialized: SerializedScriptzNode): ScriptzDialogNode {
    const node = $createScriptzDialogNode();
    node.setFormat(serialized.format);
    node.setIndent(serialized.indent);
    node.setDirection(serialized.direction);
    return node;
  }
}

export function $createScriptzDialogNode(): ScriptzDialogNode {
  return new ScriptzDialogNode();
}

export function $isScriptzDialogNode(node: LexicalNode | null | undefined): node is ScriptzDialogNode {
  return node instanceof ScriptzDialogNode;
}
