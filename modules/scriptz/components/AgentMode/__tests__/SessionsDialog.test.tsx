// The sessions dialog distinguishes "no sessions yet" from a search
// without hits.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { applyResolvedLanguage } from "@agentz/kit/i18n";
import { t } from "../../../i18n";

const listSessions = vi.fn();
vi.mock("../../../lib/agent/chats", () => ({ listSessions: (...args: unknown[]) => listSessions(...args) }));
vi.mock("../../../stores/agent", () => ({ agentStore: { sessions: () => [] } }));
vi.mock("../../../stores/nav", () => ({ navStore: { openAgent: vi.fn() } }));
vi.mock("../../Shell/libraryData", () => ({ library: { folder: () => undefined } }));

const { SessionsDialog } = await import("../SessionsDialog");

afterEach(() => cleanup());
beforeEach(() => {
  applyResolvedLanguage("en");
  listSessions.mockReset();
  listSessions.mockResolvedValue([]);
});

describe("SessionsDialog", () => {
  it("says there are no sessions yet without a search", async () => {
    render(() => <SessionsDialog open onClose={() => {}} onDelete={async () => false} />);
    await waitFor(() => expect(screen.getByText(t("agentMode.sessions.empty"))).toBeTruthy());
  });

  it("says nothing matches when a search finds no session", async () => {
    render(() => <SessionsDialog open onClose={() => {}} onDelete={async () => false} />);
    await waitFor(() => expect(screen.getByText(t("agentMode.sessions.empty"))).toBeTruthy());
    fireEvent.input(screen.getByLabelText(t("agentMode.sessions.search")), { target: { value: "mouse" } });
    await waitFor(() => expect(screen.getByText(t("agentMode.sessions.noMatch"))).toBeTruthy());
    await waitFor(() => expect(listSessions).toHaveBeenLastCalledWith(expect.any(Number), 0, "mouse"));
  });
});
