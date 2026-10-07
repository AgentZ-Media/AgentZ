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
  /** Asked after a repeated failed save: leave anyway and lose the changes? */
  confirmUnsaved(kind: "close" | "exit"): Promise<boolean>;
  /** Last step before leaving, after everything was saved (e.g. installing a
   *  downloaded update). Errors are swallowed; it never keeps the app open. */
  beforeLeave?(kind: "close" | "exit"): Promise<void>;
}

/** If an authorized exit does not end the process, editing comes back. */
const EXIT_UNLOCK_FALLBACK_MS = 3000;
/** A hanging last step (installer, backup) never blocks leaving for longer. */
const BEFORE_LEAVE_TIMEOUT_MS = 60_000;

async function settled(work: Promise<void> | undefined, ms: number): Promise<void> {
  if (!work) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([work.catch(() => {}), new Promise<void>((done) => { timer = setTimeout(done, ms); })]);
  clearTimeout(timer);
}

/** Every close is synchronously prevented, including duplicate requests.
 * Native quit and window close share one pending transaction. */
export async function startDesktopLifecycle(ports: LifecyclePorts, signal?: AbortSignal): Promise<() => void> {
  const stops: Array<() => void> = [];
  let disposed = false;
  let busy = false;
  let pendingExit: number | undefined;
  // A failed save is reported once; the next attempt may leave without it.
  let previousFailed = false;
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
    // Once the window or app is leaving, editing stays locked so nothing
    // typed in the last moment can be lost.
    let leaving = false;
    try {
      const result = await ports.flush();
      let exitId = pendingExit ?? requestId;
      pendingExit = undefined;
      if (disposed) {
        if (exitId !== undefined) await ports.finishExit(exitId, false);
        return;
      }
      let proceed = result.ok;
      if (!proceed) {
        if (previousFailed) {
          proceed = await ports.confirmUnsaved(exitId !== undefined ? "exit" : "close");
          // A quit requested while the dialog was open joins this decision.
          exitId = pendingExit ?? exitId;
          pendingExit = undefined;
        } else {
          ports.failed();
        }
        previousFailed = !proceed;
      }
      if (!proceed || disposed) {
        if (exitId !== undefined) await ports.finishExit(exitId, false);
        return;
      }
      previousFailed = false;
      // Only after everything was saved: leaving without saving ("quit
      // anyway") must not install an update on top of it.
      if (result.ok) await settled(ports.beforeLeave?.(exitId !== undefined ? "exit" : "close"), BEFORE_LEAVE_TIMEOUT_MS);
      // A quit requested during the last step joins this one.
      exitId = pendingExit ?? exitId;
      pendingExit = undefined;
      if (disposed) {
        if (exitId !== undefined) await ports.finishExit(exitId, false);
        return;
      }
      if (exitId !== undefined) {
        await ports.finishExit(exitId, true);
        leaving = true;
        setTimeout(unlock, EXIT_UNLOCK_FALLBACK_MS);
      } else if (kind === "close") {
        await ports.destroy();
        leaving = true;
      }
    } catch (error) {
      ports.failed(error);
      const exitId = pendingExit ?? requestId;
      pendingExit = undefined;
      if (exitId !== undefined) {
        try { await ports.finishExit(exitId, false); } catch { /* native channel failed */ }
      }
    } finally {
      busy = false;
      if (!leaving) unlock();
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
