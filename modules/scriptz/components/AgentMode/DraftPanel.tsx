import { For, Show, createEffect, createMemo, createSignal, on, onCleanup } from "solid-js";
import { Icon } from "@agentz/kit/ui";
import { K, isModKey } from "@agentz/kit/platform";
import { pushToast } from "@agentz/kit/stores";
import { t, tPlural } from "../../i18n";
import type { draftStates } from "../../lib/agent/chats";
import { changedBlocks, draftPlainText, draftRuntime, draftWords, type DraftVersion } from "../../lib/agent/drafts";
import type { AgentBlock } from "../../lib/agent/scriptText";
import { formatClock, formatRange, lengthStatus, resolveLengthRange } from "../../lib/lengthGoal";
import type { ChatSession } from "../../stores/agent";
import { agentSettings } from "../../stores/agentSettings";
import { navStore } from "../../stores/nav";
import { settingsStore } from "../../stores/settings";
import { AgentAvatar } from "../Agent/AgentAvatar";
import { defaultLengthRange, library } from "../Shell/libraryData";

export type DraftState = ReturnType<typeof draftStates>[number];

export interface DraftPanelProps {
  session: ChatSession;
  drafts: DraftState[];
  /** Null only for a moment while the panel is being removed. */
  selected: DraftState | null;
  onSelect(slug: string): void;
  onClose(): void;
  onQuote(text: string, draftTitle: string): void;
  onFinish(draft: DraftState, version: DraftVersion): void;
  /** The finish dialog is open (Mod+Enter belongs to it then). */
  finishOpen?: boolean;
  colorOf(name: string): string;
}

/** Speaker of a dialog / parenthetical block (nearest character above). */
function speakerAt(blocks: readonly AgentBlock[], index: number): string {
  for (let i = index; i >= 0; i--) {
    const block = blocks[i];
    if (block.type === "character") return block.text.trim().toUpperCase();
    if (block.type === "action") return "";
  }
  return "";
}

export function DraftPanel(props: DraftPanelProps) {
  // Keeps the last draft while the panel unmounts (discarding the only
  // draft closes it in the same update).
  const current = createMemo<DraftState | null>((previous) => props.selected ?? previous, null);
  const selected = (): DraftState => current() as DraftState;
  const versions = () => selected().draft.versions;
  /** Viewed version index; null = always the newest. */
  const [viewIndex, setViewIndex] = createSignal<number | null>(null);
  createEffect(on(() => [selected().draft.slug, versions().length], () => setViewIndex(null)));
  const index = () => {
    const i = viewIndex();
    return i === null || i >= versions().length ? versions().length - 1 : i;
  };
  const version = (): DraftVersion => versions()[index()];
  const previous = (): DraftVersion | null => (index() > 0 ? versions()[index() - 1] : null);
  const isLatest = () => index() === versions().length - 1;
  const streaming = () => props.session.running() && !version().complete;
  const changed = createMemo(() => {
    const prev = previous();
    return prev && version().complete ? changedBlocks(prev.blocks, version().blocks) : new Set<number>();
  });

  const folder = () => library.folder(props.session.folderId()) ?? null;
  const range = () => resolveLengthRange(folder(), defaultLengthRange());
  const seconds = () => draftRuntime(version().blocks, settingsStore.dialogWpm());
  const status = () => lengthStatus(seconds(), range());
  const scale = () => Math.max(60, (range()?.maxSec ?? 0) * 1.25, seconds() * 1.1);
  const pct = (sec: number) => `${Math.min(100, (sec / scale()) * 100)}%`;

  const finishedScript = () => {
    if (!isLatest() || selected().state !== "finished") return null;
    for (let i = props.session.items.length - 1; i >= 0; i--) {
      const item = props.session.items[i];
      // A script deleted since then no longer counts: the draft can be
      // finished again.
      if (item.kind === "handoff" && item.slug === selected().draft.slug && item.versionId === version().id) {
        return library.loaded() && !library.script(item.scriptId) ? null : item;
      }
    }
    return null;
  };

  // ---- streaming: keep the newest line in view ----
  let body: HTMLDivElement | undefined;
  let stick = true;
  createEffect(on(() => [version().blocks.length, version().blocks[version().blocks.length - 1]?.text.length ?? 0, streaming()], () => {
    if (!streaming() || !stick || !body) return;
    requestAnimationFrame(() => { if (body) body.scrollTop = body.scrollHeight; });
  }));

  // ---- selection -> "ask about this" ----
  const [ask, setAsk] = createSignal<{ x: number; y: number; text: string } | null>(null);
  let sheet: HTMLDivElement | undefined;
  const readSelection = () => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !sheet || !body) { setAsk(null); return; }
    const range = selection.getRangeAt(0);
    if (!sheet.contains(range.commonAncestorContainer)) { setAsk(null); return; }
    const text = selection.toString().replace(/\s+/g, " ").trim();
    if (!text) { setAsk(null); return; }
    const rect = range.getBoundingClientRect();
    const host = body.getBoundingClientRect();
    setAsk({ x: rect.left + rect.width / 2 - host.left, y: rect.top - host.top + body.scrollTop, text: text.slice(0, 1200) });
  };
  const onSelectionChange = () => { if (ask() && window.getSelection()?.isCollapsed) setAsk(null); };
  document.addEventListener("selectionchange", onSelectionChange);
  onCleanup(() => document.removeEventListener("selectionchange", onSelectionChange));

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(draftPlainText(version().title, version().blocks));
      pushToast(t("agentMode.draft.copied"), "ok");
    } catch {
      pushToast(t("agentMode.draft.copyFailed"), "error");
    }
  };

  const discard = () => {
    props.session.discardDraft(selected().draft.slug, version().id);
    pushToast(t("agentMode.draft.discarded", { title: version().title || t("agentMode.draft.untitled") }), "info");
  };

  const canFinish = () => version().complete && !props.session.running() && version().blocks.length > 0;

  // Mod+Enter finishes the version on screen (as the button does), outside
  // text fields and while no dialog is open.
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Enter" || !isModKey(e) || e.defaultPrevented || props.finishOpen) return;
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === "TEXTAREA" || target.tagName === "INPUT" || target.isContentEditable)) return;
    if (!canFinish() || finishedScript()) return;
    e.preventDefault();
    props.onFinish(selected(), version());
  };
  window.addEventListener("keydown", onKey);
  onCleanup(() => window.removeEventListener("keydown", onKey));

  return (
    <section class="am-draft" aria-label={t("agentMode.draft.aria")}>
      <header class="am-draft-h">
        <div class="am-tabs" role="tablist">
          <For each={props.drafts}>
            {(entry) => {
              const live = () => props.session.running() && !entry.latest.complete;
              return (
                <button
                  type="button"
                  role="tab"
                  class="am-tab"
                  aria-selected={entry.draft.slug === selected().draft.slug}
                  title={entry.latest.title || t("agentMode.draft.untitled")}
                  onClick={() => props.onSelect(entry.draft.slug)}
                >
                  <Show when={live()} fallback={<Show when={entry.state === "finished"}><Icon name="check" size={12} /></Show>}>
                    <span class="am-live-dot" aria-hidden="true" />
                  </Show>
                  <span class="am-tab-t">{entry.latest.title || t("agentMode.draft.untitled")}</span>
                </button>
              );
            }}
          </For>
        </div>
        <Show when={versions().length > 1}>
          <div class="seg am-vseg" role="group" aria-label={t("agentMode.draft.versionsAria")}>
            <For each={versions()}>
              {(_, i) => (
                <button type="button" aria-pressed={i() === index()} onClick={() => setViewIndex(i() === versions().length - 1 ? null : i())}>
                  {t("agentMode.draft.versionShort", { n: i() + 1 })}
                </button>
              )}
            </For>
          </div>
        </Show>
        <span class="am-sp" />
        <div class="am-meter" classList={{ [`is-${status().state}`]: true }} title={t("agentMode.draft.meterTitle", { wpm: settingsStore.dialogWpm() })}>
          <b>{seconds() > 0 ? formatClock(seconds()) : "0:00"}</b>
          <span class="am-meter-bar" aria-hidden="true">
            <Show when={range()}>
              {(r) => (
                <i
                  class="am-meter-range"
                  style={{ left: pct(r().minSec ?? 0), width: `calc(${pct(r().maxSec ?? scale())} - ${pct(r().minSec ?? 0)})` }}
                />
              )}
            </Show>
            <i class="am-meter-fill" style={{ width: pct(seconds()) }} />
          </span>
          <span class="am-meter-t">
            <Show when={range()}>{formatRange(range())} · </Show>
            {tPlural("agentMode.draft.words", draftWords(version().blocks))}
          </span>
        </div>
        <button type="button" class="ag-ic" title={t("agentMode.draft.closePanel")} aria-label={t("agentMode.draft.closePanel")} onClick={() => props.onClose()}>
          <Icon name="x" size={15} />
        </button>
      </header>

      <div
        class="am-draft-body"
        ref={body}
        onScroll={() => { if (body) stick = body.scrollHeight - body.scrollTop - body.clientHeight < 80; }}
        on:mouseup={() => queueMicrotask(readSelection)}
        on:keyup={(e) => { if (e.shiftKey) readSelection(); }}
      >
        <div class="am-sheet" ref={sheet} data-paper>
          <Show when={version().title}>
            <div class="am-sheet-title">{version().title}</div>
          </Show>
          <For each={version().blocks}>
            {(block, i) => {
              const speaker = () => (block.type === "action" ? "" : block.type === "character" ? block.text.trim().toUpperCase() : speakerAt(version().blocks, i()));
              const tint = () => (speaker() ? { "--char": props.colorOf(speaker()) } : {});
              const last = () => i() === version().blocks.length - 1;
              return (
                <div
                  class={`am-b am-b-${block.type}`}
                  classList={{ "is-chg": changed().has(i()) }}
                  style={tint()}
                >
                  {block.type === "action" ? block.text : <span class="am-m">{block.text}</span>}
                  <Show when={streaming() && last()}>
                    <span class="am-caret" aria-hidden="true" />
                    <span class="am-wtag" aria-hidden="true">
                      <AgentAvatar look={agentSettings.look()} size={12} state="talk" />
                      {agentSettings.displayName()}
                    </span>
                  </Show>
                </div>
              );
            }}
          </For>
          <Show when={version().blocks.length === 0}>
            <div class="am-sheet-empty">
              <span class="am-caret" aria-hidden="true" />
            </div>
          </Show>
        </div>
        <Show when={ask()}>
          {(a) => (
            <button
              type="button"
              class="am-ask"
              style={{ left: `${a().x}px`, top: `${a().y}px` }}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                props.onQuote(a().text, version().title || t("agentMode.draft.untitled"));
                window.getSelection()?.removeAllRanges();
                setAsk(null);
              }}
            >
              <AgentAvatar look={agentSettings.look()} size={14} state="idle" />
              {t("agentMode.draft.ask", { name: agentSettings.displayName() })}
            </button>
          )}
        </Show>
      </div>

      <footer class="am-draft-f">
        <Show
          when={!streaming()}
          fallback={
            <span class="am-note">
              <AgentAvatar look={agentSettings.look()} size={20} state="talk" />
              {t("agentMode.draft.writing", { name: agentSettings.displayName() })}
            </span>
          }
        >
          <Show when={isLatest() && selected().state === "open" && version().complete}>
            <button type="button" class="btn ghost" onClick={discard}>
              <Icon name="trash" size={14} />
              {t("agentMode.draft.discard")}
            </button>
          </Show>
          <button type="button" class="btn ghost" disabled={version().blocks.length === 0} onClick={() => void copy()}>
            <Icon name="export" size={14} />
            {t("agentMode.draft.copy")}
          </button>
        </Show>
        <span class="am-sp" />
        <Show when={!streaming()}>
          <span class="am-note">
            {isLatest()
              ? tPlural("agentMode.draft.versionOf", versions().length, { n: index() + 1 })
              : t("agentMode.draft.olderVersion", { n: index() + 1 })}
          </span>
        </Show>
        <Show
          when={finishedScript()}
          fallback={
            <Show when={streaming()} fallback={
              <button
                type="button"
                class="btn am-finish"
                disabled={!canFinish()}
                title={t("agentMode.draft.finishTitle")}
                onClick={() => props.onFinish(selected(), version())}
              >
                <Icon name="check" size={14} />
                {t("agentMode.draft.finish")}
                <kbd>{K("Mod+Enter")}</kbd>
              </button>
            }>
              <button type="button" class="btn" onClick={() => void props.session.stop()}>
                {t("agent.composer.stop")}
              </button>
            </Show>
          }
        >
          {(handoff) => (
            <button type="button" class="btn primary" onClick={() => void navStore.openScript(handoff().scriptId, handoff().title)}>
              <Icon name="doc" size={14} />
              {t("agentMode.draft.openScript")}
            </button>
          )}
        </Show>
      </footer>
    </section>
  );
}
