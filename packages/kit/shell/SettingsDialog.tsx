import { For, Show, createEffect, createMemo } from "solid-js";
import { Dynamic } from "solid-js/web";
import { getUpdatesStore } from "../platform";
import { t } from "../i18n";
import { DialogFrame, Icon } from "../ui";
import { SettingsAppearance } from "./settings/SettingsAppearance";
import { SettingsUpdates } from "./settings/SettingsUpdates";
import { SettingsAbout } from "./settings/SettingsAbout";
import { SettingsShortcuts } from "./settings/SettingsShortcuts";
import { AccountSettings } from "../account/AccountSettings";
import type { AppModule, KitSectionId, ModuleSettings, SettingsSection, ShellControls, ShortcutDef } from "./types";
import "./settings/SettingsDialog.css";

export interface SettingsDialogProps {
  module: Pick<AppModule, "name" | "logo" | "about">;
  settings?: ModuleSettings;
  shell: ShellControls;
  shortcuts: readonly ShortcutDef[];
  hasOnboarding?: boolean;
  /** Shows the account section (the host has a cloud backend). */
  account?: boolean;
  /** Offers "Report a problem" (the host has a cloud backend). */
  report?: boolean;
}
const KIT_IDS = new Set(["account", "appearance", "shortcuts", "updates", "about"]);

/** Shared preferences frame, composed from neutral and product-owned sections. */
export function SettingsDialog(props: SettingsDialogProps) {
  const close = () => props.shell.closeSettings();
  const extensions = (id: KitSectionId) => <For each={props.settings?.extend?.[id]}>{(component) => <Dynamic component={component} />}</For>;
  const updates = () => getUpdatesStore();
  const items = createMemo(() => {
    const product = props.settings?.sections ?? [];
    const ids = new Set<string>();
    for (const section of product) {
      if (KIT_IDS.has(section.id) || ids.has(section.id)) throw new Error(`Duplicate settings section: ${section.id}`);
      ids.add(section.id);
    }
    const sections: Array<SettingsSection & { sep?: boolean }> = [
      ...(props.account ? [{ id: "account", icon: "user" as const, label: () => t("prefs.account.title"), component: () => <><AccountSettings appName={props.module.name} onClose={close} />{extensions("account")}</> }] : []),
      { id: "appearance", icon: "sun", label: () => t("prefs.appearance.title"), component: () => <SettingsAppearance appName={props.module.name} onClose={close} extension={extensions("appearance")} report={props.report} /> },
      ...product,
      { id: "shortcuts", icon: "keyboard", label: () => t("prefs.shortcuts.title"), component: () => <><SettingsShortcuts onClose={close} shortcuts={props.shortcuts} />{extensions("shortcuts")}</> },
    ];
    if (updates()) sections.push({ id: "updates", icon: "refresh", sep: true, label: () => t("prefs.updates.title"), component: () => <><SettingsUpdates updates={updates()!} appName={props.module.name} releasesUrl={props.module.about.releasesUrl} nightlyReleasesUrl={props.module.about.nightlyReleasesUrl} onClose={close} />{extensions("updates")}</> });
    sections.push({ id: "about", icon: "info", sep: true, label: () => t("prefs.about.heading", { appName: props.module.name }), component: () => <><SettingsAbout module={props.module} onClose={close} onShowOnboarding={props.hasOnboarding ? () => { close(); props.shell.openOnboarding(); } : undefined} onReport={props.report ? () => { close(); props.shell.openReport(); } : undefined} />{extensions("about")}</> });
    return sections;
  });
  const section = () => props.shell.settingsSection();
  const selected = () => items().find((item) => item.id === section());
  createEffect(() => { if (!selected()) props.shell.setSettingsSection("appearance"); });
  let body: HTMLDivElement | undefined;
  createEffect(() => { void section(); body?.scrollTo?.({ top: 0 }); });
  const onNavKey = (event: KeyboardEvent) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const list = items();
    const index = list.findIndex((item) => item.id === section());
    const next = list[(index + (event.key === "ArrowDown" ? 1 : -1) + list.length) % list.length];
    props.shell.setSettingsSection(next.id);
    const buttons = (event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>("[data-sec]");
    Array.from(buttons).find((button) => button.dataset.sec === next.id)?.focus();
  };
  const updateReady = () => updates()?.stage() === "available" || updates()?.stage() === "ready";
  return <DialogFrame open={props.shell.settingsOpen()} onClose={close} label={t("prefs.title")} class="set">
    <nav class="set-nav" aria-label={t("prefs.title")} onKeyDown={onNavKey}>
      <div class="set-title">{t("prefs.title")}</div>
      <For each={items()}>{(item, index) => <>
        <Show when={item.sep && !items()[index() - 1]?.sep}><div class="set-sep" /></Show>
        <button type="button" class="set-it" classList={{ on: section() === item.id }} aria-current={section() === item.id ? "page" : undefined} data-sec={item.id} data-autofocus={section() === item.id ? "" : undefined} onClick={() => props.shell.setSettingsSection(item.id)}>
          <Icon name={item.icon} size={14} /><span>{item.label()}</span>
          <Show when={item.id === "updates" && updateReady()}><span class="set-badge" aria-label={t("prefs.updates.badge")}>1</span></Show>
        </button>
      </>}</For>
    </nav>
    <div class="set-body" ref={body}><Dynamic component={selected()?.component} onClose={close} /></div>
  </DialogFrame>;
}
