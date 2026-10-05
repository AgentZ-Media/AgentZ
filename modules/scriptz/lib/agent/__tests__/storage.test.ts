// @vitest-environment node
import { createRequire } from "node:module";
import type { DatabaseSync as SQLiteDatabase, SQLInputValue } from "node:sqlite";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getStorageAdapter, setStorageAdapter } from "../../storage";
import { setPlatformAdapter, type DbConnection, type PlatformAdapter } from "@agentz/kit/platform";
import { latestChat, learnedHash, markLearned, saveChat, type ChatRecord } from "../chats";
import {
  addMemory, clearMemory, deleteMemory, getMemoryEntry, listMemory, memoryVersion,
  MemoryFullError, restoreMemory, updateMemory,
} from "../memory";
import { sqlAgentStorage } from "../sqlStorage";

const state = { connection: null as DbConnection | null };

// Vite 5 predates node:sqlite; resolve this test-only built-in through Node.
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
let database: SQLiteDatabase;
const originalAdapter = getStorageAdapter();

beforeEach(() => {
  database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON; CREATE TABLE scripts (id TEXT PRIMARY KEY); CREATE TABLE folders (id TEXT PRIMARY KEY);");
  database.exec(readFileSync(new URL("../../../../../apps/scriptz/src-tauri/migrations/008_agent.sql", import.meta.url), "utf8"));
  database.exec("INSERT INTO scripts VALUES ('script'); INSERT INTO folders VALUES ('folder');");
  const bind = (values: unknown[] = []) => Object.fromEntries(Object.entries(values).map(([index, value]) => [`$${Number(index) + 1}`, value as SQLInputValue]));
  state.connection = {
    async select<T>(query: string, values?: unknown[]): Promise<T> {
      return database.prepare(query).all(bind(values)) as T;
    },
    async execute(query: string, values?: unknown[]) {
      const result = database.prepare(query).run(bind(values));
      return { rowsAffected: Number(result.changes), lastInsertId: Number(result.lastInsertRowid) };
    },
  };
  setPlatformAdapter({
    getDb: async () => {
      if (!state.connection) throw new Error("test database not initialized");
      return state.connection;
    },
  } as PlatformAdapter);
  setStorageAdapter({ ...originalAdapter, agent: sqlAgentStorage });
});

afterEach(() => {
  setStorageAdapter(originalAdapter);
  state.connection = null;
  database.close();
});

const chat = (overrides: Partial<ChatRecord> = {}): ChatRecord => ({
  id: "chat", scriptId: "script", provider: "codex", threadId: "thread", createdAt: 10, updatedAt: 10,
  items: [{ kind: "user", id: "user", text: "Remember this" }], ...overrides,
});

const memoryInput = { kind: "character" as const, folderId: "folder", subject: "TIMO", content: "  A\n fact  ", source: "user" as const };

describe("agent persistence boundary with SQLite", () => {
  it("round-trips chat history, restores interrupted UI state and keeps new-chat boundaries", async () => {
    await saveChat(chat({ items: [
      { kind: "assistant", id: "assistant", text: "Answer", streaming: true },
      { kind: "thinking", id: "thinking", text: "Thinking", done: false },
      { kind: "tool", id: "tool", tool: "read_script", args: {}, status: "running" },
      { kind: "search", id: "search", query: "reference", status: "running" },
    ] }));
    expect((await latestChat("script"))?.items).toEqual([
      { kind: "assistant", id: "assistant", text: "Answer", streaming: false },
      { kind: "thinking", id: "thinking", text: "Thinking", done: true },
      { kind: "tool", id: "tool", tool: "read_script", args: {}, status: "done" },
      { kind: "search", id: "search", query: "reference", status: "done" },
    ]);
    await saveChat(chat({ threadId: "resumed", updatedAt: 20 }));
    expect(await latestChat("script")).toMatchObject({ id: "chat", threadId: "resumed", createdAt: 10, updatedAt: 20 });
    await saveChat(chat({ id: "new-chat", threadId: null, items: [], createdAt: 30, updatedAt: 30 }));
    expect(await latestChat("script")).toMatchObject({ id: "new-chat", items: [] });
    expect(database.prepare("SELECT COUNT(*) AS n FROM agent_chats").get()?.n).toBe(2);
    await saveChat(chat({ id: "global", scriptId: null }));
    expect((await latestChat(null))?.id).toBe("global");
  });

  it("keeps malformed legacy chat JSON readable", async () => {
    await saveChat(chat());
    for (const invalid of ["broken", "{}", '[null,{"kind":"future"}]']) {
      database.prepare("UPDATE agent_chats SET items_json = ?").run(invalid);
      expect((await latestChat("script"))?.items).toEqual([]);
    }
  });

  it("preserves memory validation, update notifications, undo timestamps and learned markers", async () => {
    const version = memoryVersion();
    const entry = await addMemory(memoryInput);
    expect(entry.content).toBe("A fact");
    expect(await getMemoryEntry(entry.id)).toEqual(entry);
    expect(memoryVersion()).toBe(version + 1);
    const changed = await updateMemory(entry.id, " changed\n fact ");
    expect(changed).toMatchObject({ id: entry.id, content: "changed fact", createdAt: entry.createdAt });
    await deleteMemory(entry.id);
    expect(await getMemoryEntry(entry.id)).toBeNull();
    await restoreMemory(entry);
    expect(await getMemoryEntry(entry.id)).toEqual(entry);
    await expect(updateMemory("missing", "text")).rejects.toThrow("memory entry not found");
    await expect(addMemory({ ...memoryInput, content: " " })).rejects.toThrow("empty memory entry");
    await markLearned("script", "old-hash");
    await markLearned("script", "new-hash");
    expect(await learnedHash("script")).toBe("new-hash");
    await saveChat(chat());
    await clearMemory();
    expect(await listMemory()).toEqual([]);
    expect(await learnedHash("script")).toBeNull();
    expect(await latestChat("script")).not.toBeNull();
  });

  it("enforces scope limits independently for character base and folder profiles", async () => {
    for (let i = 0; i < 30; i++) await addMemory(memoryInput);
    await expect(addMemory(memoryInput)).rejects.toBeInstanceOf(MemoryFullError);
    await expect(addMemory({ ...memoryInput, folderId: null })).resolves.toMatchObject({ folderId: null });
  });

  it("routes all public writes through the currently registered adapter and propagates failures", async () => {
    const save = vi.fn().mockRejectedValue(new Error("storage unavailable"));
    const insert = vi.fn().mockRejectedValue(new Error("storage unavailable"));
    setStorageAdapter({ ...originalAdapter, agent: { ...sqlAgentStorage, saveChat: save, insertMemory: insert } });
    const version = memoryVersion();
    await expect(saveChat(chat())).rejects.toThrow("storage unavailable");
    await expect(addMemory(memoryInput)).rejects.toThrow("storage unavailable");
    expect(save).toHaveBeenCalledWith(chat());
    expect(insert).toHaveBeenCalledOnce();
    expect(memoryVersion()).toBe(version);
    expect(await listMemory()).toEqual([]);
  });
});
