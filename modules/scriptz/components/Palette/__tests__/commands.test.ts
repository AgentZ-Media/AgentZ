import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyResolvedLanguage } from "@agentz/kit/i18n";
import { shellUi } from "@agentz/kit/stores";
import { createScriptzCommands } from "../commands";

const data = vi.hoisted(() => ({
  scripts: [] as { id: string; title: string; updated_at: number; folder_id: null; status: "writing" }[],
  ideas: [] as { id: string; title: string; notes: string; used_at: number | null; folder_id: null }[],
  recent: [] as { scriptId: string; title: string; openedAt: number }[],
  active: null as string | null,
  search: vi.fn(),
}));
vi.mock("../../../lib/api", () => ({ api: { globalSearch: data.search } }));
vi.mock("../../../stores/nav", () => ({ navStore: {
  activeScriptId: () => data.active,
  recent: () => data.recent,
} }));
vi.mock("../../../stores/ui", () => ({ uiStore: {} }));
vi.mock("../../../stores/ideas", () => ({ ideasStore: { ideas: () => data.ideas } }));
vi.mock("../../Shell/libraryData", () => ({ library: {
  scripts: () => data.scripts,
  script: (id: string) => data.scripts.find((entry) => entry.id === id),
  folder: () => undefined,
} }));
vi.mock("../../Library/actions", () => ({ openNewScript: vi.fn(), importScriptzFile: vi.fn() }));
vi.mock("../../Script/stageActions", () => ({ setStageWithUndo: vi.fn() }));

const entry = (id: string, title: string, updated_at = 0) => ({ id, title, updated_at, folder_id: null, status: "writing" as const });
const signal = () => new AbortController().signal;

beforeEach(() => {
  data.scripts = [];
  data.ideas = [];
  data.recent = [];
  data.active = null;
  data.search.mockReset().mockResolvedValue([]);
  applyResolvedLanguage("en");
});

describe("product command provider", () => {
  it("keeps title prefixes ahead of substring matches and enriches without duplicates", async () => {
    data.scripts = [entry("substring", "My zebra", 30), entry("prefix-old", "Zebra old", 10), entry("prefix-new", "Zebra new", 20), entry("body", "Other title")];
    data.search.mockResolvedValue([
      { id: "prefix-new", title: "Zebra new", snippet: "<mark>zebra</mark>" },
      { id: "gone", title: "Archived", snippet: "<mark>zebra</mark>" },
      { id: "body", title: "Other title", snippet: "<mark>zebra</mark> body" },
    ]);
    const provider = createScriptzCommands(shellUi);
    expect(provider.immediate!("zebra").map((item) => item.id)).toEqual(["script:prefix-new", "script:prefix-old", "script:substring"]);
    const result = await provider("zebra", signal());
    expect(result.map((item) => item.id)).toEqual(["script:prefix-new", "script:prefix-old", "script:substring", "hit:body"]);
    expect(result.at(-1)?.description).toBeTypeOf("function");
    expect(data.search).toHaveBeenCalledWith("zebra", 30);
  });

  it("leads with matching commands and excludes already-used ideas", () => {
    data.scripts = [entry("title", "My new idea")];
    data.ideas = [
      { id: "fresh", title: "New idea here", notes: "", used_at: null, folder_id: null },
      { id: "used", title: "New idea used", notes: "", used_at: 1, folder_id: null },
    ];
    const result = createScriptzCommands(shellUi).immediate!("new idea");
    expect(result.map((item) => item.id)).toEqual(["cmd:new-idea", "script:title", "idea:fresh"]);
  });

  it("skips SQL for short or aborted queries and keeps local matches on SQL failure", async () => {
    data.scripts = [entry("title", "Zebra")];
    const provider = createScriptzCommands(shellUi);
    expect((await provider("z", signal())).map((item) => item.id)).toContain("script:title");
    expect(data.search).not.toHaveBeenCalled();
    const controller = new AbortController();
    controller.abort();
    expect(await provider("zebra", controller.signal)).toEqual([]);
    expect(data.search).not.toHaveBeenCalled();
    data.search.mockRejectedValue(new Error("FTS unavailable"));
    expect((await provider("zebra", signal())).map((item) => item.id)).toEqual(["script:title"]);
  });
});
