// Empty states of the scripts page.

import { Match, Switch } from "solid-js";
import { K } from "@agentz/kit/platform";
import { Icon } from "@agentz/kit/ui";
import type { ScriptStatus } from "../../lib/types";
import { finalStageId, stageLabel } from "../../lib/stages";
import { t } from "../../i18n";

/** No script at all yet ("Alle Skripte", unfiltered). */
export function FirstScriptEmpty(props: { onNewScript: () => void }) {
  return (
    <div class="lib-empty">
      <div class="lib-empty-h">{t("shell.empty.first.title")}</div>
      <div class="lib-empty-sub">
        {(() => {
          const [a, b] = t("shell.empty.first.body").split("{key}");
          return (
            <>
              {a}
              <kbd>{K("Mod+N")}</kbd>
              {b ?? ""}
            </>
          );
        })()}
      </div>
      <button type="button" class="btn primary" onClick={() => props.onNewScript()}>
        <Icon name="plus" />
        {t("browser.newScript")}
      </button>
    </div>
  );
}

/** The filter matches nothing. */
export function NoMatchesEmpty(props: { query: string }) {
  return (
    <div class="lib-empty">
      <div class="lib-empty-h">{t("browser.empty.search.title", { query: props.query })}</div>
      <div class="lib-empty-sub">{t("shell.empty.search.hint")}</div>
    </div>
  );
}

/** The inbox, a stage or a folder without scripts and ideas. */
export function ScopeEmpty(props: {
  isInbox: boolean;
  status: ScriptStatus | null;
  folderName: string;
  onNewScript: () => void;
}) {
  return (
    <div class="lib-empty">
      <Switch
        fallback={
          <>
            <div class="lib-empty-h">{t("browser.empty.folder.title", { folder: props.folderName })}</div>
            <div class="lib-empty-sub">{t("shell.empty.folder.hint")}</div>
            <button type="button" class="btn" onClick={() => props.onNewScript()}>
              <Icon name="plus" />
              {t("browser.newScript")}
            </button>
          </>
        }
      >
        <Match when={props.isInbox}>
          <div class="lib-empty-h">{t("shell.empty.inbox.title")}</div>
          <div class="lib-empty-sub">
            {t("shell.empty.inbox.hint", { stage: stageLabel(finalStageId()) })}
          </div>
          <button type="button" class="btn" onClick={() => props.onNewScript()}>
            <Icon name="plus" />
            {t("browser.newScript")}
          </button>
        </Match>
        <Match when={props.status}>
          {(st) => (
            <>
              <div class="lib-empty-h">{t("shell.empty.stage.title", { stage: stageLabel(st()) })}</div>
              <div class="lib-empty-sub">{t("shell.empty.stage.hint")}</div>
            </>
          )}
        </Match>
      </Switch>
    </div>
  );
}
