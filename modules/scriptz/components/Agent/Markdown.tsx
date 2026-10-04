import { For, Match, Switch, createMemo } from "solid-js";
import { getPlatformAdapter } from "@agentz/kit/platform";
import { parseMarkdown, type Block, type Inline } from "../../lib/agent/markdown";

function openLink(event: MouseEvent, href: string) {
  event.preventDefault();
  void getPlatformAdapter().openUrl(href).catch((error) => console.warn("[agent] open link failed", error));
}

function Inlines(props: { nodes: Inline[] }) {
  return (
    <For each={props.nodes}>
      {(node) => (
        <Switch>
          <Match when={node.t === "text" && node}>{(n) => n().v}</Match>
          <Match when={node.t === "br"}><br /></Match>
          <Match when={node.t === "code" && node}>{(n) => <code>{n().v}</code>}</Match>
          <Match when={node.t === "bold" && node}>{(n) => <strong><Inlines nodes={n().c} /></strong>}</Match>
          <Match when={node.t === "italic" && node}>{(n) => <em><Inlines nodes={n().c} /></em>}</Match>
          <Match when={node.t === "link" && node}>
            {(n) => (
              <a href={n().href} title={n().href} onClick={(e) => openLink(e, n().href)}>
                <Inlines nodes={n().c} />
              </a>
            )}
          </Match>
        </Switch>
      )}
    </For>
  );
}

function BlockView(props: { block: Block }) {
  return (
    <Switch>
      <Match when={props.block.t === "p" && props.block}>{(b) => <p><Inlines nodes={b().c} /></p>}</Match>
      <Match when={props.block.t === "quote" && props.block}>{(b) => <blockquote><Inlines nodes={b().c} /></blockquote>}</Match>
      <Match when={props.block.t === "code" && props.block}>{(b) => <pre><code>{b().v}</code></pre>}</Match>
      <Match when={props.block.t === "ul" && props.block}>
        {(b) => <ul><For each={b().items}>{(item) => <li><Inlines nodes={item} /></li>}</For></ul>}
      </Match>
      <Match when={props.block.t === "ol" && props.block}>
        {(b) => <ol start={b().start}><For each={b().items}>{(item) => <li><Inlines nodes={item} /></li>}</For></ol>}
      </Match>
    </Switch>
  );
}

/** Renders agent Markdown as DOM nodes (never as HTML). */
export function Markdown(props: { text: string; class?: string }) {
  const blocks = createMemo(() => parseMarkdown(props.text));
  return (
    <div class={`ag-md${props.class ? ` ${props.class}` : ""}`}>
      <For each={blocks()}>{(block) => <BlockView block={block} />}</For>
    </div>
  );
}
