// Agent mode UI: draft links in the chat (live and finished), idea boards
// with picking and saving, hidden quick replies and the draft panel with
// versions, change marks and the finish button.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSignal } from "solid-js";
import { createStore } from "solid-js/store";
import { cleanup, fireEvent, render } from "@solidjs/testing-library";
import { applyResolvedLanguage } from "@agentz/kit/i18n";
import type { ChatItem } from "../../../lib/agent/chats";
import { draftStates } from "../../../lib/agent/chats";
import type { ChatSession } from "../../../stores/agent";
import type { ItemContext } from "../ChatItems";
import { ChatList, createDraftIndex } from "../ChatList";
import { DraftPanel } from "../../AgentMode/DraftPanel";
import { folderLookup } from "../labels";

afterEach(() => cleanup());
beforeEach(() => applyResolvedLanguage("en"));

function fakeSession(initial: ChatItem[], running = false) {
  const [state, setState] = createStore<{ items: ChatItem[] }>({ items: initial });
  const [isRunning, setRunning] = createSignal(running);
  const session = {
    get items() { return state.items; },
    running: isRunning,
    ready: () => true,
    chatId: () => "chat-1",
    kind: () => "session" as const,
    scriptId: () => null,
    title: () => "Session",
    folderId: () => null,
    setFolder: vi.fn(),
    togglePick: vi.fn(),
    saveIdeas: vi.fn(async () => 1),
    undoSavedIdeas: vi.fn(async () => {}),
    discardDraft: vi.fn(),
    stop: vi.fn(async () => {}),
  };
  return { session: session as unknown as ChatSession & typeof session, setState, setRunning };
}

function renderList(items: ChatItem[], running = false) {
  const { session, setState } = fakeSession(items, running);
  const showDraft = vi.fn();
  const send = vi.fn();
  const lookup = folderLookup([], () => null);
  const view = render(() => {
    const index = createDraftIndex(() => session.items);
    const ctx: ItemContext = {
      session,
      lookup,
      colorOf: () => "var(--muted)",
      canApply: false,
      surface: "agent",
      draftRef: (id) => index().get(id),
      showDraft,
      send,
    };
    return <ChatList items={session.items} running={session.running()} lookup={lookup} ctx={ctx} />;
  });
  return { view, session, setState, showDraft, send };
}

describe("agent mode chat", () => {
  it("shows a written draft as a card next to the reply text", () => {
    const { view, showDraft } = renderList([
      { kind: "user", id: "u1", text: "Write number 2" },
      { kind: "assistant", id: "m1", text: 'Here it is.\n:::draft id="maus" title="The Mouse"\nACTION: An office.\nTIMO: Hello.\n:::\nAbout 0:10.' },
    ]);
    const card = view.container.querySelector(".ag-dlink");
    expect(card?.textContent).toContain("The Mouse");
    expect(card?.textContent).toContain("Version 1");
    expect(view.container.textContent).toContain("Here it is.");
    expect(view.container.textContent).toContain("About 0:10.");
    // The script text itself stays out of the chat bubble.
    expect(view.container.textContent).not.toContain("An office.");
    fireEvent.click(card!.querySelector("button")!);
    expect(showDraft).toHaveBeenCalledWith("maus");
  });

  it("marks a draft that is still streaming", () => {
    const { view } = renderList([
      { kind: "assistant", id: "m1", text: ':::draft id="a" title="Live"\nACTION: One.\nTIMO: Two', streaming: true },
    ], true);
    const card = view.container.querySelector(".ag-dlink");
    expect(card?.classList.contains("is-live")).toBe(true);
    expect(card?.textContent).toContain("writing");
  });

  it("picks idea cards and saves the picked ones", async () => {
    const board: ChatItem = {
      kind: "ideas", id: "b1", folderId: null, picked: [1], savedIds: [null, null, "idea-3"],
      ideas: [
        { title: "Camera duty", premise: "A", hook: "", characters: ["TIMO"], seconds: 50 },
        { title: "The Mouse", premise: "B", hook: "Your mouse has not moved.", characters: [], seconds: null },
        { title: "Always green", premise: "C", hook: "", characters: [], seconds: null },
      ],
    };
    const { view, session, send } = renderList([board]);
    const cards = view.container.querySelectorAll(".am-icard");
    expect(cards).toHaveLength(3);
    fireEvent.click(cards[0]);
    expect(session.togglePick).toHaveBeenCalledWith("b1", 0);
    // A saved card is not pickable.
    fireEvent.click(cards[2]);
    expect(session.togglePick).toHaveBeenCalledTimes(1);
    const bar = view.container.querySelector(".am-bbar")!;
    expect(bar.textContent).toContain("Save to ideas");
    fireEvent.click([...bar.querySelectorAll("button")].find((b) => b.textContent?.includes("Save to ideas"))!);
    expect(session.saveIdeas).toHaveBeenCalledWith("b1", [1]);
    fireEvent.click([...bar.querySelectorAll("button")].find((b) => b.textContent?.includes("Script from number 2"))!);
    expect(send).toHaveBeenCalledWith(expect.stringContaining("number 2"));
  });

  it("keeps quick replies out of the message list", () => {
    const { view } = renderList([
      { kind: "assistant", id: "m1", text: "Done." },
      { kind: "replies", id: "r1", replies: ["Make it shorter"] },
    ]);
    expect(view.container.textContent).not.toContain("Make it shorter");
  });
});

describe("agent mode draft panel", () => {
  const items: ChatItem[] = [
    { kind: "assistant", id: "m1", text: ':::draft id="maus" title="The Mouse"\nACTION: An office.\nAXEL: No movement, no hours.\n:::' },
    { kind: "assistant", id: "m2", text: ':::draft id="maus"\nACTION: An office.\nAXEL: No movement, no pay.\nTIMO: He is on it.\n:::' },
  ];

  function renderPanel(list: ChatItem[], running = false) {
    const { session } = fakeSession(list, running);
    const onFinish = vi.fn();
    const view = render(() => {
      const states = draftStates(session.items);
      return (
        <DraftPanel
          session={session}
          drafts={states}
          selected={states[0]}
          onSelect={() => {}}
          onClose={() => {}}
          onQuote={() => {}}
          onFinish={onFinish}
          colorOf={() => "var(--muted)"}
        />
      );
    });
    return { view, onFinish, session };
  }

  it("shows the newest version with its changes and finishes it", () => {
    const { view, onFinish } = renderPanel(items);
    const blocks = [...view.container.querySelectorAll(".am-b")];
    expect(blocks.map((b) => b.textContent)).toEqual(["An office.", "AXEL", "No movement, no pay.", "TIMO", "He is on it."]);
    expect(blocks.filter((b) => b.classList.contains("is-chg")).map((b) => b.textContent)).toEqual(["No movement, no pay.", "He is on it."]);
    expect(view.container.querySelector(".am-vseg")?.textContent).toBe("v1v2");
    const finish = view.container.querySelector<HTMLButtonElement>(".am-finish")!;
    expect(finish.disabled).toBe(false);
    fireEvent.click(finish);
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(onFinish.mock.calls[0][1].id).toBe("m2#0");
  });

  it("switches to an older version", () => {
    const { view } = renderPanel(items);
    fireEvent.click(view.container.querySelectorAll(".am-vseg button")[0]);
    expect([...view.container.querySelectorAll(".am-b")].map((b) => b.textContent)).toContain("No movement, no hours.");
    expect(view.container.textContent).toContain("Older version 1");
  });

  it("finishes the version on screen with Mod+Enter, not the newest", () => {
    const { view, onFinish } = renderPanel(items);
    fireEvent.click(view.container.querySelectorAll(".am-vseg button")[0]);
    // Both modifiers: the shortcut uses Cmd on macOS and Ctrl elsewhere.
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", metaKey: true, ctrlKey: true, bubbles: true }));
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(onFinish.mock.calls[0][1].id).toBe("m1#0");
  });

  it("shows the write head and no finish button while streaming", () => {
    const live: ChatItem[] = [
      { kind: "assistant", id: "m1", text: ':::draft id="a" title="Live"\nACTION: One.\nTIMO: Tw', streaming: true },
    ];
    const { view } = renderPanel(live, true);
    expect(view.container.querySelector(".am-caret")).toBeTruthy();
    expect(view.container.querySelector(".am-finish")).toBeNull();
    expect(view.container.querySelector(".am-draft-f")?.textContent).toContain("is writing");
  });

  it("offers the script once the version became one", () => {
    const finished: ChatItem[] = [
      ...items,
      { kind: "handoff", id: "h1", scriptId: "s1", title: "The Mouse", slug: "maus", versionId: "m2#0", folderId: null, at: 1 },
    ];
    const { view } = renderPanel(finished);
    expect(view.container.querySelector(".am-finish")).toBeNull();
    expect(view.container.querySelector(".am-draft-f")?.textContent).toContain("Open script");
  });
});
