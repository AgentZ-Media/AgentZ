import { For, Match, Show, Switch, createMemo, type Accessor } from "solid-js";
import { t } from "../../i18n";
import { draftStates, type ChatItem } from "../../lib/agent/chats";
import { draftRuntime, hasDraft } from "../../lib/agent/drafts";
import { settingsStore } from "../../stores/settings";
import { agentSettings } from "../../stores/agentSettings";
import {
  AssistantMessage,
  ClaimsCard,
  ErrorRow,
  MemoryNotice,
  NoteRow,
  ProposalCards,
  TraceGroup,
  UserMessage,
  WorkingRow,
  type DraftRef,
  type ItemContext,
  type TraceItem,
} from "./ChatItems";
import { DiscardedRow, HandoffRow, IdeaBoard, SavedIdeasCard } from "./ModeItems";
import type { Lookup } from "./labels";

export type Group =
  | { kind: "trace"; key: string; items: TraceItem[] }
  | { kind: "item"; key: string; item: ChatItem };

export function isTrace(item: ChatItem): item is TraceItem {
  if (item.kind === "assistant") return item.commentary === true && !hasDraft(item.text);
  return item.kind === "tool" || item.kind === "search" || item.kind === "thinking";
}

/** Items that are not rows of the list (quick replies sit above the composer). */
function isHidden(item: ChatItem): boolean {
  return item.kind === "replies";
}

/** Groups consecutive trace items. Unchanged groups keep their previous
 *  object so <For> keeps their rows: rebuilding every row on each change
 *  (e.g. marking an option as inserted) reset the scroll position and
 *  collapsed trace groups. Rows read their item reactively. */
export function groupItems(items: readonly ChatItem[], previous: readonly Group[] = []): Group[] {
  const out: Group[] = [];
  for (const item of items) {
    if (isHidden(item)) continue;
    const last = out[out.length - 1];
    if (isTrace(item)) {
      if (last?.kind === "trace") last.items.push(item);
      else out.push({ kind: "trace", key: `trace-${item.id}`, items: [item] });
    } else {
      out.push({ kind: "item", key: item.id, item });
    }
  }
  const before = new Map(previous.map((group) => [group.key, group]));
  return out.map((group) => {
    const old = before.get(group.key);
    if (!old || old.kind !== group.kind) return group;
    if (old.kind === "item" && group.kind === "item") return old.item === group.item ? old : group;
    if (old.kind === "trace" && group.kind === "trace") {
      const same = old.items.length === group.items.length && old.items.every((item, i) => item === group.items[i]);
      return same ? old : group;
    }
    return group;
  });
}

/** Every draft version of a chat with its number, state and runtime. */
export function createDraftIndex(items: Accessor<readonly ChatItem[]>): Accessor<ReadonlyMap<string, DraftRef>> {
  return createDraftIndexFrom(createMemo(() => draftStates(items())));
}

/** `createDraftIndex` over draft states a view has already derived (the
 *  agent mode needs them for its panel, too). */
export function createDraftIndexFrom(states: Accessor<ReturnType<typeof draftStates>>): Accessor<ReadonlyMap<string, DraftRef>> {
  return createMemo(() => {
    const map = new Map<string, DraftRef>();
    const wpm = settingsStore.dialogWpm();
    for (const { draft, latest, state } of states()) {
      draft.versions.forEach((version, i) => {
        const isLatest = version.id === latest.id;
        map.set(version.id, {
          slug: draft.slug,
          versionId: version.id,
          number: i + 1,
          title: version.title,
          state: isLatest ? state : "open",
          latest: isLatest,
          complete: version.complete,
          seconds: draftRuntime(version.blocks, wpm),
          blockCount: version.blocks.length,
        });
      });
    }
    return map;
  });
}

/** What changes on the newest item while a turn streams (text grows, a
 *  tool finishes): cheap enough to watch per token for auto-scrolling. */
export function tailKey(items: readonly ChatItem[]): string {
  const last = items[items.length - 1];
  if (!last) return "";
  const length = "text" in last ? last.text.length : 0;
  const state = last.kind === "tool" || last.kind === "search" ? last.status : last.kind === "thinking" ? String(last.done) : "";
  return `${items.length}:${last.id}:${length}:${state}`;
}

/** Quick replies offered at the end of the last turn. */
export function lastReplies(items: readonly ChatItem[]): string[] {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item.kind === "replies") return item.replies;
    // A new message or a draft that became a script ends the old turn.
    if (item.kind === "user" || item.kind === "handoff" || item.kind === "draft-discarded") return [];
  }
  return [];
}

/** The rows of a chat: messages, cards and collapsed activity. */
export function ChatList(props: { items: readonly ChatItem[]; running: boolean; lookup: Lookup; ctx: ItemContext }) {
  const groups = createMemo<Group[]>((previous) => groupItems(props.items, previous), []);
  const lastIsActivity = () => {
    const visible = props.items.filter((item) => !isHidden(item));
    const last = visible[visible.length - 1];
    return !!last && last.kind !== "user";
  };
  return (
    <>
      <For each={groups()}>
        {(group, i) => (
          <Switch>
            <Match when={group.kind === "trace" && group}>
              {(g) => <TraceGroup items={g().items} live={props.running && i() === groups().length - 1} lookup={props.lookup} />}
            </Match>
            <Match when={group.kind === "item" && group.item}>
              {(item) => <ItemView item={item()} ctx={props.ctx} />}
            </Match>
          </Switch>
        )}
      </For>
      <Show when={props.running && !lastIsActivity()}>
        <WorkingRow />
      </Show>
    </>
  );
}

export function ItemView(props: { item: ChatItem; ctx: ItemContext }) {
  return (
    <Switch>
      <Match when={props.item.kind === "user" && (props.item as Extract<ChatItem, { kind: "user" }>)}>{(item) => <UserMessage item={item()} />}</Match>
      <Match when={props.item.kind === "assistant" && (props.item as Extract<ChatItem, { kind: "assistant" }>)}>{(item) => <AssistantMessage item={item()} ctx={props.ctx} />}</Match>
      <Match when={props.item.kind === "proposal" && (props.item as Extract<ChatItem, { kind: "proposal" }>)}>{(item) => <ProposalCards item={item()} ctx={props.ctx} />}</Match>
      <Match when={props.item.kind === "claims" && (props.item as Extract<ChatItem, { kind: "claims" }>)}>{(item) => <ClaimsCard item={item()} ctx={props.ctx} />}</Match>
      <Match when={props.item.kind === "memory" && (props.item as Extract<ChatItem, { kind: "memory" }>)}>{(item) => <MemoryNotice item={item()} ctx={props.ctx} />}</Match>
      <Match when={props.item.kind === "ideas" && (props.item as Extract<ChatItem, { kind: "ideas" }>)}>{(item) => <IdeaBoard item={item()} ctx={props.ctx} />}</Match>
      <Match when={props.item.kind === "ideas-saved" && (props.item as Extract<ChatItem, { kind: "ideas-saved" }>)}>{(item) => <SavedIdeasCard item={item()} ctx={props.ctx} />}</Match>
      <Match when={props.item.kind === "handoff" && (props.item as Extract<ChatItem, { kind: "handoff" }>)}>{(item) => <HandoffRow item={item()} ctx={props.ctx} />}</Match>
      <Match when={props.item.kind === "draft-discarded" && (props.item as Extract<ChatItem, { kind: "draft-discarded" }>)}>{(item) => <DiscardedRow item={item()} ctx={props.ctx} />}</Match>
      <Match when={props.item.kind === "error" && (props.item as Extract<ChatItem, { kind: "error" }>)}>{(item) => <ErrorRow message={item().message} />}</Match>
      <Match when={props.item.kind === "blocked"}><NoteRow text={t("agent.blocked", { name: agentSettings.displayName() })} /></Match>
      <Match when={props.item.kind === "interrupted"}><NoteRow text={t("agent.interrupted")} /></Match>
    </Switch>
  );
}
