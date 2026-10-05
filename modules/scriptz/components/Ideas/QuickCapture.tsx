import { Show, createEffect, createResource, createSignal } from "solid-js";
import { api } from "../../lib/api";
import { foldersBus } from "../../lib/foldersBus";
import { INBOX_FOLDER_ID } from "../../lib/folders";
import { K, isModKey } from "@agentz/kit/platform";
import { ideasStore } from "../../stores/ideas";
import { navStore } from "../../stores/nav";
import { uiStore } from "../../stores/ui";
import { pushToast } from "@agentz/kit/stores";
import { t } from "../../i18n";
import type { Folder } from "../../lib/types";
import { flyInto } from "../Common/motion";
import { StageGlyph } from "../Common/StageGlyph";
import { DialogFrame } from "@agentz/kit/ui";
import { FolderMenu } from "./parts/FolderMenu";
import "./QuickCapture.css";

type FolderSource = "script" | "filter" | null;

/** ⌘I quick capture: a real centered modal over a scrim. Opens from
 *  anywhere (also in focus mode) via `uiStore.openCapture()`; the folder
 *  defaults to the open script's folder, else the current folder filter.
 *  Focus returns to where it was (usually the editor) after closing. */
export function QuickCapture() {
  const [title, setTitle] = createSignal("");
  const [notes, setNotes] = createSignal("");
  const [folderId, setFolderId] = createSignal<string | null>(null);
  const [source, setSource] = createSignal<FolderSource>(null);
  const [busy, setBusy] = createSignal(false);
  let navigated = false;
  let titleRef: HTMLInputElement | undefined;

  const [folders] = createResource(() => foldersBus.version(), () => api.listFolders(), {
    initialValue: [] as Folder[],
  });

  // Reset + resolve the default folder on every open.
  let wasOpen = false;
  createEffect(() => {
    const open = uiStore.captureOpen();
    if (open && !wasOpen) {
      setTitle("");
      setNotes("");
      setBusy(false);
      navigated = false;
      setFolderId(null);
      setSource(null);
      const route = navStore.route();
      if (route.kind === "script") {
        const sid = route.scriptId;
        void api
          .getScript(sid)
          .then((s) => {
            // Only apply if the user hasn't picked a folder meanwhile.
            if (uiStore.captureOpen() && source() === null && folderId() === null && s.folder_id) {
              setFolderId(s.folder_id);
              setSource("script");
            }
          })
          .catch(() => {});
      } else if (route.kind === "ideas" || route.kind === "scripts") {
        const fid = route.folderId ?? null;
        if (fid && fid !== INBOX_FOLDER_ID) {
          setFolderId(fid);
          setSource("filter");
        }
      }
    }
    wasOpen = open;
  });

  const close = () => uiStore.closeCapture();

  async function save(startWriting: boolean) {
    if (busy()) return;
    const text = title().trim();
    if (!text) {
      if (!notes().trim()) close();
      else titleRef?.focus();
      return;
    }
    setBusy(true);
    try {
      const idea = await ideasStore.createIdea({ title: text, notes: notes().trim(), folderId: folderId() });
      if (startWriting) {
        const { script } = await ideasStore.convertIdeaToScript({ ideaId: idea.id, folderId: idea.folder_id });
        navigated = true;
        close();
        navStore.openScript(script.id, script.title);
        pushToast(t("script.toast.created", { title: script.title }), "ok");
      } else {
        // The card flies into "Ideen" in the sidebar, so it is clear where
        // the idea went.
        const from = titleRef?.closest(".dlg")?.getBoundingClientRect() ?? null;
        close();
        if (from) flyInto(from, document.querySelector('[data-nav="ideas"]'), idea.title);
        pushToast(t("idea.quick.toast.remembered", { title: idea.title }), "ok");
      }
    } catch (err) {
      pushToast(t("common.errorPrefix", { message: (err as Error)?.message ?? String(err) }), "error");
    } finally {
      setBusy(false);
    }
  }

  const onKeys = (e: KeyboardEvent, field: "title" | "notes") => {
    if (e.key !== "Enter") return;
    if (isModKey(e)) {
      e.preventDefault();
      void save(true);
    } else if (field === "title" && !e.shiftKey) {
      e.preventDefault();
      void save(false);
    }
  };

  const sourceHint = () => {
    if (source() === "script") return t("capture.source.script");
    if (source() === "filter") return t("capture.source.filter");
    return "";
  };

  return (
    <DialogFrame
      open={uiStore.captureOpen()}
      onClose={close}
      label={t("capture.aria")}
      placement="top"
      class="cap"
      restoreFocus={() => !navigated}
    >
      <div class="cap-in">
        <div class="cap-lbl">
          <StageGlyph stage="idea" />
          {t("capture.label")}
          <Show when={sourceHint()}>
            <span class="cap-src">· {sourceHint()}</span>
          </Show>
          <button type="button" class="cap-esc" onClick={close} aria-label={t("common.close")} tabindex="-1">
            <kbd>esc</kbd>
          </button>
        </div>
        <input
          ref={titleRef}
          class="cap-title"
          data-autofocus
          value={title()}
          placeholder={t("capture.titlePlaceholder")}
          aria-label={t("capture.titleAria")}
          spellcheck={false}
          onInput={(e) => setTitle(e.currentTarget.value)}
          onKeyDown={(e) => onKeys(e, "title")}
        />
        <textarea
          class="cap-notes"
          rows={2}
          value={notes()}
          placeholder={t("capture.notesPlaceholder")}
          aria-label={t("capture.notesAria")}
          onInput={(e) => {
            setNotes(e.currentTarget.value);
            const el = e.currentTarget;
            el.style.height = "auto";
            el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
          }}
          onKeyDown={(e) => onKeys(e, "notes")}
        />
      </div>
      <div class="cap-foot">
        <FolderMenu
          folders={folders() ?? []}
          value={folderId()}
          onChange={(fid) => {
            setFolderId(fid);
            setSource(null);
          }}
          ariaLabel={t("capture.folderAria")}
        />
        <span class="sp" />
        <button type="button" class="btn" disabled={busy() || !title().trim()} onClick={() => void save(true)}>
          {t("capture.writeNow")}
          <kbd>{K("Mod+Enter")}</kbd>
        </button>
        <button
          type="button"
          class="btn primary"
          disabled={busy() || !title().trim()}
          onClick={() => void save(false)}
        >
          {t("capture.remember")}
          <kbd>⏎</kbd>
        </button>
      </div>
    </DialogFrame>
  );
}

export default QuickCapture;
