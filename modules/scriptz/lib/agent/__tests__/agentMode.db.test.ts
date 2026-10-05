// Agent mode against a real SQLite database with the real migrations
// 001-011: existing chats keep their meaning, sessions survive the deletion
// of the script they were handed to, ideas are marked used once, and the
// store keeps exactly one live object per chat row.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import { setPlatformAdapter, type DbConnection, type PlatformAdapter } from "@agentz/kit/platform";
import { getChat, latestChat, listSessions, saveChat, type ChatRecord } from "../chats";
import { createIdea, listIdeas, markIdeaUsed } from "../../ideas";
import { archiveScript, createScript, emptyTrash, purgeScript } from "../../scripts";
import { createFolder, deleteFolder } from "../../folders";
import { foldersBus } from "../../foldersBus";
import { agentStore, startAgentRuntime } from "../../../stores/agent";

// Loaded at run time: Vite 5 does not know `node:sqlite` as a builtin yet.
const { DatabaseSync } = createRequire(join(process.cwd(), "package.json"))("node:sqlite") as typeof import("node:sqlite");
type DatabaseSync = DatabaseSyncType;

// Tests run with the package as working directory (jsdom: no file URLs).
const MIGRATIONS = join(process.cwd(), "../../apps/scriptz/src-tauri/migrations");

function openDatabase(upTo = Infinity): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    if (Number(file.slice(0, 3)) > upTo) break;
    db.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
  }
  return db;
}

function connection(db: DatabaseSync): DbConnection {
  const sql = (query: string) => db.prepare(query.replace(/\$(\d+)/g, "?$1"));
  const args = (values: unknown[] = []) => values.map((v) => (v === undefined ? null : typeof v === "boolean" ? Number(v) : v)) as never[];
  return {
    async select<T>(query: string, values?: unknown[]) { return sql(query).all(...args(values)) as T; },
    async execute(query: string, values?: unknown[]) {
      const result = sql(query).run(...args(values));
      return { rowsAffected: Number(result.changes), lastInsertId: Number(result.lastInsertRowid) };
    },
  };
}

function useDatabase(db: DatabaseSync): void {
  const conn = connection(db);
  setPlatformAdapter({ getDb: async () => conn } as unknown as PlatformAdapter);
}

function session(id: string, scriptId: string | null, text = "Hallo"): ChatRecord {
  const now = Date.now();
  return {
    id, kind: "session", scriptId, provider: "codex", threadId: null, title: text, folderId: null,
    items: [{ kind: "user", id: `u-${id}`, text }], createdAt: now, updatedAt: now,
  };
}

describe("migration 010", () => {
  it("keeps chats from 008 as script chats", async () => {
    const db = openDatabase(9);
    const now = Date.now();
    db.exec(`INSERT INTO scripts (id, title, content_json, characters_meta, created_at, updated_at) VALUES ('s1', 'Alt', '{}', '[]', ${now}, ${now})`);
    db.exec(`INSERT INTO agent_chats (id, script_id, provider, items_json, created_at, updated_at) VALUES ('c1', 's1', 'codex', '[{"kind":"user","id":"u","text":"hi"}]', ${now}, ${now})`);
    db.exec(readFileSync(join(MIGRATIONS, "010_agent_sessions.sql"), "utf8"));
    db.exec(readFileSync(join(MIGRATIONS, "011_track_agent_sessions.sql"), "utf8"));
    useDatabase(db);
    const chat = await latestChat("s1");
    expect(chat).toMatchObject({ id: "c1", kind: "script", scriptId: "s1", title: null, folderId: null });
    expect(chat?.items).toHaveLength(1);
    expect(await listSessions()).toEqual([]);
  });
});

describe("agent mode storage", () => {
  let db: DatabaseSync;
  beforeAll(() => {
    db = openDatabase();
    useDatabase(db);
  });

  it("lists stored sessions and skips empty ones", async () => {
    await saveChat(session("a", null, "Ideen bitte"));
    await saveChat({ ...session("empty", null), items: [] });
    const list = await listSessions();
    expect(list.map((s) => s.id)).toEqual(["a"]);
    expect((await getChat("a"))?.title).toBe("Ideen bitte");
  });

  it("keeps a session when its script is deleted for good, but not a script chat", async () => {
    const script = await createScript("Aus der Sitzung", null, null);
    await saveChat(session("handed", script.id));
    await saveChat({ ...session("panel", script.id), kind: "script", updatedAt: Date.now() - 1000 });
    await purgeScript(script.id);
    expect(await getChat("handed")).toMatchObject({ id: "handed", scriptId: null, kind: "session" });
    expect(await getChat("panel")).toBeNull();
  });

  it("keeps sessions when the trash is emptied", async () => {
    const script = await createScript("Im Papierkorb", null, null);
    await saveChat(session("trashed", script.id));
    await archiveScript(script.id);
    await emptyTrash();
    expect(await getChat("trashed")).toMatchObject({ scriptId: null, kind: "session" });
  });

  it("never lets a stale chat write bring a deleted script's session down", async () => {
    const script = await createScript("Wettlauf", null, null);
    const stale = session("racing", script.id);
    await saveChat(stale);
    await purgeScript(script.id);
    // A snapshot queued before the deletion arrives afterwards: the foreign
    // key refuses it, the session itself stays.
    await expect(saveChat({ ...stale, updatedAt: Date.now() })).rejects.toThrow();
    expect(await getChat("racing")).toMatchObject({ scriptId: null, kind: "session" });
  });

  it("pages and searches sessions in the database", async () => {
    for (let i = 0; i < 5; i++) await saveChat({ ...session(`page-${i}`, null, `Seite ${i}`), updatedAt: 1000 + i });
    await saveChat({ ...session("pct", null, "100% Hook_test"), updatedAt: 900 });
    const first = await listSessions(2, 0, "Seite");
    const second = await listSessions(2, 2, "Seite");
    expect(first.map((s) => s.id)).toEqual(["page-4", "page-3"]);
    expect(second.map((s) => s.id)).toEqual(["page-2", "page-1"]);
    expect((await listSessions(10, 0, "100%")).map((s) => s.id)).toEqual(["pct"]);
    // "%" and "_" are literal, not wildcards.
    expect(await listSessions(10, 0, "Hook%test")).toEqual([]);
    expect((await listSessions(10, 0, "k_t")).map((s) => s.id)).toEqual(["pct"]);
  });

  it("marks an idea used once and remembers the session it came from", async () => {
    const idea = await createIdea({ title: "Die Mausbewegung", sourceChatId: "a" });
    const script = await createScript("Die Mausbewegung", null, null);
    expect(await markIdeaUsed(idea.id, script.id)).toBe(true);
    expect(await markIdeaUsed(idea.id, script.id)).toBe(false);
    const stored = (await listIdeas()).find((i) => i.id === idea.id);
    expect(stored).toMatchObject({ source_chat_id: "a", script_id: script.id });
    expect(stored?.used_at).not.toBeNull();
  });
});

describe("agent store registry", () => {
  let stop: () => void;
  beforeAll(() => {
    useDatabase(openDatabase());
    // A host that is never started: enough for the store to treat the
    // agent as present (reconciliation, session list).
    stop = startAgentRuntime({ codexHost: { locate: async () => null, start: async () => { throw new Error("not in tests"); } } });
  });
  afterAll(() => stop());

  it("serves one object per chat row, whichever view asks first", async () => {
    const script = await createScript("Geteilt", null, null);
    await saveChat(session("shared", script.id));
    const fromMode = agentStore.chat("shared");
    const fromPanel = await agentStore.sessionFor(script.id);
    expect(fromPanel).toBe(fromMode);

    const other = await createScript("Andersherum", null, null);
    await saveChat(session("shared-2", other.id));
    const panelFirst = await agentStore.sessionFor(other.id);
    expect(agentStore.chat("shared-2")).toBe(panelFirst);
    // Concurrent panel lookups share one load.
    const third = await createScript("Parallel", null, null);
    const [x, y] = await Promise.all([agentStore.sessionFor(third.id), agentStore.sessionFor(third.id)]);
    expect(x).toBe(y);
  });

  it("forgets a deleted folder, also the last one, and keeps saving", async () => {
    const folder = await createFolder("Einziger Ordner");
    const chat = agentStore.chat("in-folder", { folderId: folder.id });
    await chat.send("");
    chat.append([{ kind: "user", id: "u-folder", text: "Hallo" }]);
    await new Promise((r) => setTimeout(r, 0));
    await chat.flush();
    expect((await getChat("in-folder"))?.folderId).toBe(folder.id);
    await deleteFolder(folder.id);
    foldersBus.bump();
    await new Promise((r) => setTimeout(r, 50));
    expect(chat.folderId()).toBeNull();
    chat.append([{ kind: "interrupted", id: "after" }]);
    await new Promise((r) => setTimeout(r, 0));
    await chat.flush();
    expect((await getChat("in-folder"))?.items.map((i) => i.id)).toContain("after");
  });

  it("undo keeps ideas that became scripts, with their card marker", async () => {
    const chat = agentStore.chat("undo-board");
    await new Promise((r) => setTimeout(r, 0));
    chat.append([{
      kind: "ideas", id: "board", folderId: null, picked: [], savedIds: [null, null],
      ideas: [
        { title: "Bleibt", premise: "a", hook: "", characters: [], seconds: null },
        { title: "Geht", premise: "b", hook: "", characters: [], seconds: null },
      ],
    }]);
    await new Promise((r) => setTimeout(r, 0));
    expect(await chat.saveIdeas("board", [0, 1])).toBe(2);
    const receipt = chat.items.find((i) => i.kind === "ideas-saved")!;
    const board = () => chat.items.find((i) => i.kind === "ideas") as Extract<typeof chat.items[number], { kind: "ideas" }>;
    const [keptId, goneId] = board().savedIds as string[];
    const script = await createScript("Bleibt", null, null);
    await markIdeaUsed(keptId, script.id);
    await chat.undoSavedIdeas(receipt.id);
    const ids = (await listIdeas()).map((i) => i.id);
    expect(ids).toContain(keptId);
    expect(ids).not.toContain(goneId);
    expect(board().savedIds).toEqual([keptId, null]);
    const after = chat.items.find((i) => i.id === receipt.id) as Extract<typeof chat.items[number], { kind: "ideas-saved" }>;
    expect(after.undone).toBeFalsy();
    expect(after.saved.map((r) => r.ideaId)).toEqual([keptId]);
  });

  it("does not store a deleted session again", async () => {
    await saveChat(session("gone", null));
    const chat = agentStore.chat("gone");
    await new Promise((r) => setTimeout(r, 0));
    chat.append([{ kind: "interrupted", id: "late" }]);
    await agentStore.deleteSession("gone");
    await new Promise((r) => setTimeout(r, 500));
    await chat.flush().catch(() => {});
    expect(await getChat("gone")).toBeNull();
  });
});
