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
import { getStorageAdapter } from "../storage";

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

/** Hard limits keep the always-loaded context small and force the agent to
 *  consolidate instead of piling up notes. */
export const MEMORY_LIMITS = {
  entryChars: 400,
  globalEntries: 40,
  perScopeEntries: 30,
} as const;

/** Bumps on every write so views (memory page, chat notices) reload. */
const [memoryVersion, setMemoryVersion] = createSignal(0);
export { memoryVersion };
/** Notifies memory consumers after a successful persistence operation. */
const bump = () => setMemoryVersion((v) => v + 1);
/** Memory rows changed outside these functions (cloud sync). */
export const notifyMemoryChanged = bump;

/** Collapses whitespace and normalizes character names for memory scope matching. */
export function normalizeCharacter(name: string): string {
  return name.trim().replace(/\s+/g, " ").toUpperCase();
}

/** Canonical subject for a relation: both names normalized, sorted. */
export function relationSubject(a: string, b: string): string {
  return [normalizeCharacter(a), normalizeCharacter(b)].sort().join("|");
}

/** Normalizes whitespace and caps a fact at the memory context character limit. */
export function cleanMemoryText(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, MEMORY_LIMITS.entryChars);
}

/** Lists stored facts through the active adapter for later context selection. */
export async function listMemory(): Promise<MemoryEntry[]> {
  return getStorageAdapter().agent.listMemory();
}

/** Loads a single fact by ID, returning null if it no longer exists. */
export async function getMemoryEntry(id: string): Promise<MemoryEntry | null> {
  return getStorageAdapter().agent.getMemoryEntry(id);
}

export interface MemoryScope {
  kind: MemoryKind;
  folderId: string | null;
  subject: string | null;
}

/** Formats the scope included in memory-capacity error messages. */
function scopeKey(scope: MemoryScope): string {
  return `${scope.kind}:${scope.folderId ?? ""}:${scope.subject ?? ""}`;
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

/** Validates a fact and its scope capacity, persists it, then notifies memory consumers. */
export async function addMemory(input: AddMemoryInput): Promise<MemoryEntry> {
  const content = cleanMemoryText(input.content);
  if (!content) throw new Error("empty memory entry");
  const limit = input.kind === "global" ? MEMORY_LIMITS.globalEntries : MEMORY_LIMITS.perScopeEntries;
  if ((await getStorageAdapter().agent.countMemoryScope(input)) >= limit) throw new MemoryFullError(input);
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
  await getStorageAdapter().agent.insertMemory(entry);
  bump();
  return entry;
}

/** Validates and updates an existing fact; rejects empty text and missing records. */
export async function updateMemory(id: string, content: string): Promise<MemoryEntry> {
  const clean = cleanMemoryText(content);
  if (!clean) throw new Error("empty memory entry");
  const updated = await getStorageAdapter().agent.updateMemory(id, clean, Date.now());
  if (!updated) throw new Error(`memory entry not found: ${id}`);
  bump();
  const entry = await getMemoryEntry(id);
  if (!entry) throw new Error(`memory entry not found: ${id}`);
  return entry;
}

/** Deletes a fact by ID and notifies consumers after the adapter succeeds. */
export async function deleteMemory(id: string): Promise<void> {
  await getStorageAdapter().agent.deleteMemory(id);
  bump();
}

/** Restores a deleted entry verbatim (undo). */
export async function restoreMemory(entry: MemoryEntry): Promise<void> {
  await getStorageAdapter().agent.restoreMemory(entry);
  bump();
}

/** Clears facts and learned-script markers, preserves chats, then notifies consumers. */
export async function clearMemory(): Promise<void> {
  await getStorageAdapter().agent.clearMemory();
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
