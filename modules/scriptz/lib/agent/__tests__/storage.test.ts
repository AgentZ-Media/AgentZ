// @vitest-environment node
import { createRequire } from "node:module";
import type { DatabaseSync as SQLiteDatabase, SQLInputValue } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getStorageAdapter, setStorageAdapter } from "../../storage";
import { setPlatformAdapter, type DbConnection, type PlatformAdapter } from "@agentz/kit/platform";
import { deleteChat, getChat, latestChat, learnedState, listSessions, markLearned, saveChat, type ChatRecord } from "../chats";
import {
  addMemory, clearMemory, deleteMemory, getMemoryEntry, listMemory, memoryVersion,
  MemoryFullError, restoreMemory, updateMemory,
} from "../memory";
import { sqlAgentStorage } from "../sqlStorage";
import { threadStore } from "../threads";
import { emptyTrash, purgeScript } from "../../scripts";

const state = { connection: null as DbConnection | null };
const migrations = new URL("../../../../../apps/scriptz/src-tauri/migrations/", import.meta.url);

// Vite 5 predates node:sqlite; resolve this test-only built-in through Node.
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
let database: SQLiteDatabase;
const originalAdapter = getStorageAdapter();

beforeEach(() => {
  database = new DatabaseSync(":memory:");
  // The exact schema of an installed app: every published migration in order.
  database.exec("PRAGMA foreign_keys = ON");
  for (const file of readdirSync(migrations).filter((name) => name.endsWith(".sql")).sort()) {
    database.exec(readFileSync(new URL(file, migrations), "utf8"));
  }
  database.exec(`
    INSERT INTO folders (id, name, created_at, updated_at) VALUES ('folder', 'Folder', 1, 1);
    INSERT INTO scripts (id, title, content_json, created_at, updated_at) VALUES ('script', 'Script', '{}', 1, 1);
  `);
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

/** Builds a persisted-chat fixture with explicit overrides for recovery and scope cases. */
const chat = (overrides: Partial<ChatRecord> = {}): ChatRecord => ({
  id: "chat", kind: "script", scriptId: "script", provider: "codex", threadId: "thread", title: null, folderId: null, createdAt: 10, updatedAt: 10,
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
    await markLearned("script", "old-hash", "dialog:old");
    await markLearned("script", "new-hash", "dialog:new");
    expect(await learnedState("script")).toMatchObject({ hash: "new-hash", text: "dialog:new" });
    await saveChat(chat());
    await clearMemory();
    expect(await listMemory()).toEqual([]);
    expect(await learnedState("script")).toBeNull();
    expect(await latestChat("script")).not.toBeNull();
  });

  it("enforces scope limits independently for character base and folder profiles", async () => {
    for (let i = 0; i < 30; i++) await addMemory(memoryInput);
    await expect(addMemory(memoryInput)).rejects.toBeInstanceOf(MemoryFullError);
    await expect(addMemory({ ...memoryInput, folderId: null })).resolves.toMatchObject({ folderId: null });
  });

  it("stores agent-mode sessions behind the same boundary", async () => {
    const session = (overrides: Partial<ChatRecord> = {}) => chat({
      id: "session", kind: "session", scriptId: null, title: "Hooks 100%_test", folderId: "folder", ...overrides,
    });
    await saveChat(session());
    await saveChat(session({ id: "empty", title: "Empty", items: [] }));
    await saveChat(chat());
    expect(await getChat("session")).toMatchObject({ kind: "session", title: "Hooks 100%_test", folderId: "folder", scriptId: null });
    // Only sessions with content; LIKE wildcards in the query are literal.
    expect((await listSessions()).map((s) => s.id)).toEqual(["session"]);
    expect((await listSessions(40, 0, "100%_")).map((s) => s.id)).toEqual(["session"]);
    expect(await listSessions(40, 0, "100%x")).toEqual([]);
    expect((await listSessions(40, 0, "remember")).map((s) => s.id)).toEqual(["session"]);
    // Handed to a script: the script link and title follow, the kind stays.
    await saveChat(session({ scriptId: "script", title: "Renamed", updatedAt: 50 }));
    expect(await latestChat("script")).toMatchObject({ id: "session", kind: "session", title: "Renamed" });
    // Purging the script frees the session (migration 010) but drops script chats.
    database.exec("DELETE FROM scripts WHERE id = 'script'");
    expect(await getChat("session")).toMatchObject({ scriptId: null });
    expect(await getChat("chat")).toBeNull();
    // Ideas saved from a deleted session stay, without the link.
    database.exec("INSERT INTO ideas (id, title, notes, created_at, source_chat_id) VALUES ('idea', 'Idea', '', 1, 'session')");
    await deleteChat("session");
    expect(await getChat("session")).toBeNull();
    expect(database.prepare("SELECT source_chat_id FROM ideas WHERE id = 'idea'").get()).toEqual({ source_chat_id: null });
  });

  it("reads the items of a listed session only after it changed", async () => {
    const session = (overrides: Partial<ChatRecord> = {}) => chat({
      id: "listed", kind: "session", scriptId: null, title: "Listed", updatedAt: 20, ...overrides,
    });
    await saveChat(session());
    const getChats = vi.spyOn(sqlAgentStorage, "getChats");
    setStorageAdapter({ ...originalAdapter, agent: sqlAgentStorage });
    expect((await listSessions()).map((s) => [s.id, s.title])).toEqual([["listed", "Listed"]]);
    await listSessions();
    expect(getChats).toHaveBeenCalledTimes(1);
    // A new write (newer time, new items) is read again; a new title alone
    // comes from the light columns.
    await saveChat(session({ updatedAt: 30, title: "Renamed", items: [{ kind: "handoff", id: "h", scriptId: "script", title: "T", slug: "a", versionId: "m#0", folderId: null, at: 1 }] }));
    expect(await listSessions()).toMatchObject([{ id: "listed", title: "Renamed", finished: 1, updatedAt: 30 }]);
    expect(getChats).toHaveBeenCalledTimes(2);
    getChats.mockRestore();
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

describe("harness transcripts (migration 016)", () => {
  const record = (id: string, updatedAt: number) => ({ id, provider: "openrouter", messagesJson: `[{"role":"user","content":"${id}"}]`, createdAt: 1, updatedAt });

  it("stores, updates and prunes transcripts; deleting a chat removes its transcript", async () => {
    await threadStore.save(record("t1", 10));
    await threadStore.save({ ...record("t1", 20), provider: "other", createdAt: 99, messagesJson: "[]" });
    // Provider and creation time stay as first saved.
    expect(await threadStore.get("t1")).toEqual({ id: "t1", provider: "openrouter", messagesJson: "[]", createdAt: 1, updatedAt: 20 });
    expect(await threadStore.get("missing")).toBeNull();

    await threadStore.save(record("t2", 30));
    await threadStore.save(record("t3", 40));
    await threadStore.prune(2);
    expect(await threadStore.get("t1")).toBeNull();
    expect(await threadStore.get("t2")).not.toBeNull();

    await saveChat(chat({ id: "with-thread", threadId: "t3" }));
    await deleteChat("with-thread");
    expect(await threadStore.get("t3")).toBeNull();
    expect(await threadStore.get("t2")).not.toBeNull();
  });

  it("purging a script removes the transcripts of its chats, not of sessions", async () => {
    await threadStore.save(record("t-chat", 10));
    await threadStore.save(record("t-session", 10));
    await saveChat(chat({ id: "script-chat", threadId: "t-chat" }));
    await saveChat(chat({ id: "session", threadId: "t-session", kind: "session" }));
    await purgeScript("script");
    expect(await threadStore.get("t-chat")).toBeNull();
    expect(await threadStore.get("t-session")).not.toBeNull();
  });

  it("emptying the trash removes the transcripts of its script chats", async () => {
    await threadStore.save(record("t-chat", 10));
    await saveChat(chat({ id: "script-chat", threadId: "t-chat" }));
    database.exec("UPDATE scripts SET archived_at = 5 WHERE id = 'script'");
    await emptyTrash();
    expect(await threadStore.get("t-chat")).toBeNull();
  });

  it("is device state: no change feed entries", async () => {
    const before = database.prepare("SELECT COUNT(*) AS n FROM local_changes").get() as { n: number };
    await threadStore.save(record("t1", 10));
    const after = database.prepare("SELECT COUNT(*) AS n FROM local_changes").get() as { n: number };
    expect(after.n).toBe(before.n);
  });
});
