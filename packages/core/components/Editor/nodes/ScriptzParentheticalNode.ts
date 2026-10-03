import type { LexicalNode, NodeKey } from "lexical";
import { BaseScriptzNode, type SerializedScriptzNode } from "./BaseScriptzNode";
import type { BlockType } from "../../../lib/types";

export class ScriptzParentheticalNode extends BaseScriptzNode {
  static getType(): string {
    return "scriptz-parenthetical";
  }
  static getBlockType(): BlockType {
    return "scriptz-parenthetical";
  }
  static clone(node: ScriptzParentheticalNode): ScriptzParentheticalNode {
    return new ScriptzParentheticalNode(node.__key);
  }
  constructor(key?: NodeKey) {
    super(key);
  }
  getType(): string {
    return ScriptzParentheticalNode.getType();
  }
  hasTintHost(): boolean {
    return true;
  }
  static importJSON(serialized: SerializedScriptzNode): ScriptzParentheticalNode {
    const node = $createScriptzParentheticalNode();
    node.setFormat(serialized.format);
    node.setIndent(serialized.indent);
    node.setDirection(serialized.direction);
    return node;
  }
}

export function $createScriptzParentheticalNode(): ScriptzParentheticalNode {
  return new ScriptzParentheticalNode();
}

export function $isScriptzParentheticalNode(
  node: LexicalNode | null | undefined,
): node is ScriptzParentheticalNode {
  return node instanceof ScriptzParentheticalNode;
}
