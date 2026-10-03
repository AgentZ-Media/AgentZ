import type { FlushResult } from "@agentz/kit/lib";

interface CloseRequest { preventDefault(): void }
export interface LifecyclePorts {
  listenClose(handler: (event: CloseRequest) => void): Promise<() => void>;
  listenExit(handler: (requestId: number) => void): Promise<() => void>;
  listenMenu(handler: (action: string) => void): Promise<() => void>;
  ready(): Promise<void>;
  finishExit(requestId: number, ok: boolean): Promise<void>;
  destroy(): Promise<void>;
  flush(): Promise<FlushResult>;
  lockEditing(): () => void;
  editingLocked(): boolean;
  openSettings(section?: string): void;
  failed(error?: unknown): void;
}

/** Every close is synchronously prevented, including duplicate requests.
 * Native quit and window close share one pending transaction. */
export async function startDesktopLifecycle(ports: LifecyclePorts, signal?: AbortSignal): Promise<() => void> {
  const stops: Array<() => void> = [];
  let disposed = false;
  let busy = false;
  let pendingExit: number | undefined;
  const stop = () => {
    disposed = true;
    signal?.removeEventListener("abort", stop);
    for (const cleanup of stops.splice(0).reverse()) cleanup();
  };
  const add = (cleanup: () => void) => { if (disposed) cleanup(); else stops.push(cleanup); };
  if (signal?.aborted) return stop;
  signal?.addEventListener("abort", stop, { once: true });
  async function finish(kind: "close" | "exit", requestId?: number) {
    if (disposed) return;
    if (busy) {
      if (requestId !== undefined) pendingExit = requestId;
      return;
    }
    if (ports.editingLocked()) {
      if (requestId !== undefined) await ports.finishExit(requestId, false);
      return;
    }
    busy = true;
    const unlock = ports.lockEditing();
    try {
      const result = await ports.flush();
      const exitId = pendingExit ?? requestId;
      pendingExit = undefined;
      if (!result.ok || disposed) {
        if (!disposed) ports.failed();
        if (exitId !== undefined) await ports.finishExit(exitId, false);
        return;
      }
      if (exitId !== undefined) await ports.finishExit(exitId, true);
      else if (kind === "close") await ports.destroy();
    } catch (error) {
      ports.failed(error);
      const exitId = pendingExit ?? requestId;
      pendingExit = undefined;
      if (exitId !== undefined) {
        try { await ports.finishExit(exitId, false); } catch { /* native channel failed */ }
      }
    } finally {
      busy = false;
      unlock();
    }
  }
  try {
    add(await ports.listenClose((event) => {
      event.preventDefault();
      void finish("close");
    }));
    if (disposed) return stop;
    add(await ports.listenExit((requestId) => { void finish("exit", requestId); }));
    if (disposed) return stop;
    add(await ports.listenMenu((action) => {
      if (ports.editingLocked() || disposed) return;
      if (action === "settings") ports.openSettings();
      if (action === "about") ports.openSettings("about");
    }));
    if (!disposed) await ports.ready();
    return stop;
  } catch (error) {
    stop();
    throw error;
  }
}
