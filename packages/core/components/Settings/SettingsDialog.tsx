import { For, Match, Show, Switch, createEffect, createMemo } from "solid-js";
import { getUpdatesStore } from "../../lib/updates";
import { uiStore, type SettingsSection } from "../../stores/ui";
import { t } from "../../i18n";
import { Icon, type IconName } from "../Common/Icon";
import { DialogFrame } from "./DialogFrame";
import { SettingsAppearance } from "./sections/SettingsAppearance";
import { SettingsWriting } from "./sections/SettingsWriting";
import { SettingsFolders } from "./sections/SettingsFolders";
import { SettingsCharacters } from "./sections/SettingsCharacters";
import { SettingsShortcuts } from "./sections/SettingsShortcuts";
import { SettingsUpdates } from "./sections/SettingsUpdates";
import { SettingsAbout } from "./sections/SettingsAbout";
import "./SettingsDialog.css";

interface NavItem {
  id: SettingsSection;
  icon: IconName;
  label: () => string;
  /** Separator above this entry. */
  sep?: boolean;
}

const NAV: NavItem[] = [
  { id: "appearance", icon: "sun", label: () => t("prefs.appearance.title") },
  { id: "writing", icon: "pen", label: () => t("prefs.writing.title") },
  { id: "folders", icon: "folder", label: () => t("prefs.folders.title") },
  { id: "characters", icon: "users", label: () => t("prefs.characters.title") },
  { id: "shortcuts", icon: "keyboard", label: () => t("prefs.shortcuts.title") },
  { id: "updates", icon: "refresh", label: () => t("prefs.updates.title") },
  { id: "about", icon: "info", label: () => t("prefs.about.title") },
];

/** Settings (⌘,). Parameterless: open state and section come from
 *  `uiStore.settingsOpen()` / `uiStore.settingsSection()`. "Updates" only
 *  exists where the host registered an updates store (desktop). */
export function SettingsDialog() {
  const updates = () => getUpdatesStore();
  const items = createMemo(() => NAV.filter((n) => n.id !== "updates" || updates() !== null));
  const section = () => uiStore.settingsSection();
  const updateReady = () => {
    const stage = updates()?.stage();
    return stage === "available" || stage === "ready";
  };

  // A section that doesn't exist on this platform falls back to the first.
  createEffect(() => {
    if (!items().some((n) => n.id === section())) uiStore.setSettingsSection("appearance");
  });

  const close = () => uiStore.closeSettings();
  let body: HTMLDivElement | undefined;
  createEffect(() => {
    void section();
    body?.scrollTo({ top: 0 });
  });

  const onNavKey = (e: KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const list = items();
    const i = list.findIndex((n) => n.id === section());
    const next = list[(i + (e.key === "ArrowDown" ? 1 : -1) + list.length) % list.length];
    uiStore.setSettingsSection(next.id);
    (e.currentTarget as HTMLElement).querySelector<HTMLElement>(`[data-sec="${next.id}"]`)?.focus();
  };

  return (
    <DialogFrame open={uiStore.settingsOpen()} onClose={close} label={t("prefs.title")} class="set">
      <nav class="set-nav" aria-label={t("prefs.title")} onKeyDown={onNavKey}>
        <div class="set-title">{t("prefs.title")}</div>
        <For each={items()}>
          {(item) => (
            <>
              <Show when={item.sep}>
                <div class="set-sep" />
              </Show>
              <button
                type="button"
                class="set-it"
                classList={{ on: section() === item.id }}
                aria-current={section() === item.id ? "page" : undefined}
                data-sec={item.id}
                data-autofocus={section() === item.id ? "" : undefined}
                onClick={() => uiStore.setSettingsSection(item.id)}
              >
                <Icon name={item.icon} size={14} />
                <span>{item.label()}</span>
                <Show when={item.id === "updates" && updateReady()}>
                  <span class="set-badge" aria-label={t("prefs.updates.badge")}>
                    1
                  </span>
                </Show>
              </button>
            </>
          )}
        </For>
      </nav>
      <div class="set-body" ref={body}>
        <Switch>
          <Match when={section() === "appearance"}>
            <SettingsAppearance onClose={close} />
          </Match>
          <Match when={section() === "writing"}>
            <SettingsWriting onClose={close} />
          </Match>
          <Match when={section() === "folders"}>
            <SettingsFolders onClose={close} />
          </Match>
          <Match when={section() === "characters"}>
            <SettingsCharacters onClose={close} />
          </Match>
          <Match when={section() === "shortcuts"}>
            <SettingsShortcuts onClose={close} />
          </Match>
          <Match when={section() === "updates" && updates()}>
            {(u) => <SettingsUpdates updates={u()} onClose={close} />}
          </Match>
          <Match when={section() === "about"}>
            <SettingsAbout
              onClose={close}
              onShowOnboarding={() => {
                uiStore.closeSettings();
                uiStore.openOnboarding();
              }}
            />
          </Match>
        </Switch>
      </div>
    </DialogFrame>
  );
}

export default SettingsDialog;
