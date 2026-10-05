// Agent memory (table `agent_memory`, migration 008).
//
// One row per remembered fact. Scopes:
//   global    - base knowledge, always in the agent's context
//   folder    - tone, world and patterns of one folder
//   character - a character profile; folder_id NULL = base profile for all
//               folders, otherwise the folder's own version of that person
//   relation  - how two characters relate (subject "A|B", sorted)
// Character names are stored upper-case, like the character blocks show them.

import { createSignal } from "solid-js";
import { getDb } from "../db";

export type MemoryKind = "global" | "folder" | "character" | "relation";
export type MemorySource = "chat" | "script" | "user";

export interface MemoryEntry {
  id: string;
  kind: MemoryKind;
  folderId: string | null;
  subject: string | null;
  content: string;
  source: MemorySource;
  sourceScriptId: string | null;
  createdAt: number;
  updatedAt: number;
}

interface MemoryRow {
  id: string;
  kind: string;
  folder_id: string | null;
  subject: string | null;
  content: string;
  source: string;
  source_script_id: string | null;
  created_at: number;
  updated_at: number;
}

/** Hard limits keep the always-loaded context small and force the agent to
 *  consolidate instead of piling up notes. */
export const MEMORY_LIMITS = {
  entryChars: 400,
  globalEntries: 40,
  perScopeEntries: 30,
} as const;

const KINDS: readonly MemoryKind[] = ["global", "folder", "character", "relation"];
const SOURCES: readonly MemorySource[] = ["chat", "script", "user"];

/** Bumps on every write so views (memory page, chat notices) reload. */
const [memoryVersion, setMemoryVersion] = createSignal(0);
export { memoryVersion };
const bump = () => setMemoryVersion((v) => v + 1);

function rowToEntry(row: MemoryRow): MemoryEntry {
  return {
    id: row.id,
    kind: (KINDS as readonly string[]).includes(row.kind) ? (row.kind as MemoryKind) : "global",
    folderId: row.folder_id,
    subject: row.subject,
    content: row.content,
    source: (SOURCES as readonly string[]).includes(row.source) ? (row.source as MemorySource) : "chat",
    sourceScriptId: row.source_script_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function normalizeCharacter(name: string): string {
  return name.trim().replace(/\s+/g, " ").toUpperCase();
}

/** Canonical subject for a relation: both names normalized, sorted. */
export function relationSubject(a: string, b: string): string {
  return [normalizeCharacter(a), normalizeCharacter(b)].sort().join("|");
}

export function cleanMemoryText(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, MEMORY_LIMITS.entryChars);
}

export async function listMemory(): Promise<MemoryEntry[]> {
  const db = await getDb();
  const rows = await db.select<MemoryRow[]>(
    "SELECT * FROM agent_memory ORDER BY kind, folder_id, subject, created_at",
  );
  return rows.map(rowToEntry);
}

export async function getMemoryEntry(id: string): Promise<MemoryEntry | null> {
  const db = await getDb();
  const rows = await db.select<MemoryRow[]>("SELECT * FROM agent_memory WHERE id = $1", [id]);
  return rows[0] ? rowToEntry(rows[0]) : null;
}

export interface MemoryScope {
  kind: MemoryKind;
  folderId: string | null;
  subject: string | null;
}

function scopeKey(scope: MemoryScope): string {
  return `${scope.kind}:${scope.folderId ?? ""}:${scope.subject ?? ""}`;
}

async function countScope(scope: MemoryScope): Promise<number> {
  const db = await getDb();
  const rows = await db.select<{ n: number }[]>(
    `SELECT COUNT(*) AS n FROM agent_memory
      WHERE kind = $1 AND folder_id IS $2 AND subject IS $3`,
    [scope.kind, scope.folderId, scope.subject],
  );
  return rows[0]?.n ?? 0;
}

export class MemoryFullError extends Error {
  constructor(readonly scope: MemoryScope) {
    super(`memory scope full: ${scopeKey(scope)}`);
  }
}

export interface AddMemoryInput extends MemoryScope {
  content: string;
  source: MemorySource;
  sourceScriptId?: string | null;
}

export async function addMemory(input: AddMemoryInput): Promise<MemoryEntry> {
  const content = cleanMemoryText(input.content);
  if (!content) throw new Error("empty memory entry");
  const limit = input.kind === "global" ? MEMORY_LIMITS.globalEntries : MEMORY_LIMITS.perScopeEntries;
  if ((await countScope(input)) >= limit) throw new MemoryFullError(input);
  const db = await getDb();
  const now = Date.now();
  const entry: MemoryEntry = {
    id: crypto.randomUUID(),
    kind: input.kind,
    folderId: input.folderId,
    subject: input.subject,
    content,
    source: input.source,
    sourceScriptId: input.sourceScriptId ?? null,
    createdAt: now,
    updatedAt: now,
  };
  await db.execute(
    `INSERT INTO agent_memory (id, kind, folder_id, subject, content, source, source_script_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [entry.id, entry.kind, entry.folderId, entry.subject, entry.content, entry.source, entry.sourceScriptId, now, now],
  );
  bump();
  return entry;
}

export async function updateMemory(id: string, content: string): Promise<MemoryEntry> {
  const clean = cleanMemoryText(content);
  if (!clean) throw new Error("empty memory entry");
  const db = await getDb();
  const result = await db.execute(
    "UPDATE agent_memory SET content = $1, updated_at = $2 WHERE id = $3",
    [clean, Date.now(), id],
  );
  if (result.rowsAffected === 0) throw new Error(`memory entry not found: ${id}`);
  bump();
  const entry = await getMemoryEntry(id);
  if (!entry) throw new Error(`memory entry not found: ${id}`);
  return entry;
}

export async function deleteMemory(id: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM agent_memory WHERE id = $1", [id]);
  bump();
}

/** Restores a deleted entry verbatim (undo). */
export async function restoreMemory(entry: MemoryEntry): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT OR REPLACE INTO agent_memory (id, kind, folder_id, subject, content, source, source_script_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [entry.id, entry.kind, entry.folderId, entry.subject, entry.content, entry.source, entry.sourceScriptId, entry.createdAt, entry.updatedAt],
  );
  bump();
}

export async function clearMemory(): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM agent_memory");
  await db.execute("DELETE FROM agent_learned");
  bump();
}

/** Memory relevant for one script: global knowledge, the folder's notes,
 *  base profiles and folder versions of the given characters, relations
 *  among them. */
export function selectRelevantMemory(
  all: readonly MemoryEntry[],
  folderId: string | null,
  characters: readonly string[],
): MemoryEntry[] {
  const names = new Set(characters.map(normalizeCharacter));
  return all.filter((entry) => {
    switch (entry.kind) {
      case "global":
        return true;
      case "folder":
        return folderId !== null && entry.folderId === folderId;
      case "character":
        return !!entry.subject && names.has(entry.subject) && (entry.folderId === null || entry.folderId === folderId);
      case "relation": {
        if (!entry.subject || (entry.folderId !== null && entry.folderId !== folderId)) return false;
        const [a, b] = entry.subject.split("|");
        return names.has(a) && names.has(b);
      }
    }
  });
}
