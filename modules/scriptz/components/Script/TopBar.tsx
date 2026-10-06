import { Show, createEffect, createSignal, on, onCleanup, untrack, type JSX } from "solid-js";
import { Icon, type IconName } from "@agentz/kit/ui";
import { navStore } from "../../stores/nav";
import { uiStore } from "../../stores/ui";
import { saveStatusStore } from "../../stores/saveStatus";
import { INBOX_FOLDER_ID } from "../../lib/folders";
import type { Folder, ScriptStatus } from "../../lib/types";
import { K } from "@agentz/kit/platform";
import { t } from "../../i18n";
import { StageChip } from "./StageChip";
import { AgentAvatar } from "../Agent/AgentAvatar";
import { avatarStateFor } from "../Agent/ChatPanel";
import { agentSettings } from "../../stores/agentSettings";
import { TitleInput } from "./TitleInput";
import { library } from "../Shell/libraryData";

export interface TopBarProps {
  scriptId: string;
  title: string;
  folder: Folder | null;
  status: ScriptStatus;
  /** Set to the script id once when an "Unbenannt" script opens, so the
   *  title input grabs focus and selects its text. */
  focusTitleFor: string | null;
  onTitleAutoFocused(): void;
  /** Renames `scriptId`; rejects on failure (see TitleInput.onCommit). */
  onRename(next: string, scriptId: string): Promise<void> | void;

  quickAvailable: boolean;
  quickOn: boolean;
  onToggleQuick(): void;
  colorsOn: boolean;
  onToggleColors(): void;

  inspectorVisible: boolean;
  onToggleInspector(): void;
  onExport(): void;

  agentAvailable: boolean;
  agentOn: boolean;
  onToggleAgent(): void;
  /** Side panel next to a list: no inspector or agent toggle, but "open full
   *  view" and "close" instead. */
  peek?: { onExpand(): void; onClose(): void };
}

/** Top bar of the script screen. Back and forward
 *  are ⌘[ / ⌘] only; the folder crumb leads back to the list. While the
 *  sidebar is hidden it leads with the toggle to bring it back (the module
 *  sets `revealsSidebar`, so the shell does not render its own). */
export function TopBar(props: TopBarProps) {
  const openFolder = () => {
    navStore.openScripts({ folderId: props.folder?.id ?? INBOX_FOLDER_ID });
  };

  return (
    <header class="ss-bar" classList={{ "is-peek": !!props.peek }} aria-label={t("script.bar.aria")}>
      <Show when={!props.peek && !uiStore.sidebarOpen()}>
        <button
          type="button"
          class="btn ghost icon"
          title={t("shell.sidebar.toggle", { hotkey: K("Mod+\\") })}
          aria-label={t("shell.sidebar.toggleAria")}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => uiStore.toggleSidebar()}
        >
          <Icon name="sidebar" />
        </button>
      </Show>
      <nav class="ss-crumb">
        <button
          type="button"
          class="ss-crumb-folder"
          title={
            props.folder
              ? t("script.bar.folderTitle", { folder: props.folder.name })
              : t("script.bar.noFolderTitle")
          }
          onMouseDown={(e) => e.preventDefault()}
          onClick={openFolder}
        >
          {props.folder?.name ?? t("script.bar.noFolder")}
        </button>
        <span class="ss-crumb-sep" aria-hidden="true">/</span>
        <TitleInput
          class={library.justFinished(props.scriptId) ? "ss-crumb-title mo-marker" : "ss-crumb-title"}
          title={props.title}
          focusFor={props.focusTitleFor}
          onAutoFocused={props.onTitleAutoFocused}
          scriptId={props.scriptId}
          onCommit={props.onRename}
        />
      </nav>

      <span class="ss-sp" />

      <SaveStatus />

      <StageChip scriptId={props.scriptId} status={props.status} />

      <div class="tg-group" role="group" aria-label={t("script.toggle.aria")}>
        <TipToggle
          icon="bolt"
          on={props.quickOn}
          disabled={!props.quickAvailable}
          ariaLabel={t("script.toggle.quick.aria")}
          tipTitle={
            !props.quickAvailable
              ? t("script.toggle.quick.naTitle")
              : props.quickOn
                ? t("script.toggle.quick.onTitle")
                : t("script.toggle.quick.offTitle")
          }
          tipBody={
            !props.quickAvailable
              ? t("script.toggle.quick.naBody")
              : props.quickOn
                ? t("script.toggle.quick.onBody")
                : t("script.toggle.quick.offBody")
          }
          onClick={props.onToggleQuick}
        />
        <TipToggle
          icon="marker"
          on={props.colorsOn}
          ariaLabel={t("script.toggle.colors.aria")}
          tipTitle={props.colorsOn ? t("script.toggle.colors.onTitle") : t("script.toggle.colors.offTitle")}
          tipBody={props.colorsOn ? t("script.toggle.colors.onBody") : t("script.toggle.colors.offBody")}
          onClick={props.onToggleColors}
        />
      </div>

      <button
        type="button"
        class="btn"
        title={t("script.bar.exportTitle", { hotkey: K("Mod+E") })}
        onMouseDown={(e) => e.preventDefault()}
        onClick={props.onExport}
      >
        <Icon name="export" size={14} />
        {t("script.bar.export")}
        <kbd>{K("Mod+E")}</kbd>
      </button>

      <Show when={props.agentAvailable && !props.peek}>
        <button
          type="button"
          class="btn ss-agent-btn"
          classList={{ "is-on": props.agentOn }}
          aria-pressed={props.agentOn}
          title={t("agent.bar.toggle", { name: agentSettings.displayName(), hotkey: K("Mod+L") })}
          aria-label={t("agent.bar.toggle", { name: agentSettings.displayName(), hotkey: K("Mod+L") })}
          onMouseDown={(e) => e.preventDefault()}
          onClick={props.onToggleAgent}
        >
          <AgentAvatar look={agentSettings.look()} size={20} state={avatarStateFor(false)} />
          <span class="ss-agent-name">{agentSettings.displayName()}</span>
          <kbd>{K("Mod+L")}</kbd>
        </button>
      </Show>

      <Show
        when={props.peek}
        fallback={
          <button
            type="button"
            class="btn icon ss-insp-toggle"
            classList={{ "is-on": props.inspectorVisible }}
            aria-pressed={props.inspectorVisible}
            title={t("script.bar.inspectorTitle", { hotkey: K("Mod+Shift+\\") })}
            aria-label={t("script.bar.inspectorTitle", { hotkey: K("Mod+Shift+\\") })}
            onMouseDown={(e) => e.preventDefault()}
            onClick={props.onToggleInspector}
          >
            <Icon name="inspector" />
          </button>
        }
      >
        {(peek) => (
          <div class="ss-peek-acts">
            <button
              type="button"
              class="btn icon"
              title={t("script.peek.expand")}
              aria-label={t("script.peek.expand")}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => peek().onExpand()}
            >
              <Icon name="expand" />
            </button>
            <button
              type="button"
              class="btn icon"
              title={t("script.peek.close", { hotkey: "esc" })}
              aria-label={t("script.peek.closeAria")}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => peek().onClose()}
            >
              <Icon name="x" />
            </button>
          </div>
        )}
      </Show>
    </header>
  );
}

function SaveStatus() {
  const st = () => saveStatusStore.status();
  return (
    <span
      class="ss-saved"
      classList={{ "is-saving": st() === "saving", "is-error": st() === "error" }}
      title={st() === "error" ? t("script.save.errorTitle") : undefined}
      role="status"
    >
      {st() === "saving"
        ? t("script.save.saving")
        : st() === "error"
          ? t("script.save.error")
          : t("script.save.saved")}
    </span>
  );
}

interface TipToggleProps {
  icon: IconName;
  on: boolean;
  disabled?: boolean;
  ariaLabel: string;
  tipTitle: string;
  tipBody: string;
  onClick(): void;
}

const TIP_WIDTH = 232;
const TIP_DELAY_MS = 350;

/** Icon toggle with a dark explanatory tooltip (`.tg-tip`): bold state
 *  line + one sentence on what it does. */
function TipToggle(props: TipToggleProps) {
  const [tip, setTip] = createSignal<{ left: number; arrow: number } | null>(null);
  let btnRef: HTMLButtonElement | undefined;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const place = () => {
    if (!btnRef) return;
    const group = btnRef.parentElement;
    if (!group) return;
    const g = group.getBoundingClientRect();
    const b = btnRef.getBoundingClientRect();
    const center = b.left + b.width / 2 - g.left;
    // Keep the tip inside the window; the arrow keeps pointing at the button.
    const maxLeft = window.innerWidth - g.left - TIP_WIDTH - 8;
    const left = Math.min(center - 23, maxLeft);
    setTip({ left, arrow: Math.max(10, Math.min(TIP_WIDTH - 20, center - left - 5)) });
  };

  const show = (immediate = false) => {
    if (timer) clearTimeout(timer);
    if (immediate) {
      place();
      return;
    }
    timer = setTimeout(place, TIP_DELAY_MS);
  };
  const hide = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    setTip(null);
  };
  onCleanup(hide);

  // Re-place when the state flips while the tip is visible (texts change).
  // Tracks only `props.on`: place() writes a fresh tip object, so reading
  // tip() reactively here would re-trigger this effect in an endless
  // microtask loop (froze the renderer on hover).
  createEffect(
    on(
      () => props.on,
      () => {
        if (untrack(tip)) queueMicrotask(place);
      },
      { defer: true },
    ),
  );

  const style = (): JSX.CSSProperties => {
    const p = tip();
    return p ? { left: `${p.left}px`, "--tip-arrow": `${p.arrow}px` } : {};
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        class="btn icon"
        classList={{ "is-on": props.on, "is-na": !!props.disabled }}
        aria-pressed={props.on}
        aria-disabled={props.disabled ? "true" : undefined}
        aria-label={props.ariaLabel}
        onMouseEnter={() => show()}
        onMouseLeave={hide}
        onFocus={(e) => {
          if (e.currentTarget.matches(":focus-visible")) show(true);
        }}
        onBlur={hide}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          if (!props.disabled) props.onClick();
        }}
      >
        <Icon name={props.icon} />
      </button>
      <Show when={tip()}>
        <div class="tg-tip ss-tip" role="tooltip" style={style()}>
          <b>{props.tipTitle}</b>
          <span>{props.tipBody}</span>
        </div>
      </Show>
    </>
  );
}
