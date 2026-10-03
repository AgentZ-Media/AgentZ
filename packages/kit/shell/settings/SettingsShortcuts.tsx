import { For, createMemo } from "solid-js";
import { K } from "../../platform";
import { t } from "../../i18n";
import { SectionHead } from "../../ui";
import type { ShortcutDef } from "../types";

export function SettingsShortcuts(props: { onClose(): void; shortcuts: readonly ShortcutDef[] }) {
  const groups = createMemo(() => {
    const entries = new Map<string, { title: string; items: ShortcutDef[] }>();
    for (const shortcut of props.shortcuts) {
      let group = entries.get(shortcut.group.id);
      if (!group) { group = { title: shortcut.group.label(), items: [] }; entries.set(shortcut.group.id, group); }
      group.items.push(shortcut);
    }
    return [...entries.values()];
  });
  return <>
    <SectionHead title={t("prefs.shortcuts.title")} sub={t("prefs.shortcuts.sub")} onClose={props.onClose} />
    <For each={groups()}>{(group) => <section class="set-keys"><h4>{group.title}</h4>
      <For each={group.items}>{(item) => <div class="set-key"><span>{item.label()}</span><span class="set-key-k">
        <For each={item.displayKeys?.() ?? item.keys.map(K)}>{(key) => <kbd>{key}</kbd>}</For>
      </span></div>}</For>
    </section>}</For>
  </>;
}
