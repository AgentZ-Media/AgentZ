import { For } from "solid-js";
import { K } from "@agentz/kit/platform";
import { t } from "../../../i18n";
import { SectionHead } from "@agentz/kit/ui";


interface ShortcutGroup {
  title: string;
  items: Array<{ keys: string[]; desc: string }>;
}

// Platform-aware via K(): "⌘N" on macOS, "Ctrl+N" elsewhere. Built per
// render so a language switch updates the descriptions immediately.
// Source of truth: docs/redesign/umsetzung.md §7.
function groups(): ShortcutGroup[] {
  return [
    {
      title: t("prefs.shortcuts.group.app"),
      items: [
        { keys: [K("Mod+K")], desc: t("prefs.shortcuts.palette") },
        { keys: [K("Mod+N")], desc: t("prefs.shortcuts.newScript") },
        { keys: [K("Mod+I")], desc: t("prefs.shortcuts.capture") },
        { keys: [K("Mod+["), K("Mod+]")], desc: t("prefs.shortcuts.history") },
        { keys: [K("Mod+\\")], desc: t("prefs.shortcuts.sidebar") },
        { keys: [K("Mod+Shift+\\")], desc: t("prefs.shortcuts.inspector") },
        { keys: [K("Mod+J")], desc: t("prefs.shortcuts.timeline") },
        { keys: [K("Mod+Alt+ArrowRight"), K("Mod+Alt+ArrowLeft")], desc: t("prefs.shortcuts.stage") },
        { keys: [K("Mod+Shift+F")], desc: t("prefs.shortcuts.focus") },
        { keys: [K("Mod+E")], desc: t("prefs.shortcuts.export") },
        { keys: [K("Mod+,")], desc: t("prefs.shortcuts.settings") },
        { keys: [K("Mod+Shift+S")], desc: t("prefs.shortcuts.snapshot") },
        { keys: [K("Mod+Shift+H")], desc: t("prefs.shortcuts.versions") },
      ],
    },
    {
      title: t("prefs.shortcuts.group.editor"),
      items: [
        { keys: [K("Mod+1")], desc: t("prefs.shortcuts.action") },
        { keys: [K("Mod+2")], desc: t("prefs.shortcuts.character") },
        { keys: [K("Mod+3")], desc: t("prefs.shortcuts.dialog") },
        { keys: [K("Mod+4")], desc: t("prefs.shortcuts.parenthetical") },
        { keys: ["(", ")"], desc: t("prefs.shortcuts.parenLive") },
        { keys: [t("shortcut.key.tab")], desc: t("prefs.shortcuts.picker") },
        { keys: [K("Enter")], desc: t("prefs.shortcuts.smartEnter") },
        { keys: [K("Mod+B"), K("Mod+U")], desc: t("prefs.shortcuts.format") },
      ],
    },
    {
      title: t("prefs.shortcuts.group.ideas"),
      items: [
        { keys: ["↑", "↓"], desc: t("prefs.shortcuts.ideasSelect") },
        { keys: [K("Enter")], desc: t("prefs.shortcuts.ideasEdit") },
        { keys: [K("Mod+Enter")], desc: t("prefs.shortcuts.ideasConvert") },
        { keys: ["⌫"], desc: t("prefs.shortcuts.ideasDelete") },
        { keys: ["/"], desc: t("prefs.shortcuts.ideasFilter") },
      ],
    },
    {
      title: t("prefs.shortcuts.group.lists"),
      items: [
        { keys: [K("Mod+A")], desc: t("prefs.shortcuts.listsSelectAll") },
        { keys: [t("prefs.shortcuts.shiftClick", { key: K("Shift") })], desc: t("prefs.shortcuts.listsRange") },
        { keys: ["esc"], desc: t("prefs.shortcuts.listsExit") },
      ],
    },
  ];
}

export function SettingsShortcuts(props: { onClose(): void }) {
  return (
    <>
      <SectionHead title={t("prefs.shortcuts.title")} sub={t("prefs.shortcuts.sub")} onClose={props.onClose} />
      <For each={groups()}>
        {(g) => (
          <section class="set-keys">
            <h4>{g.title}</h4>
            <For each={g.items}>
              {(it) => (
                <div class="set-key">
                  <span>{it.desc}</span>
                  <span class="set-key-k">
                    <For each={it.keys}>{(k) => <kbd>{k}</kbd>}</For>
                  </span>
                </div>
              )}
            </For>
          </section>
        )}
      </For>
    </>
  );
}
