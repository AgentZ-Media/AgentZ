import { For } from "solid-js";
import { K } from "../../../lib/keys";
import { t } from "../../../i18n";

interface ShortcutGroup {
  title: string;
  items: Array<{ keys: string; desc: string }>;
}

// Shortcut display is platform-aware: K() renders "⌘N" on macOS and
// "Ctrl+N" on Windows/Linux. Per-call build so language switches
// update the descriptions immediately.
function shortcutGroups(): ShortcutGroup[] {
  return [
    {
      title: t("shortcuts.group.general"),
      items: [
        { keys: K("Mod+N"), desc: t("shortcut.newScript") },
        { keys: K("Mod+T"), desc: t("shortcut.toOverview") },
        { keys: K("Mod+W"), desc: t("shortcut.closeTab") },
        { keys: K("Mod+K"), desc: t("shortcut.openSearch") },
        { keys: K("Mod+F"), desc: t("shortcut.focusSearch") },
        { keys: K("Mod+,"), desc: t("shortcut.openSettings") },
        { keys: K("Mod+I"), desc: t("shortcut.captureIdea") },
        { keys: `${K("Mod+0")}-${K("Mod+9")}`, desc: t("shortcut.tabByIndex") },
        { keys: `${K("Mod+Alt+ArrowLeft")} / ${K("Mod+Alt+ArrowRight")}`, desc: t("shortcut.cycleTabs") },
      ],
    },
    {
      title: t("shortcuts.group.editor"),
      items: [
        { keys: t("shortcut.key.tab"), desc: t("shortcut.blockPicker") },
        { keys: K("Mod+1"), desc: t("shortcut.blockAction") },
        { keys: K("Mod+2"), desc: t("shortcut.blockCharacter") },
        { keys: K("Mod+3"), desc: t("shortcut.blockDialog") },
        { keys: K("Enter"), desc: t("shortcut.smartEnter") },
        { keys: `${K("Mod+B")} / ${K("Mod+U")}`, desc: t("shortcut.formatting") },
        { keys: K("Mod+E"), desc: t("shortcut.exportScript") },
        { keys: K("Mod+Shift+F"), desc: t("shortcut.focusMode") },
        { keys: K("Mod+Shift+S"), desc: t("shortcut.snapshotCreate") },
        { keys: K("Mod+Shift+H"), desc: t("shortcut.snapshotHistory") },
      ],
    },
  ];
}

export function SettingsShortcuts() {
  return (
    <>
      <h3>{t("settings.section.shortcuts")}</h3>
      <div class="settings-pane-sub">
        {t("settings.shortcuts.sub")}
      </div>
      <For each={shortcutGroups()}>
        {(group) => (
          <div class="settings-shortcuts-group">
            <div class="settings-shortcuts-title">{group.title}</div>
            <ul class="settings-shortcuts-list">
              <For each={group.items}>
                {(it) => (
                  <li class="settings-shortcut-row">
                    <span class="settings-shortcut-keys">
                      <span class="kbd kbd-inline">{it.keys}</span>
                    </span>
                    <span class="settings-shortcut-desc">{it.desc}</span>
                  </li>
                )}
              </For>
            </ul>
          </div>
        )}
      </For>
    </>
  );
}
