import { For, Match, Show, Switch, createMemo, createSignal } from "solid-js";
import { Icon } from "@agentz/kit/ui";
import { K, getPlatformAdapter } from "@agentz/kit/platform";
import { pushToast } from "@agentz/kit/stores";
import { t, tPlural } from "../../i18n";
import type { ChatItem } from "../../lib/agent/chats";
import { markdownToPlain } from "../../lib/agent/markdown";
import { AGENT_PROCESS_EXITED } from "../../lib/agent/types";
import { sourceHost, type ClaimVerdict, type ProposalTarget } from "../../lib/agent/proposals";
import { agentSettings } from "../../stores/agentSettings";
import type { ChatSession } from "../../stores/agent";
import { Markdown } from "./Markdown";
import { ScriptBlocks } from "./ScriptBlocks";
import { scopeLabel, searchLabel, toolLabel, type Lookup } from "./labels";

type Item<K extends ChatItem["kind"]> = Extract<ChatItem, { kind: K }>;
export type TraceItem = Item<"tool"> | Item<"search"> | Item<"thinking"> | (Item<"assistant"> & { commentary: true });

export interface ItemContext {
  session: ChatSession;
  lookup: Lookup;
  colorOf(name: string): string;
  canApply: boolean;
}

// ---------------------------------------------------------------- user

export function UserMessage(props: { item: Item<"user"> }) {
  return (
    <div class="ag-user">
      <Show when={props.item.quote}>
        <span class="ag-user-q">{props.item.quote}</span>
      </Show>
      <span class="ag-user-t">{props.item.text}</span>
    </div>
  );
}

// ---------------------------------------------------------------- assistant

export function AssistantMessage(props: { item: Item<"assistant"> }) {
  return (
    <div class="ag-ai" classList={{ "is-streaming": !!props.item.streaming }}>
      <Markdown text={props.item.text} />
    </div>
  );
}

// ---------------------------------------------------------------- trace

/** Consecutive activity rows (tools, searches, thinking, progress notes)
 *  of one turn. Collapses to "n steps" once the turn is done. */
export function TraceGroup(props: { items: TraceItem[]; live: boolean; lookup: Lookup }) {
  const [open, setOpen] = createSignal(false);
  const collapsible = () => !props.live && props.items.length > 2;
  const expanded = () => !collapsible() || open();
  return (
    <div class="ag-trace" classList={{ "is-live": props.live }}>
      <Show when={collapsible()}>
        <button type="button" class="ag-trace-sum" aria-expanded={open()} onClick={() => setOpen(!open())}>
          <Icon name={open() ? "down" : "right"} size={11} />
          {tPlural("agent.trace.summary", props.items.length)}
        </button>
      </Show>
      <Show when={expanded()}>
        <For each={props.items}>{(item) => <TraceRow item={item} lookup={props.lookup} />}</For>
      </Show>
    </div>
  );
}

function TraceRow(props: { item: TraceItem; lookup: Lookup }) {
  return (
    <Switch>
      <Match when={props.item.kind === "thinking" && (props.item as Item<"thinking">)}>
        {(item) => <ThinkingRow item={item()} />}
      </Match>
      <Match when={props.item.kind === "assistant" && (props.item as Item<"assistant">)}>
        {(item) => (
          <div class="ag-row ag-row-note">
            <span class="ag-row-ic"><Icon name="dots" size={12} /></span>
            <Markdown text={item().text} class="ag-row-md" />
          </div>
        )}
      </Match>
      <Match when={props.item.kind === "tool" && (props.item as Item<"tool">)}>
        {(item) => {
          const label = () => toolLabel(item(), props.lookup);
          return <ActivityRow status={item().status} icon="doc" label={label().label} detail={label().detail} />;
        }}
      </Match>
      <Match when={props.item.kind === "search" && (props.item as Item<"search">)}>
        {(item) => {
          const label = () => searchLabel(item());
          return <ActivityRow status={item().status} icon="search" label={label().label} detail={label().detail} />;
        }}
      </Match>
    </Switch>
  );
}

function ActivityRow(props: { status: "running" | "done" | "failed"; icon: "doc" | "search"; label: string; detail: string }) {
  return (
    <div class="ag-row" classList={{ "is-running": props.status === "running", "is-failed": props.status === "failed" }}>
      <span class="ag-row-ic">
        <Show when={props.status === "running"} fallback={<Icon name={props.status === "failed" ? "x" : "check"} size={11} />}>
          <span class="ag-spin" />
        </Show>
      </span>
      <span class="ag-row-l">{props.label}</span>
      <Show when={props.detail}>
        <span class="ag-row-d">{props.detail}</span>
      </Show>
    </div>
  );
}

function ThinkingRow(props: { item: Item<"thinking"> }) {
  const [open, setOpen] = createSignal(false);
  const title = createMemo(() => {
    const first = props.item.text.split(/\n\s*\n/)[0] ?? "";
    return markdownToPlain(first);
  });
  return (
    <div class="ag-row ag-row-think" classList={{ "is-running": !props.item.done }}>
      <button type="button" class="ag-think-h" aria-expanded={open()} onClick={() => setOpen(!open())} disabled={!props.item.text.trim()}>
        <span class="ag-row-ic">
          <Show when={props.item.done} fallback={<span class="ag-spin" />}>
            <Icon name="spark" size={11} />
          </Show>
        </span>
        <span class="ag-row-l">{title() || (props.item.done ? t("agent.thinking.done") : t("agent.thinking.active"))}</span>
        <Show when={props.item.text.trim()}>
          <Icon name={open() ? "up" : "down"} size={10} class="ag-think-chev" />
        </Show>
      </button>
      <Show when={open()}>
        <Markdown text={props.item.text} class="ag-think-body" />
      </Show>
    </div>
  );
}

/** Shown while a turn runs and nothing visible has arrived yet. */
export function WorkingRow() {
  return (
    <div class="ag-trace is-live">
      <div class="ag-row is-running">
        <span class="ag-row-ic"><span class="ag-spin" /></span>
        <span class="ag-row-l">{t("agent.working")}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- proposal

function targetHint(target: ProposalTarget): string {
  if (target.mode === "append") return t("agent.option.target.append");
  if (target.mode === "insertAfter") return t("agent.option.target.insert");
  return tPlural("agent.option.target.replace", target.to - target.from + 1);
}

function applyLabel(target: ProposalTarget): string {
  if (target.mode === "append") return t("agent.option.append");
  if (target.mode === "insertAfter") return t("agent.option.insert");
  return t("agent.option.replace");
}

const LETTERS = ["A", "B", "C"];

export function ProposalCards(props: { item: Item<"proposal">; ctx: ItemContext }) {
  const apply = (index: number) => {
    if (!props.ctx.canApply) { pushToast(t("agent.option.noEditor"), "info"); return; }
    if (!props.ctx.session.applyOption(props.item.id, index)) {
      pushToast(t("agent.option.failed", { name: agentSettings.displayName() }), "error");
    }
  };
  return (
    <div class="ag-opts">
      <For each={props.item.proposal.options}>
        {(option, i) => {
          const applied = () => props.item.applied === i();
          const dim = () => props.item.applied !== null && !applied();
          return (
            <div class="ag-opt" classList={{ "is-applied": applied(), "is-dim": dim() }}>
              <div class="ag-opt-h">
                <span class="ag-opt-k">{LETTERS[i()] ?? i() + 1}</span>
                <b>{option.title || LETTERS[i()]}</b>
              </div>
              <Show when={option.note}>
                <p class="ag-opt-note">{option.note}</p>
              </Show>
              <ScriptBlocks blocks={option.blocks} colorOf={props.ctx.colorOf} />
              <div class="ag-opt-f">
                <Show when={!dim()}>
                <Show
                  when={!applied()}
                  fallback={
                    <span class="ag-opt-done">
                      <Icon name="check" size={12} />
                      {t("agent.option.applied")}
                      <span class="ag-opt-undo">{t("agent.option.undoHint", { hotkey: K("Mod+Z") })}</span>
                    </span>
                  }
                >
                  <button type="button" class="btn" classList={{ primary: i() === 0 && props.item.applied === null }} onClick={() => apply(i())}>
                    {applyLabel(props.item.proposal.target)}
                  </button>
                  <span class="ag-opt-target">{targetHint(props.item.proposal.target)}</span>
                </Show>
                </Show>
              </div>
            </div>
          );
        }}
      </For>
    </div>
  );
}

// ---------------------------------------------------------------- claims

const VERDICT_KEY: Record<ClaimVerdict, "agent.claim.correct" | "agent.claim.imprecise" | "agent.claim.wrong" | "agent.claim.unclear"> = {
  correct: "agent.claim.correct",
  imprecise: "agent.claim.imprecise",
  wrong: "agent.claim.wrong",
  unclear: "agent.claim.unclear",
};

function openSource(url: string) {
  void getPlatformAdapter().openUrl(url).catch((error) => console.warn("[agent] open source failed", error));
}

export function ClaimsCard(props: { item: Item<"claims">; ctx: ItemContext }) {
  const apply = (index: number) => {
    if (!props.ctx.canApply) { pushToast(t("agent.option.noEditor"), "info"); return; }
    if (!props.ctx.session.applyFix(props.item.id, index)) {
      pushToast(t("agent.option.failed", { name: agentSettings.displayName() }), "error");
    }
  };
  return (
    <div class="ag-claims">
      <div class="ag-claims-h">
        <Icon name="search" size={12} />
        {t("agent.claims.title")}
      </div>
      <For each={props.item.claims}>
        {(claim, i) => (
          <div class={`ag-claim is-${claim.verdict}`}>
            <span class={`ag-verdict is-${claim.verdict}`}>{t(VERDICT_KEY[claim.verdict])}</span>
            <q class="ag-claim-q">{claim.quote}</q>
            <Show when={claim.explanation}>
              <p class="ag-claim-x">{claim.explanation}</p>
            </Show>
            <Show when={claim.sources.length}>
              <div class="ag-src" aria-label={t("agent.claim.sources")}>
                <For each={claim.sources}>
                  {(source) => (
                    <button type="button" class="ag-src-chip" title={source.url} onClick={() => openSource(source.url)}>
                      <span class="ag-src-ic">{sourceHost(source.url).slice(0, 1).toUpperCase()}</span>
                      <b>{sourceHost(source.url)}</b>
                      <Show when={source.title && source.title !== sourceHost(source.url)}>
                        <span>{source.title}</span>
                      </Show>
                    </button>
                  )}
                </For>
              </div>
            </Show>
            <Show when={claim.fix}>
              {(fix) => (
                <div class="ag-claim-fix">
                  <ScriptBlocks blocks={fix().blocks} colorOf={props.ctx.colorOf} />
                  <Show
                    when={!props.item.applied.includes(i())}
                    fallback={<span class="ag-opt-done"><Icon name="check" size={12} />{t("agent.claim.fixed")}</span>}
                  >
                    <button type="button" class="btn" onClick={() => apply(i())}>{t("agent.claim.fix")}</button>
                  </Show>
                </div>
              )}
            </Show>
          </div>
        )}
      </For>
    </div>
  );
}

// ---------------------------------------------------------------- memory

export function MemoryNotice(props: { item: Item<"memory">; ctx: ItemContext }) {
  const title = () => {
    if (props.item.entry.source === "script") return t("agent.memory.learnedFromScript");
    return props.item.action === "added" ? t("agent.memory.added")
      : props.item.action === "updated" ? t("agent.memory.updated") : t("agent.memory.removed");
  };
  return (
    <div class="ag-mem" classList={{ "is-undone": !!props.item.undone, "is-removed": props.item.action === "removed" }}>
      <span class="ag-mem-ic"><Icon name="bulb" size={13} /></span>
      <div class="ag-mem-b">
        <span class="ag-mem-scope">{title()} · {scopeLabel(props.item.entry, props.ctx.lookup)}</span>
        <p>{props.item.entry.content}</p>
      </div>
      <Show
        when={!props.item.undone}
        fallback={<span class="ag-mem-undone">{t("agent.memory.undone")}</span>}
      >
        <button type="button" class="ag-mem-undo" onClick={() => void props.ctx.session.undoMemory(props.item.id)}>
          <Icon name="undo" size={12} />
          {t("agent.memory.undo")}
        </button>
      </Show>
    </div>
  );
}

// ---------------------------------------------------------------- misc

export function ErrorRow(props: { message: string }) {
  const usage = () => /usage ?limit|usageLimitExceeded|rate ?limit/i.test(props.message);
  const text = () => {
    if (props.message === AGENT_PROCESS_EXITED) return t("agent.error.exited");
    return usage() ? t("agent.error.usage") : t("agent.error", { message: cleanError(props.message) });
  };
  return (
    <div class="ag-err" role="alert">
      <Icon name="info" size={13} />
      <span>{text()}</span>
    </div>
  );
}

/** Codex wraps provider errors as JSON strings; show the inner message. */
export function cleanError(raw: string): string {
  let text = raw.trim();
  for (let i = 0; i < 3; i++) {
    try {
      const parsed: unknown = JSON.parse(text);
      const obj = parsed as { message?: unknown; error?: { message?: unknown } | string };
      const inner = typeof obj.error === "object" && obj.error ? obj.error.message : typeof obj.error === "string" ? obj.error : obj.message;
      if (typeof inner !== "string") break;
      text = inner;
    } catch {
      break;
    }
  }
  return text.length > 240 ? `${text.slice(0, 239)}…` : text;
}

export function NoteRow(props: { text: string }) {
  return <div class="ag-note">{props.text}</div>;
}
