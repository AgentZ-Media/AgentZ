import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@solidjs/testing-library";
import { applyResolvedLanguage } from "@agentz/kit/i18n";
import { CodexSetupInstructions } from "../CodexSetupInstructions";

const host = vi.hoisted(() => ({ platform: "macos", openUrl: vi.fn() }));
vi.mock("@agentz/kit/platform", async (importOriginal) => ({
  ...await importOriginal<typeof import("@agentz/kit/platform")>(),
  getPlatformAdapter: () => host,
}));
const writeText = vi.fn();

beforeEach(() => {
  applyResolvedLanguage("de");
  host.platform = "macos";
  host.openUrl.mockReset().mockResolvedValue(undefined);
  writeText.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Codex setup instructions", () => {
  it.each(["macos", "windows", "linux"])("copies the installer for the %s host and the login command", async (platform) => {
    host.platform = platform;
    const view = render(() => <CodexSetupInstructions install />);
    const command = platform === "windows"
      ? 'powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"'
      : "curl -fsSL https://chatgpt.com/codex/install.sh | sh";
    expect(view.getByText(command)).toBeTruthy();
    await fireEvent.click(view.getByRole("button", { name: /Codex installieren: Befehl kopieren/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(command));
    await fireEvent.click(view.getByRole("button", { name: "Bei Codex anmelden: Befehl kopieren" }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith("codex login"));
  });

  it("lets users switch platform without showing stale copy success", async () => {
    const view = render(() => <CodexSetupInstructions install />);
    const copy = view.getByRole("button", { name: /Codex installieren: Befehl kopieren/ });
    await fireEvent.click(copy);
    await waitFor(() => expect(copy.textContent).toContain("Kopiert"));
    await fireEvent.click(view.getByRole("button", { name: "Windows" }));
    expect(copy.textContent).toContain("Kopieren");
    await fireEvent.click(copy);
    expect(writeText).toHaveBeenLastCalledWith('powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"');
  });

  it("explains clipboard failure and leaves the command available for manual copying", async () => {
    writeText.mockRejectedValue(new Error("Permission denied"));
    const view = render(() => <CodexSetupInstructions install={false} />);
    await fireEvent.click(view.getByRole("button", { name: "Bei Codex anmelden: Befehl kopieren" }));
    await waitFor(() => expect(view.getByRole("status").textContent).toContain("manuell"));
    expect(view.getByText("codex login")).toBeTruthy();
    expect(view.queryByText("Kopiert")).toBeNull();
  });

  it("only shows sign-in when installed and opens official documentation through the host", async () => {
    applyResolvedLanguage("en");
    const view = render(() => <CodexSetupInstructions install={false} />);
    expect(view.queryByRole("group")).toBeNull();
    expect(view.container.querySelectorAll("code")).toHaveLength(1);
    await fireEvent.click(view.getByRole("link", { name: "OpenAI installation guide" }));
    expect(host.openUrl).toHaveBeenCalledWith("https://developers.openai.com/codex/cli#getting-started");
  });
});
