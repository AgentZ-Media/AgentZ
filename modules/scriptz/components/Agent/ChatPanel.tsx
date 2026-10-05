import { For, Match, Show, Switch, createEffect, createMemo, createSignal, on, onCleanup, onMount } from "solid-js";
import { Icon } from "@agentz/kit/ui";
import { K } from "@agentz/kit/platform";
import { shellUi } from "@agentz/kit/stores";
import { t } from "../../i18n";
import { api } from "../../lib/api";
import { scriptsBus } from "../../lib/scriptsBus";
import type { ChatItem } from "../../lib/agent/chats";
import { agentStore, type ChatSession } from "../../stores/agent";
import { agentSettings } from "../../stores/agentSettings";
import { agentUi } from "../../stores/agentUi";
import { library } from "../Shell/libraryData";
import { AgentAvatar, type AvatarState } from "./AgentAvatar";
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
  type ItemContext,
  type TraceItem,
} from "./ChatItems";
import { agentEditor, clearProposalPreview, liveBlocks } from "./editorBridge";
import { AGENT_JOBS, jobInstruction, type AgentJobId } from "../../lib/agent/jobs";
import { formatClock, formatRange, type LengthRange } from "../../lib/lengthGoal";
import { measureBlocks } from "./proposalMetrics";
import { JOB_HINT, JOB_ICON, JOB_LABEL } from "./jobLabels";
import { folderLookup } from "./labels";
import "./Agent.css";

export interface ChatPanelProps {
  scriptId: string;
  colorOf(name: string): string;
  onClose(): void;
  /** Target range of the script (for runtimes on cards and the jobs). */
  range: LengthRange | null;
  wpm: number;
}

type Group =
  | { kind: "trace"; key: string; items: TraceItem[] }
  | { kind: "item"; key: string; item: ChatItem };

function isTrace(item: ChatItem): item is TraceItem {
  return item.kind === "tool" || item.kind === "search" || item.kind === "thinking" || (item.kind === "assistant" && item.commentary === true);
}

/** Groups consecutive trace items. Unchanged groups keep their previous
 *  object so <For> keeps their rows: rebuilding every row on each change
 *  (e.g. marking an option as inserted) reset the scroll position and
 *  collapsed trace groups. Rows read their item reactively. */
function groupItems(items: readonly ChatItem[], previous: readonly Group[] = []): Group[] {
  const out: Group[] = [];
  for (const item of items) {
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

export function avatarStateFor(running: boolean, talking = false): AvatarState {
  if (running && talking) return "talk";
  if (running) return "think";
  if (agentStore.learning()) return "learn";
  return "idle";
}

/** The agent's chat next to the paper (replaces the inspector while open). */
export function ChatPanel(props: ChatPanelProps) {
  const gate = createMemo<"off" | "setup" | "status" | "chat">(() => {
    if (!agentSettings.onboarded()) return "setup";
    if (!agentSettings.enabled()) return "off";
    const state = agentStore.status().state;
    if (state === "ready") return "chat";
    return "status";
  });

  // Connect once the panel is shown with the agent on.
  createEffect(() => {
    if (agentSettings.enabled() && agentSettings.onboarded() && agentStore.status().state === "checking") {
      void agentStore.refreshStatus();
    }
  });

  return (
    <aside class="ag-panel" aria-label={t("agent.panel.aria", { name: agentSettings.displayName() })}>
      <Show when={gate() === "chat"} fallback={<PanelHead running={false} onClose={props.onClose} />}>
        <ChatBody {...props} />
      </Show>
      <Show when={gate() !== "chat" && (gate() as "off" | "setup" | "status")}>
        {(g) => <GateView gate={g()} />}
      </Show>
    </aside>
  );
}

function PanelHead(props: { running: boolean; onClose(): void; session?: ChatSession }) {
  const status = () => {
    const learning = agentStore.learning();
    if (props.running) return t("agent.status.working");
    if (learning) return t("agent.status.learning", { title: learning.title });
    if (!agentSettings.enabled()) return t("agent.status.off");
    const state = agentStore.status().state;
    if (state === "checking") return t("agent.status.checking");
    if (state !== "ready") return t("agent.status.offline");
    return agentStore.resolveModel()?.label ?? t("agent.status.ready");
  };
  const ready = () => agentSettings.enabled() && agentStore.status().state === "ready";
  // While the answer streams in, the face talks; while tools run, it thinks.
  const talking = () => {
    const items = props.session?.items;
    const last = items?.[items.length - 1];
    return !!last && last.kind === "assistant" && !!last.streaming && !last.commentary;
  };
  return (
    <header class="ag-head">
      <AgentAvatar look={agentSettings.look()} size={30} state={avatarStateFor(props.running, talking())} />
      <div class="ag-head-nm">
        <b>{agentSettings.displayName()}</b>
        <small classList={{ "is-ready": ready() }}>
          <i aria-hidden="true" />
          <span>{status()}</span>
        </small>
      </div>
      <span class="ag-sp" />
      <button type="button" class="ag-ic" title={t("agent.panel.memory")} aria-label={t("agent.panel.memory")} onClick={() => agentUi.openMemory()}>
        <Icon name="bulb" size={15} />
      </button>
      <Show when={props.session}>
        {(session) => (
          <button
            type="button"
            class="ag-ic"
            title={t("agent.panel.new")}
            aria-label={t("agent.panel.new")}
            disabled={session().items.length === 0}
            onClick={() => void session().reset()}
          >
            <Icon name="plus" size={15} />
          </button>
        )}
      </Show>
      <button
        type="button"
        class="ag-ic"
        title={t("agent.panel.close", { hotkey: K("Mod+L") })}
        aria-label={t("agent.panel.close", { hotkey: K("Mod+L") })}
        onClick={props.onClose}
      >
        <Icon name="x" size={15} />
      </button>
    </header>
  );
}

function GateView(props: { gate: "off" | "setup" | "status" }) {
  const name = () => agentSettings.displayName();
  const command = () => <code>codex login</code>;
  const splitCmd = (text: string) => {
    const [a, b] = text.split("{command}");
    return <>{a}{command()}{b ?? ""}</>;
  };
  return (
    <div class="ag-gate">
      <AgentAvatar look={agentSettings.look()} size={64} state={props.gate === "status" && agentStore.status().state === "checking" ? "think" : "idle"} />
      <Switch>
        <Match when={props.gate === "setup"}>
          <h3>{t("agent.state.setup.title")}</h3>
          <p>{t("agent.state.setup.body")}</p>
          <button type="button" class="btn primary" onClick={() => agentUi.openOnboarding()}>{t("agent.state.setup.action")}</button>
        </Match>
        <Match when={props.gate === "off"}>
          <h3>{t("agent.state.off.title", { name: name() })}</h3>
          <p>{t("agent.state.off.body")}</p>
          <button type="button" class="btn" onClick={() => shellUi.openSettings("agent")}>{t("agent.state.off.action")}</button>
        </Match>
        <Match when={props.gate === "status"}>
          <Switch>
            <Match when={agentStore.status().state === "checking"}>
              <p>{t("agent.status.checking")}</p>
            </Match>
            <Match when={agentStore.status().state === "missing"}>
              <h3>{t("agent.state.missing.title")}</h3>
              <p>{splitCmd(t("agent.state.missing.body", { name: name() }))}</p>
            </Match>
            <Match when={agentStore.status().state === "logged-out"}>
              <h3>{t("agent.state.loggedOut.title")}</h3>
              <p>{splitCmd(t("agent.state.loggedOut.body"))}</p>
            </Match>
            <Match when={agentStore.status().state === "unavailable"}>
              <p>{t("agent.state.unavailable")}</p>
            </Match>
            <Match when={agentStore.status().state === "error"}>
              <h3>{t("agent.state.error.title")}</h3>
              <p>{(agentStore.status() as { message?: string }).message ?? ""}</p>
            </Match>
          </Switch>
          <Show when={agentStore.status().state !== "checking" && agentStore.status().state !== "unavailable"}>
            <button type="button" class="btn" onClick={() => void agentStore.refreshStatus()}>{t("agent.state.retry")}</button>
          </Show>
        </Match>
      </Switch>
    </div>
  );
}

function ChatBody(props: ChatPanelProps) {
  const session = createMemo(() => agentStore.session(props.scriptId));
  // Proposals may name characters this script does not have yet (empty
  // script, new scene): fall back to the app-wide colour of that name.
  // A plain signal, not a resource: resources suspend the script screen.
  const [registry, setRegistry] = createSignal<ReadonlyMap<string, string>>(new Map());
  createEffect(on(scriptsBus.version, () => {
    let alive = true;
    onCleanup(() => { alive = false; });
    void api.listCharacterColors().then((records) => {
      if (!alive) return;
      const map = new Map<string, string>();
      for (const record of records) {
        const color = record.override_color ?? record.default_color;
        if (color) map.set(record.name.toUpperCase(), color);
      }
      setRegistry(map);
    }).catch(() => {});
  }));
  const colorOf = (name: string): string => {
    const own = props.colorOf(name);
    // "var(--muted)" is the script screen's "unknown character" value.
    if (own !== "var(--muted)") return own;
    return registry().get(name.toUpperCase()) ?? own;
  };
  const lookup = createMemo(() => folderLookup(library.folderList(), (id) => library.script(id)?.title ?? null));
  const [draft, setDraft] = createSignal("");
  const [quote, setQuote] = createSignal<{ text: string; from: number; to: number } | null>(null);
  let listRef: HTMLDivElement | undefined;
  let inputRef: HTMLTextAreaElement | undefined;
  let stick = true;

  const ctx = (): ItemContext => ({
    session: session(),
    lookup: lookup(),
    colorOf,
    canApply: agentEditor(props.scriptId) !== null,
    scriptId: props.scriptId,
    range: props.range,
    wpm: props.wpm,
  });

  const groups = createMemo<Group[]>((previous) => groupItems(session().items, previous), []);
  const running = () => session().running();
  const lastIsActivity = () => {
    const items = session().items;
    const last = items[items.length - 1];
    return !!last && last.kind !== "user";
  };

  // Keep the newest message in view unless the user scrolled up.
  const onScroll = () => {
    if (!listRef) return;
    stick = listRef.scrollHeight - listRef.scrollTop - listRef.clientHeight < 60;
  };
  createEffect(on(() => [session().items.length, JSON.stringify(session().items[session().items.length - 1] ?? null).length, running()], () => {
    if (!stick || !listRef) return;
    requestAnimationFrame(() => { if (listRef) listRef.scrollTop = listRef.scrollHeight; });
  }));
  onCleanup(clearProposalPreview);
  createEffect(on(() => props.scriptId, () => {
    clearProposalPreview();
    stick = true;
    setQuote(null);
    requestAnimationFrame(() => { if (listRef) listRef.scrollTop = listRef.scrollHeight; });
  }));

  const send = async (text = draft(), q = quote(), extra?: { instruction?: string; job?: AgentJobId }) => {
    const clean = text.trim();
    if (!clean || running()) return;
    setDraft("");
    setQuote(null);
    stick = true;
    resize();
    await session().send(clean, q ?? undefined, extra);
  };

  /** A fixed job: the chat shows its label, the model gets the full
   *  instruction (lib/agent/jobs.ts). */
  const runJob = (job: AgentJobId) => {
    const blocks = liveBlocks(props.scriptId) ?? [];
    const runtime = measureBlocks(blocks, props.wpm).runtimeSec;
    const instruction = jobInstruction(job, { range: formatRange(props.range), runtime: formatClock(runtime), wpm: props.wpm });
    void send(t(JOB_LABEL[job]), null, { instruction, job });
  };

  // Requests from the editor context menu.
  createEffect(() => {
    const req = agentUi.request();
    if (!req || req.scriptId !== props.scriptId) return;
    const taken = agentUi.takeRequest(props.scriptId);
    if (!taken) return;
    if (taken.job) runJob(taken.job);
    else if (taken.send) void send(taken.text, taken.quote ?? null, taken.instruction ? { instruction: taken.instruction } : undefined);
    else {
      setQuote(taken.quote ?? null);
      setDraft(taken.text);
      queueMicrotask(() => { inputRef?.focus(); resize(); });
    }
  });

  const resize = () => {
    if (!inputRef) return;
    inputRef.style.height = "auto";
    inputRef.style.height = `${Math.min(160, inputRef.scrollHeight)}px`;
  };

  onMount(() => {
    queueMicrotask(() => inputRef?.focus({ preventScroll: true }));
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && running() && document.activeElement === inputRef) {
        event.preventDefault();
        void session().stop();
      }
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });


  return (
    <>
      <PanelHead running={running()} onClose={props.onClose} session={session()} />
      <div class="ag-list" ref={listRef} onScroll={onScroll}>
        <Show
          when={session().items.length > 0}
          fallback={
            <Show when={session().ready()}>
              <div class="ag-empty">
                <AgentAvatar look={agentSettings.look()} size={52} state="idle" />
                <h3>{t("agent.empty.title")}</h3>
                <p>{t("agent.empty.body", { name: agentSettings.displayName() })}</p>
                <div class="ag-jobs" role="list" aria-label={t("agent.jobs.title")}>
                  <For each={AGENT_JOBS}>
                    {(job) => (
                      <button type="button" class="ag-job" role="listitem" onClick={() => runJob(job)}>
                        <Icon name={JOB_ICON[job]} size={14} />
                        <b>{t(JOB_LABEL[job])}</b>
                        <small>{t(JOB_HINT[job])}</small>
                      </button>
                    )}
                  </For>
                </div>
                <p class="ag-jobs-or">{t("agent.jobs.or")}</p>
              </div>
            </Show>
          }
        >
          <For each={groups()}>
            {(group, i) => (
              <Switch>
                <Match when={group.kind === "trace" && group}>
                  {(g) => <TraceGroup items={g().items} live={running() && i() === groups().length - 1} lookup={lookup()} />}
                </Match>
                <Match when={group.kind === "item" && group.item}>
                  {(item) => <ItemView item={item()} ctx={ctx()} />}
                </Match>
              </Switch>
            )}
          </For>
          <Show when={running() && !lastIsActivity()}>
            <WorkingRow />
          </Show>
        </Show>
      </div>
      <div class="ag-composer" classList={{ "is-running": running() }}>
        <Show when={quote()}>
          {(q) => (
            <div class="ag-quote">
              <span class="ag-quote-l">{t("agent.composer.quote")}</span>
              <span class="ag-quote-t">{q().text}</span>
              <button type="button" class="ag-quote-x" aria-label={t("agent.composer.removeQuote")} title={t("agent.composer.removeQuote")} onClick={() => setQuote(null)}>
                <Icon name="x" size={11} />
              </button>
            </div>
          )}
        </Show>
        <div class="ag-input">
          <textarea
            ref={inputRef}
            rows={1}
            value={draft()}
            placeholder={t("agent.composer.placeholder", { name: agentSettings.displayName() })}
            aria-label={t("agent.composer.placeholder", { name: agentSettings.displayName() })}
            onInput={(e) => { setDraft(e.currentTarget.value); resize(); }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <Show
            when={running()}
            fallback={
              <button type="button" class="ag-send" disabled={!draft().trim()} title={t("agent.composer.send")} aria-label={t("agent.composer.send")} onClick={() => void send()}>
                <Icon name="up" size={15} />
              </button>
            }
          >
            <button type="button" class="ag-send is-stop" title={t("agent.composer.stop")} aria-label={t("agent.composer.stop")} onClick={() => void session().stop()}>
              <span class="ag-stop-sq" />
            </button>
          </Show>
        </div>
      </div>
    </>
  );
}

function ItemView(props: { item: ChatItem; ctx: ItemContext }) {
  return (
    <Switch>
      <Match when={props.item.kind === "user" && (props.item as Extract<ChatItem, { kind: "user" }>)}>{(item) => <UserMessage item={item()} />}</Match>
      <Match when={props.item.kind === "assistant" && (props.item as Extract<ChatItem, { kind: "assistant" }>)}>{(item) => <AssistantMessage item={item()} />}</Match>
      <Match when={props.item.kind === "proposal" && (props.item as Extract<ChatItem, { kind: "proposal" }>)}>{(item) => <ProposalCards item={item()} ctx={props.ctx} />}</Match>
      <Match when={props.item.kind === "claims" && (props.item as Extract<ChatItem, { kind: "claims" }>)}>{(item) => <ClaimsCard item={item()} ctx={props.ctx} />}</Match>
      <Match when={props.item.kind === "memory" && (props.item as Extract<ChatItem, { kind: "memory" }>)}>{(item) => <MemoryNotice item={item()} ctx={props.ctx} />}</Match>
      <Match when={props.item.kind === "error" && (props.item as Extract<ChatItem, { kind: "error" }>)}>{(item) => <ErrorRow message={item().message} />}</Match>
      <Match when={props.item.kind === "blocked"}><NoteRow text={t("agent.blocked", { name: agentSettings.displayName() })} /></Match>
      <Match when={props.item.kind === "interrupted"}><NoteRow text={t("agent.interrupted")} /></Match>
    </Switch>
  );
}
