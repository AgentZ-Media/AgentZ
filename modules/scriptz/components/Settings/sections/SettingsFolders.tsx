import { Index, Show, createResource } from "solid-js";
import { api } from "../../../lib/api";
import { foldersBus } from "../../../lib/foldersBus";
import { folderHasLengthRange, formatRange } from "../../../lib/lengthGoal";
import { settingsStore } from "../../../stores/settings";
import { t } from "../../../i18n";
import type { Folder } from "../../../lib/types";
import { folderColor } from "../../Ideas/folderColor";
import { SectionHead } from "@agentz/kit/ui";
import { RangeFields } from "./parts";

/** Target range per folder (overrides the default range). Folder CRUD
 *  itself lives in the sidebar. */
export function SettingsFolders(props: { onClose(): void }) {
  const [folders] = createResource(() => foldersBus.version(), () => api.listFolders(), {
    initialValue: [] as Folder[],
  });
  const defaults = () => ({
    minSec: settingsStore.lengthMinDefaultSec(),
    maxSec: settingsStore.lengthMaxDefaultSec(),
  });
  const defaultText = () => formatRange(defaults());
  // Empty fields of a folder without own range inherit the default
  // ("Standard"); once one bound is set, the other empty one means "none".
  const placeholder = (f: Folder) =>
    folderHasLengthRange(f) ? t("prefs.folders.placeholderNone") : t("prefs.folders.placeholder");

  return (
    <>
      <SectionHead title={t("prefs.folders.title")} sub={t("prefs.folders.sub")} onClose={props.onClose} />
      <div class="srow set-note">
        <div>
          <b>{t("prefs.folders.rangeLabel")}</b>
          <small>
            {t("prefs.folders.rangeHelp")}{" "}
            {defaultText() ? t("prefs.folders.defaultIs", { range: defaultText() }) : t("prefs.folders.defaultNone")}
          </small>
        </div>
      </div>
      <Show
        when={(folders() ?? []).length > 0}
        fallback={<p class="set-empty">{t("prefs.folders.empty")}</p>}
      >
        <div class="set-folders">
          <Index each={folders()}>
            {(f) => (
              <div class="set-folder">
                <i class="fdot" style={{ "--dot": folderColor(f().id) }} />
                <span class="set-folder-name">{f().name}</span>
                <RangeFields
                  label={f().name}
                  minSec={f().length_min_sec}
                  maxSec={f().length_max_sec}
                  minPlaceholder={placeholder(f())}
                  maxPlaceholder={placeholder(f())}
                  onCommit={async (min, max) => {
                    await api.setFolderLengthRange(f().id, min, max);
                    foldersBus.bump();
                  }}
                />
              </div>
            )}
          </Index>
        </div>
      </Show>
    </>
  );
}
