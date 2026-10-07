// @vitest-environment node
import { describe, expect, it } from "vitest";
import { canonicalJson, decodeRecord, encodeRecord, recordIdOf } from "../records";

describe("records", () => {
  it("encodes small records as JSON and compresses large ones", async () => {
    const small = { entity: "scripts", id: "a", record: { title: "Hallo" } };
    const plain = await encodeRecord(small);
    expect(JSON.parse(new TextDecoder().decode(plain))).toEqual(small);
    expect(await decodeRecord(plain)).toEqual(small);

    const large = { entity: "scripts", id: "a", record: { content: "Text ".repeat(5000) } };
    const packed = await encodeRecord(large);
    expect([packed[0], packed[1]]).toEqual([0x1f, 0x8b]);
    expect(packed.length).toBeLessThan(5000);
    expect(await decodeRecord(packed)).toEqual(large);
  });

  it("rejects data that is no record", async () => {
    await expect(decodeRecord(new TextEncoder().encode('{"record":1}'))).rejects.toThrow();
    await expect(decodeRecord(new Uint8Array([1, 0, 9, 9]))).rejects.toThrow();
  });

  it("gives every entity and local ID its own stable record ID", () => {
    expect(recordIdOf("scripts", "a")).toBe("scripts/a");
    expect(recordIdOf("folders", "a")).not.toBe(recordIdOf("scripts", "a"));
  });
});

describe("canonicalJson", () => {
  it("sorts keys at every level", () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: null } })).toBe('{"a":{"c":null,"d":[1,{"y":2,"z":1}]},"b":1}');
  });
});
