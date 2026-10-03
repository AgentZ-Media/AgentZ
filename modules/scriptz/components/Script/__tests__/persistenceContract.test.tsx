// Exercise persisted quick-mode and onboarding choices through their real
// controls. The editor itself is unrelated to these storage contracts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { setStorageAdapter, type StorageAdapter } from "../../../lib/storage";
import { settingsStore } from "../../../stores/settings";
import { uiStore } from "../../../stores/ui";
import { t } from "../../../i18n";
import { ScriptScreen } from "../ScriptScreen";
import { Onboarding } from "../../Onboarding/Onboarding";
import type { Script } from "../../../lib/types";

vi.mock("../../Editor/Editor", () => ({ Editor: () => null }));
vi.mock("../../Editor/SnapshotsDialog", () => ({ SnapshotsDialog: () => null }));
vi.mock("../Inspector", () => ({ Inspector: () => null }));

const script = (id: string): Script => ({
  id, title: `Contract ${id}`, content_json: '{"root":{"children":[]}}',
  highlighting_enabled: 0, created_at: 1, updated_at: 1, archived_at: null,
  page_count: 1, word_count: 0, dialog_word_count: 0, direction_block_count: 0,
  characters: [{ name: "ANNA", color: "var(--accent)" }, { name: "BEN", color: "var(--muted)" }],
  folder_id: null, status: "writing", status_changed_at: null,
});

let state: Map<string, string>;
let getAppState: ReturnType<typeof vi.fn<(key: string) => Promise<string | null>>>;
let setAppState: ReturnType<typeof vi.fn<(key: string, value: string) => Promise<void>>>;

beforeEach(async () => {
  state = new Map();
  getAppState = vi.fn(async (key: string) => state.get(key) ?? null);
  setAppState = vi.fn(async (key: string, value: string) => { state.set(key, value); });
  const adapter: Partial<StorageAdapter> = {
    getAppState, setAppState, getScript: async (id) => script(id),
    listFolders: async () => [], listSnapshots: async () => [],
    setSetting: async () => {},
  };
  setStorageAdapter(new Proxy(adapter as StorageAdapter, {
    get(target, prop) {
      const value = Reflect.get(target, prop);
      if (value !== undefined) return value;
      throw new Error(`Unexpected storage call in UI persistence contract: ${String(prop)}`);
    },
  }));
  await settingsStore.setQuickModeAutoEnable(true);
  uiStore.clearFocus();
  uiStore.closeOnboarding();
});
afterEach(() => {
  cleanup();
  uiStore.closeOnboarding();
});

describe("component persistence contracts", () => {
  it("restores each script's manual quick-mode override and writes literal 1/0", async () => {
    state.set("script.alpha.quick_mode", "0");
    state.set("script.beta.quick_mode", "1");
    const [id, setId] = createSignal("alpha");
    const view = render(() => <ScriptScreen scriptId={id()} />);
    const quick = await view.findByRole("button", { name: t("script.toggle.quick.aria") });
    await waitFor(() => expect(quick.getAttribute("aria-pressed")).toBe("false"));
    fireEvent.click(quick);
    expect(setAppState).toHaveBeenCalledWith("script.alpha.quick_mode", "1");
    fireEvent.click(quick);
    expect(state.get("script.alpha.quick_mode")).toBe("0");
    setId("beta");
    await waitFor(() => expect(quick.getAttribute("aria-pressed")).toBe("true"));
    expect(getAppState.mock.calls).toEqual([["script.alpha.quick_mode"], ["script.beta.quick_mode"]]);
    expect([...state.keys()].sort()).toEqual(["script.alpha.quick_mode", "script.beta.quick_mode"]);
  });

  it("marks skipped onboarding complete using its existing database key", async () => {
    uiStore.openOnboarding();
    render(() => <Onboarding />);
    fireEvent.click(screen.getByRole("button", { name: t("onb.skip") }));
    await waitFor(() => expect(uiStore.onboardingOpen()).toBe(false));
    expect(setAppState.mock.calls).toEqual([["onboarding_completed_v1", "1"]]);
  });
});
