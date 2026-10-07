import { For, Show } from "solid-js";
import { INBOX_FOLDER_ID } from "../../lib/folders";
import type { Folder } from "../../lib/types";
import { t } from "../../i18n";
import { folderColor } from "./folderColor";

/** Items per folder of a page, before its folder filter applies. */
export interface FolderChipCounts {
  /** Every item of the page (the "all" chip). */
  total: number;
  byFolder: Map<string, number>;
  /** Items without a folder. */
  none: number;
}

/** Counts `items` per folder id, plus the ones without a folder. */
export function countByFolder(items: Iterable<{ folder_id: string | null }>): FolderChipCounts {
  const byFolder = new Map<string, number>();
  let total = 0;
  let none = 0;
  for (const item of items) {
    total++;
    if (!item.folder_id) none++;
    else byFolder.set(item.folder_id, (byFolder.get(item.folder_id) ?? 0) + 1);
  }
  return { total, byFolder, none };
}

export interface FolderChipsProps {
  /** Every folder (decides whether the "no folder" chip shows). */
  folders: Folder[];
  counts: FolderChipCounts;
  /** Folder filter: null = all, `INBOX_FOLDER_ID` = no folder. */
  active: string | null;
  onSelect: (id: string | null) => void;
}

/** One-click folder filter of the list pages: "all", every folder with
 *  items (plus the active one) and "no folder". Renders the chips only; the
 *  page decides the row around them. */
export function FolderChips(props: FolderChipsProps) {
  const shown = () =>
    props.folders.filter((f) => (props.counts.byFolder.get(f.id) ?? 0) > 0 || f.id === props.active);

  return (
    <>
      <button type="button" class="fchip" aria-pressed={props.active === null} onClick={() => props.onSelect(null)}>
        {t("folder.chips.all")} <em>{props.counts.total}</em>
      </button>
      <For each={shown()}>
        {(f) => (
          <button
            type="button"
            class="fchip"
            aria-pressed={props.active === f.id}
            onClick={() => props.onSelect(f.id)}
          >
            <i style={{ background: folderColor(f.id) }} />
            {f.name} <em>{props.counts.byFolder.get(f.id) ?? 0}</em>
          </button>
        )}
      </For>
      <Show when={props.folders.length > 0 && (props.counts.none > 0 || props.active === INBOX_FOLDER_ID)}>
        <button
          type="button"
          class="fchip"
          aria-pressed={props.active === INBOX_FOLDER_ID}
          onClick={() => props.onSelect(INBOX_FOLDER_ID)}
        >
          {t("folder.inbox")} <em>{props.counts.none}</em>
        </button>
      </Show>
    </>
  );
}
