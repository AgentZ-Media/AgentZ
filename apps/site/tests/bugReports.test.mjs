import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DAY_MS, GLOBAL_HOUR_LIMIT, HOUR_MS, MAX_APP_NAME_CHARS, MAX_DETAILS, MAX_DETAIL_CHARS, MAX_ERRORS, MAX_MESSAGE_CHARS,
  MIN_GAP_MS, USER_DAY_LIMIT, USER_HOUR_LIMIT, checkLimits, parseReport,
} from "../convex/bugReports.ts";

const base = {
  app: "scriptz",
  appName: "ScriptZ",
  installId: "3f1c2a7e-9b1d-4c55-8a0e-2b7f6d1e9a10",
  message: "  The export button does nothing.  ",
  version: "0.10.1",
  channel: "stable",
  os: "macos",
};

describe("parseReport", () => {
  it("keeps a complete report and trims the message", () => {
    const report = parseReport({
      ...base,
      details: { osVersion: "15.4", arch: "aarch64", windowWidth: 1280, signedIn: true },
      errors: ["TypeError: x is undefined"],
    });
    assert.equal(report.message, "The export button does nothing.");
    assert.equal(report.app, "scriptz");
    assert.equal(report.appName, "ScriptZ");
    assert.deepEqual(report.details, { osVersion: "15.4", arch: "aarch64", windowWidth: "1280", signedIn: "yes" });
    assert.deepEqual(report.errors, ["TypeError: x is undefined"]);
  });

  it("requires app, installation and a message", () => {
    assert.equal(parseReport(null), null);
    assert.equal(parseReport({ ...base, message: "   " }), null);
    assert.equal(parseReport({ ...base, app: "Script Z" }), null);
    assert.equal(parseReport({ ...base, installId: "x" }), null);
  });

  it("accepts every app of the suite, not only a fixed list", () => {
    const report = parseReport({ ...base, app: "cutz", appName: "  CutZ  " });
    assert.equal(report.app, "cutz");
    assert.equal(report.appName, "CutZ");
    assert.equal(parseReport({ ...base, appName: "x".repeat(MAX_APP_NAME_CHARS + 5) }).appName.length, MAX_APP_NAME_CHARS);
  });

  it("never drops a report for a malformed collected part", () => {
    const report = parseReport({ ...base, appName: 7, version: 3, channel: "beta", os: "beos", details: "x", errors: {} });
    assert.equal(report.version, "unknown");
    assert.equal(report.channel, "unknown");
    assert.equal(report.os, "unknown");
    assert.equal(report.appName, undefined);
    assert.deepEqual(report.details, {});
    assert.deepEqual(report.errors, []);
  });

  it("cuts long texts and caps the collected part", () => {
    const details = Object.fromEntries(Array.from({ length: MAX_DETAILS + 10 }, (_, i) => [`key${i}`, "v"]));
    details.$bad = "x";
    details.long = "y".repeat(MAX_DETAIL_CHARS + 50);
    const errors = Array.from({ length: MAX_ERRORS + 5 }, (_, i) => `error ${i}`);
    const report = parseReport({ ...base, message: "m".repeat(MAX_MESSAGE_CHARS + 100), details, errors });
    assert.equal(report.message.length, MAX_MESSAGE_CHARS);
    assert.equal(Object.keys(report.details).length, MAX_DETAILS);
    assert.ok(!("$bad" in report.details));
    assert.equal(report.errors.length, MAX_ERRORS);
    assert.equal(report.errors.at(-1), `error ${MAX_ERRORS + 4}`);
  });

  it("skips nested and empty detail values", () => {
    const report = parseReport({ ...base, details: { nested: { a: 1 }, empty: " ", list: [1], nan: Number.NaN, ok: "fine" } });
    assert.deepEqual(report.details, { ok: "fine" });
  });
});

describe("checkLimits", () => {
  const now = 10 * DAY_MS;
  const reports = (count, spacing, from = now - MIN_GAP_MS) =>
    Array.from({ length: count }, (_, i) => ({ number: 100 - i, message: `report ${i}`, createdAt: from - i * spacing }));
  const check = (own, allLastHour = 0, message = "new problem") => checkLimits({ own, allLastHour, message, now }).kind;

  it("lets a normal report through", () => {
    assert.equal(check([]), "ok");
    assert.equal(check(reports(USER_HOUR_LIMIT - 1, 60_000)), "ok");
  });

  it("answers the same text within an hour with its number instead of storing it twice", () => {
    const own = [{ number: 41, message: "new problem", createdAt: now - 1000 }];
    assert.deepEqual(checkLimits({ own, allLastHour: 0, message: "new problem", now }), { kind: "duplicate", number: 41 });
    assert.equal(check([{ number: 41, message: "new problem", createdAt: now - HOUR_MS - 1 }]), "ok");
  });

  it("stops bursts, the hourly and the daily limit of one account", () => {
    assert.equal(check([{ number: 1, message: "other", createdAt: now - MIN_GAP_MS + 1 }]), "limited");
    assert.equal(check(reports(USER_HOUR_LIMIT, 60_000)), "limited");
    assert.equal(check(reports(USER_DAY_LIMIT, HOUR_MS / 2, now - HOUR_MS)), "limited");
    assert.equal(check(reports(USER_DAY_LIMIT - 1, HOUR_MS / 2, now - HOUR_MS)), "ok");
  });

  it("caps a flood of all accounts", () => {
    assert.equal(check([], GLOBAL_HOUR_LIMIT - 1), "ok");
    assert.equal(check([], GLOBAL_HOUR_LIMIT), "limited");
  });
});
