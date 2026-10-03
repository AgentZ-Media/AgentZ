import { createSignal } from "solid-js";
import { getKvStore, type KvStore } from "../platform";
import { createStatePersistence } from "./persistedState";

/** Typed complete-object layout persistence: one writer owns the shared key. */
export function createLayoutStore<State extends object>(options: {
  key: string;
  defaults: State;
  decode(value: unknown): Partial<State>;
}) {
  const [state, setState] = createSignal<State>({ ...options.defaults });
  let runtime: { active: boolean; kv: KvStore; stop(): void; persistence: ReturnType<typeof createStatePersistence> } | undefined;
  return {
    state,
    start(kv = getKvStore()) {
      if (runtime?.active) return runtime.stop;
      const persistence = createStatePersistence(kv, options.key);
      const current = {
        active: true, kv, persistence,
        stop() {
          if (!current.active) return;
          current.active = false; persistence.dispose();
          if (runtime === current) runtime = undefined;
        },
      };
      runtime = current;
      setState(() => ({ ...options.defaults }));
      return current.stop;
    },
    async load(isActive: () => boolean = () => true) {
      const current = runtime;
      if (!current) throw new Error("Layout runtime must start before load.");
      try {
        const raw = await current.kv.getAppState(options.key);
        if (!current.active || !isActive() || !raw) return;
        setState(() => ({ ...options.defaults, ...options.decode(JSON.parse(raw)) }));
      } catch { /* Invalid stored layout keeps the runtime defaults. */ }
    },
    update(patch: Partial<State>) {
      setState((previous) => ({ ...previous, ...patch }));
      runtime?.persistence.schedule(JSON.stringify(state()));
    },
  };
}
