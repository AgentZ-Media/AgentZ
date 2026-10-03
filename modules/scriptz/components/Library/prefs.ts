import { getKvStore, type KvStore } from "@agentz/kit/platform";
import { createStatePersistence } from "@agentz/kit/stores";
// View preferences of the scripts page (grouping, sort, collapsed groups),
// persisted in app_state. Module-level so they survive the page being
// unmounted while a script is open.

import { createSignal } from "solid-js";

export type Grouping = "stage" | "folder" | "none";
export type SortKey = "updated" | "created" | "title";

const PREFS_KEY = "library.view";
// Done stages are folded away by default (concept: "Liste klappt, was
// erledigt ist").
const DEFAULT_COLLAPSED = ["shot", "online"];

const [grouping, setGroupingSignal] = createSignal<Grouping>("stage");
const [sort, setSortSignal] = createSignal<SortKey>("updated");
const [collapsed, setCollapsedSignal] = createSignal<Set<string>>(new Set(DEFAULT_COLLAPSED));

let runtime: { active: boolean; loaded: boolean; kv: KvStore; writer: ReturnType<typeof createStatePersistence>; stop(): void } | undefined;
export function startLibraryPrefs(kv = getKvStore()): () => void {
  if (runtime?.active) return runtime.stop;
  const writer = createStatePersistence(kv, PREFS_KEY);
  setGroupingSignal("stage"); setSortSignal("updated"); setCollapsedSignal(new Set(DEFAULT_COLLAPSED));
  const current = {
    active: true, loaded: false, kv, writer,
    stop() {
      if (!current.active) return;
      current.active = false; writer.dispose();
      if (runtime === current) runtime = undefined;
    },
  };
  runtime = current;
  return current.stop;
}
/** Loading may start the runtime (setup always does so first). Setters never
 *  start one: after teardown they must not persist through a stray runtime. */
function ensureRuntime() {
  if (!runtime) startLibraryPrefs();
  return runtime!;
}

function isGrouping(v: unknown): v is Grouping {
  return v === "stage" || v === "folder" || v === "none";
}
function isSort(v: unknown): v is SortKey {
  return v === "updated" || v === "created" || v === "title";
}

function persist(): void {
  const payload = JSON.stringify({
    grouping: grouping(),
    sort: sort(),
    collapsed: [...collapsed()],
  });
  runtime?.writer.schedule(payload);
}

export const libraryPrefs = {
  grouping,
  sort,
  collapsed,
  setGrouping(v: Grouping) {
    setGroupingSignal(v);
    persist();
  },
  setSort(v: SortKey) {
    setSortSignal(v);
    persist();
  },
  isCollapsed: (key: string) => collapsed().has(key),
  toggleCollapsed(key: string) {
    const next = new Set(collapsed());
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setCollapsedSignal(next);
    persist();
  },
  async load(isActive: () => boolean = () => true): Promise<void> {
    const current = ensureRuntime();
    if (current.loaded) return;
    try {
      const raw = await current.kv.getAppState(PREFS_KEY);
      if (!current.active || !isActive()) return;
      if (!raw) {
        current.loaded = true;
        return;
      }
      const parsed = JSON.parse(raw) as { grouping?: unknown; sort?: unknown; collapsed?: unknown };
      if (isGrouping(parsed.grouping)) setGroupingSignal(parsed.grouping);
      if (isSort(parsed.sort)) setSortSignal(parsed.sort);
      if (Array.isArray(parsed.collapsed)) {
        setCollapsedSignal(new Set(parsed.collapsed.filter((k): k is string => typeof k === "string")));
      }
      current.loaded = true;
    } catch {
      /* defaults */
    }
  },
};
