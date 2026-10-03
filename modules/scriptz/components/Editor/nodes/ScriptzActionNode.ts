import type { LexicalNode, NodeKey } from "lexical";
import { BaseScriptzNode, type SerializedScriptzNode } from "./BaseScriptzNode";
import type { BlockType } from "../../../lib/types";

export class ScriptzActionNode extends BaseScriptzNode {
  static getType(): string {
    return "scriptz-action";
  }

  static getBlockType(): BlockType {
    return "scriptz-action";
  }

  static clone(node: ScriptzActionNode): ScriptzActionNode {
    return new ScriptzActionNode(node.__key);
  }

  constructor(key?: NodeKey) {
    super(key);
  }

  getType(): string {
    return ScriptzActionNode.getType();
  }

  static importJSON(serialized: SerializedScriptzNode): ScriptzActionNode {
    const node = $createScriptzActionNode();
    node.setFormat(serialized.format);
    node.setIndent(serialized.indent);
    node.setDirection(serialized.direction);
    return node;
  }
}

export function $createScriptzActionNode(): ScriptzActionNode {
  return new ScriptzActionNode();
}

export function $isScriptzActionNode(node: LexicalNode | null | undefined): node is ScriptzActionNode {
  return node instanceof ScriptzActionNode;
}
