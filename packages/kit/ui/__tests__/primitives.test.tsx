import { cleanup, fireEvent, render, waitFor } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { LOGOS, type LogoId } from "@agentz/design/logo";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppMark, BootErrorScreen, DialogFrame, Modal, dismissOnDialog } from "../index";

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});

describe("product-neutral UI primitives", () => {
  it("blurs a pending field before closing a modal and restores the trigger", async () => {
    const trigger = document.createElement("button");
    document.body.append(trigger);
    trigger.focus();
    const calls: string[] = [];
    const [open, setOpen] = createSignal(false);
    render(() => <Modal open={open()} title="Preferences" onClose={() => {
      calls.push("close");
      setOpen(false);
    }}><input autofocus aria-label="Name" onBlur={() => calls.push("blur")} /></Modal>);
    setOpen(true);
    await waitFor(() => expect(document.activeElement?.getAttribute("aria-label")).toBe("Name"));
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(calls).toEqual(["blur", "close"]);
    expect(document.activeElement).toBe(trigger);
  });

  it("lets a marked nested overlay consume Escape before the dialog", () => {
    const close = vi.fn();
    const result = render(() => <DialogFrame open label="Preferences" onClose={close}><div data-dialog-dismiss-layer>Picker</div></DialogFrame>);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(close).not.toHaveBeenCalled();
    document.querySelector("[data-dialog-dismiss-layer]")!.remove();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(close).toHaveBeenCalledOnce();
    result.unmount();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(close).toHaveBeenCalledOnce();
  });

  it("dismisses a menu using the supplied application dialog signal", () => {
    const [dialogOpen, setDialogOpen] = createSignal(false);
    const dismiss = vi.fn();
    render(() => {
      dismissOnDialog({ dialogOpen, open: () => true, inside: () => false, dismiss, trackFocus: false });
      return null;
    });
    setDialogOpen(true);
    expect(dismiss).toHaveBeenCalledOnce();
  });

  it("accepts product recovery copy and retains technical error details", () => {
    const retry = vi.fn();
    const { getByText, getByRole } = render(() => <BootErrorScreen appName="Example" title="Example could not open" description="Your data remains safe." error={new Error("database unavailable")} onRetry={retry} />);
    expect(getByRole("heading").textContent).toBe("Example could not open");
    expect(getByText("Your data remains safe.")).toBeTruthy();
    expect(getByRole("alert").textContent).toBe("database unavailable");
    fireEvent.click(document.querySelector(".boot-error-actions button")!);
    expect(retry).toHaveBeenCalledOnce();
  });

  it("renders a registry-selected logo with the supplied product name", () => {
    const { getByRole } = render(() => <AppMark logo={Object.keys(LOGOS)[0] as LogoId} appName="Example app" />);
    expect(getByRole("img").getAttribute("aria-label")).toBe("Example app");
    expect(document.querySelectorAll("circle").length).toBeGreaterThan(0);
  });
});
