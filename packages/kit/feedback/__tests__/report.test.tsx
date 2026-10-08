import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SuiteShell } from "../../shell";
import { createFixtureKv, createFixtureModule, fixturePlatform } from "../../__tests__/fixtures/module";
import { ReportError, collectInfo, sendReport, startErrorLog, type ReportContext } from "../report";

const cloud = { convexUrl: "https://backend.test", siteUrl: "https://backend.test", webUrl: "https://web.test" };

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function answer(status: number, body: unknown) {
  return vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

describe("report a problem in the shell", () => {
  it("sends the description with the collected details and shows the number", async () => {
    const fetcher = answer(200, { number: 7 });
    vi.stubGlobal("fetch", fetcher);
    const { kv, state } = createFixtureKv();
    const platform = { ...fixturePlatform, systemInfo: async () => ({ osVersion: "6.8", arch: "x86_64" }) };
    const page = render(() => <SuiteShell module={createFixtureModule()} platform={platform} kv={kv} cloud={cloud} />);
    await waitFor(() => expect(page.getByRole("button", { name: "Problem melden" })).toBeTruthy());

    fireEvent.click(page.getByRole("button", { name: "Problem melden" }));
    const message = await screen.findByRole("textbox", { name: "Was ist passiert?" });
    const send = screen.getByRole("button", { name: "Senden" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.input(message, { target: { value: "  Export does nothing.  " } });
    await waitFor(() => expect(send.disabled).toBe(false));
    fireEvent.click(send);

    await screen.findByText("Sie ist als Meldung #7 bei uns angekommen. Wir schauen sie uns an.");
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("https://backend.test/bugs/report");
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      app: "fixture", message: "Export does nothing.", version: "0.0.0-fixture", channel: "stable", os: "linux",
      details: { osVersion: "6.8", arch: "x86_64", view: "home", appLanguage: "de-DE", signedIn: "no" },
    });
    expect(body.email).toBeUndefined();
    // The installation keeps its ID for later reports.
    expect(body.installId).toBe(state.get("feedback.install"));
  });

  it("hides the floating button until the setting brings it back", async () => {
    const { kv, settings } = createFixtureKv();
    const page = render(() => <SuiteShell module={createFixtureModule()} platform={fixturePlatform} kv={kv} cloud={cloud} />);
    await waitFor(() => expect(page.getByRole("button", { name: "Knopf ausblenden" })).toBeTruthy());
    fireEvent.click(page.getByRole("button", { name: "Knopf ausblenden" }));
    await waitFor(() => expect(settings.get("report_button")).toBe("0"));
    expect(page.queryByRole("button", { name: "Problem melden" })).toBeNull();
  });

  it("offers nothing without a backend", async () => {
    const { kv } = createFixtureKv();
    const page = render(() => <SuiteShell module={createFixtureModule()} platform={fixturePlatform} kv={kv} />);
    await waitFor(() => expect(page.getByRole("heading", { name: "Ein eigenständiges Modul" })).toBeTruthy());
    expect(page.queryByRole("button", { name: "Problem melden" })).toBeNull();
    expect(document.querySelector(".rpt-pill")).toBeNull();
  });
});

describe("report plumbing", () => {
  const context = (): ReportContext => ({ app: "fixture", cloud, platform: fixturePlatform, kv: createFixtureKv().kv, route: () => "home" });

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

  it("tells a full limit and a missing connection apart", async () => {
    const info = await collectInfo(context());
    vi.stubGlobal("fetch", answer(429, { error: "rate_limited" }));
    await expect(sendReport(context(), { message: "x", info })).rejects.toEqual(new ReportError("limit"));
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    await expect(sendReport(context(), { message: "x", info })).rejects.toEqual(new ReportError("network"));
    vi.stubGlobal("fetch", answer(400, { error: "invalid_request" }));
    await expect(sendReport(context(), { message: "x", info })).rejects.toEqual(new ReportError("generic"));
  });
});
