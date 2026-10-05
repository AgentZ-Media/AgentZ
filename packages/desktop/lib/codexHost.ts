import { Channel, invoke } from "@tauri-apps/api/core";

export interface CodexLocation { path: string; version: string | null }
export interface CodexProcess {
  readonly id: number;
  send(line: string): Promise<void>;
  onLine(cb: (line: string) => void): () => void;
  onStderr(cb: (line: string) => void): () => void;
  onExit(cb: (code: number | null) => void): () => void;
  stop(): Promise<void>;
}
export interface CodexHost {
  locate(): Promise<CodexLocation | null>;
  start(config?: string[]): Promise<CodexProcess>;
}

/** Wire format of `CodexEvent` in `crates/agentz-desktop/src/codex.rs`. */
type CodexEvent =
  | { type: "stdout"; line: string }
  | { type: "stderr"; line: string }
  | { type: "exit"; code: number | null };

const COMMAND = "plugin:agentz-desktop|";
/** Lines kept for a stream nobody has subscribed to yet (oldest dropped first). */
const STDOUT_BUFFER_LIMIT = 1000;
const STDERR_BUFFER_LIMIT = 200;

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/** Delivers to all listeners; lines arriving before the first listener are
 * buffered and replayed synchronously to it, so no handshake reply is lost. */
function createLineStream(limit: number) {
  const listeners = new Set<(line: string) => void>();
  let buffer: string[] | undefined = [];
  return {
    push(line: string) {
      if (buffer) {
        buffer.push(line);
        if (buffer.length > limit) buffer.shift();
        return;
      }
      for (const listener of [...listeners]) listener(line);
    },
    subscribe(cb: (line: string) => void): () => void {
      listeners.add(cb);
      const pending = buffer;
      buffer = undefined;
      for (const line of pending ?? []) cb(line);
      return () => { listeners.delete(cb); };
    },
  };
}

/** Runs the Codex CLI as `codex app-server` through the native host.
 * Creating the host performs no I/O; everything happens on first call. */
export function createCodexHost(): CodexHost {
  return {
    async locate() {
      try {
        return await invoke<CodexLocation | null>(`${COMMAND}codex_locate`);
      } catch (error) {
        throw toError(error);
      }
    },
    async start(config = []) {
      const stdout = createLineStream(STDOUT_BUFFER_LIMIT);
      const stderr = createLineStream(STDERR_BUFFER_LIMIT);
      const exitListeners = new Set<(code: number | null) => void>();
      let exited: { code: number | null } | undefined;
      // Subscribe before starting: output may arrive before the id resolves.
      const channel = new Channel<CodexEvent>((event) => {
        if (event.type === "stdout") stdout.push(event.line);
        else if (event.type === "stderr") stderr.push(event.line);
        else if (!exited) {
          exited = { code: event.code };
          for (const listener of [...exitListeners]) listener(event.code);
        }
      });
      let id: number;
      try {
        id = await invoke<number>(`${COMMAND}codex_start`, { config, onEvent: channel });
      } catch (error) {
        throw toError(error);
      }
      // Writes are chained so lines reach stdin in call order even when
      // callers do not await each send.
      let queue: Promise<void> = Promise.resolve();
      return {
        id,
        send(line) {
          const result = queue.then(async () => {
            if (exited) throw new Error("Codex session has exited");
            try {
              await invoke<void>(`${COMMAND}codex_send`, { id, line });
            } catch (error) {
              throw toError(error);
            }
          });
          queue = result.catch(() => {});
          return result;
        },
        onLine: stdout.subscribe,
        onStderr: stderr.subscribe,
        onExit(cb) {
          exitListeners.add(cb);
          if (exited) cb(exited.code);
          return () => { exitListeners.delete(cb); };
        },
        async stop() {
          try {
            await invoke<void>(`${COMMAND}codex_stop`, { id });
          } catch (error) {
            throw toError(error);
          }
        },
      };
    },
  };
}
