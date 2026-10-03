// Script and folder operations shared by the scripts page, the sidebar, the
// command palette and the global shortcuts. Every function bumps the right
// buses and reports success / failure as a toast, so callers stay thin.

import { api } from "../../lib/api";
import { scriptsBus } from "../../lib/scriptsBus";
import { foldersBus } from "../../lib/foldersBus";
import { INBOX_FOLDER_ID } from "../../lib/folders";
import { navStore } from "../../stores/nav";
import { pushToast } from "../../stores/toasts";
import { ideasStore } from "../../stores/ideas";
import { confirmDialog } from "../Common/ConfirmDialog";
import { library } from "../Shell/libraryData";
import { t, tPlural } from "../../i18n";
import type { Folder, ScriptStatus, ScriptSummary } from "../../lib/types";

function fail(e: unknown): void {
  const message = e instanceof Error ? e.message : String(e);
  pushToast(t("common.errorPrefix", { message }), "error");
}

function realFolder(id: string | null | undefined): string | null {
  if (!id || id === INBOX_FOLDER_ID) return null;
  return library.folder(id) ? id : null;
}

/** Folder the user is "in" right now: the filtered folder of the scripts
 *  or ideas page, or the folder of the open script. */
export function currentFolderContext(): string | null {
  const r = navStore.route();
  if (r.kind === "scripts" || r.kind === "ideas") return realFolder(r.folderId);
  if (r.kind === "script") return realFolder(library.script(r.scriptId)?.folder_id);
  return null;
}

let creating = false;

/** ⌘N / "+": creates an untitled script and opens it. The script screen
 *  focuses the title field of a fresh "Unbenannt" script. */
export async function createScript(folderId: string | null = currentFolderContext()): Promise<void> {
  // Key repeat / double click guard: one script per gesture.
  if (creating) return;
  creating = true;
  try {
    const created = await api.createScript({ folderId: realFolder(folderId) });
    scriptsBus.bump();
    foldersBus.bump();
    navStore.openScript(created.id, created.title);
  } catch (e) {
    fail(e);
  } finally {
    creating = false;
  }
}

export async function importScriptzFile(): Promise<void> {
  try {
    const result = await api.importScriptz();
    if (!result) return;
    scriptsBus.bump();
    foldersBus.bump();
    navStore.openScript(result.scriptId, result.title);
    pushToast(t("script.toast.imported"), "ok");
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    pushToast(t("script.toast.importFailed", { message }), "error");
  }
}

export async function duplicateScript(s: ScriptSummary): Promise<void> {
  try {
    const dup = await api.duplicateScript(s.id);
    scriptsBus.bump();
    foldersBus.bump();
    pushToast(t("script.toast.duplicated"), "ok");
    navStore.openScript(dup.id, dup.title);
  } catch (e) {
    fail(e);
  }
}

export async function renameScript(s: ScriptSummary, title: string): Promise<boolean> {
  const v = title.trim();
  if (!v) return false;
  if (v === s.title) return true;
  try {
    const updated = await api.renameScript(s.id, v);
    navStore.setScriptTitle(s.id, updated.title);
    scriptsBus.bump();
    pushToast(t("script.toast.renamed"), "ok");
    return true;
  } catch (e) {
    fail(e);
    return false;
  }
}

export async function archiveScripts(list: ScriptSummary[]): Promise<void> {
  if (list.length === 0) return;
  try {
    for (const s of list) await api.archiveScript(s.id);
    if (list.length === 1) {
      pushToast(t("script.toast.archived", { title: list[0].title }), "ok");
    } else {
      pushToast(tPlural("shell.toast.archivedMany", list.length), "ok");
    }
  } catch (e) {
    fail(e);
  } finally {
    scriptsBus.bump();
    foldersBus.bump();
  }
}

export async function moveScriptsTo(ids: string[], folderId: string | null): Promise<void> {
  if (ids.length === 0) return;
  try {
    if (ids.length === 1) await api.moveScript(ids[0], folderId);
    else await api.moveScripts(ids, folderId);
    const name =
      folderId === null ? t("folder.none") : (library.folder(folderId)?.name ?? t("folder.new"));
    pushToast(t("folder.toast.movedTo", { name }), "ok");
  } catch (e) {
    fail(e);
  } finally {
    scriptsBus.bump();
    foldersBus.bump();
  }
}

export async function setScriptsStage(ids: string[], status: ScriptStatus): Promise<void> {
  if (ids.length === 0) return;
  try {
    for (const id of ids) await api.setScriptStatus(id, status);
    pushToast(t("shell.toast.stageSet", { stage: t(`stage.${status}`) }), "ok");
  } catch (e) {
    fail(e);
  } finally {
    scriptsBus.bump();
  }
}

export async function createFolder(name: string): Promise<Folder | null> {
  const v = name.trim();
  if (!v) return null;
  try {
    const created = await api.createFolder(v);
    foldersBus.bump();
    pushToast(t("folder.toast.created", { name: created.name }), "ok");
    return created;
  } catch (e) {
    fail(e);
    return null;
  }
}

export async function renameFolder(folder: Folder, name: string): Promise<void> {
  const v = name.trim();
  if (!v || v === folder.name) return;
  try {
    await api.renameFolder(folder.id, v);
    foldersBus.bump();
    pushToast(t("folder.toast.renamed"), "ok");
  } catch (e) {
    fail(e);
  }
}

/** Asks first. Scripts and ideas inside stay (they lose their folder). */
export async function deleteFolder(folder: Folder): Promise<void> {
  const n = folder.script_count;
  const body =
    n === 0
      ? t("folder.deleteBody.empty")
      : n === 1
        ? t("folder.deleteBody.one")
        : t("folder.deleteBody.many", { count: n });
  const ok = await confirmDialog({
    title: t("folder.deleteTitle", { name: folder.name }),
    body,
    confirmLabel: t("common.delete"),
    danger: true,
  });
  if (!ok) return;
  try {
    await api.deleteFolder(folder.id);
    pushToast(t("folder.toast.deleted", { name: folder.name }), "ok");
    const r = navStore.route();
    if ((r.kind === "scripts" || r.kind === "ideas") && r.folderId === folder.id) {
      navStore.openScripts();
    }
  } catch (e) {
    fail(e);
  } finally {
    foldersBus.bump();
    scriptsBus.bump();
    ideasStore.refresh();
  }
}
