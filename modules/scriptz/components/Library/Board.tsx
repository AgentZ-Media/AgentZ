import { For, Index, Show, createMemo, createSignal, onCleanup } from "solid-js";
import { relativeTime, requireSuccessfulFlush } from "@agentz/kit/lib";
import { pushToast } from "@agentz/kit/stores";
import { Icon } from "@agentz/kit/ui";
import { api } from "../../lib/api";
import { scriptsBus } from "../../lib/scriptsBus";
import { foldersBus } from "../../lib/foldersBus";
import { firstStageId } from "../../lib/stages";
import { formatClock, lengthStatus } from "../../lib/lengthGoal";
import type { Idea, ScriptStatus, ScriptSummary } from "../../lib/types";
import { ideasStore } from "../../stores/ideas";
import { t } from "../../i18n";
import { StageGlyph } from "../Common/StageGlyph";
import { BumpNumber } from "../Common/motion";
import { setStageWithUndo } from "../Script/stageActions";
import { folderColor } from "../Common/folderColor";
import { lengthRangeFor, library, runtimeSecFor } from "../Shell/libraryData";
import { IDEA_DRAG_MIME, SCRIPT_DRAG_MIME } from "./dnd";
import "./Board.css";

/** Cards rendered per column before "show more". */
const COLUMN_PAGE = 40;

export interface BoardColumn {
  key: string;
  /** Stage of the column; null = the ideas column. */
  stage: ScriptStatus | null;
  label: string;
  scripts: ScriptSummary[];
  ideas: Idea[];
}

export interface BoardProps {
  columns: BoardColumn[];
  /** Script shown in the side panel (its card is marked). */
  peekId: string | null;
  /** Folder name on the cards (off on a folder's own page). */
  showFolder: boolean;
  /** `inverse`: Alt-click, open the other way than the setting says. */
  onOpen: (s: ScriptSummary, inverse: boolean) => void;
  onOpenIdea: (idea: Idea) => void;
  onMenu: (s: ScriptSummary, e: MouseEvent, anchor?: HTMLElement) => void;
  onNewScript: () => void;
}

function errorToast(err: unknown) {
  pushToast(t("common.errorPrefix", { message: err instanceof Error ? err.message : String(err) }), "error");
}

/** An idea dropped on a stage becomes a script at that stage. */
async function ideaToStage(idea: Idea, stage: ScriptStatus): Promise<void> {
  try {
    await requireSuccessfulFlush();
    const { script } = await ideasStore.convertIdeaToScript({ ideaId: idea.id, folderId: idea.folder_id });
    if (stage !== firstStageId()) await api.setScriptStatus(script.id, stage);
    scriptsBus.bump();
    foldersBus.bump();
    ideasStore.refresh();
    pushToast(t("script.toast.created", { title: script.title }), "ok");
  } catch (err) {
    errorToast(err);
  }
}

/**
 * Board view of the scripts page: one column per stage, in the order of
 * the configured pipeline, optionally led by the open ideas. Dragging a
 * card onto another column changes its stage (with the usual undo toast);
 * an idea dragged onto a stage becomes a script there.
 */
export function Board(props: BoardProps) {
  const [dropOn, setDropOn] = createSignal<string | null>(null);
  const [dragKind, setDragKind] = createSignal<"script" | "idea" | null>(null);
  // The card just dropped into another column settles in with a little
  // spring when it shows up there (after the list reloads).
  const [dropped, setDropped] = createSignal<string | null>(null);
  let droppedTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(droppedTimer));
  const markDropped = (id: string) => {
    clearTimeout(droppedTimer);
    setDropped(id);
    droppedTimer = setTimeout(() => setDropped(null), 900);
  };

  // "Show more" per column key: survives list reloads (the columns are
  // rebuilt on every change) and the columns are matched by position.
  const [limits, setLimits] = createSignal<Readonly<Record<string, number>>>({});
  const limitOf = (key: string) => limits()[key] ?? COLUMN_PAGE;

  const accepts = (col: BoardColumn, e: DragEvent) => {
    if (col.stage === null || !e.dataTransfer) return false;
    const types = Array.from(e.dataTransfer.types);
    return types.includes(SCRIPT_DRAG_MIME) || types.includes(IDEA_DRAG_MIME);
  };

  const onDrop = (col: BoardColumn, e: DragEvent) => {
    setDropOn(null);
    const stage = col.stage;
    if (stage === null || !e.dataTransfer) return;
    const scriptId = e.dataTransfer.getData(SCRIPT_DRAG_MIME);
    const ideaId = e.dataTransfer.getData(IDEA_DRAG_MIME);
    if (scriptId) {
      e.preventDefault();
      if (library.script(scriptId)?.status !== stage) {
        markDropped(scriptId);
        void setStageWithUndo(scriptId, stage);
      }
    } else if (ideaId) {
      e.preventDefault();
      const idea = library.openIdeas().find((i) => i.id === ideaId);
      if (idea) void ideaToStage(idea, stage);
    }
  };

  return (
    <div class="board" classList={{ "is-dragging": dragKind() !== null }}>
      <Index each={props.columns}>
        {(col) => {
          const limit = () => limitOf(col().key);
          const setLimit = (n: number) => setLimits((cur) => ({ ...cur, [col().key]: n }));
          const count = () => (col().stage === null ? col().ideas.length : col().scripts.length);
          const isFirst = () => col().stage !== null && col().stage === firstStageId();
          return (
            <section
              class="bcol"
              classList={{
                "is-drop": dropOn() === col().key,
                "is-target": dragKind() !== null && col().stage !== null,
              }}
              aria-label={col().label}
              onDragOver={(e) => {
                if (!accepts(col(), e)) return;
                e.preventDefault();
                if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
                setDropOn(col().key);
              }}
              onDragLeave={(e) => {
                const next = e.relatedTarget as Node | null;
                if (next && e.currentTarget.contains(next)) return;
                setDropOn((cur) => (cur === col().key ? null : cur));
              }}
              onDrop={(e) => onDrop(col(), e)}
            >
              <header class="bcol-h">
                <StageGlyph stage={col().stage ?? "idea"} />
                <span class="bcol-t">{col().label}</span>
                <BumpNumber class="bcol-n num" value={count()} />
                <Show when={isFirst()}>
                  <button
                    type="button"
                    class="bcol-add"
                    title={t("browser.newScript")}
                    aria-label={t("browser.newScript")}
                    onClick={() => props.onNewScript()}
                  >
                    <Icon name="plus" size={12} />
                  </button>
                </Show>
              </header>
              <div class="bcol-cards">
                <Show when={col().stage === null}>
                  <For each={col().ideas.slice(0, limit())}>
                    {(idea) => (
                      <IdeaCard
                        idea={idea}
                        showFolder={props.showFolder}
                        onOpen={() => props.onOpenIdea(idea)}
                        onDragState={(on) => setDragKind(on ? "idea" : null)}
                      />
                    )}
                  </For>
                </Show>
                <For each={col().scripts.slice(0, limit())}>
                  {(s) => (
                    <ScriptCard
                      script={s}
                      dropped={dropped() === s.id}
                      peek={props.peekId === s.id}
                      showFolder={props.showFolder}
                      onOpen={(inverse) => props.onOpen(s, inverse)}
                      onMenu={(e, anchor) => props.onMenu(s, e, anchor)}
                      onDragState={(on) => setDragKind(on ? "script" : null)}
                    />
                  )}
                </For>
                <Show when={count() > limit()}>
                  <button type="button" class="bcol-more" onClick={() => setLimit(limit() + COLUMN_PAGE)}>
                    {t("shell.board.more", { n: Math.min(COLUMN_PAGE, count() - limit()) })}
                  </button>
                </Show>
                <Show when={count() === 0}>
                  <div class="bcol-empty">{col().stage === null ? t("shell.board.noIdeas") : t("shell.board.empty")}</div>
                </Show>
              </div>
            </section>
          );
        }}
      </Index>
    </div>
  );
}

function firstLine(text: string | null | undefined): string {
  return (
    (text ?? "")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.length > 0) ?? ""
  );
}

function FolderTag(props: { folderId: string | null }) {
  const folder = () => library.folder(props.folderId);
  return (
    <Show when={folder()}>
      {(f) => (
        <span class="bcard-folder">
          <span class="fdot" style={{ background: folderColor(f().id) }} />
          <span>{f().name}</span>
        </span>
      )}
    </Show>
  );
}

function ScriptCard(props: {
  script: ScriptSummary;
  dropped: boolean;
  peek: boolean;
  showFolder: boolean;
  onOpen: (inverse: boolean) => void;
  onMenu: (e: MouseEvent, anchor?: HTMLElement) => void;
  onDragState: (dragging: boolean) => void;
}) {
  const [dragging, setDragging] = createSignal(false);
  const s = () => props.script;
  const title = () => s().title || t("common.untitled");
  const runtime = createMemo(() => {
    const sec = runtimeSecFor(s());
    if (sec === null) return null;
    return { label: formatClock(sec), over: lengthStatus(sec, lengthRangeFor(s())).state === "over" };
  });
  return (
    <div
      class="bcard"
      classList={{ "is-peek": props.peek, "is-dragging": dragging(), "is-dropped": props.dropped }}
      role="button"
      tabIndex={0}
      aria-label={title()}
      draggable={true}
      onDragStart={(e) => {
        if (!e.dataTransfer) return;
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData(SCRIPT_DRAG_MIME, s().id);
        e.dataTransfer.setData("text/plain", title());
        setDragging(true);
        props.onDragState(true);
      }}
      onDragEnd={() => {
        setDragging(false);
        props.onDragState(false);
      }}
      onClick={(e) => props.onOpen(e.altKey)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          props.onOpen(e.altKey);
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        props.onMenu(e);
      }}
    >
      <div class="bcard-top">
        <b class="bcard-title">
          <span classList={{ "mo-marker": library.justFinished(s().id) }}>{title()}</span>
        </b>
        <button
          type="button"
          class="bcard-more"
          title={t("browser.rowMore")}
          aria-label={t("browser.rowMore")}
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation();
            props.onMenu(e, e.currentTarget);
          }}
        >
          <Icon name="dots" size={14} />
        </button>
      </div>
      <Show when={library.ideaLine(s().id)}>{(line) => <p class="bcard-sub">{line()}</p>}</Show>
      <div class="bcard-foot">
        <Show when={props.showFolder}>
          <FolderTag folderId={s().folder_id} />
        </Show>
        <span class="bcard-sp" />
        <Show when={runtime()}>
          {(rt) => <span class="bcard-rt num" classList={{ over: rt().over }}>{rt().label}</span>}
        </Show>
        <span class="bcard-when">{relativeTime(s().updated_at)}</span>
      </div>
    </div>
  );
}

function IdeaCard(props: {
  idea: Idea;
  showFolder: boolean;
  onOpen: () => void;
  onDragState: (dragging: boolean) => void;
}) {
  const [dragging, setDragging] = createSignal(false);
  const title = () => props.idea.title || t("common.untitled");
  return (
    <div
      class="bcard is-idea"
      classList={{ "is-dragging": dragging() }}
      role="button"
      tabIndex={0}
      aria-label={title()}
      title={t("shell.board.ideaHint")}
      draggable={true}
      onDragStart={(e) => {
        if (!e.dataTransfer) return;
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData(IDEA_DRAG_MIME, props.idea.id);
        e.dataTransfer.setData("text/plain", title());
        setDragging(true);
        props.onDragState(true);
      }}
      onDragEnd={() => {
        setDragging(false);
        props.onDragState(false);
      }}
      onClick={() => props.onOpen()}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          props.onOpen();
        }
      }}
    >
      <div class="bcard-top">
        <b class="bcard-title">{title()}</b>
      </div>
      <Show when={firstLine(props.idea.notes)}>{(line) => <p class="bcard-sub">{line()}</p>}</Show>
      <div class="bcard-foot">
        <Show when={props.showFolder}>
          <FolderTag folderId={props.idea.folder_id} />
        </Show>
        <span class="bcard-sp" />
        <span class="bcard-when">{relativeTime(props.idea.created_at)}</span>
      </div>
    </div>
  );
}
