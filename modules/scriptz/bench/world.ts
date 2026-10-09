// A benchmark world: one fresh SQLite database with the app's migrations,
// seeded with a demo profile through the app's own storage functions. Every
// (profile, model, repetition) gets its own world, so memory the agent
// writes in one run never reaches another. Worlds run side by side: the
// platform adapter hands each async call chain the database of its world.

import { AsyncLocalStorage } from "node:async_hooks";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DatabaseSync } from "node:sqlite";
import { createSqlKvStore, getKvStore, getPlatformAdapter, setKvStore, setPlatformAdapter, type DbConnection, type PlatformAdapter } from "@agentz/kit/platform";
import { api, registerSqlStorageAdapter } from "../lib/api";
import { contentJsonFromBlocks, parseDraftBody } from "../lib/agent/drafts";
import { addMemory } from "../lib/agent/memory";
import type { AgentBlock } from "../lib/agent/scriptText";
import type { AgentProvider } from "../lib/agent/types";
import type { Profile } from "./profiles/types";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = join(HERE, "../../../apps/scriptz/src-tauri/migrations");
// Loaded at run time: Vite does not know `node:sqlite` as a builtin.
const { DatabaseSync: Database } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

/** What a running request needs to know about where it belongs. */
export interface WorldContext {
  world: World;
  /** Task the current call chain works on (for the step log). */
  task: string | null;
}

export interface World {
  id: string;
  profile: Profile;
  model: string;
  rep: number;
  db: DatabaseSync;
  conn: DbConnection;
  /** Script key -> id, folder key -> id. */
  scripts: Map<string, string>;
  folders: Map<string, string>;
  /** Seeded blocks per script key (what the tasks start from). */
  blocks: Map<string, AgentBlock[]>;
  provider: AgentProvider | null;
}

export const context = new AsyncLocalStorage<WorldContext>();

export function currentWorld(): World {
  const ctx = context.getStore();
  if (!ctx) throw new Error("no benchmark world in this call chain");
  return ctx.world;
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

let installed = false;

/** Platform, key-value store and SQL storage of the app, routed per world. */
export function installPlatform(): void {
  if (installed) return;
  installed = true;
  setPlatformAdapter({ getDb: async () => currentWorld().conn } as unknown as PlatformAdapter);
  setKvStore(createSqlKvStore(() => getPlatformAdapter().getDb()));
  registerSqlStorageAdapter();
}

function migrate(db: DatabaseSync): void {
  db.exec("PRAGMA foreign_keys = ON;");
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    db.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
  }
}

export function createWorld(profile: Profile, model: string, rep: number): World {
  const db = new Database(":memory:");
  migrate(db);
  return {
    id: `${profile.id}|${model}|${rep}`, profile, model, rep, db, conn: connection(db),
    scripts: new Map(), folders: new Map(), blocks: new Map(), provider: null,
  };
}

/** Writes the profile's settings rows (before the settings stores load). */
export async function writeSettings(world: World): Promise<void> {
  await context.run({ world, task: null }, async () => {
    for (const [key, value] of Object.entries(world.profile.settings)) await getKvStore().setSetting(key, value);
  });
}

/** Folders, scripts (with stage), memory and ideas through the app's API.
 *  Needs the settings stores loaded (stages are validated against them). */
export async function seedContent(world: World): Promise<void> {
  const { profile } = world;
  await context.run({ world, task: null }, async () => {
    for (const folder of profile.folders) {
      const created = await api.createFolder(folder.name);
      if (folder.minSec !== null || folder.maxSec !== null) await api.setFolderLengthRange(created.id, folder.minSec, folder.maxSec);
      world.folders.set(folder.key, created.id);
    }
    for (const script of profile.scripts) {
      const blocks = parseDraftBody(script.body);
      const created = await api.createScript({ title: script.title, initialContentJson: contentJsonFromBlocks(blocks), folderId: world.folders.get(script.folder) ?? null });
      await api.setScriptStatus(created.id, script.stage);
      world.scripts.set(script.key, created.id);
      world.blocks.set(script.key, blocks);
    }
    for (const entry of profile.memory) {
      await addMemory({
        kind: entry.kind,
        folderId: entry.folder ? world.folders.get(entry.folder) ?? null : null,
        subject: entry.subject ?? null,
        content: entry.content,
        source: "user",
      });
    }
    for (const idea of profile.ideas) {
      await api.createIdea({ title: idea.title, notes: idea.notes, folderId: idea.folder ? world.folders.get(idea.folder) ?? null : null });
    }
  });
}

export function scriptId(world: World, key: string): string {
  const id = world.scripts.get(key);
  if (!id) throw new Error(`profile ${world.profile.id} has no script ${key}`);
  return id;
}
