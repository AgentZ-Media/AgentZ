import { describe, expect, it } from "vitest";
import { compareVersions } from "../build";

describe("compareVersions", () => {
  it("orders releases, pre-releases and nightlies like the backend", () => {
    const ordered = [
      "0.9.9", "0.10.0-nightly.202610010000", "0.10.0-nightly.202610071200", "0.10.0-rc.1", "0.10.0",
      "0.10.1-nightly.202610081200", "0.10.1", "1.0.0-alpha", "1.0.0-alpha.1", "1.0.0-alpha.beta", "1.0.0",
    ];
    for (let i = 0; i < ordered.length - 1; i++) {
      expect(compareVersions(ordered[i], ordered[i + 1]), `${ordered[i]} < ${ordered[i + 1]}`).toBeLessThan(0);
      expect(compareVersions(ordered[i + 1], ordered[i])).toBeGreaterThan(0);
    }
    expect(compareVersions("v1.2.3", "1.2.3")).toBe(0);
    expect(compareVersions("1.2", "1.2.3")).toBeNull();
  });
});
