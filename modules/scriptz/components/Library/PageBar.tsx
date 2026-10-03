import { Show, type JSX } from "solid-js";
import { navStore } from "../../stores/nav";
import { uiStore } from "../../stores/ui";
import { Icon } from "@agentz/kit/ui";
import { K } from "@agentz/kit/platform";
import { t } from "../../i18n";

export interface PageBarProps {
  /** Crumb title (route name). */
  title: string;
  /** Right-hand controls. */
  children?: JSX.Element;
}

/**
 * Top bar of the list pages (concept `.bar`): history ‹ ›, the crumb and
 * page controls on the right. Doubles as window drag region on desktop.
 * When the sidebar is hidden it offers the toggle to bring it back (the
 * traffic-light inset comes from `--shell-inset-left`, see Shell.css).
 */
export function PageBar(props: PageBarProps) {
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
      <div class="pbar-hist">
        <button
          type="button"
          class="pbar-hist-btn"
          disabled={!navStore.canBack()}
          title={t("shell.history.back", { hotkey: K("Mod+[") })}
          aria-label={t("shell.history.backAria")}
          onClick={() => navStore.back()}
        >
          <Icon name="left" />
        </button>
        <button
          type="button"
          class="pbar-hist-btn"
          disabled={!navStore.canForward()}
          title={t("shell.history.forward", { hotkey: K("Mod+]") })}
          aria-label={t("shell.history.forwardAria")}
          onClick={() => navStore.forward()}
        >
          <Icon name="right" />
        </button>
      </div>
      <div class="pbar-crumb" data-tauri-drag-region>
        <b>{props.title}</b>
      </div>
      <span class="pbar-sp" data-tauri-drag-region />
      {props.children}
    </header>
  );
}
