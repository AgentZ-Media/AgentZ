import { For, Show, createResource, createSignal, onCleanup, onMount } from "solid-js";
import { api } from "../../../lib/api";
import { ideasStore } from "../../../stores/ideas";
import { pushToast } from "../../../stores/toasts";
import { registerFlusher } from "../../../lib/saveFlush";
import { createSerialSaver } from "../../../lib/serialSave";
import { getCurrentLocale, t } from "../../../i18n";
import { K } from "../../../lib/keys";
import type { Folder, Idea, ScriptStatus, ScriptSummary } from "../../../lib/types";
import { Icon } from "../../Common/Icon";
import { StageGlyph } from "../../Common/StageGlyph";
import { FolderMenu } from "./FolderMenu";
import { ideaAge } from "../ideaGroups";
import { rankScriptHits, similarIdeas, similarQueryTerms } from "../similar";

export interface IdeaDetailHandle {
  /** Persists pending title/notes edits now. */
  flush(): Promise<void>;
  focusNotes(): void;
}

export interface IdeaDetailProps {
  ideaId: string;
  ideas: Idea[];
  folders: Folder[];
  scripts: Map<string, ScriptSummary>;
  now: number;
  onReady(handle: IdeaDetailHandle): void;
  onConvert(idea: Idea): void;
  onDelete(idea: Idea): void;
  onMove(idea: Idea, folderId: string | null): void;
  onOpenScript(scriptId: string, title: string): void;
  onSelectIdea(id: string): void;
  /** Escape inside a field hands focus back to the list. */
  onLeave(): void;
}

const SAVE_DELAY_MS = 600;

interface IdeaDraft {
  title: string;
  notes: string;
}

function stageLabel(status: ScriptStatus): string {
  return t(`stage.${status}` as "stage.writing" | "stage.ready" | "stage.shot" | "stage.online");
}

/** Right-hand panel of the ideas page: editable title + notes (autosave),
 *  folder, created date, "start as script" and similar pieces. Mounted
 *  once per selected idea id (the page keys it), so drafts never leak
 *  between ideas. */
export function IdeaDetail(props: IdeaDetailProps) {
  const idea = () => props.ideas.find((i) => i.id === props.ideaId) ?? null;
  const initial = idea();
  const [title, setTitle] = createSignal(initial?.title ?? "");
  const [notes, setNotes] = createSignal(initial?.notes ?? "");
  const used = () => !!idea()?.used_at;
  let titleRef: HTMLTextAreaElement | undefined;
  let notesRef: HTMLTextAreaElement | undefined;

  // Title + notes autosave. Writes are serialized; each queued save reads
  // the newest drafts when it runs and diffs them against what the last
  // ACKNOWLEDGED write stored - never against the asynchronously refreshed
  // props, which lag behind an in-flight save.
  const saver = createSerialSaver<IdeaDraft>({
    initial: { title: initial?.title ?? "", notes: initial?.notes ?? "" },
    read: () => ({ title: title().trim(), notes: notes() }),
    isClean: (d, b) => (!d.title || d.title === b.title) && d.notes === b.notes,
    delayMs: SAVE_DELAY_MS,
    async write(d, b) {
      const cur = idea();
      if (!cur || cur.used_at) return b;
      const patch: { id: string; title?: string; notes?: string } = { id: cur.id };
      if (d.title && d.title !== b.title) patch.title = d.title;
      if (d.notes !== b.notes) patch.notes = d.notes;
      await ideasStore.updateIdea(patch);
      return { title: patch.title ?? b.title, notes: patch.notes ?? b.notes };
    },
    onError: (err) =>
      pushToast(t("common.errorPrefix", { message: (err as Error)?.message ?? String(err) }), "error"),
  });

  const schedule = () => saver.schedule();
  /** Drains the latest drafts and every write still in flight. */
  const flush = () => saver.flush();

  const unregister = registerFlusher(flush);
  onCleanup(() => {
    // Idea switch / page leave: write what's left, and keep the window-
    // close flusher registered until that write settled.
    void saver.flush().finally(unregister);
  });

  function autoGrow(el: HTMLTextAreaElement | undefined) {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }

  onMount(() => {
    autoGrow(titleRef);
    props.onReady({
      flush,
      focusNotes() {
        if (!notesRef) return;
        notesRef.focus();
        const end = notesRef.value.length;
        notesRef.setSelectionRange(end, end);
      },
    });
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
      const lists = await Promise.all(
        terms.map((term) => api.globalSearch(term, 8).catch(() => [])),
      );
      const exclude = new Set(src.scriptId ? [src.scriptId] : []);
      return rankScriptHits(lists, exclude).slice(0, 3);
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
    return new Date(i.created_at).toLocaleString(getCurrentLocale(), {
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
      props.onLeave();
      return;
    }
    if (field === "title" && e.key === "Enter" && !e.shiftKey && !(e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      notesRef?.focus();
    }
  };

  return (
    <Show when={idea()}>
      {(cur) => (
        <>
          <div class="idet-top">
            <Show when={used()} fallback={<StageGlyph stage="idea" />}>
              <Icon name="check" size={14} />
            </Show>
            <span>
              {used() ? t("ideasPage.detail.usedAge", { age: ideaAge(cur().used_at ?? cur().created_at, props.now) })
                : t("ideasPage.detail.age", { age: ideaAge(cur().created_at, props.now) })}
            </span>
          </div>

          <textarea
            ref={titleRef}
            class="idet-t"
            rows={1}
            value={title()}
            readOnly={used()}
            placeholder={t("ideasPage.detail.titlePlaceholder")}
            aria-label={t("ideasPage.detail.titleAria")}
            spellcheck={false}
            onInput={(e) => {
              setTitle(e.currentTarget.value.replace(/\n/g, " "));
              autoGrow(titleRef);
              schedule();
            }}
            onBlur={() => {
              // An emptied title is never saved - show the stored one again.
              if (!title().trim()) setTitle(saver.baseline().title);
              void flush();
            }}
            onKeyDown={(e) => fieldKeys(e, "title")}
          />

          <textarea
            ref={notesRef}
            class="idet-n"
            value={notes()}
            readOnly={used()}
            placeholder={t("ideasPage.detail.notesPlaceholder")}
            aria-label={t("ideasPage.detail.notesAria")}
            onInput={(e) => {
              setNotes(e.currentTarget.value);
              schedule();
            }}
            onBlur={() => void flush()}
            onKeyDown={(e) => fieldKeys(e, "notes")}
          />

          <div class="idet-meta">
            <div>
              <span>{t("ideasPage.detail.folder")}</span>
              <FolderMenu
                folders={props.folders}
                value={cur().folder_id}
                onChange={(fid) => props.onMove(cur(), fid)}
                ariaLabel={t("ideasPage.detail.folder")}
              />
            </div>
            <div>
              <span>{t("ideasPage.detail.created")}</span>
              <b>{created()}</b>
            </div>
          </div>

          <Show
            when={used()}
            fallback={
              <button type="button" class="btn primary wide" onClick={() => props.onConvert(cur())}>
                {t("ideasPage.detail.convert")}
                <kbd>{K("Mod+Enter")}</kbd>
              </button>
            }
          >
            <Show
              when={linkedScript()}
              fallback={
                <button type="button" class="btn wide" disabled>
                  {t("ideas.card.linked.stale")}
                </button>
              }
            >
              {(s) => (
                <button
                  type="button"
                  class="btn primary wide"
                  onClick={() => props.onOpenScript(s().id, s().title)}
                >
                  <Icon name="doc" />
                  {t("ideasPage.detail.openScript")}
                </button>
              )}
            </Show>
          </Show>

          <div class="idet-sim">
            <div class="idet-sec-h">{t("ideasPage.detail.similar")}</div>
            <Show
              when={similarScripts().length > 0 || otherIdeas().length > 0}
              fallback={<p class="idet-sim-empty">{t("ideasPage.detail.similarNone")}</p>}
            >
              <For each={similarScripts()}>
                {(hit) => {
                  const status = () => props.scripts.get(hit.id)?.status ?? "writing";
                  return (
                    <button
                      type="button"
                      class="sim"
                      onClick={() => props.onOpenScript(hit.id, props.scripts.get(hit.id)?.title ?? hit.title)}
                    >
                      <StageGlyph stage={status()} />
                      <span>{props.scripts.get(hit.id)?.title || hit.title || t("common.untitled")}</span>
                      <em>{stageLabel(status())}</em>
                    </button>
                  );
                }}
              </For>
              <For each={otherIdeas()}>
                {(other) => (
                  <button type="button" class="sim" onClick={() => props.onSelectIdea(other.id)}>
                    <Show when={other.used} fallback={<StageGlyph stage="idea" />}>
                      <Icon name="check" size={14} />
                    </Show>
                    <span>{other.title}</span>
                    <em>{t("stage.idea")}</em>
                  </button>
                )}
              </For>
            </Show>
          </div>

          <div class="idet-foot">
            <FolderMenu
              variant="ghost"
              label={t("ideasPage.folder.move")}
              folders={props.folders}
              value={cur().folder_id}
              onChange={(fid) => props.onMove(cur(), fid)}
            />
            <button type="button" class="btn ghost" onClick={() => props.onDelete(cur())}>
              {t("common.delete")}
            </button>
          </div>
        </>
      )}
    </Show>
  );
}
