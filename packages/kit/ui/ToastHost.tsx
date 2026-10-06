import { For, Show, createEffect, createSignal, onCleanup } from "solid-js";
import { runToastAction, toastsSignal, type Toast } from "../stores";

/** How long a dismissed toast stays to play its exit (see `.toast.is-leaving`). */
const LEAVE_MS = 260;

export function ToastHost() {
  // Dismissed toasts stay rendered briefly so they can shrink away
  // instead of vanishing; the store itself drops them immediately.
  const [shown, setShown] = createSignal<Toast[]>([]);
  const [leaving, setLeaving] = createSignal<ReadonlySet<number>>(new Set());
  const timers = new Map<number, ReturnType<typeof setTimeout>>();

  createEffect(() => {
    const live = toastsSignal();
    const liveIds = new Set(live.map((t) => t.id));
    const current = shown();
    const added = live.filter((t) => !current.some((s) => s.id === t.id));
    const gone = current.filter((s) => !liveIds.has(s.id) && !timers.has(s.id));
    if (added.length) setShown([...current, ...added]);
    if (!gone.length) return;
    setLeaving((prev) => new Set([...prev, ...gone.map((t) => t.id)]));
    for (const t of gone) {
      timers.set(t.id, setTimeout(() => {
        timers.delete(t.id);
        setShown((list) => list.filter((s) => s.id !== t.id));
        setLeaving((prev) => {
          const next = new Set(prev);
          next.delete(t.id);
          return next;
        });
      }, LEAVE_MS));
    }
  });
  onCleanup(() => {
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
  });

  return (
    <div class="toast-host">
      <For each={shown()}>
        {(t) => (
          <div class={"toast " + t.kind} classList={{ "is-leaving": leaving().has(t.id) }} role="status">
            <span>{t.text}</span>
            <Show when={t.action}>
              {(action) => (
                <button type="button" class="undo" disabled={leaving().has(t.id)} onClick={() => runToastAction(t.id)}>
                  {action().label}
                </button>
              )}
            </Show>
          </div>
        )}
      </For>
    </div>
  );
}
