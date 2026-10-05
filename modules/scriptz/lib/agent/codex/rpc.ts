// Minimal JSON-RPC client for `codex app-server` (newline-delimited JSON
// over the process' stdio). Codex does not require the `"jsonrpc":"2.0"`
// field; frames are `{id, method, params}` / `{id, result | error}` /
// `{method, params}` (notification).

export interface CodexProcessLike {
  send(line: string): Promise<void>;
  onLine(cb: (line: string) => void): () => void;
  onExit(cb: (code: number | null) => void): () => void;
  stop(): Promise<void>;
}

export class RpcError extends Error {
  constructor(message: string, readonly code: number, readonly data?: unknown) {
    super(message);
  }
}

export class RpcClosedError extends Error {
  constructor(readonly exitCode: number | null) {
    super(`codex app-server exited (${exitCode ?? "signal"})`);
  }
}

type Pending = { resolve(value: unknown): void; reject(error: Error): void; method: string };
type JsonObject = Record<string, unknown>;

export type NotificationHandler = (method: string, params: JsonObject) => void;
/** Handles a server -> client request; the returned value is the result. */
export type RequestHandler = (method: string, params: JsonObject) => Promise<unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class RpcClient {
  private nextId = 1;
  private readonly pending = new Map<string, Pending>();
  private readonly notificationHandlers = new Set<NotificationHandler>();
  private readonly closeHandlers = new Set<(error: RpcClosedError) => void>();
  private requestHandler: RequestHandler | null = null;
  private closed: RpcClosedError | null = null;
  private sendChain: Promise<void> = Promise.resolve();
  private readonly unsubscribe: Array<() => void> = [];

  constructor(private readonly process: CodexProcessLike) {
    this.unsubscribe.push(process.onLine((line) => this.receive(line)));
    this.unsubscribe.push(process.onExit((code) => this.fail(new RpcClosedError(code))));
  }

  get isClosed(): boolean {
    return this.closed !== null;
  }

  onNotification(handler: NotificationHandler): () => void {
    this.notificationHandlers.add(handler);
    return () => this.notificationHandlers.delete(handler);
  }

  /** Called once when the process exits or the client is closed. */
  onClose(handler: (error: RpcClosedError) => void): () => void {
    this.closeHandlers.add(handler);
    return () => this.closeHandlers.delete(handler);
  }

  setRequestHandler(handler: RequestHandler | null): void {
    this.requestHandler = handler;
  }

  request<T>(method: string, params?: unknown, timeoutMs = 0): Promise<T> {
    if (this.closed) return Promise.reject(this.closed);
    const id = this.nextId++;
    const frame: JsonObject = { id, method };
    if (params !== undefined) frame.params = params;
    return new Promise<T>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const settle = () => { if (timer) clearTimeout(timer); this.pending.delete(String(id)); };
      this.pending.set(String(id), {
        method,
        resolve: (value) => { settle(); resolve(value as T); },
        reject: (error) => { settle(); reject(error); },
      });
      if (timeoutMs > 0) {
        timer = setTimeout(() => this.pending.get(String(id))?.reject(new Error(`${method} timed out`)), timeoutMs);
      }
      this.write(frame).catch((error: unknown) => {
        this.pending.get(String(id))?.reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }

  notify(method: string, params?: unknown): Promise<void> {
    const frame: JsonObject = { method };
    if (params !== undefined) frame.params = params;
    return this.write(frame);
  }

  async close(): Promise<void> {
    this.fail(new RpcClosedError(null));
    for (const off of this.unsubscribe.splice(0)) off();
    await this.process.stop().catch(() => {});
  }

  /** Writes are serialized so frames never interleave. */
  private write(frame: JsonObject): Promise<void> {
    if (this.closed) return Promise.reject(this.closed);
    const line = JSON.stringify(frame);
    const run = this.sendChain.then(() => this.process.send(line));
    this.sendChain = run.catch(() => {});
    return run;
  }

  private receive(raw: string): void {
    const line = raw.trim();
    if (!line) return;
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      console.warn("[agent] unparseable codex frame", line.slice(0, 200));
      return;
    }
    if (!isObject(message)) return;
    const method = typeof message.method === "string" ? message.method : null;
    const hasId = "id" in message && (typeof message.id === "number" || typeof message.id === "string");
    const params = isObject(message.params) ? message.params : {};
    if (method && hasId) {
      void this.answer(message.id as number | string, method, params);
      return;
    }
    if (method) {
      for (const handler of this.notificationHandlers) {
        try {
          handler(method, params);
        } catch (error) {
          console.warn("[agent] notification handler failed", method, error);
        }
      }
      return;
    }
    if (hasId) {
      const pending = this.pending.get(String(message.id));
      if (!pending) return;
      if (isObject(message.error)) {
        const err = message.error;
        pending.reject(new RpcError(
          typeof err.message === "string" ? err.message : `${pending.method} failed`,
          typeof err.code === "number" ? err.code : -1,
          err.data,
        ));
      } else {
        pending.resolve(message.result);
      }
    }
  }

  private async answer(id: number | string, method: string, params: JsonObject): Promise<void> {
    const handler = this.requestHandler;
    if (!handler) {
      await this.write({ id, error: { code: -32601, message: `unsupported: ${method}` } }).catch(() => {});
      return;
    }
    try {
      const result = await handler(method, params);
      await this.write({ id, result: result ?? null });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code = error instanceof RpcError ? error.code : -32000;
      await this.write({ id, error: { code, message } }).catch(() => {});
    }
  }

  private fail(error: RpcClosedError): void {
    if (this.closed) return;
    this.closed = error;
    for (const pending of [...this.pending.values()]) pending.reject(error);
    this.pending.clear();
    for (const handler of [...this.closeHandlers]) handler(error);
    this.closeHandlers.clear();
  }
}
