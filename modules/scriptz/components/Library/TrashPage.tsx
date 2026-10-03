import { For, Show, createResource } from "solid-js";
import { api } from "../../lib/api";
import { relativeTime } from "@agentz/kit/lib";
import { scriptsBus } from "../../lib/scriptsBus";
import { foldersBus } from "../../lib/foldersBus";
import { navStore } from "../../stores/nav";
import { pushToast } from "@agentz/kit/stores";
import { confirmDialog } from "@agentz/kit/ui";
import { Icon } from "@agentz/kit/ui";
import { StageGlyph } from "../Common/StageGlyph";
import { PageBar } from "./PageBar";
import { t, tPlural } from "../../i18n";
import type { ScriptSummary } from "../../lib/types";
import "./Library.css";

function fail(e: unknown): void {
  pushToast(t("common.errorPrefix", { message: e instanceof Error ? e.message : String(e) }), "error");
}

/** Trash (former TrashView in the browser): restore, purge, empty,
 *  restore all. Restoring the last item leads back to the library, so the
 *  user sees where the script went. */
export function TrashPage() {
  const [scripts] = createResource(
    () => scriptsBus.version(),
    () => api.listScripts({ onlyArchived: true, sort: "updated" }),
    { initialValue: [] },
  );
  const list = () => scripts() ?? [];

  const afterRestore = (emptied: boolean) => {
    scriptsBus.bump();
    foldersBus.bump();
    if (emptied) navStore.openScripts();
  };

  async function restoreOne(s: ScriptSummary) {
    const wasLast = list().length <= 1;
    try {
      await api.restoreScript(s.id);
      pushToast(t("trash.toast.restored"), "ok");
      afterRestore(wasLast);
    } catch (e) {
      fail(e);
    }
  }

  async function purgeOne(s: ScriptSummary) {
    const ok = await confirmDialog({
      title: t("trash.confirm.purge.title"),
      body: t("trash.confirm.purge.body", { title: s.title }),
      confirmLabel: t("common.delete"),
      danger: true,
    });
    if (!ok) return;
    try {
      await api.purgeScript(s.id);
      pushToast(t("trash.toast.purged"), "ok");
      scriptsBus.bump();
    } catch (e) {
      fail(e);
    }
  }

  async function restoreAll() {
    const arr = list();
    if (arr.length === 0) return;
    const ok = await confirmDialog({
      title: t("trash.confirm.restoreAll.title"),
      body: tPlural("trash.confirm.restoreAll.body", arr.length),
      confirmLabel: t("trash.restoreOne"),
    });
    if (!ok) return;
    try {
      await Promise.all(arr.map((s) => api.restoreScript(s.id)));
      pushToast(tPlural("trash.toast.restoredAll", arr.length), "ok");
      afterRestore(true);
    } catch (e) {
      fail(e);
      scriptsBus.bump();
    }
  }

  async function emptyAll() {
    const n = list().length;
    if (n === 0) return;
    const ok = await confirmDialog({
      title: t("trash.confirm.empty.title"),
      body: tPlural("trash.confirm.empty.body", n),
      confirmLabel: t("trash.confirm.empty.button"),
      danger: true,
    });
    if (!ok) return;
    try {
      await api.emptyTrash();
      pushToast(t("trash.toast.emptied"), "ok");
      scriptsBus.bump();
    } catch (e) {
      fail(e);
    }
  }

  return (
    <div class="lib-page">
      <PageBar title={t("browser.trash")}>
        <button type="button" class="btn ghost" disabled={list().length === 0} onClick={() => void restoreAll()}>
          <Icon name="undo" />
          {t("trash.restoreAll")}
        </button>
        <button type="button" class="btn danger" disabled={list().length === 0} onClick={() => void emptyAll()}>
          <Icon name="trash" />
          {t("trash.emptyAll")}
        </button>
      </PageBar>
      <div class="lib-scroll">
        <div class="lib">
          <div class="lib-head">
            <div class="lib-head-main">
              <h1>{t("browser.trash")}</h1>
              <div class="week">
                <span class="week-lbl">{tPlural("units.scripts", list().length)}</span>
              </div>
            </div>
          </div>
          <Show
            when={list().length > 0}
            fallback={
              <Show when={!scripts.loading}>
                <div class="lib-empty">
                  <div class="lib-empty-h">{t("trash.empty")}</div>
                  <div class="lib-empty-sub">{t("shell.trash.hint")}</div>
                </div>
              </Show>
            }
          >
            <div class="rows">
              <For each={list()}>
                {(s) => (
                  <div class="trow">
                    <StageGlyph stage={s.status} />
                    <div class="lrow-t">
                      <span class="lrow-title">{s.title || t("common.untitled")}</span>
                    </div>
                    <div class="lrow-u">
                      <Show when={s.archived_at}>
                        {(at) => t("trash.deletedAt", { when: relativeTime(at()) })}
                      </Show>
                    </div>
                    <div class="trow-act">
                      <button type="button" class="btn sm" onClick={() => void restoreOne(s)}>
                        {t("trash.restoreOne")}
                      </button>
                      <button type="button" class="btn danger sm" onClick={() => void purgeOne(s)}>
                        {t("trash.purgeOne")}
                      </button>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
}

export default TrashPage;
