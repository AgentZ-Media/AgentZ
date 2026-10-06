// Shared helpers for reading model-supplied tool arguments and building tool
// results. Arguments come from a model, so readers never throw: anything
// unusable falls back to an empty value.

import type { ToolResult } from "./types";

export type Obj = Record<string, unknown>;

/** True for plain objects (not null, not arrays). */
export const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** The value as a plain object, or `{}` when it is none. */
export const obj = (v: unknown): Obj => (isObj(v) ? v : {});

/** Successful tool result; non-string values are sent as JSON. */
export const ok = (value: unknown): ToolResult => ({ ok: true, output: typeof value === "string" ? value : JSON.stringify(value) });

/** Failed tool result carrying `{ error: message }`. */
export const fail = (message: string): ToolResult => ({ ok: false, output: JSON.stringify({ error: message }) });
