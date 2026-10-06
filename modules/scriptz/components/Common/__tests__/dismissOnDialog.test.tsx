// Regression tests for menus closing when a dialog opens on top
// (dismissOnDialog from @agentz/kit/ui): the context menu and the folder
// picker must not stay open (and keep handling keys)
// behind ⌘I / ⌘K or a legacy modal.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@solidjs/testing-library";
import { uiStore } from "../../../stores/ui";
import { ContextMenu } from "../../Library/ContextMenu";
import { FolderMenu } from "../../Ideas/parts/FolderMenu";

const tick = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  cleanup();
  uiStore.closePalette();
  document.body.querySelectorAll("input.outside").forEach((el) => el.remove());
});

describe("dismissOnDialog", () => {
  it("closes the context menu when a shell dialog opens", async () => {
    const onClose = vi.fn();
    render(() => <ContextMenu x={10} y={10} items={[{ label: "Rename" }]} onClose={onClose} />);
    await tick();
    uiStore.openPalette();
    await tick();
    expect(onClose).toHaveBeenCalled();
  });

  it("closes the folder picker when focus moves to a modal field", async () => {
    const { container } = render(() => <FolderMenu folders={[]} value={null} onChange={() => {}} ariaLabel="Folder" />);
    (container.querySelector("button") as HTMLButtonElement).click();
    await tick();
    expect(document.querySelector(".fm-menu")).not.toBeNull();
    const field = document.createElement("input");
    field.className = "outside";
    document.body.appendChild(field);
    field.focus();
    await tick();
    expect(document.querySelector(".fm-menu")).toBeNull();
    // Focus is not pulled back to the trigger.
    expect(document.activeElement).toBe(field);
  });
});
