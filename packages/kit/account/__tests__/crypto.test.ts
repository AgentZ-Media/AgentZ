// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  canonicalJson, createDataKey, createRecordCipher, formatRecoveryKey, parseRecoveryKey, randomBytes,
  unwrapDataKey, wrapDataKey,
} from "../crypto";

describe("recovery key", () => {
  it("round-trips through its text form and forgives look-alike characters", () => {
    const bytes = randomBytes(32);
    const text = formatRecoveryKey(bytes);
    expect(text).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){12}[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(parseRecoveryKey(text)).toEqual(bytes);
    expect(parseRecoveryKey(text.toLowerCase().replace(/-/g, " "))).toEqual(bytes);
    expect(parseRecoveryKey(text.replace(/1/g, "l").replace(/0/g, "O"))).toEqual(bytes);
  });

  it("rejects text of the wrong length or alphabet", () => {
    expect(parseRecoveryKey("ABCD-EFGH")).toBeNull();
    expect(parseRecoveryKey("U".repeat(52))).toBeNull();
    // Only one spelling per key: the unused bits of the last character are zero.
    const text = formatRecoveryKey(randomBytes(32));
    const last = "0123456789ABCDEFGHJKMNPQRSTVWXYZ".indexOf(text.at(-1)!);
    expect(parseRecoveryKey(text.slice(0, -1) + "0123456789ABCDEFGHJKMNPQRSTVWXYZ"[last ^ 1])).toBeNull();
  });
});

describe("data key wrapping", () => {
  it("unwraps only with the matching recovery key", async () => {
    const dataKey = createDataKey();
    const recovery = randomBytes(32);
    const wrapped = await wrapDataKey(dataKey, recovery);
    const back = await unwrapDataKey(dataKey.keyId, wrapped, recovery);
    expect(back.key).toEqual(dataKey.key);
    await expect(unwrapDataKey(dataKey.keyId, wrapped, randomBytes(32))).rejects.toThrow();
    // The key ID is authenticated: a swapped wrapped key does not unwrap.
    await expect(unwrapDataKey("another-key-id-0000", wrapped, recovery)).rejects.toThrow();
  });
});

describe("record cipher", () => {
  it("encrypts records, compresses large ones and binds them to their slot", async () => {
    const cipher = await createRecordCipher(createDataKey(), "scriptz");
    const id = await cipher.recordId("scripts", "a");
    expect(id).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await cipher.recordId("scripts", "a")).toBe(id);
    expect(await cipher.recordId("folders", "a")).not.toBe(id);

    const small = { entity: "scripts", id: "a", record: { title: "Hallo" } };
    const sealed = await cipher.encrypt(id, small);
    expect(new TextDecoder().decode(sealed)).not.toContain("Hallo");
    expect(await cipher.decrypt(id, sealed)).toEqual(small);

    const large = { entity: "scripts", id: "a", record: { content: "Text ".repeat(5000) } };
    const packed = await cipher.encrypt(id, large);
    expect(packed[1]).toBe(1);
    expect(packed.length).toBeLessThan(5000);
    expect(await cipher.decrypt(id, packed)).toEqual(large);

    const other = await cipher.recordId("scripts", "b");
    await expect(cipher.decrypt(other, sealed)).rejects.toThrow();
  });

  it("derives separate keys per app", async () => {
    const dataKey = createDataKey();
    const a = await createRecordCipher(dataKey, "scriptz");
    const b = await createRecordCipher(dataKey, "other");
    expect(await a.recordId("scripts", "x")).not.toBe(await b.recordId("scripts", "x"));
    const sealed = await a.encrypt("r", { entity: "scripts", id: "x", record: 1 });
    await expect(b.decrypt("r", sealed)).rejects.toThrow();
  });
});

describe("canonicalJson", () => {
  it("sorts keys at every level", () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: null } })).toBe('{"a":{"c":null,"d":[1,{"y":2,"z":1}]},"b":1}');
  });
});
