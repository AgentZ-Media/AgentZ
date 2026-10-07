import { For, Show, createEffect, createResource, on, onCleanup, onMount } from "solid-js";
import type { SaveResult } from "@agentz/kit/lib";
import { api } from "../../../lib/api";
import { acquireIdeaDraft, releaseIdeaDraft } from "./ideaDrafts";
import { formatDate } from "@agentz/kit/i18n";
import { t } from "../../../i18n";
import { K } from "@agentz/kit/platform";
import type { Folder, Idea, ScriptSummary } from "../../../lib/types";
import { stageLabel } from "../../../lib/stages";
import { Icon } from "@agentz/kit/ui";
import { StageGlyph } from "../../Common/StageGlyph";
import { AgentAvatar } from "../../Agent/AgentAvatar";
import { agentSettings } from "../../../stores/agentSettings";
import { FolderMenu } from "../../Common/FolderMenu";
import { ideaAge } from "../ideaGroups";
import { rankScriptHits, similarIdeas, similarQueryTerms } from "../similar";

export interface IdeaEditorHandle {
  /** Persists pending title/notes edits now. */
  flush(): Promise<SaveResult>;
  focusNotes(): void;
}

export interface IdeaEditorProps {
  ideaId: string;
  ideas: Idea[];
  folders: Folder[];
  scripts: ReadonlyMap<string, ScriptSummary>;
  now: number;
  onReady(handle: IdeaEditorHandle): void;
  /** The editor unmounts; `handle` is the one passed to `onReady`. */
  onDispose?(handle: IdeaEditorHandle): void;
  onConvert(idea: Idea): void;
  /** "Mit Ida ausschreiben" (agent mode); absent when the agent is not offered. */
  onWriteWithAgent?(idea: Idea): void;
  /** Opens the agent session an idea was saved from. */
  onOpenSession?(chatId: string): void;
  onDelete(idea: Idea): void;
  onMove(idea: Idea, folderId: string | null): void;
  onOpenScript(scriptId: string, title: string): void;
  onSelectIdea(id: string): void;
  /** Collapse button, or Escape inside a field: close and hand focus back
   *  to the list. */
  onCollapse(): void;
}

/** Expanded row of the ideas list: editable title + notes (autosave),
 *  folder, created date, similar pieces, "start as script" and delete.
 *  Mounted while its row is open. The drafts live per idea id outside the
 *  component (see ideaDrafts.ts): collapsing and reopening before a save
 *  landed shows the pending text, never stale cached notes. */
export function IdeaEditor(props: IdeaEditorProps) {
  const idea = () => props.ideas.find((i) => i.id === props.ideaId) ?? null;
  const initial = idea();
  // Title + notes autosave. Writes are serialized; each queued save reads
  // the newest drafts when it runs and diffs them against what the last
  // ACKNOWLEDGED write stored - never against the asynchronously refreshed
  // props, which lag behind an in-flight save.
  const draft = initial ? acquireIdeaDraft(initial) : null;
  const title = () => draft?.title() ?? "";
  const notes = () => draft?.notes() ?? "";
  const setTitle = (v: string) => draft?.setTitle(v);
  const setNotes = (v: string) => draft?.setNotes(v);
  const used = () => !!idea()?.used_at;
  let notesRef: HTMLTextAreaElement | undefined;

  const schedule = () => draft?.saver.schedule();
  /** Drains the latest drafts and every write still in flight. */
  const flush = () => draft?.saver.flush() ?? Promise.resolve({ ok: true });
  /** Saves what was just typed first; the agent gets the newest text. */
  const writeWithAgent = async () => {
    const base = idea();
    if (!base || !props.onWriteWithAgent) return;
    const latest = { ...base, title: title().trim() || base.title, notes: notes() };
    const saved = await flush();
    if (!saved.ok) return;
    props.onWriteWithAgent(latest);
  };

  const handle: IdeaEditorHandle = {
    flush,
    focusNotes() {
      if (!notesRef) return;
      notesRef.focus({ preventScroll: true });
      const end = notesRef.value.length;
      notesRef.setSelectionRange(end, end);
    },
  };

  onCleanup(() => {
    props.onDispose?.(handle);
    // Collapse / idea switch / page leave: write what's left. The draft
    // entry keeps its window-close flusher until that write settled.
    if (draft) releaseIdeaDraft(draft);
  });

  function autoGrow(el: HTMLTextAreaElement | undefined) {
    if (!el) return;
    el.style.height = "auto";
    // scrollHeight excludes the border; add it back so no scrollbar shows.
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
  }

  // The notes can change without an input event (resync from the store).
  createEffect(on(notes, () => autoGrow(notesRef), { defer: true }));

  onMount(() => {
    autoGrow(notesRef);
    props.onReady(handle);
  });

  // Similar scripts: full-text search per distinctive title word, merged.
  const [similarScripts] = createResource(
    () => {
      const i = idea();
      return i ? { id: i.id, title: i.title, scriptId: i.script_id } : null;
    },
    async (src) => {
      const terms = similarQueryTerms(src.title);
      if (terms.length === 0) return [];
      const lists = await Promise.all(terms.map((term) => api.globalSearch(term, 8).catch(() => [])));
      const exclude = new Set(src.scriptId ? [src.scriptId] : []);
      return rankScriptHits(lists, exclude).slice(0, 2);
    },
    { initialValue: [] },
  );
  const otherIdeas = () => {
    const i = idea();
    return i ? similarIdeas(i, props.ideas, 2) : [];
  };

  const created = () => {
    const i = idea();
    if (!i) return "";
    return formatDate(i.created_at, {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  };
  const linkedScript = () => {
    const sid = idea()?.script_id;
    return sid ? props.scripts.get(sid) ?? null : null;
  };

  const fieldKeys = (e: KeyboardEvent, field: "title" | "notes") => {
    if (e.key === "Escape") {
      e.preventDefault();
      void flush();
      props.onCollapse();
      return;
    }
    if (field === "title" && e.key === "Enter" && !e.shiftKey && !(e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handle.focusNotes();
    }
  };

  return (
    <Show when={idea()}>
      {(cur) => (
        <>
          <div class="ix-h">
            <Show when={used()} fallback={<StageGlyph stage="idea" />}>
              <Icon name="check" size={14} />
            </Show>
            <input
              class="ix-t"
              value={title()}
              readOnly={used()}
              placeholder={t("ideasPage.detail.titlePlaceholder")}
              aria-label={t("ideasPage.detail.titleAria")}
              spellcheck={false}
              onInput={(e) => {
                setTitle(e.currentTarget.value);
                schedule();
              }}
              onBlur={() => {
                // An emptied title is never saved - show the stored one again.
                if (!title().trim() && draft) setTitle(draft.saver.baseline().title);
                void flush();
              }}
              onKeyDown={(e) => fieldKeys(e, "title")}
            />
            <span class="ix-age">
              {used()
                ? t("ideasPage.detail.usedAge", { age: ideaAge(cur().used_at ?? cur().created_at, props.now) })
                : t("ideasPage.detail.age", { age: ideaAge(cur().created_at, props.now) })}
            </span>
            <button
              type="button"
              class="btn ghost icon sm"
              aria-label={t("ideasPage.detail.collapse")}
              title={`${t("ideasPage.detail.collapse")} (esc)`}
              onClick={() => {
                void flush();
                props.onCollapse();
              }}
            >
              <Icon name="up" size={14} />
            </button>
          </div>

          <textarea
            ref={notesRef}
            class="ix-n"
            rows={3}
            value={notes()}
            readOnly={used()}
            placeholder={used() ? undefined : t("ideasPage.detail.notesPlaceholder")}
            aria-label={t("ideasPage.detail.notesAria")}
            onInput={(e) => {
              setNotes(e.currentTarget.value);
              autoGrow(notesRef);
              schedule();
            }}
            onBlur={() => void flush()}
            onKeyDown={(e) => fieldKeys(e, "notes")}
          />

          <div class="ix-f">
            <FolderMenu
              folders={props.folders}
              value={cur().folder_id}
              onChange={(fid) => props.onMove(cur(), fid)}
              ariaLabel={t("ideasPage.detail.folder")}
            />
            <span class="ix-meta">{t("ideasPage.detail.created", { date: created() })}</span>
            <Show when={props.onOpenSession && cur().source_chat_id}>
              {(chatId) => (
                <button
                  type="button"
                  class="ix-origin"
                  title={t("agentMode.ideas.openSession")}
                  onClick={() => props.onOpenSession?.(chatId())}
                >
                  <AgentAvatar look={agentSettings.look()} size={14} state="still" />
                  {t("agentMode.ideas.fromAgent", { name: agentSettings.displayName() })}
                </button>
              )}
            </Show>
            <Show when={similarScripts().length > 0 || otherIdeas().length > 0}>
              <div class="i-sim">
                <span>{t("ideasPage.detail.similar")}</span>
                <For each={similarScripts()}>
                  {(hit) => {
                    const status = () => props.scripts.get(hit.id)?.status ?? "writing";
                    const name = () => props.scripts.get(hit.id)?.title || hit.title || t("common.untitled");
                    return (
                      <button
                        type="button"
                        class="i-sim-it"
                        title={`${name()} · ${stageLabel(status())}`}
                        onClick={() => props.onOpenScript(hit.id, name())}
                      >
                        <StageGlyph stage={status()} />
                        <span>{name()}</span>
                      </button>
                    );
                  }}
                </For>
                <For each={otherIdeas()}>
                  {(other) => (
                    <button
                      type="button"
                      class="i-sim-it"
                      title={`${other.title} · ${t("stage.idea")}`}
                      onClick={() => props.onSelectIdea(other.id)}
                    >
                      <Show when={other.used} fallback={<StageGlyph stage="idea" />}>
                        <Icon name="check" size={14} />
                      </Show>
                      <span>{other.title}</span>
                    </button>
                  )}
                </For>
              </div>
            </Show>
            <div class="ix-act">
              <button type="button" class="btn ghost" onClick={() => props.onDelete(cur())}>
                {t("common.delete")}
              </button>
              <Show when={!used() && props.onWriteWithAgent}>
                <button type="button" class="btn ix-agent" onClick={() => void writeWithAgent()}>
                  <AgentAvatar look={agentSettings.look()} size={16} state="idle" />
                  {t("agentMode.ideas.writeWith", { name: agentSettings.displayName() })}
                </button>
              </Show>
              <Show
                when={used()}
                fallback={
                  <button type="button" class="btn primary" onClick={() => props.onConvert(cur())}>
                    {t("ideasPage.detail.convert")}
                    <kbd>{K("Mod+Enter")}</kbd>
                  </button>
                }
              >
                <Show
                  when={linkedScript()}
                  fallback={
                    <button type="button" class="btn" disabled>
                      {t("ideas.card.linked.stale")}
                    </button>
                  }
                >
                  {(s) => (
                    <button type="button" class="btn primary" onClick={() => props.onOpenScript(s().id, s().title)}>
                      <Icon name="doc" />
                      {t("ideasPage.detail.openScript")}
                    </button>
                  )}
                </Show>
              </Show>
            </div>
          </div>
        </>
      )}
    </Show>
  );
}
