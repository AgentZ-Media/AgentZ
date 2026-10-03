// `.scriptz` file format: a simple JSON container that makes a single
// script exchangeable between devices (web <-> desktop, desktop <-> desktop).
//
// Deliberately NOT in the format:
//   - `folder_id` (doesn't exist on the target device; import lands in
//      the root, user files it themselves).
//   - Snapshots (current state only). Can be added later as
//      `script.snapshots: [...]` without breaking the format (version: 2).
//   - Global character color overrides (`character_colors` table).
//      The `characters[].color` shipped with the file is enough for
//      rendering - app-wide overrides stay app-wide.
//   - App state, settings, ideas, daily word log - that's device state,
//      not script content.

import { normalizeLegacyTree } from "./legacyBlocks";
import { isScriptStatus, type ScriptCharacter, type ScriptStatus } from "./types";
import { t } from "../i18n";

/** File extension without the dot. */
export const SCRIPTZ_EXTENSION = "scriptz";
/** MIME type for blob download and <input accept>. */
export const SCRIPTZ_MIME = "application/x-scriptz+json";

/** Current format version. Version bumps only have to happen when
 *  a new reader can NO LONGER read the old format. Additive
 *  fields get default values during parsing and no bump. */
export const SCRIPTZ_VERSION_CURRENT = 1;

export interface ScriptzFileV1 {
  format: "scriptz";
  version: 1;
  exportedAt: string; // ISO 8601
  script: {
    title: string;
    contentJson: object; // parsed Lexical state - no double stringify
    characters: ScriptCharacter[];
    highlightingEnabled: number | null;
    createdAt: string; // ISO 8601
    updatedAt: string; // ISO 8601
    /** Production stage. Additive field (no version bump): older files
     *  don't carry it, the parser then falls back to "writing". */
    status: ScriptStatus;
  };
}

/** Format validation error. Caller catches with `instanceof` and shows
 *  a toast instead of crashing. */
export class ScriptzParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScriptzParseError";
  }
}

export interface ScriptForSerialization {
  title: string;
  content_json: string;
  characters: ScriptCharacter[];
  highlighting_enabled: number | null;
  created_at: number; // Unix-millis
  updated_at: number; // Unix-millis
  /** Optional so older callers keep compiling; missing = "writing". */
  status?: ScriptStatus;
}

/** Parses a stored Lexical state (converting retired block types to action),
 *  throwing a descriptive `ScriptzParseError` on malformed JSON. */
function parseContentOrThrow(contentJson: string): object {
  try {
    const parsed = JSON.parse(contentJson) as object;
    // Never ship retired block types to another device.
    normalizeLegacyTree(parsed);
    return parsed;
  } catch (err) {
    throw new ScriptzParseError(
      t("error.scriptz.invalidContent", { message: (err as Error).message }),
    );
  }
}

/** Flattens characters to `{name, color, share?}`, dropping the `share` key
 *  when undefined so the output stays clean. */
function flattenCharacters(characters: ScriptCharacter[]): ScriptCharacter[] {
  return characters.map((c) =>
    c.share === undefined
      ? { name: c.name, color: c.color }
      : { name: c.name, color: c.color, share: c.share },
  );
}

/** Pure: serializes a script into the V1 container object. */
export function serializeScript(script: ScriptForSerialization): ScriptzFileV1 {
  return {
    format: "scriptz",
    version: SCRIPTZ_VERSION_CURRENT,
    exportedAt: new Date().toISOString(),
    script: {
      title: script.title,
      contentJson: parseContentOrThrow(script.content_json),
      characters: flattenCharacters(script.characters),
      highlightingEnabled: script.highlighting_enabled,
      createdAt: new Date(script.created_at).toISOString(),
      updatedAt: new Date(script.updated_at).toISOString(),
      status: script.status ?? "writing",
    },
  };
}

/** Serializes to a UTF-8 byte string for download. */
export function serializeScriptToBytes(script: ScriptForSerialization): Uint8Array {
  const obj = serializeScript(script);
  const json = JSON.stringify(obj, null, 2);
  return new TextEncoder().encode(json);
}

/** Pure: parses and validates. Throws `ScriptzParseError` on broken
 *  files with a descriptive message. */
export function parseScriptzBytes(bytes: Uint8Array): ScriptzFileV1 {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (err) {
    throw new ScriptzParseError(
      t("error.scriptz.notUtf8", { message: (err as Error).message }),
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new ScriptzParseError(
      t("error.scriptz.notJson", { message: (err as Error).message }),
    );
  }
  return validateScriptzObject(raw);
}

function validateScriptzObject(raw: unknown): ScriptzFileV1 {
  if (typeof raw !== "object" || raw === null) {
    throw new ScriptzParseError(t("error.scriptz.notObject"));
  }
  const r = raw as Record<string, unknown>;
  if (r.format !== "scriptz") {
    throw new ScriptzParseError(
      t("error.scriptz.badFormat", { value: JSON.stringify(r.format) }),
    );
  }
  if (r.version !== 1) {
    throw new ScriptzParseError(
      t("error.scriptz.unsupportedVersion", { version: JSON.stringify(r.version) }),
    );
  }
  const script = r.script;
  if (typeof script !== "object" || script === null) {
    throw new ScriptzParseError(t("error.scriptz.missingScript"));
  }
  const s = script as Record<string, unknown>;
  if (typeof s.title !== "string") {
    throw new ScriptzParseError(t("error.scriptz.missingTitle"));
  }
  if (typeof s.contentJson !== "object" || s.contentJson === null) {
    throw new ScriptzParseError(t("error.scriptz.missingContent"));
  }
  // Files written before the block-type reduction may carry retired block
  // types - convert them so the importer gets editor-ready content.
  normalizeLegacyTree(s.contentJson);
  if (!Array.isArray(s.characters)) {
    throw new ScriptzParseError(t("error.scriptz.missingCharacters"));
  }
  // Validate characters flat - name + color must be strings.
  const characters: ScriptCharacter[] = [];
  for (let i = 0; i < s.characters.length; i++) {
    const c = s.characters[i] as Record<string, unknown>;
    if (typeof c?.name !== "string" || typeof c?.color !== "string") {
      throw new ScriptzParseError(
        t("error.scriptz.invalidCharacter", { index: i }),
      );
    }
    const entry: ScriptCharacter = { name: c.name, color: c.color };
    if (typeof c.share === "number") entry.share = c.share;
    characters.push(entry);
  }
  // Date fields are nice-to-have; on errors be tolerant -
  // our app doesn't use them on import (see applyScriptzFile),
  // it sets its own timestamps.
  const exportedAt = typeof r.exportedAt === "string" ? r.exportedAt : new Date().toISOString();
  const createdAt = typeof s.createdAt === "string" ? s.createdAt : exportedAt;
  const updatedAt = typeof s.updatedAt === "string" ? s.updatedAt : exportedAt;
  const highlightingEnabled =
    typeof s.highlightingEnabled === "number"
      ? s.highlightingEnabled
      : s.highlightingEnabled === null
        ? null
        : null;
  return {
    format: "scriptz",
    version: 1,
    exportedAt,
    script: {
      title: s.title,
      contentJson: s.contentJson,
      characters,
      highlightingEnabled,
      createdAt,
      updatedAt,
      status: isScriptStatus(s.status) ? s.status : "writing",
    },
  };
}

/** Slug-free filename suggestion with `.scriptz` extension. Replaces slashes
 *  and characters that file systems don't like with underscores. */
export function defaultScriptzFilename(title: string): string {
  const fallback = t("common.untitled");
  const cleaned = (title || fallback).replace(/[\\/:*?"<>|]+/g, "_").trim();
  return `${cleaned || fallback}.${SCRIPTZ_EXTENSION}`;
}
