import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { applyResolvedLanguage } from "@agentz/kit/i18n";
import type { ModuleContext } from "@agentz/kit/shell";
import { clearToasts, toastsSignal } from "@agentz/kit/stores";
import { appModule } from "./index";

afterEach(() => { cleanup(); clearToasts(); applyResolvedLanguage("de"); });
describe("Sandbox", () => {
  it("switches home language and shows a shared toast", async () => {
    applyResolvedLanguage("de");
    const runtime = await appModule.setup({ shell: { closeSettings: vi.fn() } } as unknown as ModuleContext);
    const Home = runtime.routes[0].component;
    render(() => <Home />);
    expect(screen.getByRole("heading").textContent).toBe("Willkommen bei Sandbox");
    applyResolvedLanguage("en");
    expect(screen.getByRole("heading").textContent).toBe("Welcome to Sandbox");
    fireEvent.click(screen.getByRole("button", { name: "Show notice" }));
    expect(toastsSignal().at(-1)?.text).toBe("All set!");
  });
});
