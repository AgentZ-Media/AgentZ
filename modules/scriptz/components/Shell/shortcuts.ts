// Global actions are dispatched by Kit. Editor/list handlers keep ownership of
// their events; their entries here only document the same keyboard contract.
import { K, isModKey } from "@agentz/kit/platform";
import type { ShortcutDef } from "@agentz/kit/shell";
import { t, type TranslationKey } from "../../i18n";
import { navStore } from "../../stores/nav";
import { uiStore } from "../../stores/ui";
import { createScript } from "../Library/actions";
import { stepStage } from "../Script/stageActions";
import { agentUi } from "../../stores/agentUi";
import { agentStore } from "../../stores/agent";

export function getScriptzShortcuts(): ShortcutDef[] {
  const group = (id: "app" | "editor" | "ideas" | "lists") => ({
    id, label: () => t(`prefs.shortcuts.group.${id}`),
  });
  const entry = (
    id: string,
    label: TranslationKey,
    keys: string[],
    groupId: "app" | "editor" | "ideas" | "lists" = "app",
    options: Partial<ShortcutDef> = {},
  ): ShortcutDef => ({
    id: `scriptz.${id}`, label: () => t(label), keys, group: group(groupId),
    contexts: [groupId === "app" ? "shell" : groupId === "editor" ? "editor" : "list"],
    ...options,
  });
  const letter = (key: string, shift = false) => (event: KeyboardEvent) =>
    isModKey(event) && !event.altKey && event.shiftKey === shift && event.key.toLowerCase() === key;
  const hasScript = () => navStore.activeScriptId() !== null;
  return [
    entry("new", "prefs.shortcuts.newScript", ["Mod+N"], "app", {
      matches: letter("n"), run: () => void createScript(),
    }),
    entry("capture", "prefs.shortcuts.capture", ["Mod+I"], "app", {
      matches: letter("i"), run: () => uiStore.openCapture(),
    }),
    entry("history", "prefs.shortcuts.history", ["Mod+[", "Mod+]"], "app", {
      // Match produced brackets, including Alt on German Mac keyboards.
      matches: (event) => isModKey(event) && (event.key === "[" || event.key === "]"),
      run: (event) => { if (event.key === "[") navStore.back(); else navStore.forward(); },
    }),
    entry("inspector", "prefs.shortcuts.inspector", ["Mod+Shift+\\"], "app", {
      matches: (event) => isModKey(event) && (event.key === "|" || (event.key === "\\" && event.shiftKey)),
      enabled: hasScript, run: () => uiStore.toggleInspector(),
    }),
    entry("agent", "agent.shortcut", ["Mod+L"], "app", {
      matches: letter("l"), enabled: () => hasScript() && agentStore.available(), run: () => agentUi.toggleChat(),
    }),
    entry("timeline", "prefs.shortcuts.timeline", ["Mod+J"], "app", {
      matches: letter("j"), enabled: hasScript, run: () => uiStore.toggleTimeline(),
    }),
    entry("stage", "prefs.shortcuts.stage", ["Mod+Alt+ArrowRight", "Mod+Alt+ArrowLeft"], "app", {
      matches: (event) => isModKey(event) && event.altKey && !event.shiftKey && (event.key === "ArrowRight" || event.key === "ArrowLeft"),
      enabled: hasScript,
      run: (event) => { const id = navStore.activeScriptId(); if (id) void stepStage(id, event.key === "ArrowRight" ? 1 : -1); },
    }),
    entry("focus", "prefs.shortcuts.focus", ["Mod+Shift+F"], "app", {
      matches: letter("f", true), enabled: hasScript,
      run: () => { const id = navStore.activeScriptId(); if (id) uiStore.toggleFocus(id); },
    }),
    entry("export", "prefs.shortcuts.export", ["Mod+E"], "app", {
      matches: letter("e"), enabled: hasScript,
      run: () => { const id = navStore.activeScriptId(); if (id) uiStore.openExport(id); },
    }),
    entry("snapshot", "prefs.shortcuts.snapshot", ["Mod+Shift+S"]),
    entry("versions", "prefs.shortcuts.versions", ["Mod+Shift+H"]),
    entry("action", "prefs.shortcuts.action", ["Mod+1"], "editor"),
    entry("character", "prefs.shortcuts.character", ["Mod+2"], "editor"),
    entry("dialog", "prefs.shortcuts.dialog", ["Mod+3"], "editor"),
    entry("parenthetical", "prefs.shortcuts.parenthetical", ["Mod+4"], "editor"),
    entry("parenLive", "prefs.shortcuts.parenLive", ["(", ")"], "editor"),
    entry("picker", "prefs.shortcuts.picker", [], "editor", { displayKeys: () => [t("shortcut.key.tab")] }),
    entry("smartEnter", "prefs.shortcuts.smartEnter", ["Enter"], "editor"),
    entry("format", "prefs.shortcuts.format", ["Mod+B", "Mod+U"], "editor"),
    entry("ideasSelect", "prefs.shortcuts.ideasSelect", ["ArrowUp", "ArrowDown"], "ideas"),
    entry("ideasEdit", "prefs.shortcuts.ideasEdit", ["Enter"], "ideas"),
    entry("ideasConvert", "prefs.shortcuts.ideasConvert", ["Mod+Enter"], "ideas"),
    entry("ideasDelete", "prefs.shortcuts.ideasDelete", ["⌫"], "ideas"),
    entry("ideasFilter", "prefs.shortcuts.ideasFilter", ["/"], "ideas"),
    entry("listsSelectAll", "prefs.shortcuts.listsSelectAll", ["Mod+A"], "lists"),
    entry("listsRange", "prefs.shortcuts.listsRange", [], "lists", {
      displayKeys: () => [t("prefs.shortcuts.shiftClick", { key: K("Shift") })],
    }),
    entry("listsExit", "prefs.shortcuts.listsExit", ["esc"], "lists"),
  ];
}
