import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  blockFor, compareVersions, devRaiseDenied, markOf, policyError, raisedMark, validClient,
} from "../convex/compat.ts";

const client = (version, reads = 1, writes = reads, channel = "stable") => ({ version, reads, writes, channel });
const none = { format: 0, by: null };

describe("compareVersions", () => {
  it("orders releases, pre-releases and nightlies by SemVer precedence", () => {
    const ordered = [
      "0.9.9", "0.10.0-nightly.202610010000", "0.10.0-nightly.202610071200", "0.10.0-rc.1", "0.10.0",
      "0.10.1-nightly.202610081200", "0.10.1", "1.0.0-alpha", "1.0.0-alpha.1", "1.0.0-alpha.beta", "1.0.0",
    ];
    for (let i = 0; i < ordered.length - 1; i++) {
      assert.ok(compareVersions(ordered[i], ordered[i + 1]) < 0, `${ordered[i]} < ${ordered[i + 1]}`);
      assert.ok(compareVersions(ordered[i + 1], ordered[i]) > 0, `${ordered[i + 1]} > ${ordered[i]}`);
    }
    assert.equal(compareVersions("v1.2.3", "1.2.3"), 0);
    assert.equal(compareVersions("1.2.3+build.5", "1.2.3"), 0);
  });

  it("rejects what is not SemVer", () => {
    for (const bad of ["", "1.2", "01.2.3", "1.2.3.4", "latest", "1.2.3-", "1.2.3-a..b"]) {
      assert.equal(compareVersions(bad, "1.0.0"), null, bad);
    }
  });
});

describe("blockFor", () => {
  it("lets a device sync while it can read the account's format", () => {
    assert.equal(blockFor(client("0.10.0"), none, null), null);
    assert.equal(blockFor(client("0.10.0"), { format: 1, by: "0.9.0" }, null), null);
    assert.equal(blockFor(client("0.11.0", 2, 1), { format: 2, by: "0.12.0" }, null), null);
  });

  it("pauses a device that cannot read newer data and names the version that wrote it", () => {
    assert.deepEqual(blockFor(client("0.10.0"), { format: 2, by: "0.11.0-nightly.202611011200" }, null),
      { reason: "format", format: 2, by: "0.11.0-nightly.202611011200" });
  });

  it("turns away versions that write a format the server no longer accepts", () => {
    // ScriptZ format 1 was end-to-end encrypted; MIN_FORMAT is 2.
    assert.deepEqual(blockFor(client("0.11.1-nightly.202610061200", 1), { format: 1, by: null }, null, 2),
      { reason: "version", minVersion: null });
    assert.deepEqual(blockFor(client("0.11.1-nightly.202610061200", 1), none, { minVersion: "0.11.0" }, 2),
      { reason: "version", minVersion: "0.11.0" });
    assert.equal(blockFor(client("0.12.0", 2), { format: 1, by: null }, null, 2), null);
    assert.equal(blockFor(client("0.12.0", 2), none, null, 2), null);
  });

  it("treats versions from before the check as outdated", () => {
    assert.deepEqual(blockFor(undefined, none, null), { reason: "version", minVersion: null });
    assert.deepEqual(blockFor(undefined, none, { minVersion: "0.10.0" }), { reason: "version", minVersion: "0.10.0" });
  });

  it("rejects inconsistent or malformed reports", () => {
    for (const bad of [client("nope"), client("1.0.0", 0, 0), client("1.0.0", 1, 2), client("1.0.0", 1.5, 1), client("1.0.0", 1001, 1)]) {
      assert.equal(validClient(bad), false);
      assert.equal(blockFor(bad, none, null)?.reason, "version");
    }
  });

  it("applies the policy's minimum version, including to nightlies of that version", () => {
    const policy = { minVersion: "0.10.1" };
    assert.equal(blockFor(client("0.10.0"), none, policy)?.reason, "version");
    assert.equal(blockFor(client("0.10.1-nightly.202610081200"), none, policy)?.reason, "version");
    assert.equal(blockFor(client("0.10.1"), none, policy), null);
    assert.equal(blockFor(client("0.10.2-nightly.202610101200"), none, policy), null);
  });

  it("blocks single versions", () => {
    const policy = { blockedVersions: ["0.10.2", "v0.10.3-nightly.202610101200"] };
    assert.equal(blockFor(client("0.10.2"), none, policy)?.reason, "version");
    assert.equal(blockFor(client("0.10.3-nightly.202610101200"), none, policy)?.reason, "version");
    assert.equal(blockFor(client("0.10.3"), none, policy), null);
  });

  it("checks the policy before the format", () => {
    assert.deepEqual(blockFor(client("0.10.0"), { format: 3, by: "1.0.0" }, { minVersion: "0.11.0" }),
      { reason: "version", minVersion: "0.11.0" });
  });
});

describe("format mark", () => {
  it("reads accounts from before format numbers as format 1", () => {
    assert.deepEqual(markOf(null), { format: 0, by: null });
    assert.deepEqual(markOf({ rev: 0 }), { format: 0, by: null });
    assert.deepEqual(markOf({ rev: 12 }), { format: 1, by: null });
    assert.deepEqual(markOf({ rev: 12, format: 2, formatBy: "0.11.0" }), { format: 2, by: "0.11.0" });
  });

  it("only ever moves up", () => {
    assert.deepEqual(raisedMark(client("0.11.0", 2), { format: 1, by: null }), { format: 2, by: "0.11.0" });
    assert.equal(raisedMark(client("0.11.0", 2, 1), { format: 1, by: null }), null);
    assert.equal(raisedMark(client("0.10.0"), { format: 2, by: "0.11.0" }), null);
  });

  it("keeps development builds from moving a real account to a newer format", () => {
    const dev = client("0.11.0", 2, 2, "dev");
    assert.equal(devRaiseDenied(dev, { format: 1, by: null }, false), true);
    assert.equal(devRaiseDenied(dev, { format: 1, by: null }, true), false);
    assert.equal(devRaiseDenied(dev, none, false), false, "a fresh account may start in any format");
    assert.equal(devRaiseDenied(dev, { format: 2, by: "0.11.0" }, false), false);
    assert.equal(devRaiseDenied(client("0.11.0", 2), { format: 1, by: null }, false), false);
  });
});

describe("policyError", () => {
  it("accepts valid versions and rejects anything else", () => {
    assert.equal(policyError({}), null);
    assert.equal(policyError({ minVersion: "0.10.0", blockedVersions: ["0.10.1-nightly.202610081200"] }), null);
    assert.match(policyError({ minVersion: "latest" }), /minVersion/);
    assert.match(policyError({ blockedVersions: ["0.10"] }), /blocked/);
  });
});
