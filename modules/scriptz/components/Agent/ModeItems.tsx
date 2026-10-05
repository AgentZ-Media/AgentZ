import { For, Show, createSignal } from "solid-js";
import { Icon } from "@agentz/kit/ui";
import { pushToast } from "@agentz/kit/stores";
import { t, tPlural } from "../../i18n";
import type { ChatItem } from "../../lib/agent/chats";
import { formatClock } from "../../lib/lengthGoal";
import { navStore } from "../../stores/nav";
import { uiStore } from "../../stores/ui";
import { StageGlyph } from "../Common/StageGlyph";
import type { ItemContext } from "./ChatItems";
import "./ModeItems.css";

type Item<K extends ChatItem["kind"]> = Extract<ChatItem, { kind: K }>;

/** Card numbers as the user reads them ("2, 5 und 7"). */
function numberList(indices: readonly number[]): string {
  const nums = indices.map((i) => String(i + 1));
  if (nums.length <= 1) return nums.join("");
  return t("agentMode.ideas.numberList", { list: nums.slice(0, -1).join(", "), last: nums[nums.length - 1] });
}

function revealIdea(ideaId: string, folderId: string | null): void {
  uiStore.revealIdea(ideaId);
  if (!navStore.isIdeas()) void navStore.openIdeas(folderId);
}

// ---------------------------------------------------------------- idea board

export function IdeaBoard(props: { item: Item<"ideas">; ctx: ItemContext }) {
  const [busy, setBusy] = createSignal(false);
  const picked = () => props.item.picked;
  const open = () => props.item.ideas.map((_, i) => i).filter((i) => !props.item.savedIds[i]);
  const save = async (indices: number[]) => {
    if (busy() || indices.length === 0) return;
    setBusy(true);
    try {
      const n = await props.ctx.session.saveIdeas(props.item.id, indices);
      if (n > 0) pushToast(tPlural("agentMode.ideas.savedToast", n), "ok");
    } catch (error) {
      console.warn("[agent] saving ideas failed", error);
      pushToast(t("agentMode.ideas.saveFailed"), "error");
    } finally {
      setBusy(false);
    }
  };
  const writeOne = (index: number) => {
    const idea = props.item.ideas[index];
    props.ctx.send(t("agentMode.ideas.writeMessage", { n: index + 1, title: idea.title }));
  };
  const more = () => props.ctx.send(t("agentMode.ideas.moreMessage", { list: numberList(picked()) }));
  return (
    <div class="am-board" classList={{ "is-panel": props.ctx.surface === "panel" }}>
      <div class="am-board-grid">
        <For each={props.item.ideas}>
          {(idea, i) => {
            const savedId = () => props.item.savedIds[i()] ?? null;
            const isPicked = () => picked().includes(i());
            return (
              <div
                class="am-icard"
                classList={{ "is-on": isPicked(), "is-saved": !!savedId() }}
                role="checkbox"
                aria-checked={savedId() ? "mixed" : isPicked()}
                aria-label={t("agentMode.ideas.cardAria", { n: i() + 1, title: idea.title })}
                tabIndex={0}
                onClick={() => { if (!savedId()) props.ctx.session.togglePick(props.item.id, i()); }}
                onKeyDown={(e) => {
                  if (e.key !== " " && e.key !== "Enter") return;
                  e.preventDefault();
                  if (!savedId()) props.ctx.session.togglePick(props.item.id, i());
                }}
              >
                <div class="am-icard-top">
                  <span class="am-inum">{i() + 1}</span>
                  <b>{idea.title}</b>
                  <Show
                    when={savedId()}
                    fallback={<span class="am-cb" classList={{ "is-on": isPicked() }} aria-hidden="true">{isPicked() ? <Icon name="check" size={11} /> : null}</span>}
                  >
                    {(id) => (
                      <button
                        type="button"
                        class="am-stamp"
                        title={t("agentMode.ideas.openSaved")}
                        onClick={(e) => { e.stopPropagation(); revealIdea(id(), props.item.folderId); }}
                      >
                        <Icon name="check" size={10} />
                        {t("agentMode.ideas.saved")}
                      </button>
                    )}
                  </Show>
                </div>
                <Show when={idea.premise}>
                  <p>{idea.premise}</p>
                </Show>
                <Show when={idea.hook}>
                  <span class="am-hook">{idea.hook}</span>
                </Show>
                <div class="am-icard-f">
                  <For each={idea.characters}>
                    {(name) => <span class="am-who" style={{ "--char": props.ctx.colorOf(name) }}>{name}</span>}
                  </For>
                  <Show when={idea.seconds}>
                    {(sec) => <span class="am-len">≈ {formatClock(sec())}</span>}
                  </Show>
                </div>
              </div>
            );
          }}
        </For>
      </div>
      <Show when={picked().length > 0 || open().length > 1}>
        <div class="am-bbar" classList={{ "is-picking": picked().length > 0 }}>
          <Show
            when={picked().length > 0}
            fallback={
              <>
                <span class="am-bbar-hint">{t("agentMode.ideas.pickHint")}</span>
                <span class="am-sp" />
                <button type="button" class="am-b2" disabled={busy()} onClick={() => void save(open())}>
                  <Icon name="bulb" size={13} />
                  {tPlural("agentMode.ideas.saveAll", open().length)}
                </button>
              </>
            }
          >
            <span class="am-bbar-l">{t("agentMode.ideas.picked")}</span>
            <span class="am-nums">
              <For each={picked()}>{(i) => <i>{i + 1}</i>}</For>
            </span>
            <button type="button" class="am-b2 is-acc" disabled={busy()} onClick={() => void save(picked())}>
              <Icon name="bulb" size={13} />
              {t("agentMode.ideas.save")}
            </button>
            <Show when={picked().length === 1}>
              <button type="button" class="am-b2" onClick={() => writeOne(picked()[0])}>
                <Icon name="pen" size={13} />
                {t("agentMode.ideas.write", { n: picked()[0] + 1 })}
              </button>
            </Show>
            <button type="button" class="am-b2" onClick={more}>
              <Icon name="refresh" size={13} />
              {t("agentMode.ideas.more")}
            </button>
          </Show>
        </div>
      </Show>
    </div>
  );
}

// ---------------------------------------------------------------- receipt

export function SavedIdeasCard(props: { item: Item<"ideas-saved">; ctx: ItemContext }) {
  const folder = () => props.ctx.lookup.folderName(props.item.folderId);
  return (
    <div class="am-rcpt" classList={{ "is-undone": !!props.item.undone }}>
      <div class="am-rcpt-h">
        <Icon name={props.item.undone ? "undo" : "check"} size={13} />
        <span>
          {props.item.undone
            ? t("agentMode.ideas.receiptUndone")
            : tPlural("agentMode.ideas.receipt", props.item.saved.length)}
        </span>
        <span class="am-sp" />
        <span class="am-rcpt-f">{folder() ?? t("ideasPage.folder.none")}</span>
      </div>
      <For each={props.item.saved}>
        {(ref) => (
          <button
            type="button"
            class="am-rcpt-it"
            disabled={!!props.item.undone}
            title={t("agentMode.ideas.openSaved")}
            onClick={() => revealIdea(ref.ideaId, props.item.folderId)}
          >
            <StageGlyph stage="idea" />
            <Show when={ref.number !== null} fallback={<span class="am-inum is-blank" />}>
              <span class="am-inum">{ref.number}</span>
            </Show>
            <b>{ref.title}</b>
          </button>
        )}
      </For>
      <Show when={!props.item.undone}>
        <div class="am-rcpt-foot">
          <button type="button" class="ag-mem-undo" onClick={() => void navStore.openIdeas(props.item.folderId)}>
            <Icon name="right" size={12} />
            {t("agentMode.ideas.openList")}
          </button>
          <button type="button" class="ag-mem-undo" onClick={() => void props.ctx.session.undoSavedIdeas(props.item.id)}>
            <Icon name="undo" size={12} />
            {t("agent.memory.undo")}
          </button>
        </div>
      </Show>
    </div>
  );
}

// ---------------------------------------------------------------- handoff

export function HandoffRow(props: { item: Item<"handoff">; ctx: ItemContext }) {
  const title = () => props.ctx.lookup.scriptTitle(props.item.scriptId) ?? props.item.title;
  const exists = () => props.ctx.lookup.scriptTitle(props.item.scriptId) !== null;
  return (
    <div class="am-handoff">
      <span class="am-handoff-l" />
      <Icon name="check" size={12} />
      <span>{t("agentMode.handoff.created", { title: title() })}</span>
      <Show when={exists() && navStore.activeScriptId() !== props.item.scriptId}>
        <button type="button" class="am-handoff-b" onClick={() => void navStore.openScript(props.item.scriptId, title())}>
          {t("agentMode.handoff.open")}
        </button>
      </Show>
      <span class="am-handoff-l" />
    </div>
  );
}

export function DiscardedRow(props: { item: Item<"draft-discarded">; ctx: ItemContext }) {
  const title = () => props.ctx.draftRef(props.item.versionId)?.title || t("agentMode.draft.untitled");
  return <div class="ag-note">{t("agentMode.draft.discardedNote", { title: title() })}</div>;
}

// ---------------------------------------------------------------- replies

/** Quick replies of the last turn, above the composer. */
export function RepliesBar(props: { replies: readonly string[]; onPick(text: string): void }) {
  return (
    <div class="am-qr" role="group" aria-label={t("agentMode.replies.aria")}>
      <For each={props.replies}>
        {(reply) => (
          <button type="button" class="am-qr-b" onClick={() => props.onPick(reply)}>
            {reply}
          </button>
        )}
      </For>
    </div>
  );
}
