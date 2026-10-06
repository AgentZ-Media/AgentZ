import { For, Show, batch, createMemo, createSignal, type Accessor } from "solid-js";
import { K, isModKey } from "@agentz/kit/platform";
import { Icon } from "@agentz/kit/ui";
import { INBOX_FOLDER_ID } from "../../../lib/folders";
import type { Folder, Idea } from "../../../lib/types";
import { ideasStore } from "../../../stores/ideas";
import { t } from "../../../i18n";
import { StageGlyph } from "../../Common/StageGlyph";
import { FolderMenu } from "../../Common/FolderMenu";
import { similarIdeas } from "../similar";
import { errorToast } from "../ideaActions";

export interface CaptureDeps {
  ideas: Accessor<Idea[]>;
  /** Folder filter of the page; the capture follows it until a folder is
   *  picked explicitly. */
  activeFolder: Accessor<string | null>;
  /** ⌘⏎: the fresh idea becomes a script right away. */
  convert: (idea: Idea) => Promise<void>;
  /** ⏎: the fresh idea was saved and stays an idea. */
  onCreated: (idea: Idea) => void;
}

/** State and actions of the capture field. Called from the ideas page, so
 *  its signals live in the page's owner; `CaptureField` renders it. */
export function createCapture(deps: CaptureDeps) {
  const refs: { input?: HTMLInputElement; notes?: HTMLTextAreaElement } = {};
  const [title, setTitle] = createSignal("");
  const [notes, setNotes] = createSignal("");
  const [open, setOpen] = createSignal(false);
  /** Explicitly picked folder; undefined follows the folder filter. */
  const [folder, setFolder] = createSignal<string | null | undefined>(undefined);
  const folderValue = () => {
    const picked = folder();
    if (picked !== undefined) return picked;
    const fid = deps.activeFolder();
    return fid === INBOX_FOLDER_ID ? null : fid;
  };
  /** Existing ideas resembling the title being typed (duplicate check). */
  const similar = createMemo(() =>
    open() ? similarIdeas({ id: "", title: title() }, deps.ideas(), 2) : [],
  );

  function growNotes() {
    const el = refs.notes;
    if (!el) return;
    el.style.height = "auto";
    // scrollHeight excludes the border; add it back so no scrollbar shows.
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
  }

  function expand() {
    setOpen(true);
    queueMicrotask(() => {
      growNotes();
      refs.notes?.focus({ preventScroll: true });
    });
  }

  /** Closes the expanded part; its notes and folder pick are dropped so
   *  nothing invisible rides along with the next idea. */
  function collapse() {
    batch(() => {
      setOpen(false);
      setNotes("");
      setFolder(undefined);
    });
    refs.input?.focus({ preventScroll: true });
  }

  async function submit(startScript: boolean) {
    const trimmed = title().trim();
    if (!trimmed) return;
    const draft = { title: title(), notes: notes(), folder: folder(), open: open() };
    const folderId = folderValue();
    // Clear right away: the field stays usable for the next idea while this
    // one is saved (and a second Enter cannot submit it twice).
    batch(() => {
      setTitle("");
      setNotes("");
      setFolder(undefined);
      setOpen(false);
    });
    // Focus stays in the field for the next idea.
    refs.input?.focus({ preventScroll: true });
    try {
      const idea = await ideasStore.createIdea({ title: trimmed, notes: draft.notes.trim(), folderId });
      if (startScript) {
        await deps.convert(idea);
        return;
      }
      deps.onCreated(idea);
    } catch (err) {
      // Give the text back unless the field was reused meanwhile.
      if (!title() && !notes()) {
        batch(() => {
          setTitle(draft.title);
          setNotes(draft.notes);
          setFolder(draft.folder);
          setOpen(draft.open);
        });
      }
      errorToast(err);
    }
  }

  return { refs, title, setTitle, notes, setNotes, open, setFolder, folderValue, similar, growNotes, expand, collapse, submit };
}

export type Capture = ReturnType<typeof createCapture>;

export interface CaptureFieldProps {
  capture: Capture;
  folders: Folder[];
  /** A similar-idea link was clicked. */
  onReveal: (id: string) => void;
}

/** The capture field on top of the ideas page: a title line that expands
 *  into notes, folder, similar ideas and the two submit buttons. */
export function CaptureField(props: CaptureFieldProps) {
  const cap = props.capture;
  return (
    <div class="i-cap" classList={{ "is-open": cap.open() }}>
      <div
        class="i-cap-row"
        onMouseDown={(e) => {
          // The whole row focuses the input, like a label would.
          if (!(e.target as HTMLElement).closest("button, input")) {
            e.preventDefault();
            cap.refs.input?.focus();
          }
        }}
      >
        <span class="i-cap-plus" aria-hidden="true">
          <Icon name="plus" />
        </span>
        <input
          ref={(el) => (cap.refs.input = el)}
          class="i-cap-input"
          value={cap.title()}
          placeholder={t("ideasPage.capture.placeholder")}
          aria-label={t("ideasPage.capture.aria")}
          spellcheck={false}
          onInput={(e) => cap.setTitle(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void cap.submit(isModKey(e));
            } else if (
              !cap.open() &&
              ((e.key === "Tab" && !e.shiftKey && !e.altKey && !isModKey(e)) || (e.key === "Enter" && e.shiftKey))
            ) {
              e.preventDefault();
              cap.expand();
            } else if (e.key === "Escape") {
              e.preventDefault();
              if (cap.open()) {
                cap.collapse();
              } else {
                cap.setTitle("");
                e.currentTarget.blur();
              }
            }
          }}
        />
        <Show when={!cap.open()}>
          <kbd>⏎</kbd>
          <button
            type="button"
            class="btn ghost sm"
            tabindex="-1"
            title={t("ideasPage.capture.addNoteTitle")}
            onClick={cap.expand}
          >
            <Icon name="pen" size={13} />
            {t("ideasPage.capture.addNote")}
            <kbd>⇥</kbd>
          </button>
        </Show>
        <span class="i-cap-hint">{t("ideasPage.capture.hint", { key: K("Mod+I") })}</span>
      </div>
      <Show when={cap.open()}>
        <textarea
          ref={(el) => (cap.refs.notes = el)}
          class="i-cap-notes"
          rows={2}
          value={cap.notes()}
          placeholder={t("ideasPage.detail.notesPlaceholder")}
          aria-label={t("ideasPage.capture.notesAria")}
          onInput={(e) => {
            cap.setNotes(e.currentTarget.value);
            cap.growNotes();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && isModKey(e)) {
              e.preventDefault();
              void cap.submit(true);
            } else if (e.key === "Escape") {
              // Back to the title; a second esc closes the notes.
              e.preventDefault();
              cap.refs.input?.focus({ preventScroll: true });
            }
          }}
        />
        <div class="i-cap-foot">
          <FolderMenu
            folders={props.folders}
            value={cap.folderValue()}
            onChange={cap.setFolder}
            ariaLabel={t("ideasPage.capture.folderAria")}
          />
          <Show when={cap.similar().length > 0}>
            <div class="i-sim">
              <span>{t("ideasPage.detail.similar")}</span>
              <For each={cap.similar()}>
                {(other) => (
                  <button
                    type="button"
                    class="i-sim-it"
                    title={`${other.title} · ${t("stage.idea")}`}
                    onClick={() => props.onReveal(other.id)}
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
          <div class="i-cap-act">
            <button
              type="button"
              class="btn"
              disabled={!cap.title().trim()}
              onClick={() => void cap.submit(true)}
            >
              {t("ideasPage.detail.convert")}
              <kbd>{K("Mod+Enter")}</kbd>
            </button>
            <button
              type="button"
              class="btn primary"
              disabled={!cap.title().trim()}
              onClick={() => void cap.submit(false)}
            >
              {t("capture.remember")}
              <kbd>⏎</kbd>
            </button>
          </div>
        </div>
      </Show>
    </div>
  );
}
