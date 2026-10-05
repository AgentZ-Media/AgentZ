import { For } from "solid-js";
import type { AgentBlock } from "../../lib/agent/scriptText";

/** A proposal rendered like the paper: same four block types, character
 *  tints as in the editor (colour mixed onto the paper at 28 %). */
export function ScriptBlocks(props: { blocks: readonly AgentBlock[]; colorOf(name: string): string }) {
  const speakerAt = (index: number): string => {
    for (let i = index; i >= 0; i--) {
      const block = props.blocks[i];
      if (block.type === "character") return block.text.trim().toUpperCase();
      if (block.type === "action") return "";
    }
    return "";
  };
  return (
    <div class="ag-paper">
      <For each={props.blocks}>
        {(block, i) => {
          const speaker = () => (block.type === "action" ? "" : block.type === "character" ? block.text.trim().toUpperCase() : speakerAt(i()));
          const tint = () => (speaker() ? { "--char": props.colorOf(speaker()) } : {});
          return (
            <div class={`ag-b ag-b-${block.type}`} style={tint()}>
              {block.type === "action" ? block.text : <span class="ag-m">{block.text}</span>}
            </div>
          );
        }}
      </For>
    </div>
  );
}
