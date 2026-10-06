// Idea operations of the ideas page (single row and selection bar): convert
// to a script, delete with undo, move with undo, bulk convert into a stage,
// plus the selection bar menus. Every function reports failures as a toast.

import { api } from "../../lib/api";
import { scriptsBus } from "../../lib/scriptsBus";
import { requireSuccessfulFlush } from "@agentz/kit/lib";
import { ideasStore } from "../../stores/ideas";
import { navStore } from "../../stores/nav";
import { pushToast } from "@agentz/kit/stores";
import { confirmDialog } from "@agentz/kit/ui";
import { t, tPlural } from "../../i18n";
import type { Folder, Idea, ScriptStatus } from "../../lib/types";
import { scriptStages, stageLabel } from "../../lib/stages";
import { StageGlyph } from "../Common/StageGlyph";
import type { ContextMenuItem } from "../Common/ContextMenu";
import { folderColor } from "../Common/folderColor";

export const errorToast = (err: unknown) =>
  pushToast(t("common.errorPrefix", { message: (err as Error)?.message ?? String(err) }), "error");

/** Turns an open idea into a script and opens it. */
export async function convertIdea(idea: Idea) {
  if (idea.used_at) return;
  try {
    // All pending idea drafts, including a row collapsed a moment ago.
    await requireSuccessfulFlush();
    const { script } = await ideasStore.convertIdeaToScript({
      ideaId: idea.id,
      folderId: idea.folder_id,
    });
    pushToast(t("script.toast.created", { title: script.title }), "ok");
    navStore.openScript(script.id, script.title);
  } catch (err) {
    errorToast(err);
  }
}

export async function removeIdeas(list: Idea[]) {
  if (list.length === 0) return;
  const ok = await confirmDialog(
    list.length === 1
      ? {
          title: t("ideas.confirm.delete.title"),
          body: t("ideas.confirm.delete.body", { title: list[0].title }),
          confirmLabel: t("common.delete"),
          danger: true,
        }
      : {
          title: t("ideasPage.confirm.deleteMany.title"),
          body: tPlural("ideasPage.confirm.deleteMany.body", list.length),
          confirmLabel: t("common.delete"),
          danger: true,
        },
  );
  if (!ok) return;
  const deleted: Idea[] = [];
  // Ideas have no trash: whatever was deleted gets its undo, even when a
  // later one in the batch fails.
  const undoToast = () => {
    if (deleted.length === 0) return;
    pushToast(
      deleted.length === 1
        ? t("ideas.toast.deleted", { title: deleted[0].title })
        : tPlural("ideasPage.toast.deletedMany", deleted.length),
      "ok",
      undefined,
      {
        action: {
          label: t("shell.toast.undo"),
          run: async () => {
            try {
              for (const idea of deleted) await ideasStore.restoreIdea(idea);
            } catch (err) {
              errorToast(err);
            }
          },
        },
      },
    );
  };
  try {
    for (const idea of list) {
      await ideasStore.deleteIdea(idea.id);
      deleted.push(idea);
    }
  } catch (err) {
    errorToast(err);
  }
  undoToast();
}

/** Moves `list` into `folderId` (`name` for the toast), with undo. */
export async function moveIdeas(list: Idea[], folderId: string | null, name: string) {
  const todo = list.filter((i) => i.folder_id !== folderId);
  if (todo.length === 0) return;
  try {
    for (const idea of todo) await ideasStore.moveIdea(idea.id, folderId);
    pushToast(t("folder.toast.movedTo", { name }), "ok", undefined, {
      action: {
        label: t("shell.toast.undo"),
        run: async () => {
          try {
            // Only ideas still where this move put them (a later move wins).
            const now = new Map(ideasStore.ideas.latest.map((i) => [i.id, i.folder_id]));
            for (const idea of todo) {
              if (now.get(idea.id) === folderId) await ideasStore.moveIdea(idea.id, idea.folder_id);
            }
          } catch (err) {
            errorToast(err);
          }
        },
      },
    });
  } catch (err) {
    errorToast(err);
  }
}

/** Bulk "Zu Skripten": every open idea of `list` becomes a script in
 *  `stage` (same folder as the idea). Converted ideas are skipped. */
export async function convertIdeas(list: Idea[], stage: ScriptStatus) {
  const open = list.filter((i) => !i.used_at);
  const skipped = list.length - open.length;
  if (open.length === 0) return;
  let done = 0;
  let restaged = false;
  try {
    await requireSuccessfulFlush();
    for (const idea of open) {
      const { script } = await ideasStore.convertIdeaToScript({ ideaId: idea.id });
      if (script.status !== stage) {
        await api.setScriptStatus(script.id, stage);
        restaged = true;
      }
      done++;
    }
  } catch (err) {
    errorToast(err);
  } finally {
    if (restaged) scriptsBus.bump();
  }
  if (done > 0) {
    pushToast(tPlural("ideasPage.toast.convertedMany", done, { stage: stageLabel(stage) }), "ok");
  }
  if (skipped > 0) pushToast(tPlural("ideasPage.toast.convertSkipped", skipped), "info");
}

/** "Verschieben" menu of the selection bar: no folder, every folder,
 *  "Neuer Ordner…". `move` without a name uses the folder's own. */
export function ideaMoveMenu(
  list: Idea[],
  folders: Folder[],
  move: (list: Idea[], folderId: string | null, name?: string) => void,
  onNewFolder: (list: Idea[]) => void,
): ContextMenuItem[] {
  const items: ContextMenuItem[] = [
    { label: t("folder.none"), onClick: () => move(list, null) },
  ];
  for (const f of folders) {
    items.push({
      label: f.name,
      icon: <span class="fdot" style={{ background: folderColor(f.id) }} />,
      onClick: () => move(list, f.id, f.name),
    });
  }
  items.push({
    label: t("folder.newDots"),
    icon: "plus",
    separatorBefore: true,
    onClick: () => onNewFolder(list),
  });
  return items;
}

/** "Zu Skripten" menu of the selection bar: one entry per stage. */
export const ideaStageMenu = (list: Idea[]): ContextMenuItem[] =>
  scriptStages().map(({ id: st }) => ({
    label: stageLabel(st),
    icon: <StageGlyph stage={st} />,
    onClick: () => void convertIdeas(list, st),
  }));
