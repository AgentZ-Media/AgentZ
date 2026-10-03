import { beforeEach, describe, expect, it, vi } from "vitest";
import { createShellShortcuts, createShortcutRegistry } from "@agentz/kit/shell";
import { applyResolvedLanguage } from "@agentz/kit/i18n";
import { getScriptzShortcuts } from "../shortcuts";
import { navStore } from "../../../stores/nav";
import { uiStore } from "../../../stores/ui";
import { createScript } from "../../Library/actions";
import { stepStage } from "../../Script/stageActions";

vi.mock("../../../stores/nav", () => ({ navStore: {
  activeScriptId: vi.fn((): string | null => "open-document"), back: vi.fn(), forward: vi.fn(),
} }));
vi.mock("../../../stores/ui", () => ({ uiStore: {
  openPalette: vi.fn(), openSettings: vi.fn(), openCapture: vi.fn(), toggleInspector: vi.fn(),
  toggleSidebar: vi.fn(), toggleTimeline: vi.fn(), toggleFocus: vi.fn(), openExport: vi.fn(), anyDialogOpen: vi.fn(() => false),
} }));
vi.mock("../../Library/actions", () => ({ createScript: vi.fn() }));
vi.mock("../../Script/stageActions", () => ({ stepStage: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(navStore.activeScriptId).mockReturnValue("open-document");
  applyResolvedLanguage("de");
});
const press = (key: string, init: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent("keydown", { key, metaKey: true, cancelable: true, ...init });
  createShortcutRegistry(getScriptzShortcuts, () => "editor").handle(event);
  return event;
};

describe("ScriptZ shortcut contribution", () => {
  it("preserves brackets produced using Alt on German keyboards", () => {
    press("[", { altKey: true });
    press("]", { altKey: true });
    expect(navStore.back).toHaveBeenCalledOnce();
    expect(navStore.forward).toHaveBeenCalledOnce();
  });

  it("handles shifted inspector variants and leaves plain Mod+\\ to the shell", () => {
    press("|", { shiftKey: true });
    press("\\", { shiftKey: true });
    press("\\");
    expect(uiStore.toggleInspector).toHaveBeenCalledTimes(2);
    // The sidebar shortcut is a kit shell shortcut since all apps need it.
    expect(uiStore.toggleSidebar).not.toHaveBeenCalled();
  });

  it("keeps product actions available inside the editor", () => {
    press("N");
    press("i");
    press("j");
    press("F", { shiftKey: true });
    press("e");
    press("ArrowRight", { altKey: true });
    press("ArrowLeft", { altKey: true });
    expect(createScript).toHaveBeenCalledOnce();
    expect(uiStore.openCapture).toHaveBeenCalledOnce();
    expect(uiStore.toggleTimeline).toHaveBeenCalledOnce();
    expect(uiStore.toggleFocus).toHaveBeenCalledWith("open-document");
    expect(uiStore.openExport).toHaveBeenCalledWith("open-document");
    expect(stepStage).toHaveBeenNthCalledWith(1, "open-document", 1);
    expect(stepStage).toHaveBeenNthCalledWith(2, "open-document", -1);
  });

  it("does not consume document-only actions on other routes or locally handled keys", () => {
    vi.mocked(navStore.activeScriptId).mockReturnValue(null);
    for (const [key, init] of [
      ["|", {}], ["j", {}], ["e", {}], ["f", { shiftKey: true }],
      ["ArrowRight", { altKey: true }], ["b", {}], ["1", {}], ["s", { shiftKey: true }],
    ] as const) expect(press(key, init).defaultPrevented).toBe(false);
    expect(uiStore.toggleInspector).not.toHaveBeenCalled();
    expect(stepStage).not.toHaveBeenCalled();
  });

  it("retains all 29 documentation rows, translated dynamically", () => {
    const entries = [...createShellShortcuts(uiStore), ...getScriptzShortcuts()];
    expect(entries).toHaveLength(29);
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(29);
    expect(new Set(entries.map((entry) => entry.group.id))).toEqual(new Set(["app", "editor", "ideas", "lists"]));
    const capture = entries.find((entry) => entry.id === "scriptz.capture")!;
    expect(capture.label()).toBe("Idee erfassen, auch im Fokus");
    applyResolvedLanguage("en");
    expect(capture.label()).toBe("Capture an idea, also in focus mode");
  });
});
