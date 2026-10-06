import { Show, createMemo } from "solid-js";
import { relativeTime } from "@agentz/kit/lib";
import { Icon } from "@agentz/kit/ui";
import { navStore } from "../../stores/nav";
import { t, tPlural } from "../../i18n";
import { StageGlyph } from "../Common/StageGlyph";
import { library } from "../Shell/libraryData";

/** "48 Ideen warten" card (only on the unfiltered "Alle Skripte" view). */
export function IdeasTeaser() {
  const newest = createMemo(() => {
    const list = library.openIdeas();
    let best = list[0];
    for (const i of list) if (i.created_at > (best?.created_at ?? 0)) best = i;
    return best;
  });
  return (
    <button type="button" class="teaser" onClick={() => navStore.openIdeas()}>
      <StageGlyph stage="idea" class="teaser-glyph" />
      <div>
        <b>{tPlural("shell.teaser.waiting", library.openIdeas().length)}</b>
        <Show when={newest()}>
          {(i) => (
            <span>
              {t("shell.teaser.newest", { title: i().title, when: relativeTime(i().created_at) })}
            </span>
          )}
        </Show>
      </div>
      <span class="btn sm">
        {t("shell.teaser.open")}
        <Icon name="right" size={12} />
      </span>
    </button>
  );
}
