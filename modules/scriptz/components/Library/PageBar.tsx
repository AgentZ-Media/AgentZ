import { Show } from "solid-js";
import { uiStore } from "../../stores/ui";
import { Icon } from "@agentz/kit/ui";
import { K } from "@agentz/kit/platform";
import { t } from "../../i18n";

/**
 * Top edge of the list pages. Deliberately empty: page tools sit with the
 * content they control, right above the list. The strip is the window's
 * drag region on desktop and offers the sidebar toggle while the sidebar
 * is hidden (the traffic-light inset comes from `--shell-inset-left`, see
 * Shell.css). Back and forward are ⌘[ / ⌘].
 */
export function PageBar() {
  return (
    <header class="pbar" data-tauri-drag-region>
      <Show when={!uiStore.sidebarOpen()}>
        <button
          type="button"
          class="btn ghost icon"
          title={t("shell.sidebar.toggle", { hotkey: K("Mod+\\") })}
          aria-label={t("shell.sidebar.toggleAria")}
          onClick={() => uiStore.toggleSidebar()}
        >
          <Icon name="sidebar" />
        </button>
      </Show>
    </header>
  );
}
