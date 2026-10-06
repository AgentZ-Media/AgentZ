import { For, Match, Show, Switch } from "solid-js";
import type { Idea, ScriptSummary } from "../../lib/types";
import { firstStageId } from "../../lib/stages";
import { formatClock } from "../../lib/lengthGoal";
import { t } from "../../i18n";
import { Icon } from "@agentz/kit/ui";
import type { ListSelection } from "../Common/listSelection";
import { GroupCheck, SelectAllLine } from "../Common/SelectCheck";
import { runtimeSecFor } from "../Shell/libraryData";
import { IdeasTeaser } from "./IdeasTeaser";
import { InboxIdeas } from "./InboxIdeas";
import { ScriptRow } from "./ScriptRow";
import { openFromList, openFull } from "./openScript";
import { libraryPrefs } from "./prefs";
import type { Block, ContentHit, Group } from "./scriptsData";

export interface ScriptListProps {
  selection: ListSelection;
  /** Rows "select all" covers. */
  selectableCount: number;
  blocks: Block[];
  contentHits: ContentHit[];
  canCollapse: boolean;
  collapseKey: (key: string) => string;
  hasMore: boolean;
  /** Rows the "load more" button adds. */
  moreCount: number;
  onMore: () => void;
  inboxIdeas: Idea[];
  ideasClosed: boolean;
  ideasCanCollapse: boolean;
  /** Script shown in the side panel. */
  peekId: string | null;
  onNewScript: () => void;
  onToggleSelect: (id: string, e?: MouseEvent | KeyboardEvent) => void;
  onMenu: (s: ScriptSummary, e: MouseEvent, anchor?: HTMLElement) => void;
}

/** The list view of the scripts page: "select all" line, stage / folder
 *  groups (folded ones in one line), the ideas teaser, "load more", the
 *  inbox ideas and the full-text hits. */
export function ScriptList(props: ScriptListProps) {
  const sel = props.selection;

  const row = (s: ScriptSummary, snippetHtml?: string) => (
    <ScriptRow
      script={s}
      snippetHtml={snippetHtml}
      selectMode={sel.selectMode()}
      selected={sel.selected().has(s.id)}
      peek={props.peekId === s.id}
      onOpen={(inverse) => openFromList(s.id, s.title, inverse)}
      onOpenFull={() => openFull(s.id, s.title)}
      onToggleSelect={(e) => props.onToggleSelect(s.id, e)}
      onMenu={(e, anchor) => props.onMenu(s, e, anchor)}
    />
  );

  const groupAction = (grp: Group) => {
    if (grp.status === firstStageId() && !sel.selectMode()) {
      return (
        <button type="button" class="grp-act" onClick={() => props.onNewScript()}>
          <Icon name="plus" size={12} />
          {t("browser.newScript")}
        </button>
      );
    }
    if (grp.status === "ready") {
      const sum = grp.all.reduce((acc, s) => acc + (runtimeSecFor(s) ?? 0), 0);
      if (sum <= 0) return null;
      return (
        <span class="grp-act is-static" title={t("shell.group.materialTitle")}>
          {t("shell.group.material", { time: formatClock(sum) })}
        </span>
      );
    }
    return null;
  };

  return (
    <>
      <Show when={sel.selectMode() && props.selectableCount > 0}>
        <SelectAllLine state={sel.allState()} count={props.selectableCount} onToggle={sel.toggleAll} />
      </Show>
      <For each={props.blocks}>
        {(block) => (
          <Switch>
            <Match when={block.kind === "teaser"}>
              <IdeasTeaser />
            </Match>
            <Match when={block.kind === "closed" && block}>
              {(b) => (
                <div class="grp is-closed">
                  <div class="grp-h">
                    <For each={(b() as { kind: "closed"; groups: Group[] }).groups}>
                      {(grp, i) => (
                        <button
                          type="button"
                          class="grp-tog"
                          aria-expanded="false"
                          title={t("shell.group.expand")}
                          onClick={() => libraryPrefs.toggleCollapsed(props.collapseKey(grp.key))}
                        >
                          <Show when={i() === 0}>
                            <Icon name="right" size={11} class="chev is-shown" />
                          </Show>
                          {grp.glyph()}
                          <span>{grp.label}</span>
                          <span class="n num">{grp.all.length}</span>
                        </button>
                      )}
                    </For>
                    <span class="grp-act is-static">{t("shell.group.collapsed")}</span>
                  </div>
                </div>
              )}
            </Match>
            <Match when={block.kind === "group" && block}>
              {(b) => {
                const grp = () => (b() as { kind: "group"; group: Group }).group;
                return (
                  <section class="grp">
                    <Show when={grp().key !== "all"}>
                      <div class="grp-h">
                        <GroupCheck selection={sel} ids={grp().all.map((s) => s.id)} name={grp().label} />
                        <button
                          type="button"
                          class="grp-tog"
                          aria-expanded="true"
                          disabled={!props.canCollapse}
                          title={props.canCollapse ? t("shell.group.collapse") : undefined}
                          onClick={() => libraryPrefs.toggleCollapsed(props.collapseKey(grp().key))}
                        >
                          <Show when={props.canCollapse}>
                            <Icon name="down" size={11} class="chev" />
                          </Show>
                          {grp().glyph()}
                          <span>{grp().label}</span>
                          <span class="n num">{grp().all.length}</span>
                        </button>
                        <span class="grp-sp" />
                        {groupAction(grp())}
                      </div>
                    </Show>
                    <Show when={grp().items.length > 0}>
                      <div class="rows">
                        <For each={grp().items}>{(s) => row(s)}</For>
                      </div>
                    </Show>
                  </section>
                );
              }}
            </Match>
          </Switch>
        )}
      </For>
      <Show when={props.hasMore}>
        <div class="lib-more">
          <button type="button" class="btn ghost" onClick={() => props.onMore()}>
            {t("browser.loadMore", { n: props.moreCount })}
          </button>
        </div>
      </Show>

      {/* Work in progress first, the (often long) idea list below it. */}
      <Show when={props.inboxIdeas.length > 0}>
        <InboxIdeas
          ideas={props.inboxIdeas}
          closed={props.ideasClosed}
          canCollapse={props.ideasCanCollapse}
          onToggle={() => libraryPrefs.toggleCollapsed(props.collapseKey("ideas"))}
        />
      </Show>

      <Show when={props.contentHits.length > 0}>
        <section class="grp">
          <div class="grp-h">
            <GroupCheck
              selection={sel}
              ids={props.contentHits.map((h) => h.script.id)}
              name={t("shell.group.contentHits")}
            />
            <span class="grp-tog is-static">
              <Icon name="search" size={12} />
              <span>{t("shell.group.contentHits")}</span>
              <span class="n num">{props.contentHits.length}</span>
            </span>
          </div>
          <div class="rows">
            <For each={props.contentHits}>{(hit) => row(hit.script, hit.snippet)}</For>
          </div>
        </section>
      </Show>
    </>
  );
}
