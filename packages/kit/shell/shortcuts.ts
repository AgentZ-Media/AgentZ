import type { Accessor } from "solid-js";
import { t } from "../i18n";
import { isModKey } from "../platform";
import type { ShellControls, ShortcutContext, ShortcutDef } from "./types";

/** Dispatch in the bubble phase so focused controls can claim their own keys.
 * Shell actions also work inside an editor/list; a modal owns its keyboard. */
export function createShortcutRegistry(
  definitions: Accessor<readonly ShortcutDef[]>,
  context: Accessor<ShortcutContext> = () => "shell",
  isDialogOpen: Accessor<boolean> = () => false,
) {
  const handle = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || event.isComposing) return;
    const activeContext = isDialogOpen() ? "dialog" : context();
    for (const definition of definitions()) {
      if (!definition.run || !definition.matches || definition.enabled?.() === false) continue;
      const inContext = definition.contexts.includes(activeContext)
        || (activeContext !== "dialog" && definition.contexts.includes("shell"));
      if (!inContext || !definition.matches(event)) continue;
      event.preventDefault();
      definition.run(event);
      return;
    }
  };
  let listening = false;
  const stop = () => {
    if (!listening) return;
    window.removeEventListener("keydown", handle);
    listening = false;
  };
  return {
    handle,
    start(): () => void {
      if (!listening && typeof window !== "undefined") {
        window.addEventListener("keydown", handle);
        listening = true;
      }
      return stop;
    },
  };
}

export function createShellShortcuts(
  shell: Pick<ShellControls, "openPalette" | "openSettings" | "toggleSidebar">,
): ShortcutDef[] {
  const group = { id: "app", label: () => t("prefs.shortcuts.group.app") };
  return [
    {
      id: "shell.palette", label: () => t("prefs.shortcuts.palette"), group,
      keys: ["Mod+K"], contexts: ["shell"],
      matches: (event) => isModKey(event) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "k",
      run: () => shell.openPalette(),
    },
    {
      id: "shell.settings", label: () => t("prefs.shortcuts.settings"), group,
      keys: ["Mod+,"], contexts: ["shell"],
      matches: (event) => isModKey(event) && !event.shiftKey && !event.altKey && event.key === ",",
      run: () => shell.openSettings(),
    },
    {
      id: "shell.sidebar", label: () => t("prefs.shortcuts.sidebar"), group,
      keys: ["Mod+\\"], contexts: ["shell"],
      matches: (event) => isModKey(event) && !event.shiftKey && event.key === "\\",
      run: () => shell.toggleSidebar(),
    },
  ];
}
