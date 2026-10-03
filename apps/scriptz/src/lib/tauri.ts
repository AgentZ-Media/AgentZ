import { invoke as tauriInvoke } from "@tauri-apps/api/core";

/** Thin wrapper around tauri's invoke, preserving error messages. */
export function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return tauriInvoke<T>(cmd, args ?? {});
}

export const isTauri = typeof (window as any).__TAURI_INTERNALS__ !== "undefined";
