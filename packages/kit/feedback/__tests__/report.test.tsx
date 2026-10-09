import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SuiteShell } from "../../shell";
import { account } from "../../account/account";
import { SessionExpiredError } from "../../account/http";
import { createFixtureKv, createFixtureModule, fixturePlatform } from "../../__tests__/fixtures/module";
import { ReportError, collectInfo, sendReport, startErrorLog, type ReportContext } from "../report";

const cloud = { convexUrl: "https://backend.test", siteUrl: "https://backend.test", webUrl: "https://web.test" };

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

const answer = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** The account runtime itself is covered elsewhere; here only its answers matter. */
function signIn(backend: (path: string, init?: RequestInit) => Promise<Response> = async () => answer(200, { number: 1 })) {
  vi.spyOn(account, "signedIn").mockReturnValue(true);
  vi.spyOn(account, "user").mockReturnValue({ id: "u1", name: "Lena", email: "lena@example.com" });
  return vi.spyOn(account, "backendFetch").mockImplementation(backend);
}

describe("report a problem in the shell", () => {
  it("sends the description with app and collected details through the account session", async () => {
    const backend = signIn(async () => answer(200, { number: 7 }));
    const { kv, state } = createFixtureKv();
    const platform = { ...fixturePlatform, systemInfo: async () => ({ osVersion: "6.8", arch: "x86_64" }) };
    const page = render(() => <SuiteShell module={createFixtureModule()} platform={platform} kv={kv} cloud={cloud} />);
    await waitFor(() => expect(page.getByRole("button", { name: "Problem melden" })).toBeTruthy());

    fireEvent.click(page.getByRole("button", { name: "Problem melden" }));
    const message = await screen.findByRole("textbox", { name: "Was ist passiert?" });
    expect(screen.getByText("Falls wir Fragen haben, melden wir uns unter lena@example.com.")).toBeTruthy();
    const send = screen.getByRole("button", { name: "Senden" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.input(message, { target: { value: "  Export does nothing.  " } });
    await waitFor(() => expect(send.disabled).toBe(false));
    fireEvent.click(send);

    await screen.findByText("Sie ist als Meldung #7 bei uns angekommen. Wir schauen sie uns an.");
    expect(backend).toHaveBeenCalledTimes(1);
    const [path, init] = backend.mock.calls[0];
    expect(path).toBe("/bugs/report");
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      app: "fixture", appName: "Kit Lab", message: "Export does nothing.", version: "0.0.0-fixture", channel: "stable", os: "linux",
      details: { osVersion: "6.8", arch: "x86_64", view: "home", appLanguage: "de-DE", signedIn: "yes" },
    });
    // The installation keeps its ID for later reports.
    expect(body.installId).toBe(state.get("feedback.install"));
  });

  it("hides the floating button until the setting brings it back", async () => {
    signIn();
    const { kv, settings } = createFixtureKv();
    const page = render(() => <SuiteShell module={createFixtureModule()} platform={fixturePlatform} kv={kv} cloud={cloud} />);
    await waitFor(() => expect(page.getByRole("button", { name: "Knopf ausblenden" })).toBeTruthy());
    fireEvent.click(page.getByRole("button", { name: "Knopf ausblenden" }));
    await waitFor(() => expect(settings.get("report_button")).toBe("0"));
    expect(page.queryByRole("button", { name: "Problem melden" })).toBeNull();
  });

  it("shows nothing to signed-out users, neither the button nor the settings", async () => {
    const { kv } = createFixtureKv();
    let open: ((section: string) => void) | undefined;
    const fixture = createFixtureModule({ onSetup: (context) => { open = (section) => context.shell.openSettings(section); } });
    const page = render(() => <SuiteShell module={fixture} platform={fixturePlatform} kv={kv} cloud={cloud} />);
    await waitFor(() => expect(page.getByRole("heading", { name: "Ein eigenständiges Modul" })).toBeTruthy());
    expect(document.querySelector(".rpt-pill")).toBeNull();
    open!("appearance");
    await screen.findByRole("radio", { name: "Dunkel" });
    expect(screen.queryByRole("switch", { name: "Knopf „Problem melden“" })).toBeNull();
    open!("about");
    await screen.findByText("Über Kit Lab", { selector: ".set-head b" });
    expect(screen.queryByRole("button", { name: "Melden" })).toBeNull();
    expect(screen.queryByText("Problem melden")).toBeNull();
  });

  it("offers nothing without a backend", async () => {
    signIn();
    const { kv } = createFixtureKv();
    const page = render(() => <SuiteShell module={createFixtureModule()} platform={fixturePlatform} kv={kv} />);
    await waitFor(() => expect(page.getByRole("heading", { name: "Ein eigenständiges Modul" })).toBeTruthy());
    expect(document.querySelector(".rpt-pill")).toBeNull();
  });
});

describe("report plumbing", () => {
  const context = (): ReportContext => ({ app: "fixture", appName: "Kit Lab", platform: fixturePlatform, kv: createFixtureKv().kv, route: () => "home" });

  it("keeps recent errors and warnings in memory and restores the console", async () => {
    const original = console.warn;
    const silent = vi.fn();
    console.warn = silent;
    const stop = startErrorLog();
    console.warn("[sync] failed", new Error("socket closed"));
    window.dispatchEvent(new ErrorEvent("error", { message: "boom", error: new TypeError("x is undefined") }));
    const info = await collectInfo(context());
    expect(silent).toHaveBeenCalledTimes(1);
    expect(info.errors).toHaveLength(2);
    expect(info.errors[0]).toMatch(/warn: \[sync\] failed Error: socket closed/);
    expect(info.errors[1]).toMatch(/error: TypeError: x is undefined/);
    stop();
    expect(console.warn).toBe(silent);
    expect((await collectInfo(context())).errors).toEqual([]);
    console.warn = original;
  });

  it("tells a full limit, an expired session and a missing connection apart", async () => {
    const info = await collectInfo(context());
    const backend = signIn(async () => answer(429, { error: "rate_limited" }));
    await expect(sendReport(context(), { message: "x", info })).rejects.toEqual(new ReportError("limit"));
    backend.mockImplementation(async () => { throw new SessionExpiredError(); });
    await expect(sendReport(context(), { message: "x", info })).rejects.toEqual(new ReportError("expired"));
    backend.mockImplementation(async () => { throw new TypeError("Failed to fetch"); });
    await expect(sendReport(context(), { message: "x", info })).rejects.toEqual(new ReportError("network"));
    backend.mockImplementation(async () => answer(400, { error: "invalid_request" }));
    await expect(sendReport(context(), { message: "x", info })).rejects.toEqual(new ReportError("generic"));
  });
});
