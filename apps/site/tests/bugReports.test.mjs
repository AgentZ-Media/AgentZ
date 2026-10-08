import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  GLOBAL_LIMIT, INSTALL_LIMIT, MAX_DETAILS, MAX_DETAIL_CHARS, MAX_ERRORS, MAX_MESSAGE_CHARS, parseReport, withinLimits,
} from "../convex/bugReports.ts";

const base = {
  app: "scriptz",
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
      email: " lena@example.com ",
      details: { osVersion: "15.4", arch: "aarch64", windowWidth: 1280, signedIn: true },
      errors: ["TypeError: x is undefined"],
    });
    assert.equal(report.message, "The export button does nothing.");
    assert.equal(report.email, "lena@example.com");
    assert.deepEqual(report.details, { osVersion: "15.4", arch: "aarch64", windowWidth: "1280", signedIn: "yes" });
    assert.deepEqual(report.errors, ["TypeError: x is undefined"]);
  });

  it("requires app, installation and a message", () => {
    assert.equal(parseReport(null), null);
    assert.equal(parseReport({ ...base, message: "   " }), null);
    assert.equal(parseReport({ ...base, app: "Script Z" }), null);
    assert.equal(parseReport({ ...base, installId: "x" }), null);
  });

  it("never drops a report for a malformed collected part", () => {
    const report = parseReport({ ...base, version: 3, channel: "beta", os: "beos", email: "not-an-address", details: "x", errors: {} });
    assert.equal(report.version, "unknown");
    assert.equal(report.channel, "unknown");
    assert.equal(report.os, "unknown");
    assert.equal(report.email, undefined);
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

describe("withinLimits", () => {
  it("stops one installation and a flood of all", () => {
    assert.equal(withinLimits(0, 0), true);
    assert.equal(withinLimits(INSTALL_LIMIT - 1, 0), true);
    assert.equal(withinLimits(INSTALL_LIMIT, 0), false);
    assert.equal(withinLimits(0, GLOBAL_LIMIT), false);
  });
});
