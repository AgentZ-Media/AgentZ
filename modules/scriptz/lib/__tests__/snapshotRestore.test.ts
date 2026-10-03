// Snapshot restore (SQL path, lib/snapshots.ts) must reconcile every
// derived column with the restored content - word counts incl. the
// last_word_count baseline, runtime stats, characters_meta, FTS - without
// booking the restored words in daily_word_log.
//
// Runs against a tiny fake DbConnection that understands exactly the
// statements involved (no SQLite engine in the test environment).

import { afterEach, describe, expect, it } from "vitest";
import { characterUsageBus } from "../characterUsage";
import { getPlatformAdapter, setPlatformAdapter, type DbConnection, type PlatformAdapter } from "@agentz/kit/platform";
import { restoreSnapshot } from "../snapshots";

interface Row {
  id: string;
  title: string;
  content_json: string;
  characters_meta: string;
  updated_at: number;
  last_word_count: number;
  dialog_word_count: number;
  direction_block_count: number;
}

function content(blocks: Array<[string, string]>): string {
  return JSON.stringify({
    root: {
      children: blocks.map(([type, text]) => ({
        type,
        ...(type === "scriptz-character" ? { characterName: text.toUpperCase() } : {}),
        children: [{ type: "text", text }],
      })),
    },
  });
}

function fakeDb(row: Row, snapshotContent: string) {
  const executed: string[] = [];
  const fts: { text: string } = { text: "" };
  const db: DbConnection = {
    async select<T>(query: string, params: unknown[] = []): Promise<T> {
      const q = query.replace(/\s+/g, " ").trim();
      if (q.startsWith("SELECT script_id, content_json FROM snapshots")) {
        return [{ script_id: row.id, content_json: snapshotContent }] as T;
      }
      if (q.startsWith("SELECT name, default_color, override_color FROM character_colors")) {
        return [] as T;
      }
      if (q.startsWith("SELECT content_json FROM scripts")) return [{ content_json: row.content_json }] as T;
      if (q.startsWith("SELECT characters_meta FROM scripts")) {
        return [{ characters_meta: row.characters_meta }] as T;
      }
      if (q.startsWith("SELECT title, content_json FROM scripts")) {
        return [{ title: row.title, content_json: row.content_json }] as T;
      }
      throw new Error(`unexpected select: ${q} ${JSON.stringify(params)}`);
    },
    async execute(query: string, params: unknown[] = []) {
      const q = query.replace(/\s+/g, " ").trim();
      executed.push(q);
      if (q.startsWith("UPDATE scripts SET content_json")) {
        const [c, meta, updated, words, dialog, direction] = params as [string, string, number, number, number, number];
        Object.assign(row, {
          content_json: c,
          characters_meta: meta,
          updated_at: updated,
          last_word_count: words,
          dialog_word_count: dialog,
          direction_block_count: direction,
        });
      } else if (q.startsWith("INSERT INTO scripts_fts")) {
        fts.text = String((params as unknown[])[2] ?? "");
      }
      return { rowsAffected: 1 };
    },
  };
  return { db, executed, fts };
}

const originalPlatform = (() => {
  try {
    return getPlatformAdapter();
  } catch {
    return null;
  }
})();

afterEach(() => {
  if (originalPlatform) setPlatformAdapter(originalPlatform);
});

describe("restoreSnapshot (SQL)", () => {
  it("reconciles derived metadata and resets the word baseline without booking words", async () => {
    const current = content([["scriptz-action", "one two three four five six seven eight"]]);
    const restored = content([
      ["scriptz-action", "Rain falls."],
      ["scriptz-character", "Max"],
      ["scriptz-dialog", "Hello there my friend"],
      // Retired block type from before the redesign.
      ["scriptz-caption", "Old caption"],
    ]);
    const row: Row = {
      id: "s1",
      title: "Test",
      content_json: current,
      characters_meta: "[]",
      updated_at: 1,
      last_word_count: 8,
      dialog_word_count: 0,
      direction_block_count: 1,
    };
    const fake = fakeDb(row, restored);
    setPlatformAdapter({ getDb: async () => fake.db } as unknown as PlatformAdapter);

    await restoreSnapshot("snap1");

    // Legacy block normalized away.
    expect(row.content_json).not.toContain("scriptz-caption");
    // Rain falls. (2) + Max (1) + Hello there my friend (4) + Old caption (2)
    expect(row.last_word_count).toBe(9);
    expect(row.dialog_word_count).toBe(4);
    expect(row.direction_block_count).toBe(2);
    const meta = JSON.parse(row.characters_meta) as Array<{ name: string }>;
    expect(meta.map((c) => c.name.toUpperCase())).toEqual(["MAX"]);
    expect(row.updated_at).toBeGreaterThan(1);
    // FTS refreshed with the restored text.
    expect(fake.fts.text).toContain("Hello there my friend");
    // Restored words are not "written today".
    expect(fake.executed.some((q) => q.includes("daily_word_log"))).toBe(false);
    // A backup snapshot of the pre-restore content was taken.
    expect(fake.executed.some((q) => q.startsWith("INSERT INTO snapshots"))).toBe(true);
  });

  it("replaces the -1 sentinel with the restored count", async () => {
    const restored = content([["scriptz-action", "a b c"]]);
    const row: Row = {
      id: "s2",
      title: "T",
      content_json: content([]),
      characters_meta: "[]",
      updated_at: 1,
      last_word_count: -1,
      dialog_word_count: -1,
      direction_block_count: -1,
    };
    const fake = fakeDb(row, restored);
    setPlatformAdapter({ getDb: async () => fake.db } as unknown as PlatformAdapter);
    await restoreSnapshot("snap2");
    expect(row.last_word_count).toBe(3);
    expect(row.dialog_word_count).toBe(0);
    expect(row.direction_block_count).toBe(1);
    expect(fake.executed.some((q) => q.includes("daily_word_log"))).toBe(false);
  });

  it("signals a possibly orphaned name only when the restore drops one", async () => {
    let signals = 0;
    const off = characterUsageBus.onNamesDropped(() => signals++);
    try {
      const withMax = content([["scriptz-character", "Max"]]);
      const row: Row = {
        id: "s3",
        title: "T",
        content_json: content([["scriptz-character", "Eve"]]),
        characters_meta: JSON.stringify([{ name: "EVE", color: "#e0791f" }]),
        updated_at: 1,
        last_word_count: 1,
        dialog_word_count: 0,
        direction_block_count: 0,
      };
      setPlatformAdapter({ getDb: async () => fakeDb(row, withMax).db } as unknown as PlatformAdapter);
      await restoreSnapshot("snap3");
      expect(signals).toBe(1);

      // MAX -> MAX: nothing dropped, no signal.
      setPlatformAdapter({ getDb: async () => fakeDb(row, withMax).db } as unknown as PlatformAdapter);
      await restoreSnapshot("snap4");
      expect(signals).toBe(1);
    } finally {
      off();
    }
  });
});
