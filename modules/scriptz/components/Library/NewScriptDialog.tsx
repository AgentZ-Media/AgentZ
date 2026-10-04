import { Show, createEffect, createSignal } from "solid-js";
import { api } from "../../lib/api";
import { foldersBus } from "../../lib/foldersBus";
import type { Folder } from "../../lib/types";
import { uiStore } from "../../stores/ui";
import { pushToast } from "@agentz/kit/stores";
import { DialogFrame, Icon } from "@agentz/kit/ui";
import { t } from "../../i18n";
import { FolderMenu } from "../Ideas/parts/FolderMenu";
import { library } from "../Shell/libraryData";
import { createScript } from "./actions";
// Same frame, title field and footer as the ⌘I quick capture.
import "../Ideas/QuickCapture.css";
import "./NewScriptDialog.css";

/** Stands for the folder typed in the dialog; created only on "Anlegen". */
const NEW_FOLDER_ID = "new-script-dialog:new-folder";

/** ⌘N / "Neues Skript": asks for the title and, optionally, the folder
 *  (an existing one or a new one) before the script is created and opened.
 *  Opened via `uiStore.openNewScript(folderId)` with the folder preset. */
export function NewScriptDialog() {
  const [title, setTitle] = createSignal("");
  const [folderId, setFolderId] = createSignal<string | null>(null);
  /** Name of the folder to create along with the script. */
  const [newFolder, setNewFolder] = createSignal<string | null>(null);
  const [namingFolder, setNamingFolder] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  let navigated = false;
  let titleRef: HTMLInputElement | undefined;

  let wasOpen = false;
  createEffect(() => {
    const open = uiStore.newScriptOpen();
    if (open && !wasOpen) {
      const preset = uiStore.newScriptFolder();
      setTitle("");
      setFolderId(preset && library.folder(preset) ? preset : null);
      setNewFolder(null);
      setNamingFolder(false);
      setBusy(false);
      navigated = false;
    }
    wasOpen = open;
  });

  const close = () => uiStore.closeNewScript();

  const folderOptions = (): Folder[] => {
    const name = newFolder();
    if (name === null) return library.folders();
    const now = Date.now();
    return [
      ...library.folders(),
      {
        id: NEW_FOLDER_ID,
        name: t("newScript.pendingFolder", { name }),
        created_at: now,
        updated_at: now,
        script_count: 0,
        length_min_sec: null,
        length_max_sec: null,
      },
    ];
  };

  const commitFolderName = (value: string) => {
    setNamingFolder(false);
    const name = value.trim();
    if (!name) return;
    // An existing folder of that name is picked instead of a duplicate.
    const existing = library.folders().find((f) => f.name.toLocaleLowerCase() === name.toLocaleLowerCase());
    if (existing) {
      setFolderId(existing.id);
    } else {
      setNewFolder(name);
      setFolderId(NEW_FOLDER_ID);
    }
    requestAnimationFrame(() => titleRef?.focus());
  };

  async function submit() {
    if (busy() || namingFolder()) return;
    const name = title().trim();
    if (!name) {
      titleRef?.focus();
      return;
    }
    setBusy(true);
    try {
      let target = folderId();
      const folderName = newFolder();
      if (target === NEW_FOLDER_ID && folderName !== null) {
        const created = await api.createFolder(folderName);
        foldersBus.bump();
        // A second attempt after a failed script must not create it again.
        setNewFolder(null);
        setFolderId(created.id);
        target = created.id;
      }
      if (await createScript({ title: name, folderId: target })) {
        navigated = true;
        close();
      }
    } catch (err) {
      pushToast(t("common.errorPrefix", { message: (err as Error)?.message ?? String(err) }), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <DialogFrame
      open={uiStore.newScriptOpen()}
      onClose={close}
      label={t("newScript.aria")}
      placement="top"
      class="cap ns"
      restoreFocus={() => !navigated}
    >
      <div class="cap-in">
        <div class="cap-lbl">
          <Icon name="doc" size={14} />
          {t("newScript.label")}
          <button type="button" class="cap-esc" onClick={close} aria-label={t("common.close")} tabindex="-1">
            <kbd>esc</kbd>
          </button>
        </div>
        <input
          ref={titleRef}
          class="cap-title"
          data-autofocus
          value={title()}
          placeholder={t("newScript.titlePlaceholder")}
          aria-label={t("newScript.titleAria")}
          spellcheck={false}
          onInput={(e) => setTitle(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.isComposing) {
              e.preventDefault();
              void submit();
            }
          }}
        />
      </div>
      <div class="cap-foot">
        <Show
          when={!namingFolder()}
          fallback={<FolderNameInput onCommit={commitFolderName} onCancel={() => setNamingFolder(false)} />}
        >
          <Show
            when={folderOptions().length > 0}
            fallback={
              <button type="button" class="btn ghost" onClick={() => setNamingFolder(true)}>
                <Icon name="plus" />
                {t("folder.new")}
              </button>
            }
          >
            <FolderMenu
              folders={folderOptions()}
              value={folderId()}
              onChange={setFolderId}
              onCreate={() => setNamingFolder(true)}
              ariaLabel={t("newScript.folderAria")}
            />
          </Show>
        </Show>
        <span class="sp" />
        <button type="button" class="btn" onClick={close}>
          {t("common.cancel")}
        </button>
        <button
          type="button"
          class="btn primary"
          disabled={busy() || namingFolder() || !title().trim()}
          onClick={() => void submit()}
        >
          {t("newScript.create")}
          <kbd>⏎</kbd>
        </button>
      </div>
    </DialogFrame>
  );
}

/** Inline name field in the footer. ⏎ / blur commits, esc cancels without
 *  closing the dialog. */
function FolderNameInput(props: { onCommit(value: string): void; onCancel(): void }) {
  let done = false;
  const finish = (value: string | null) => {
    if (done) return;
    done = true;
    if (value === null) props.onCancel();
    else props.onCommit(value);
  };
  return (
    <label class="ns-folder">
      <Icon name="folder" />
      <input
        ref={(el) => requestAnimationFrame(() => el.focus())}
        type="text"
        placeholder={t("newScript.newFolderPlaceholder")}
        aria-label={t("newScript.newFolderAria")}
        spellcheck={false}
        onKeyDown={(e) => {
          if (e.isComposing) return;
          if (e.key === "Enter") {
            e.preventDefault();
            finish(e.currentTarget.value);
          } else if (e.key === "Escape") {
            // Handled here: the dialog frame skips prevented events.
            e.preventDefault();
            finish(null);
          }
        }}
        onBlur={(e) => finish(e.currentTarget.value)}
      />
    </label>
  );
}

export default NewScriptDialog;
