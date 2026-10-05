import { For, Show, createEffect, createMemo, createSignal, on, onCleanup, onMount, untrack } from "solid-js";
import { Icon, confirmDialog } from "@agentz/kit/ui";
import { K } from "@agentz/kit/platform";
import { pushToast } from "@agentz/kit/stores";
import { t, tPlural } from "../../i18n";
import { api } from "../../lib/api";
import { draftStates } from "../../lib/agent/chats";
import type { DraftVersion } from "../../lib/agent/drafts";
import { scriptsBus } from "../../lib/scriptsBus";
import { agentStore, type ChatQuote, type ChatSession } from "../../stores/agent";
import { agentSettings } from "../../stores/agentSettings";
import { agentUi } from "../../stores/agentUi";
import { ideasStore } from "../../stores/ideas";
import { navStore } from "../../stores/nav";
import { uiStore } from "../../stores/ui";
import { AgentAvatar } from "../Agent/AgentAvatar";
import type { ItemContext } from "../Agent/ChatItems";
import { ChatList, createDraftIndex, lastReplies } from "../Agent/ChatList";
import { GateView, avatarStateFor } from "../Agent/ChatPanel";
import { RepliesBar } from "../Agent/ModeItems";
import { folderLookup } from "../Agent/labels";
import { StageGlyph } from "../Common/StageGlyph";
import { ideaAge } from "../Ideas/ideaGroups";
import { ContextMenu, type ContextMenuItem } from "../Library/ContextMenu";
import { library } from "../Shell/libraryData";
import { startSession } from "./actions";
import { AgentComposer } from "./AgentComposer";
import { DraftPanel, type DraftState } from "./DraftPanel";
import { FinishDialog, type FinishTarget } from "./FinishDialog";
import { SessionsDialog, sessionSubline } from "./SessionsDialog";
import "../Agent/Agent.css";
import "./AgentMode.css";

/** Character colours for drafts and cards: the app-wide registry (the
 *  agent mode has no script of its own). */
function useCharacterColors(): (name: string) => string {
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
  return (name) => registry().get(name.trim().toUpperCase()) ?? "var(--muted)";
}

/** Route `agent`: the agent mode. */
export function AgentPage() {
  const chatId = () => navStore.activeAgentChatId();
  createEffect(() => { const id = chatId(); if (id) agentUi.setLastAgentChat(id); });

  const gate = createMemo<"off" | "setup" | "status" | "chat" | "unavailable">(() => {
    if (!agentStore.available()) return "unavailable";
    if (!agentSettings.onboarded()) return "setup";
    if (!agentSettings.enabled()) return "off";
    return agentStore.status().state === "ready" ? "chat" : "status";
  });
  createEffect(() => {
    if (agentStore.available() && agentSettings.enabled() && agentSettings.onboarded() && agentStore.status().state === "checking") {
      void agentStore.refreshStatus();
    }
  });
  onMount(() => { if (agentStore.available()) void agentStore.refreshSessions(); });

  return (
    <div class="am-page">
      <SessionsDialog open={sessionsOpen()} onClose={() => setSessionsOpen(false)} onDelete={deleteSession} />
      <Show
        when={gate() === "chat" && chatId()}
        keyed
        fallback={
          <>
            <AgentBar session={null} />
            <div class="am-gate">
              <Show when={gate() === "unavailable"} fallback={<GateView gate={gate() as "off" | "setup" | "status"} />}>
                <div class="ag-gate">
                  <p>{t("agent.state.unavailable")}</p>
                </div>
              </Show>
            </div>
          </>
        }
      >
        {(id) => <SessionView chatId={id} />}
      </Show>
    </div>
  );
}

// ---------------------------------------------------------------- top bar

function AgentBar(props: { session: ChatSession | null }) {
  const [menu, setMenu] = createSignal<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const title = () => {
    const s = props.session;
    if (!s) return t("agentMode.bar.title");
    return s.title() || t("agentMode.bar.newSession");
  };
  const openSessions = (e: MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu({ x: r.right, y: r.bottom + 4, items: sessionMenuItems(props.session?.chatId() ?? null) });
  };
  return (
    <header class="am-bar" data-tauri-drag-region>
      <Show when={!uiStore.sidebarOpen()}>
        <button
          type="button"
          class="btn ghost icon"
          title={t("shell.sidebar.toggle", { hotkey: K("Mod+\\") })}
          aria-label={t("shell.sidebar.toggleAria")}
          onClick={() => uiStore.toggleSidebar()}
        >
          <Icon name="sidebar" />
        </button>
      </Show>
      <div class="am-crumb" data-tauri-drag-region>
        <span>{agentSettings.displayName()}</span>
        <span class="sep">/</span>
        <b title={title()}>{title()}</b>
      </div>
      <span class="am-sp" data-tauri-drag-region />
      <button type="button" class="btn ghost" aria-haspopup="menu" onClick={openSessions}>
        <Icon name="history" size={14} />
        {t("agentMode.bar.sessions")}
      </button>
      <button type="button" class="btn ghost" title={t("agent.panel.memory")} onClick={() => agentUi.openMemory()}>
        <Icon name="bulb" size={14} />
        {t("agentMode.bar.memory")}
      </button>
      <button
        type="button"
        class="btn"
        disabled={!!props.session && props.session.items.length === 0 && !props.session.running()}
        onClick={() => void startSession()}
      >
        <Icon name="plus" size={14} />
        {t("agentMode.bar.new")}
      </button>
      <Show when={menu()}>
        {(m) => <ContextMenu x={m().x} y={m().y} align="end" items={m().items} onClose={() => setMenu(null)} />}
      </Show>
    </header>
  );
}

/** "Alle Sitzungen" dialog (top bar menu and start screen). */
const [sessionsOpen, setSessionsOpen] = createSignal(false);

function sessionMenuItems(current: string | null): ContextMenuItem[] {
  const list = agentStore.sessions().slice(0, 12);
  const items: ContextMenuItem[] = list.map((s) => ({
    label: s.title || t("agentMode.bar.newSession"),
    hint: ideaAge(s.updatedAt, Date.now()),
    checked: s.id === current,
    onClick: () => void navStore.openAgent(s.id),
  }));
  if (items.length === 0) items.push({ label: t("agentMode.sessions.empty"), disabled: true });
  else items.push({ label: t("agentMode.sessions.all"), icon: "list", separatorBefore: true, onClick: () => setSessionsOpen(true) });
  if (current && list.some((s) => s.id === current)) {
    items.push({
      label: t("agentMode.sessions.delete"),
      icon: "trash",
      danger: true,
      separatorBefore: true,
      onClick: () => void deleteSession(current),
    });
  }
  return items;
}

async function deleteSession(chatId: string): Promise<boolean> {
  const ok = await confirmDialog({
    title: t("agentMode.sessions.deleteTitle"),
    body: t("agentMode.sessions.deleteBody"),
    confirmLabel: t("common.delete"),
    danger: true,
  });
  if (!ok) return false;
  try {
    await agentStore.deleteSession(chatId);
    if (navStore.activeAgentChatId() === chatId) await startSession();
    pushToast(t("agentMode.sessions.deleted"), "ok");
    return true;
  } catch (error) {
    console.warn("[agent] deleting session failed", error);
    pushToast(t("agentMode.sessions.deleteFailed"), "error");
    return false;
  }
}

// ---------------------------------------------------------------- session

function SessionView(props: { chatId: string }) {
  const session = createMemo(() => agentStore.chat(props.chatId));
  const colorOf = useCharacterColors();
  const lookup = createMemo(() => folderLookup(library.folderList(), (id) => library.script(id)?.title ?? null));
  const [text, setText] = createSignal("");
  const [quote, setQuote] = createSignal<ChatQuote | null>(null);
  const [finish, setFinish] = createSignal<FinishTarget | null>(null);
  const [focusTick, setFocusTick] = createSignal(0);
  const running = () => session().running();

  const send = async (value = text(), q = quote(), hint?: string) => {
    const clean = value.trim();
    if (!clean || running()) return;
    setText("");
    setQuote(null);
    await session().send(clean, q ?? undefined, hint);
  };

  // Requests from outside (ideas page, palette, start presets).
  createEffect(() => {
    if (!session().ready()) return;
    const req = agentUi.modeRequest();
    if (!req || req.chatId !== props.chatId) return;
    const taken = untrack(() => agentUi.takeModeRequest(props.chatId));
    if (!taken) return;
    if (taken.send) void send(taken.text, null, taken.hint);
    else setText(taken.text);
  });

  // Mod+L inside the agent mode focuses the field.
  createEffect(on(agentUi.modeFocus, (tick) => { if (tick) setFocusTick((n) => n + 1); }, { defer: true }));

  // ---- drafts ----
  const states = createMemo(() => draftStates(session().items));
  // A discarded draft leaves the panel (a new version brings it back).
  const visible = createMemo(() => states().filter((s) => s.state !== "discarded"));
  const streamingDraft = createMemo(() => (running() ? states().find((s) => !s.latest.complete) ?? null : null));
  // A draft that starts streaming comes to the front.
  createEffect(on(() => streamingDraft()?.draft.slug, (slug) => {
    if (!slug) return;
    agentUi.selectDraft(props.chatId, slug);
    agentUi.setDraftPanelClosed(props.chatId, false);
  }, { defer: true }));
  const selected = createMemo<DraftState | null>(() => {
    const list = visible();
    if (list.length === 0) return null;
    const slug = agentUi.selectedDraft(props.chatId);
    return list.find((s) => s.draft.slug === slug) ?? list[list.length - 1];
  });
  const split = () => selected() !== null && !agentUi.draftPanelClosed(props.chatId);

  const draftIndex = createDraftIndex(() => session().items);
  const ctx = (): ItemContext => ({
    session: session(),
    lookup: lookup(),
    colorOf,
    canApply: false,
    surface: "agent",
    draftRef: (versionId) => draftIndex().get(versionId),
    showDraft: (slug) => {
      agentUi.selectDraft(props.chatId, slug);
      agentUi.setDraftPanelClosed(props.chatId, false);
    },
    send: (value) => void send(value, null),
  });

  const replies = createMemo(() => (running() ? [] : lastReplies(session().items)));
  const empty = () => session().ready() && session().items.length === 0;


  return (
    <>
      <AgentBar session={session()} />
      <Show when={session().ready()} fallback={<div class="am-loading" />}>
        <Show
          when={!empty()}
          fallback={<StartScreen session={session()} value={text()} onInput={setText} onSend={() => void send()} send={(v, h) => void send(v, null, h)} focusTick={focusTick()} />}
        >
          <div class="am-split" classList={{ "is-split": split() }}>
            <ThreadColumn
              session={session()}
              ctx={ctx()}
              lookup={lookup()}
              split={split()}
              replies={replies()}
              text={text()}
              onInput={setText}
              onSend={() => void send()}
              onReply={(value) => void send(value, null)}
              quote={quote()}
              onClearQuote={() => setQuote(null)}
              focusTick={focusTick()}
              hiddenDrafts={selected() !== null && !split()}
              onShowDrafts={() => agentUi.setDraftPanelClosed(props.chatId, false)}
            />
            <Show when={split() && selected() !== null}>
              {/* The memo, not Show's accessor: the panel may still read it
                  while it is being removed (stale read from <Show>). */}
              {(
                <DraftPanel
                  session={session()}
                  drafts={visible()}
                  selected={selected()}
                  colorOf={colorOf}
                  onSelect={(slug) => agentUi.selectDraft(props.chatId, slug)}
                  onClose={() => agentUi.setDraftPanelClosed(props.chatId, true)}
                  onQuote={(value, title) => {
                    setQuote({ text: value, draft: title });
                    setFocusTick((n) => n + 1);
                  }}
                  finishOpen={finish() !== null}
                  onFinish={(draft: DraftState, version: DraftVersion) => setFinish({ draft, version })}
                />
              )}
            </Show>
          </div>
        </Show>
      </Show>
      <FinishDialog session={session()} target={finish()} onClose={() => setFinish(null)} colorOf={colorOf} />
    </>
  );
}

// ---------------------------------------------------------------- thread

function ThreadColumn(props: {
  session: ChatSession;
  ctx: ItemContext;
  lookup: ReturnType<typeof folderLookup>;
  split: boolean;
  replies: string[];
  text: string;
  onInput(value: string): void;
  onSend(): void;
  onReply(value: string): void;
  quote: ChatQuote | null;
  onClearQuote(): void;
  focusTick: number;
  hiddenDrafts: boolean;
  onShowDrafts(): void;
}) {
  let list: HTMLDivElement | undefined;
  let stick = true;
  const items = () => props.session.items;
  createEffect(on(() => [items().length, JSON.stringify(items()[items().length - 1] ?? null).length, props.session.running()], () => {
    if (!stick || !list) return;
    requestAnimationFrame(() => { if (list) list.scrollTop = list.scrollHeight; });
  }));
  onMount(() => requestAnimationFrame(() => { if (list) list.scrollTop = list.scrollHeight; }));
  const attachedTitle = () => {
    const id = props.session.scriptId();
    return id ? library.script(id)?.title ?? null : null;
  };
  return (
    <div class="am-col">
      <Show when={props.session.scriptId()}>
        {(scriptId) => (
          <div class="am-attached">
            <Icon name="doc" size={13} />
            <span>{t("agentMode.attached", { title: attachedTitle() ?? t("common.untitled") })}</span>
            <span class="am-sp" />
            <Show when={attachedTitle() !== null}>
              <button type="button" class="btn sm" onClick={() => void navStore.openScript(scriptId(), attachedTitle() ?? undefined)}>
                {t("agentMode.handoff.open")}
              </button>
            </Show>
          </div>
        )}
      </Show>
      <div class="am-scroll" ref={list} onScroll={() => { if (list) stick = list.scrollHeight - list.scrollTop - list.clientHeight < 60; }}>
        <div class="am-thread ag-list-inner">
          <ChatList items={items()} running={props.session.running()} lookup={props.lookup} ctx={props.ctx} />
        </div>
      </div>
      <div class="am-dock">
        <Show when={props.hiddenDrafts}>
          <button type="button" class="am-show-drafts" onClick={() => props.onShowDrafts()}>
            <Icon name="doc" size={13} />
            {t("agentMode.draft.showPanel")}
          </button>
        </Show>
        <Show when={props.replies.length > 0}>
          <RepliesBar replies={props.replies} onPick={(value) => props.onReply(value)} />
        </Show>
        <AgentComposer
          session={props.session}
          variant="dock"
          compact={props.split}
          value={props.text}
          onInput={props.onInput}
          onSend={props.onSend}
          quote={props.quote}
          onClearQuote={props.onClearQuote}
          placeholder={props.session.running() ? t("agentMode.composer.whileRunning", { name: agentSettings.displayName() }) : t("agentMode.composer.reply", { name: agentSettings.displayName() })}
          focusTick={props.focusTick}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- start

function StartScreen(props: {
  session: ChatSession;
  value: string;
  onInput(value: string): void;
  onSend(): void;
  send(text: string, hint?: string): void;
  focusTick: number;
}) {
  const [ideaMenu, setIdeaMenu] = createSignal<{ x: number; y: number } | null>(null);
  const folderName = () => library.folder(props.session.folderId())?.name ?? null;
  const openIdeas = () => ideasStore.ideas().filter((i) => !i.used_at);
  const ideasForMenu = () => {
    const folder = props.session.folderId();
    const list = openIdeas();
    const own = folder ? list.filter((i) => i.folder_id === folder) : [];
    const rest = list.filter((i) => !own.includes(i));
    return [...own, ...rest].slice(0, 14);
  };
  const greeting = () => {
    const user = agentSettings.userName().trim();
    return user ? t("agentMode.start.titleNamed", { name: user }) : t("agentMode.start.title");
  };
  const presets = () => [
    {
      id: "ideas",
      icon: "spark" as const,
      hot: true,
      title: t("agentMode.preset.ideas"),
      body: folderName() ? t("agentMode.preset.ideasBodyFolder", { folder: folderName()! }) : t("agentMode.preset.ideasBody"),
      run: () => props.send(folderName() ? t("agentMode.prompt.ideasFolder", { folder: folderName()! }) : t("agentMode.prompt.ideas")),
    },
    {
      id: "idea",
      icon: "pen" as const,
      title: t("agentMode.preset.fromIdea"),
      body: tPlural("agentMode.preset.fromIdeaBody", openIdeas().length),
      run: (e: MouseEvent) => {
        if (openIdeas().length === 0) {
          pushToast(t("agentMode.preset.noIdeas"), "info");
          return;
        }
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        setIdeaMenu({ x: r.left, y: r.bottom + 4 });
      },
    },
    {
      id: "series",
      icon: "stack" as const,
      title: t("agentMode.preset.series"),
      body: t("agentMode.preset.seriesBody"),
      run: () => props.send(folderName() ? t("agentMode.prompt.seriesFolder", { folder: folderName()! }) : t("agentMode.prompt.series")),
    },
    {
      id: "hooks",
      icon: "bolt" as const,
      title: t("agentMode.preset.hooks"),
      body: t("agentMode.preset.hooksBody"),
      run: () => props.send(t("agentMode.prompt.hooks")),
    },
  ];
  const recent = () => agentStore.sessions().filter((s) => s.id !== props.session.chatId()).slice(0, 3);
  return (
    <div class="am-start">
      <div class="am-hello">
        <AgentAvatar look={agentSettings.look()} size={58} state={avatarStateFor(props.session.running())} />
        <h1>{greeting()}</h1>
        <p>
          {t("agentMode.start.lede", {
            folders: tPlural("agentMode.start.folders", library.folderList().length),
            scripts: tPlural("agentMode.start.scripts", library.scripts().length),
            ideas: tPlural("agentMode.start.ideas", openIdeas().length),
          })}
        </p>
        <AgentComposer
          session={props.session}
          variant="big"
          value={props.value}
          onInput={props.onInput}
          onSend={props.onSend}
          quote={null}
          onClearQuote={() => {}}
          placeholder={t("agentMode.start.placeholder")}
          focusTick={props.focusTick}
        />
        <div class="am-presets">
          <For each={presets()}>
            {(preset) => (
              <button type="button" class="am-preset" classList={{ "is-hot": !!preset.hot }} onClick={(e) => preset.run(e)}>
                <span class="am-preset-ic"><Icon name={preset.icon} size={14} /></span>
                <b>{preset.title}</b>
                <small>{preset.body}</small>
              </button>
            )}
          </For>
        </div>
        <Show when={recent().length > 0}>
          <div class="am-resume">
            <div class="am-resume-h">
              <span>{t("agentMode.start.resume")}</span>
              <span class="am-sp" />
              <button
                type="button"
                class="am-link"
                onClick={() => setSessionsOpen(true)}
              >
                {t("agentMode.start.allSessions")}
              </button>
            </div>
            <div class="am-rs-list">
              <For each={recent()}>
                {(s) => (
                  <button type="button" class="am-rs" onClick={() => void navStore.openAgent(s.id)}>
                    <Icon name="dots" size={14} />
                    <span class="am-rs-t">
                      <b>{s.title || t("agentMode.bar.newSession")}</b>
                      <small>{sessionSubline(s)}</small>
                    </span>
                    <Show
                      when={s.openDrafts > 0}
                      fallback={
                        <Show when={s.finished > 0} fallback={<span class="am-dchip">{t("agentMode.sessions.chatChip")}</span>}>
                          <span class="am-dchip is-done"><Icon name="check" size={11} />{t("agentMode.sessions.finishedChip")}</span>
                        </Show>
                      }
                    >
                      <span class="am-dchip is-live"><i />{tPlural("agentMode.sessions.draftsChip", s.openDrafts)}</span>
                    </Show>
                    <span class="am-rs-age">{ideaAge(s.updatedAt, Date.now())}</span>
                  </button>
                )}
              </For>
            </div>
          </div>
        </Show>
      </div>
      <Show when={ideaMenu()}>
        {(pos) => (
          <ContextMenu
            x={pos().x}
            y={pos().y}
            onClose={() => setIdeaMenu(null)}
            items={ideasForMenu().map((idea) => ({
              label: idea.title,
              icon: <StageGlyph stage="idea" />,
              hint: library.folder(idea.folder_id)?.name,
              onClick: () => {
                if (idea.folder_id !== props.session.folderId() && library.folder(idea.folder_id)) props.session.setFolder(idea.folder_id);
                const notes = idea.notes.trim().replace(/\s+/g, " ").slice(0, 800);
                props.send(
                  t("agentMode.prompt.writeIdea", { title: idea.title }),
                  `This is the saved idea with id ${idea.id}${notes ? `; its notes: ${notes}` : ""}. Set idea="${idea.id}" on the draft.`,
                );
              },
            }))}
          />
        )}
      </Show>
    </div>
  );
}
