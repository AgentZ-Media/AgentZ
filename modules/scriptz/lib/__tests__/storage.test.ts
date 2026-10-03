// Sanity tests for the ScriptzApiStorage slot.
//
// Validates that the `api` proxy from ./api.ts really goes through
// `getStorageAdapter()` - otherwise a future
// `setStorageAdapter(webImpl)` wouldn't reach existing code with
// `api.*` calls.

import { afterEach, describe, it, expect, vi } from "vitest";
import {
  setStorageAdapter,
  getStorageAdapter,
  type ScriptzApiStorage,
} from "../storage";
import { api, registerSqlStorageAdapter } from "../api";

// Stub factory: returns a ScriptzApiStorage where all 30+ methods are
// produced via `vi.fn()`. Tests override individual methods with
// real values; the rest is enough as "won't be called".
function stubAdapter(overrides: Partial<ScriptzApiStorage> = {}): ScriptzApiStorage {
  // Eager-eval default fields per required interface key.
  // We use a proxy: anything that isn't overridden becomes a
  // `vi.fn()` that returns an empty result.
  return new Proxy({} as ScriptzApiStorage, {
    get(_, prop: string) {
      if (prop in overrides) return overrides[prop as keyof ScriptzApiStorage];
      return vi.fn().mockResolvedValue(undefined);
    },
  });
}

const originalAdapter = getStorageAdapter();

afterEach(() => {
  // Restore the default adapter after each test so other
  // test files (which go through `api.*`) don't run into our stub.
  setStorageAdapter(originalAdapter);
});

describe("ScriptzApiStorage slot", () => {
  it("api proxies through getStorageAdapter() (not a static bind)", async () => {
    const getScript = vi
      .fn()
      .mockResolvedValue({ id: "x", title: "PROXIED" });
    setStorageAdapter(stubAdapter({ getScript: getScript as never }));

    const result = await api.getScript("x");

    expect(getScript).toHaveBeenCalledWith("x");
    expect((result as { title: string }).title).toBe("PROXIED");
  });

  it("setStorageAdapter takes effect immediately - no re-import needed", async () => {
    const first = vi.fn().mockResolvedValue([{ id: "a" }] as never);
    const second = vi.fn().mockResolvedValue([{ id: "b" }] as never);

    setStorageAdapter(stubAdapter({ listFolders: first as never }));
    expect(await api.listFolders()).toEqual([{ id: "a" }]);
    expect(first).toHaveBeenCalledTimes(1);

    setStorageAdapter(stubAdapter({ listFolders: second as never }));
    expect(await api.listFolders()).toEqual([{ id: "b" }]);
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(1); // first not called again
  });

  it("SQL adapter can be registered explicitly", () => {
    registerSqlStorageAdapter();
    expect(() => getStorageAdapter()).not.toThrow();
    // And the default has all the methods the interface requires.
    const a = getStorageAdapter();
    expect(typeof a.getScript).toBe("function");
    expect(typeof a.listScripts).toBe("function");
    expect(typeof a.createSnapshot).toBe("function");
    expect(typeof a.globalSearch).toBe("function");
    expect(typeof a.loadDailyStats).toBe("function");
  });
});
