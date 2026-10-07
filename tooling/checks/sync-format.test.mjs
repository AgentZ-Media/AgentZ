import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { checkSyncFormats, formatProblems, latestStableTag } from "./sync-format.mjs";

describe("latestStableTag", () => {
  it("picks the newest stable release of the app by SemVer", () => {
    const tags = ["scriptz-v0.9.2", "scriptz-v0.10.1", "scriptz-v0.11.0-rc.1", "scriptz-v0.10.0", "other-v9.0.0", "v0.8.4", "scriptz-nightly", "scriptz-latest"];
    assert.equal(latestStableTag(tags, "scriptz"), "scriptz-v0.10.1");
    assert.equal(latestStableTag(tags, "other"), "other-v9.0.0");
    assert.equal(latestStableTag(tags, "missing"), null);
  });
});

describe("formatProblems", () => {
  const check = (current, released) => formatProblems({ app: "scriptz", current, released, tag: "scriptz-v1.0.0" });

  it("accepts the same format and the two-step order", () => {
    assert.deepEqual(check({ reads: 1, writes: 1 }, { reads: 1, writes: 1 }), []);
    assert.deepEqual(check({ reads: 2, writes: 1 }, { reads: 1, writes: 1 }), [], "step one: read the new format");
    assert.deepEqual(check({ reads: 2, writes: 2 }, { reads: 2, writes: 1 }), [], "step two: write it");
    assert.deepEqual(check({ reads: 1, writes: 1 }, null), [], "nothing released to compare against");
  });

  it("rejects writing a format the release cannot read yet", () => {
    assert.match(check({ reads: 2, writes: 2 }, { reads: 1, writes: 1 })[0], /reads only up to 1/);
  });

  it("rejects reading less than the release writes", () => {
    assert.match(check({ reads: 1, writes: 1 }, { reads: 2, writes: 2 })[0], /already writes 2/);
  });

  it("rejects inconsistent numbers", () => {
    assert.equal(check({ reads: 1, writes: 2 }, null).length, 1);
    assert.equal(check({ reads: 0, writes: 0 }, null).length, 1);
  });
});

describe("checkSyncFormats", () => {
  it("passes on this repository", () => {
    const { problems } = checkSyncFormats(fileURLToPath(new URL("../../", import.meta.url)));
    assert.deepEqual(problems, []);
  });
});
