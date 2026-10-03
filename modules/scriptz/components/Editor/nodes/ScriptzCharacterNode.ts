import type { EditorConfig, LexicalNode, NodeKey, Spread } from "lexical";
import { BaseScriptzNode, type SerializedScriptzNode } from "./BaseScriptzNode";
import type { BlockType } from "../../../lib/types";

export type SerializedScriptzCharacterNode = Spread<
  { characterName: string },
  SerializedScriptzNode
>;

export class ScriptzCharacterNode extends BaseScriptzNode {
  __characterName: string = "";

  static getType(): string {
    return "scriptz-character";
  }

  static getBlockType(): BlockType {
    return "scriptz-character";
  }

  static clone(node: ScriptzCharacterNode): ScriptzCharacterNode {
    const clone = new ScriptzCharacterNode(node.__key);
    clone.__characterName = node.__characterName;
    return clone;
  }

  constructor(key?: NodeKey) {
    super(key);
  }

  getType(): string {
    return ScriptzCharacterNode.getType();
  }

  getCharacterName(): string {
    return this.getLatest().__characterName;
  }

  setCharacterName(name: string): this {
    const writable = this.getWritable();
    writable.__characterName = name;
    return writable;
  }

  createDOM(config: EditorConfig): HTMLElement {
    return super.createDOM(config);
  }

  hasTintHost(): boolean {
    return true;
  }

  exportJSON(): SerializedScriptzCharacterNode {
    return {
      ...super.exportJSON(),
      characterName: this.__characterName,
    } as SerializedScriptzCharacterNode;
  }

  static importJSON(serialized: SerializedScriptzCharacterNode): ScriptzCharacterNode {
    const node = $createScriptzCharacterNode();
    node.setFormat(serialized.format);
    node.setIndent(serialized.indent);
    node.setDirection(serialized.direction);
    node.__characterName = serialized.characterName ?? "";
    return node;
  }
}

export function $createScriptzCharacterNode(): ScriptzCharacterNode {
  return new ScriptzCharacterNode();
}

export function $isScriptzCharacterNode(
  node: LexicalNode | null | undefined,
): node is ScriptzCharacterNode {
  return node instanceof ScriptzCharacterNode;
}
