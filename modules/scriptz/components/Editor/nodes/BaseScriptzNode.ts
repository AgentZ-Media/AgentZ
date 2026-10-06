import {
  ElementNode,
  type EditorConfig,
  type ElementDOMSlot,
  type LexicalNode,
  type SerializedElementNode,
  type Spread,
} from "lexical";
import type { BlockType } from "../../../lib/types";

export type SerializedScriptzNode = Spread<
  { blockType: BlockType },
  SerializedElementNode
>;

/**
 * Shared base class for the four ScriptZ block types (Action, Character,
 * Dialog, Parenthetical).
 * Each subclass declares its own BlockType through `getBlockType()`.
 */
export abstract class BaseScriptzNode extends ElementNode {
  static getBlockType(): BlockType {
    throw new Error("BaseScriptzNode subclass must override getBlockType()");
  }

  getBlockType(): BlockType {
    return (this.constructor as unknown as typeof BaseScriptzNode).getBlockType();
  }

  /** When true, createDOM nests a `<span class="tint-host">` inside the
   *  block and getDOMSlot routes Lexical's children into it. The inner
   *  span becomes the single inline element that hosts the character
   *  tint, so per-line text-hugging pills stay intact across bold /
   *  italic runs (Lexical would otherwise emit a sibling `<strong>` per
   *  bold run and the bg would split into separate pills). Used by
   *  Dialog, Character and Parenthetical - the only tinted blocks. */
  hasTintHost(): boolean {
    return false;
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const type = this.getBlockType();
    const dom = document.createElement("div");
    dom.classList.add("block", `block-${type}`);
    dom.setAttribute("data-block-type", type);
    if (this.hasTintHost()) {
      const host = document.createElement("span");
      host.className = "tint-host";
      dom.appendChild(host);
    }
    return dom;
  }

  getDOMSlot(element: HTMLElement): ElementDOMSlot<HTMLElement> {
    const base = super.getDOMSlot(element);
    if (!this.hasTintHost()) return base;
    const host = element.querySelector<HTMLElement>(":scope > .tint-host");
    return host ? base.withElement(host) : base;
  }

  updateDOM(_prev: this, _dom: HTMLElement, _config: EditorConfig): boolean {
    return false;
  }

  exportJSON(): SerializedScriptzNode {
    return {
      ...super.exportJSON(),
      blockType: this.getBlockType(),
      type: (this.constructor as unknown as { getType(): string }).getType(),
      version: 1,
    } as SerializedScriptzNode;
  }

  // Every subclass overrides this.
  static importJSON(_serialized: SerializedScriptzNode): BaseScriptzNode {
    throw new Error("BaseScriptzNode subclass must override importJSON()");
  }

  isShadowRoot(): boolean {
    return false;
  }

  // Block nodes are always block-level top-level paragraphs.
  canBeEmpty(): boolean {
    return true;
  }

  canInsertTextBefore(): boolean {
    return true;
  }

  canInsertTextAfter(): boolean {
    return true;
  }

  // Smart-Enter inserts sibling blocks itself via concrete factories.
  insertNewAfter(_selection: unknown, _restoreSelection?: boolean): LexicalNode | null {
    return null;
  }
}
