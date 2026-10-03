// Tests for the one-time legacy-block boot migration. Runs against an
// in-memory StorageAdapter stub, so it verifies the adapter-agnostic flow
// (flag handling, which scripts get rewritten, internalRewrite flag).

import { afterEach, describe, expect, it, vi } from "vitest";
import { getStorageAdapter, setStorageAdapter, type StorageAdapter } from "../storage";
import "../api";
import {
  LEGACY_BLOCKS_MIGRATION_FLAG,
  migrateLegacyBlocksOnce,
} from "../legacyBlocksMigration";

const originalAdapter = getStorageAdapter();

afterEach(() => {
  setStorageAdapter(originalAdapter);
});

function content(type: string, text: string): string {
  return JSON.stringify({ root: { children: [{ type, children: [{ type: "text", text }] }] } });
}

function memoryAdapter(scripts: Record<string, string>, opts: { failGet?: string } = {}) {
  const appState = new Map<string, string>();
  const updateScript = vi.fn(async (input: { id: string; contentJson?: string }) => {
    if (input.contentJson !== undefined) scripts[input.id] = input.contentJson;
    return {} as never;
  });
  const listScripts = vi.fn(async (q?: { includeArchived?: boolean }) => {
    expect(q?.includeArchived).toBe(true);
    return Object.keys(scripts).map((id) => ({ id })) as never;
  });
  const adapter = new Proxy({} as StorageAdapter, {
    get(_, prop: string) {
      switch (prop) {
        case "getAppState":
          return async (k: string) => appState.get(k) ?? null;
        case "setAppState":
          return async (k: string, v: string) => {
            appState.set(k, v);
          };
        case "listScripts":
          return listScripts;
        case "getScript":
          return async (id: string) => {
            if (id === opts.failGet) throw new Error("boom");
            return { id, content_json: scripts[id] };
          };
        case "updateScript":
          return updateScript;
        default:
          return vi.fn().mockResolvedValue(undefined);
      }
    },
  });
  return { adapter, appState, updateScript, listScripts };
}

describe("migrateLegacyBlocksOnce", () => {
  it("rewrites only scripts with retired block types, as internal rewrite", async () => {
    const scripts = {
      a: content("scriptz-sfx", "Pling"),
      b: content("scriptz-action", "Normal"),
      c: content("scriptz-caption", "Büro"),
      d: content("scriptz-parenthetical", "(leise)"),
    };
    const m = memoryAdapter(scripts);
    setStorageAdapter(m.adapter);

    await migrateLegacyBlocksOnce();

    expect(m.updateScript).toHaveBeenCalledTimes(2);
    for (const call of m.updateScript.mock.calls) {
      expect(call[0]).toMatchObject({ internalRewrite: true });
    }
    expect(scripts.a).toContain("scriptz-action");
    expect(scripts.c).toContain("scriptz-action");
    expect(scripts.b).toBe(content("scriptz-action", "Normal"));
    // Parenthetical is a live block type again - never rewritten.
    expect(scripts.d).toBe(content("scriptz-parenthetical", "(leise)"));
    expect(m.appState.get(LEGACY_BLOCKS_MIGRATION_FLAG)).toBeTruthy();
  });

  it("does nothing once the flag is set", async () => {
    const m = memoryAdapter({ a: content("scriptz-sfx", "Pling") });
    m.appState.set(LEGACY_BLOCKS_MIGRATION_FLAG, "1");
    setStorageAdapter(m.adapter);

    await migrateLegacyBlocksOnce();

    expect(m.listScripts).not.toHaveBeenCalled();
    expect(m.updateScript).not.toHaveBeenCalled();
  });

  it("leaves the flag unset when a script fails, so the next boot retries", async () => {
    const m = memoryAdapter(
      { a: content("scriptz-sfx", "Pling"), b: content("scriptz-camera", "Close") },
      { failGet: "a" },
    );
    setStorageAdapter(m.adapter);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await migrateLegacyBlocksOnce();

    expect(m.updateScript).toHaveBeenCalledTimes(1);
    expect(m.appState.has(LEGACY_BLOCKS_MIGRATION_FLAG)).toBe(false);
    warn.mockRestore();
  });

  it("skips silently when the adapter cannot list scripts", async () => {
    const m = memoryAdapter({});
    m.listScripts.mockRejectedValueOnce(new Error("not supported"));
    setStorageAdapter(m.adapter);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(migrateLegacyBlocksOnce()).resolves.toBeUndefined();

    expect(m.appState.has(LEGACY_BLOCKS_MIGRATION_FLAG)).toBe(false);
    warn.mockRestore();
  });
});
