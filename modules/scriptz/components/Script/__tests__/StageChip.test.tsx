// Regression tests for the stage chip menu (components/Script/StageChip.tsx):
// a dialog opening on top must close the menu, and keys typed into the
// dialog (digits, Enter, arrows) must never change the stage behind it.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@solidjs/testing-library";
import { uiStore } from "../../../stores/ui";

const setStage = vi.fn();
vi.mock("../stageActions", () => ({
  setStageWithUndo: (...args: unknown[]) => setStage(...args),
  stageLabel: (s: string) => s,
}));

const { StageChip } = await import("../StageChip");

const tick = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  cleanup();
  uiStore.closeCapture();
  setStage.mockReset();
  document.body.querySelectorAll("input.outside").forEach((el) => el.remove());
});

function key(target: Element, k: string) {
  target.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
}

async function openMenu() {
  const { container } = render(() => <StageChip scriptId="s1" status="writing" />);
  const chip = container.querySelector("button.chip") as HTMLButtonElement;
  chip.click();
  await tick();
  const menu = container.querySelector(".ss-stage-menu") as HTMLElement;
  expect(menu).not.toBeNull();
  expect(document.activeElement).toBe(menu);
  return { container, menu };
}

/** Stand-in for a dialog's text field. */
function outsideInput(): HTMLInputElement {
  const input = document.createElement("input");
  input.className = "outside";
  document.body.appendChild(input);
  return input;
}

describe("StageChip menu", () => {
  it("picks a stage by digit while the menu has focus", async () => {
    const { menu } = await openMenu();
    key(menu, "2");
    expect(setStage).toHaveBeenCalledWith("s1", "ready");
  });

  it("closes when a shell dialog opens and leaves its keys alone", async () => {
    const { container } = await openMenu();
    uiStore.openCapture(); // ⌘I
    await tick();
    expect(container.querySelector(".ss-stage-menu")).toBeNull();

    const field = outsideInput();
    field.focus();
    for (const k of ["1", "Enter", " ", "ArrowDown"]) key(field, k);
    expect(setStage).not.toHaveBeenCalled();
    // Focus stays in the dialog.
    expect(document.activeElement).toBe(field);
  });

  it("closes when focus moves into another surface (legacy modal)", async () => {
    const { container } = await openMenu();
    const field = outsideInput();
    field.focus();
    await tick();
    expect(container.querySelector(".ss-stage-menu")).toBeNull();
    key(field, "3");
    expect(setStage).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(field);
  });
});
