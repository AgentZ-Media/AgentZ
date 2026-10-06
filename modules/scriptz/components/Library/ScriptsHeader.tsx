import { For, Match, Show, Switch, type JSX } from "solid-js";
import { getCurrentLocale } from "@agentz/kit/i18n";
import { clockNow } from "@agentz/kit/lib";
import { Icon } from "@agentz/kit/ui";
import { finalStageId, stageLabel } from "../../lib/stages";
import { INBOX_FOLDER_ID } from "../../lib/folders";
import { uiStore } from "../../stores/ui";
import { t, tPlural } from "../../i18n";
import { StageGlyph } from "../Common/StageGlyph";
import { library } from "../Shell/libraryData";
import { dayLevels } from "../../lib/writingCounter";

/** Placeholder for the number inside a translated sentence, so the number
 *  can be rendered bold without putting markup into the catalog. */
const MARK = "\u0000";

function boldCount(text: string, display: string): JSX.Element {
  const [a, b] = text.split(MARK);
  return (
    <>
      {a}
      <b class="num">{display}</b>
      {b ?? ""}
    </>
  );
}

const fmtNum = (n: number) => n.toLocaleString(getCurrentLocale());

export interface WeekStats {
  /** Scripts that reached the last stage this week. */
  finished: number;
  words: number;
  ideas: number;
  /** Monday..Sunday per stat; days still ahead are null. */
  days?: { finished: (number | null)[]; words: (number | null)[]; ideas: (number | null)[] };
}

const DOT_ROWS = [0, 1, 2, 3, 4] as const;

/** Monday..Sunday as dot columns; today and the days ahead are marked. */
function WeekDots(props: { values: (number | null)[] | undefined }) {
  const levels = () => dayLevels(props.values ?? [], DOT_ROWS.length);
  const today = () => (props.values ?? []).filter((v) => v !== null).length - 1;
  return (
    <Show when={props.values}>
      <span class="wk-dots" aria-hidden="true">
        <For each={levels()}>{(level, i) =>
          <span class="wk-day" classList={{ "is-today": i() === today(), "is-ahead": level === null }}>
            <For each={DOT_ROWS}>{(row) => <i classList={{ on: level !== null && row < level }} />}</For>
          </span>
        }</For>
      </span>
    </Show>
  );
}

/** Today's date above the overview title, in the user's language. Reads
 *  the shared minute clock, so it turns over at midnight. */
function todayLabel(): string {
  return new Intl.DateTimeFormat(getCurrentLocale(), { weekday: "long", day: "numeric", month: "long" }).format(new Date(clockNow()));
}

export interface ScriptsHeaderProps {
  title: string;
  isAll: boolean;
  isInbox: boolean;
  week: WeekStats;
  /** Scripts in the current scope. */
  scopeCount: number;
  folderId: string | null;
  /** Formatted length range of the folder, empty without one. */
  folderRange: string;
}

/** Page title plus the line below it: the week on "Alle Skripte", the
 *  inbox lead, otherwise the script count and the folder's length range. */
export function ScriptsHeader(props: ScriptsHeaderProps) {
  return (
    <div class="lib-head">
      <div class="lib-head-main">
        <Show when={props.isAll}>
          <p class="lib-eyebrow">{todayLabel()}</p>
        </Show>
        <h1>{props.title}</h1>
        <Switch>
          <Match when={props.isAll}>
            <Show when={props.week.finished + props.week.words + props.week.ideas > 0}>
              {/* The week as tiles: a lit icon, the number, its rhythm in dots. */}
              <div class="week is-tiles">
                <span class="week-lbl">{t("shell.week.label")}</span>
                <Show when={props.week.finished > 0}>
                  <span class="wk is-lit">
                    <span class="wk-ic"><StageGlyph stage={finalStageId()} size={16} /></span>
                    <span class="wk-t">
                      {boldCount(
                        tPlural("shell.week.done", props.week.finished, { count: MARK, stage: stageLabel(finalStageId()) }),
                        fmtNum(props.week.finished),
                      )}
                    </span>
                    <WeekDots values={props.week.days?.finished} />
                  </span>
                </Show>
                <Show when={props.week.words > 0}>
                  <span class="wk">
                    <span class="wk-ic"><Icon name="pen" size={15} /></span>
                    <span class="wk-t">
                      {boldCount(tPlural("shell.week.words", props.week.words, { count: MARK }), fmtNum(props.week.words))}
                    </span>
                    <WeekDots values={props.week.days?.words} />
                  </span>
                </Show>
                <Show when={props.week.ideas > 0}>
                  <span class="wk">
                    <span class="wk-ic"><StageGlyph stage="idea" size={16} /></span>
                    <span class="wk-t">
                      {boldCount(tPlural("shell.week.ideas", props.week.ideas, { count: MARK }), fmtNum(props.week.ideas))}
                    </span>
                    <WeekDots values={props.week.days?.ideas} />
                  </span>
                </Show>
              </div>
            </Show>
          </Match>
          <Match when={props.isInbox}>
            <div class="week">
              <span class="week-lbl">{t("shell.inbox.lead")}</span>
              <Show when={library.openIdeas().length > 0}>
                <span>
                  <StageGlyph stage="idea" />
                  {boldCount(
                    tPlural("units.ideas", library.openIdeas().length, { count: MARK }),
                    fmtNum(library.openIdeas().length),
                  )}
                </span>
              </Show>
              <Show when={props.scopeCount > 0}>
                <span>
                  <Icon name="doc" size={13} />
                  {boldCount(tPlural("units.scripts", props.scopeCount, { count: MARK }), fmtNum(props.scopeCount))}
                </span>
              </Show>
            </div>
          </Match>
          <Match when={!props.isAll}>
            <div class="week">
              <span class="week-lbl">{tPlural("units.scripts", props.scopeCount)}</span>
              <Show when={props.folderId && props.folderId !== INBOX_FOLDER_ID}>
                <button
                  type="button"
                  class="week-btn"
                  title={t("shell.folder.rangeTitle")}
                  onClick={() => uiStore.openSettings("folders")}
                >
                  {props.folderRange
                    ? t("shell.folder.range", { range: props.folderRange })
                    : t("shell.folder.rangeNone")}
                </button>
              </Show>
            </div>
          </Match>
        </Switch>
      </div>
    </div>
  );
}
