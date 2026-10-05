import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@solidjs/testing-library";
import { TopBar, type TopBarProps } from "../TopBar";

afterEach(() => cleanup());

function bar(overrides: Partial<TopBarProps> = {}) {
  const props: TopBarProps = {
    scriptId: "s1", title: "Pilot", folder: null, status: "idea",
    focusTitleFor: null, onTitleAutoFocused: () => {}, onRename: () => {},
    quickAvailable: false, quickOn: false, onToggleQuick: () => {},
    colorsOn: false, onToggleColors: () => {},
    inspectorVisible: false, onToggleInspector: () => {}, onExport: () => {},
    agentAvailable: true, agentOn: false, onToggleAgent: () => {},
    ...overrides,
  };
  return render(() => <TopBar {...props} />);
}

describe("script top bar agent toggle", () => {
  it("offers the agent in the full script view", () => {
    const view = bar();
    expect(view.container.querySelector(".ss-agent-btn")).toBeTruthy();
    expect(view.container.querySelector(".ss-insp-toggle")).toBeTruthy();
  });

  it("hides the agent in the side panel", () => {
    const view = bar({ peek: { onExpand: () => {}, onClose: () => {} } });
    expect(view.container.querySelector(".ss-agent-btn")).toBeNull();
    expect(view.container.querySelector(".ss-insp-toggle")).toBeNull();
    expect(view.container.querySelector(".ss-peek-acts")).toBeTruthy();
  });

  it("hides the agent while it is unavailable", () => {
    const view = bar({ agentAvailable: false });
    expect(view.container.querySelector(".ss-agent-btn")).toBeNull();
  });
});
