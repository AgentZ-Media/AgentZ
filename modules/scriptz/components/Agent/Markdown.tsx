import { Index, Match, Switch, createMemo } from "solid-js";
import { getPlatformAdapter } from "@agentz/kit/platform";
import { parseMarkdown, type Block, type Inline } from "../../lib/agent/markdown";

// Every streamed token parses the text anew into fresh objects. Rows are
// positional (<Index>), so a token updates the last text node instead of
// rebuilding the message.

function openLink(event: MouseEvent, href: string) {
  event.preventDefault();
  void getPlatformAdapter().openUrl(href).catch((error) => console.warn("[agent] open link failed", error));
}

function Inlines(props: { nodes: Inline[] }) {
  return (
    <Index each={props.nodes}>
      {(node) => (
        <Switch>
          <Match when={node().t === "text" && (node() as Extract<Inline, { t: "text" }>)}>{(n) => n().v}</Match>
          <Match when={node().t === "br"}><br /></Match>
          <Match when={node().t === "code" && (node() as Extract<Inline, { t: "code" }>)}>{(n) => <code>{n().v}</code>}</Match>
          <Match when={node().t === "bold" && (node() as Extract<Inline, { t: "bold" }>)}>{(n) => <strong><Inlines nodes={n().c} /></strong>}</Match>
          <Match when={node().t === "italic" && (node() as Extract<Inline, { t: "italic" }>)}>{(n) => <em><Inlines nodes={n().c} /></em>}</Match>
          <Match when={node().t === "link" && (node() as Extract<Inline, { t: "link" }>)}>
            {(n) => (
              <a href={n().href} title={n().href} onClick={(e) => openLink(e, n().href)}>
                <Inlines nodes={n().c} />
              </a>
            )}
          </Match>
        </Switch>
      )}
    </Index>
  );
}

function BlockView(props: { block: Block }) {
  return (
    <Switch>
      <Match when={props.block.t === "p" && (props.block as Extract<Block, { t: "p" }>)}>{(b) => <p><Inlines nodes={b().c} /></p>}</Match>
      <Match when={props.block.t === "quote" && (props.block as Extract<Block, { t: "quote" }>)}>{(b) => <blockquote><Inlines nodes={b().c} /></blockquote>}</Match>
      <Match when={props.block.t === "code" && (props.block as Extract<Block, { t: "code" }>)}>{(b) => <pre><code>{b().v}</code></pre>}</Match>
      <Match when={props.block.t === "ul" && (props.block as Extract<Block, { t: "ul" }>)}>
        {(b) => <ul><Index each={b().items}>{(item) => <li><Inlines nodes={item()} /></li>}</Index></ul>}
      </Match>
      <Match when={props.block.t === "ol" && (props.block as Extract<Block, { t: "ol" }>)}>
        {(b) => <ol start={b().start}><Index each={b().items}>{(item) => <li><Inlines nodes={item()} /></li>}</Index></ol>}
      </Match>
    </Switch>
  );
}

/** Renders agent Markdown as DOM nodes (never as HTML). */
export function Markdown(props: { text: string; class?: string }) {
  const blocks = createMemo(() => parseMarkdown(props.text));
  return (
    <div class={`ag-md${props.class ? ` ${props.class}` : ""}`}>
      <Index each={blocks()}>{(block) => <BlockView block={block()} />}</Index>
    </div>
  );
}
